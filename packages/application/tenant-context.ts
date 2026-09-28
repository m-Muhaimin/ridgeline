export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type PoolClientLike = Queryable & { release: () => void };

export type Connectable = {
  connect: () => Promise<PoolClientLike>;
};

export async function runTenantQuery<T>(
  db: Connectable,
  orgId: string,
  userId: string | null,
  callback: (client: Queryable) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_organization_id', $1, true);`, [orgId]);
    if (userId) {
      await client.query(`SELECT set_config('app.current_user_id', $1, true);`, [userId]);
    }
    try {
      await client.query('SET LOCAL ROLE ridgeline_app;');
    } catch (e) {
      // Role might not be provisioned yet in preview environment
    }
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
