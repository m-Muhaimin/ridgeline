# syntax=docker/dockerfile:1
#
# RidgeLine API image — Express: routes, AI pipeline, Neon, auth, Twilio webhooks (:3000).
#
# Build context is the REPO ROOT (see docker-compose.yml). The web app is a
# separate image built from apps/web as its own context and is deliberately not
# part of this one.
#
# Installer: bun, not npm. The only committed root lockfile is bun.lock
# (lockfileVersion 2 / configVersion 1) — there is no root package-lock.json and
# regenerating one is not an option, so `npm ci` cannot be used here.

# ---------------------------------------------------------------------------
# deps — resolve exactly what bun.lock pins
# ---------------------------------------------------------------------------
FROM node:22-slim AS deps
WORKDIR /app

# 1.4.2 is the bun that produced the committed lockfile.
RUN npm install -g bun@1.4.2

# Only these two files are visible to this stage. If apps/web were in scope, bun
# could re-resolve the workspace graph and drift away from the frozen lockfile.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# `npm start` runs `tsx server.ts` and tsx lives in devDependencies. Fail the
# build here, loudly, instead of failing at container start with "tsx: not found".
RUN test -x node_modules/.bin/tsx

# ---------------------------------------------------------------------------
# runtime — node + the installed tree + the app sources
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app

# production = fail closed: Twilio signature verification becomes mandatory
# (no dev bypass) and session cookies become Secure/None. See README for the
# plain-HTTP caveat before overriding this.
ENV NODE_ENV=production \
    PORT=3000 \
    PATH=/app/node_modules/.bin:$PATH \
    npm_config_cache=/tmp/.npm \
    npm_config_update_notifier=false

# Unprivileged, shell-less, home-less. uid/gid 1001 avoids the image's built-in
# `node` account (1000). The API opens no outbound ports and writes no files.
RUN groupadd --system --gid 1001 app \
 && useradd --system --uid 1001 --gid 1001 --no-create-home \
            --home-dir /nonexistent --shell /usr/sbin/nologin app

COPY --from=deps --chown=1001:1001 /app/node_modules ./node_modules
COPY --chown=1001:1001 package.json server.ts ./
COPY --chown=1001:1001 packages/ ./packages/

USER 1001:1001
EXPOSE 3000

# node:22-slim ships no curl/wget, so probe with node's own fetch. /api/health
# is unauthenticated and does not touch Postgres, so it isolates "the process is
# serving" from "the database is reachable".
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Same start mechanism as local dev — npm/tsx stays the app's entry point.
CMD ["npm", "start"]
