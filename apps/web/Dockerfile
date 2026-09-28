# syntax=docker/dockerfile:1
#
# RidgeLine web image — Next.js App Router UI (:3001).
#
# Build context is apps/web ONLY (see docker-compose.yml): this image must stay
# independent of the API, which is what keeps the browser on a single origin.

# ---------------------------------------------------------------------------
# deps — the web app is its own npm install with its own committed lockfile
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# build — `next build` typechecks and lints, so a broken build fails here
# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# API_ORIGIN is a BUILD argument, not just a runtime one: `rewrites()` is
# evaluated at build time and baked into .next/routes-manifest.json, which is
# what `next start` serves. Setting it only in `environment:` would leave the
# container rewriting /api/* at http://localhost:3000. docker-compose.yml feeds
# the same value to both the build and the runtime.
ARG API_ORIGIN=http://localhost:3000
ENV API_ORIGIN=$API_ORIGIN

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# prod-deps — devDependencies (tailwind, typescript, @types/*) are not needed
# to serve the already-built .next output
# ---------------------------------------------------------------------------
FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false

# Runtime value of the same variable the build used; `next start` re-reads
# next.config.ts, so it must agree with what was baked in.
ARG API_ORIGIN=http://localhost:3000
ENV API_ORIGIN=$API_ORIGIN

RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid 1001 --no-create-home \
            --home-dir /nonexistent --shell /usr/sbin/nologin app

COPY --from=prod-deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --from=build --chown=1001:1001 /app/.next ./.next
COPY --chown=1001:1001 package.json next.config.ts ./
# NOTE: next.config.ts is needed at boot because the /api/* rewrite lives in it.
# It is transpiled with Next's bundled SWC, so the `typescript` devDependency
# being absent from prod-deps is fine.

USER 1001:1001
# The `start` script pins the port (`next start -p 3001`); Next binds 0.0.0.0 by
# default, so the edge container can reach it.
EXPOSE 3001

# node:22-slim ships no curl/wget. GET / is a client-rendered route, so it
# answers 200 without depending on the API — the API's own health is checked by
# the api service and by compose's `depends_on: service_healthy`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["npm", "run", "start"]
