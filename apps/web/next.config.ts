import type { NextConfig } from 'next';

const API_ORIGIN = 'http://localhost:3000';

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
