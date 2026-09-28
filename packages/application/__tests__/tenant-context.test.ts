import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTenantQuery, type Connectable, type PoolClientLike } from '../tenant-context.js';

type Call = { text: string; params: unknown[] };

/**
 * A stand-in for a Postgres client: records every statement, no server, no
 * database, no network. `throwOn` makes one statement reject, so a rollback or
 * a tolerated `SET LOCAL ROLE` failure can be observed.
 */
function fakeDb(throwOn?: string) {
  const calls: Call[] = [];
  const state = { releases: 0 };
  const client: PoolClientLike = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (throwOn && text === throwOn) throw new Error(`failed: ${text}`);
      return { rows: [] };
    },
    release() {
      state.releases += 1;
    },
  };
  const db: Connectable = { connect: async () => client };
  return { db, state, calls };
}

const texts = (calls: Call[]) => calls.map((c) => c.text);

test('happy path: BEGIN, org, user, role, callback, COMMIT, release once', async () => {
  const { db, state, calls } = fakeDb();

  const result = await runTenantQuery(db, 'org-1', 'user-7', async (client) => {
    await client.query('SELECT 1 FROM business_hours');
    return 'done';
  });

  assert.deepEqual(texts(calls), [
    'BEGIN',
    `SELECT set_config('app.current_organization_id', $1, true);`,
    `SELECT set_config('app.current_user_id', $1, true);`,
    'SET LOCAL ROLE ridgeline_app;',
    'SELECT 1 FROM business_hours',
    'COMMIT',
  ]);
  assert.deepEqual(calls[1]!.params, ['org-1'], 'org id is bound, not interpolated');
  assert.deepEqual(calls[2]!.params, ['user-7'], 'user id is bound, not interpolated');
  assert.equal(state.releases, 1, 'release called exactly once');
  assert.equal(result, 'done', 'returns the callback result');
});

test('null userId: no app.current_user_id set_config is issued', async () => {
  const { db, state, calls } = fakeDb();

  const result = await runTenantQuery(db, 'org-1', null, async (client) => {
    await client.query('SELECT 2');
    return 42;
  });

  assert.deepEqual(texts(calls), [
    'BEGIN',
    `SELECT set_config('app.current_organization_id', $1, true);`,
    'SET LOCAL ROLE ridgeline_app;',
    'SELECT 2',
    'COMMIT',
  ]);
  assert.equal(calls.some((c) => c.text.includes('app.current_user_id')), false);
  assert.deepEqual(calls[1]!.params, ['org-1']);
  assert.equal(state.releases, 1);
  assert.equal(result, 42);
});

test('callback throws: ROLLBACK, rethrow, release still called', async () => {
  const { db, state, calls } = fakeDb();
  const boom = new Error('callback exploded');

  await assert.rejects(
    runTenantQuery(db, 'org-1', 'user-7', async (client) => {
      await client.query('SELECT 3');
      throw boom;
    }),
    /callback exploded/,
  );

  const tail = texts(calls);
  assert.equal(tail[tail.length - 1], 'ROLLBACK', 'ROLLBACK is the last statement');
  assert.equal(tail.includes('COMMIT'), false, 'no COMMIT on the failure path');
  assert.equal(state.releases, 1, 'client returned to the pool');
});

test('SET LOCAL ROLE failure is tolerated and the transaction still commits', async () => {
  const { db, state, calls } = fakeDb('SET LOCAL ROLE ridgeline_app;');
  let reached = false;

  const result = await runTenantQuery(db, 'org-1', 'user-7', async () => {
    reached = true;
    return 'committed anyway';
  });

  assert.equal(reached, true, 'callback still runs when the role is missing');
  assert.equal(result, 'committed anyway');
  assert.equal(texts(calls).includes('COMMIT'), true);
  assert.equal(texts(calls).includes('ROLLBACK'), false);
  assert.equal(state.releases, 1);
});
