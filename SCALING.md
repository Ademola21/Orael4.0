# Orael — Scaling to 1M+ Users

This document explains the architecture, current performance characteristics,
and the migration path from SQLite to PostgreSQL for 1M+ user scale.

## Current Architecture (SQLite — up to ~100k users)

```
                    ┌─────────────────────────────────┐
                    │         Caddy (HTTPS)            │
                    │   reverse proxy + load balancer  │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     Orael App (Node + Express)   │
                    │  ┌──────────────────────────┐    │
                    │  │  better-sqlite3 (WAL)     │    │  ← single file, single writer
                    │  │  data/orael.db            │    │
                    │  └──────────────────────────┘    │
                    │  + Telegram bot (long-poll)      │
                    └──────────────────────────────────┘
```

### Performance Characteristics (better-sqlite3 + WAL)

| Metric | Value |
|---|---|
| Write throughput | ~50,000 writes/sec (native C++ binding) |
| Read concurrency | Unlimited (WAL allows concurrent readers + 1 writer) |
| DB file size (1M users) | ~500MB–2GB (fits in memory cache) |
| Query latency (indexed) | <1ms |
| Backup | Online (safe during traffic) |

**This handles ~100k concurrent users comfortably on a single $20/month VPS.**

### Optimizations Already Applied

1. **better-sqlite3** (not sql.js) — native, WAL mode, incremental writes (no full-DB-export)
2. **WAL mode** + `synchronous=NORMAL` — concurrent reads, fast writes, safe on power loss
3. **busy_timeout=5000ms** — waits on write contention instead of throwing
4. **64MB cache** — hot data stays in memory
5. **20 indexes** — leaderboard, transaction history, withdrawal queue, audit log, referral tree all indexed
6. **gzip compression** — 5-10x bandwidth reduction on JSON responses
7. **Static asset caching** — Vite-hashed JS/CSS cached 1 year (immutable), HTML never cached
8. **Atomic mining accrual** — single `UPDATE balance=balance+?, tank_mined=tank_mined+?` (was 3 separate writes)
9. **Micro-transaction suppression** — mining amounts < 0.001 ORL don't log a transaction row (avoids billions of rows)
10. **Weighted SQL lottery** — `ORDER BY random()/tickets` (was OOM-prone array building)
11. **Cron leadership** — `CRON_LEADER=true` on one replica prevents duplicate backups/rewards
12. **Graceful shutdown** — WAL checkpoint on SIGTERM (no data loss)

---

## Production Architecture (PostgreSQL — 1M+ users)

```
                    ┌─────────────────────────────────┐
                    │         Caddy (HTTPS)            │
                    │   reverse proxy + load balancer  │
                    └──────────────┬──────────────────┘
                                   │ round-robin
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼───────┐  ┌────────▼───────┐  ┌────────▼───────┐
     │  Orael App #1  │  │  Orael App #2  │  │  Orael App #N  │
     │  CRON_LEADER=  │  │  CRON_LEADER=  │  │  CRON_LEADER=  │
     │  true          │  │  false         │  │  false         │
     └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
             │                   │                   │
             └───────────┬───────┴───────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
  ┌───────▼──────┐ ┌────▼─────┐ ┌──────▼──────┐
  │ PostgreSQL 16│ │  Redis 7 │ │  Bot (1×)   │
  │  (primary)   │ │ (cache + │ │ Telegram    │
  │              │ │  rate    │ │ long-poll   │
  │              │ │  limit)  │ │ (1 only)    │
  └──────────────┘ └──────────┘ └─────────────┘
```

### Deploy

```bash
# 1. Set up .env with real secrets (BOT_TOKEN, FLW_SECRET_KEY, POSTGRES_PASSWORD, etc.)
cp .env.example .env
nano .env

# 2. Launch the full stack
docker compose -f docker-compose.prod.yml up -d

# 3. Scale the app to more replicas (each handles ~50k concurrent users)
docker compose -f docker-compose.prod.yml up -d --scale orael=4
```

### Why PostgreSQL for 1M+?

| | SQLite (better-sqlite3) | PostgreSQL |
|---|---|---|
| Writers | 1 at a time (WAL) | Unlimited (MVCC) |
| Horizontal scaling | Single machine | Read replicas + sharding |
| Max DB size | ~2TB practical | Unlimited |
| Concurrent connections | 1 process | Thousands (connection pool) |
| Backup | Online backup API | pg_basebackup, PITR |
| Full-text search | FTS5 | Built-in + tsvector |
| Suitable for | <100k users | 100k–100M+ users |

### Migration Path: SQLite → PostgreSQL

The codebase is structured so ALL database access goes through `server/db.js`.
To migrate to PostgreSQL:

1. **Change the driver**: Replace `better-sqlite3` with `pg` (node-postgres) or Prisma
2. **Update `db.js` internals**: Rewrite `getOne/getAll/run` to use the pg pool
   (functions become async — update callers to `await`)
3. **Update the schema**: SQLite types → Postgres types
   (`INTEGER` → `BIGINT`, `REAL` → `NUMERIC(20,6)`, `TEXT` → `TEXT`)
4. **Run `docker compose -f docker-compose.prod.yml up -d`** — starts Postgres + Redis + app
5. **Migrate data**: Export from SQLite, import into Postgres
   (`pgloader` does this automatically: `pgloader data/orael.db postgresql://orael:pass@db/orael`)

The Prisma schema at `prisma/schema.prisma` (from the original Next.js scaffold)
can be adapted — just change `provider = "sqlite"` to `provider = "postgresql"`
and run `prisma migrate deploy`.

### Redis Integration (for multi-replica)

Currently, rate limiting and broadcast job tracking are in-memory (per-process).
For multi-replica, these need to be shared:

- **Rate limiting**: Move from `Map()` to Redis (`INCR` + `EXPIRE` per user per minute)
- **Broadcast jobs**: Store job progress in Redis instead of `Map()`
- **Economy config cache**: Already DB-backed (settings table) — works across replicas
- **Cron leadership**: Already handled via `CRON_LEADER` env var

### Telegram Bot (1 instance only)

Telegram only allows ONE long-poller per bot token. In a multi-replica setup:
- Run the bot as a **separate container** (see `docker-compose.prod.yml` `bot` service)
- The app containers handle web traffic only
- For even higher scale, switch the bot from long-polling to **webhooks**
  (set a webhook URL via `setWebhook` API — then any replica can receive updates)

### Monitoring at Scale

For production monitoring, add:
- **Prometheus + Grafana** for metrics (request rate, latency, error rate, DB connections)
- **Sentry** for error tracking
- **Loki** for log aggregation (Caddy already logs JSON)
- **Uptime Kuma** for external health checks

### Resource Sizing (1M users)

| Component | CPU | RAM | Disk | Monthly Cost (est.) |
|---|---|---|---|---|
| App (×4 replicas) | 1.5 vCPU each | 1GB each | — | ~$120 |
| PostgreSQL | 4 vCPU | 8GB | 100GB SSD | ~$80 |
| Redis | 1 vCPU | 512MB | 1GB | ~$10 |
| Caddy | 0.5 vCPU | 256MB | — | ~$5 |
| **Total** | | | | **~$215/month** |

This comfortably handles 1M registered users with ~50k concurrent.
