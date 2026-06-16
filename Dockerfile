# Multi-stage build:
#   1. builder — install ALL deps, run `vite build` → dist/
#   2. runtime — copy server + ontology + built dist/, install ONLY prod deps
#
# Result is ~150MB and starts in <1s.

# ---------- 1. builder ----------
FROM node:24-slim AS builder
WORKDIR /app

# Cache deps first
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# Source needed for vite build
COPY client    ./client
COPY public    ./public
COPY server    ./server
COPY scripts   ./scripts

RUN npm run build && \
    node server/src/ontology.test.mjs

# ---------- 2. runtime ----------
FROM node:24-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3005
ENV HOST=0.0.0.0

WORKDIR /app

# Prod-only deps (no vite / playwright / concurrently)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && \
    npm cache clean --force

# Built client + server source + ontology generator
COPY --from=builder /app/dist   ./dist
COPY --from=builder /app/server ./server

EXPOSE 3005

# Non-root user
RUN useradd -r -u 10001 -m matrix && chown -R matrix:matrix /app
USER matrix

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3005)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.mjs"]
