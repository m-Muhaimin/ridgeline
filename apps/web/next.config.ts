import type { NextConfig } from 'next';

// Where the /api/* rewrite points. Defaults to the local dev API on :3000, so
// `npm run dev:web` and direct :3001 access are unchanged. When the web app runs
// as its own container, set API_ORIGIN to the API service's in-network address
// (docker compose: http://api:3000). Note this is read at BUILD time too — the
// rewrite is baked into .next — so a container build needs it as a build arg.
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:3000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Only /api/* is proxied. /webhooks/* is deliberately NOT proxied: in dev
  // Twilio never talks to :3001, and in production the host routes webhooks
  // straight to Express (PLAN §2.2).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
