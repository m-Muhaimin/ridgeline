'use client';

import { useEffect, useState } from 'react';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'json'; payload: unknown }
  | { kind: 'raw'; httpStatus: number; body: string };

export default function HealthPage() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Bare fetch on purpose: lib/apiFetch is task 2's deliverable. This page
        // exists to prove a *relative* /api/* request survives the
        // :3001 -> :3000 rewrite, so it must not depend on any app lib.
        // credentials: 'include' keeps the session cookie on the request path.
        const res = await fetch('/api/neon/status', { credentials: 'include' });
        const body = await res.text();
        if (cancelled) return;
        try {
          setState({ kind: 'json', payload: JSON.parse(body) });
        } catch {
          setState({ kind: 'raw', httpStatus: res.status, body: body.slice(0, 200) });
        }
      } catch (err) {
        if (cancelled) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="p-4 text-sm font-mono text-neutral-700">
      <h1 className="font-head">RidgeLine proxy health</h1>
      <p>GET /api/neon/status (rewritten to http://localhost:3000)</p>
      {renderState(state)}
    </main>
  );
}

function renderState(state: HealthState) {
  if (state.kind === 'loading') return <p>…</p>;
  if (state.kind === 'error') return <p>Request failed: {state.message}</p>;
  if (state.kind === 'raw') {
    return <p>HTTP {state.httpStatus} — {state.body}</p>;
  }
  return <pre>{JSON.stringify(state.payload, null, 2)}</pre>;
}
