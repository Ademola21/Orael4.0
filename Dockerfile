# ─────────────────────────────────────────────────────────────
#  Orael — Production Dockerfile (scalability-optimized)
#  Multi-stage build: Vite frontend → minimal Node runtime.
#  Runs as non-root, handles SIGTERM gracefully, serves gzip.
# ─────────────────────────────────────────────────────────────

# ---- Stage 1: Build frontend ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install build tools for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++ libc6-compat

# Install ALL dependencies (including devDeps for vite build)
COPY package*.json ./
RUN npm ci

# Copy source and build the frontend
COPY . .
RUN npm run build

# ---- Stage 2: Production runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

# Install runtime libs + build tools for compiling better-sqlite3
RUN apk add --no-cache libc6-compat curl tini python3 make g++

# Install only production dependencies (no devDeps → smaller image)
COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++ && npm cache clean --force

# Copy built frontend from the builder stage (only dist/ — not src/)
COPY --from=builder /app/dist ./dist

# Copy server source + public assets
COPY server ./server
COPY public ./public
COPY orael_logo.svg ./

# Create data directory for SQLite (mounted as a volume in prod)
RUN mkdir -p /app/data && chown -R node:node /app

# ── Run as non-root user for security (node:20-alpine includes the `node` user) ──
USER node

# Environment defaults (overridden by .env / docker-compose)
ENV NODE_ENV=production
ENV PORT=3000
ENV DOMAIN=https://yorubacinemax.xyz

# Expose port
EXPOSE 3000

# Health check — verifies the Express server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# ── Graceful shutdown ──
# Node handles SIGTERM natively (our db.js checkpoint-on-exit handler runs).
# Using `npm run start:server` (NOT `npm run start` which includes the bot) so
# the bot can run as a SEPARATE container for independent scaling/restart.
# If you need the bot in the same container, use `npm run start` instead.
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]
