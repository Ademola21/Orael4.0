# Orael — Telegram Mini App (Production)

AI mining faucet. Users trade attention (rewarded ads) for mining energy.
"Refuel-to-Mine" loop: a virtual engine mines ORL, then runs out of fuel;
one rewarded ad refuels it to 100%. Optional ad unlocks a 1.2× boost.

## Quick Start

### Prerequisites
- Node.js 18+ (20 LTS recommended)
- npm or yarn
- Telegram Bot Token (from @BotFather)
- Flutterwave account (for bank transfers + airtime)

### Installation

```bash
# Clone the repo
git clone https://github.com/Ademola21/Orael4.0.git
cd Orael4.0

# Install dependencies
npm install

# Copy environment file and fill in your values
cp .env.example .env
# Edit .env with your BOT_TOKEN, ADMIN_IDS, Flutterwave keys, etc.

# Development mode (runs server + client + bot concurrently)
npm run dev

# Production build
npm run build
npm start
```

### Environment Variables (.env)

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_TOKEN` | Telegram bot token from @BotFather | ✅ |
| `PORT` | Server port (default: 3000) | ❌ |
| `NODE_ENV` | `production` or `development` | ✅ |
| `DOMAIN` | Your HTTPS domain (e.g. `https://yorubacinemax.xyz`) | ✅ |
| `ADMIN_IDS` | Comma-separated Telegram user IDs who are admins | ✅ |
| `VITE_ADSGRAM_BLOCK_ID` | Adsgram rewarded ad block ID | ✅ |
| `VITE_ADSGRAM_TASK_BLOCK_ID` | Adsgram task wall block ID | ✅ |
| `ADSGRAM_SECRET` | Adsgram callback verification secret | ✅ |
| `FLUTTERWAVE_SECRET_KEY` | Flutterwave secret key | ✅ |
| `FLUTTERWAVE_ENCRYPTION_KEY` | Flutterwave encryption key | ✅ |
| `FLUTTERWAVE_PUBLIC_KEY` | Flutterwave public key | ✅ |
| `FLW_SECRET_HASH` | Flutterwave webhook verification hash | ✅ |

### Admin Access

- **Admins** are defined ONLY in `.env` via `ADMIN_IDS` (comma-separated Telegram user IDs)
- Admins **cannot** create new admins from the panel — only `.env` can add admins
- Admins **can** promote users to **moderator** role with granular permissions
- Admins **bypass ads** — all ad-gated actions work instantly for admin users
- Moderator permissions: `view_users`, `ban_users`, `adjust_balance`, `process_withdrawals`, `view_transactions`

### Telegram Setup

1. Create a bot via @BotFather
2. Set the bot's webhook URL to your domain
3. Configure the Mini App URL in BotFather (`/newapp` command)
4. Set `BOT_TOKEN` in `.env`
5. This app is Telegram-only — browser users see an "Open in Telegram" gate page

### Flutterwave Setup

1. Create a Flutterwave account at flutterwave.com
2. Get your API keys from the dashboard (Settings > API)
3. Set up a webhook URL: `https://yourdomain.com/api/flutterwave-webhook`
4. Get the webhook secret hash from Settings > Webhooks
5. Set `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_ENCRYPTION_KEY`, `FLW_SECRET_HASH` in `.env`

### Airtime (Flutterwave Bills API)

- Airtime is **free** — 0% network fee
- Users enter their Nigerian phone number
- Flutterwave auto-detects the network (MTN, Airtel, Glo, 9mobile) from the phone prefix
- Airtime is delivered **instantly** — no webhook needed
- The API call uses `POST /bills` with `type: 'AIRTIME'`, `country: 'NG'`, `customer: +234...`

### Withdrawal Methods

| Method | Fee | Processing | Notes |
|--------|-----|------------|-------|
| Airtime | **0% (Free)** | Instant via Flutterwave | Nigeria only |
| Bank (NGN) | 10% (5% Pro) | Auto via Flutterwave | Nigeria only |
| USDT (TRC20) | 10% (5% Pro) | **Manual review** | Admin sends crypto manually |

## Docker Deployment (Production)

```bash
# Build and start all services (app + Redis + Caddy + auto-backup)
docker compose up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build
```

### Docker Services

- **app**: Express.js server (port 3000) — crash recovery (max 10 retries)
- **redis**: Session caching + rate limit storage (256mb, AOF persistence)
- **caddy**: Reverse proxy + HTTPS + cache headers + rate limiting
- **backup**: Auto SQLite backup every 6 hours (keeps last 30, gzipped)

### Instant Updates (No Cache Issues)

- `index.html`: `Cache-Control: no-cache` — always fetches latest
- Static assets (JS/CSS with hashes): `Cache-Control: max-age=31536000, immutable`
- API responses: `Cache-Control: no-cache`
- When you push a new build, users get it instantly on next page load

### Database Backups

Backups run automatically via Docker:
- Every 6 hours via the `backup` container
- Stored in `orael-backups` Docker volume as gzipped SQLite files
- Keeps last 30 backups (older ones auto-deleted)
- Manual backup: `./backup.sh`

## Security Features

- ✅ Telegram initData HMAC-SHA256 signature verification
- ✅ Rate limiting (10 req/min auth, 30/min API, 5/min sensitive)
- ✅ SQL injection protection (parameterized queries throughout)
- ✅ Helmet security headers
- ✅ Custom CSP headers (restrict script/style/img sources)
- ✅ HSTS (force HTTPS for 1 year in production)
- ✅ Body size limiting (10KB max)
- ✅ CORS whitelist (only your domain)
- ✅ HTTPS redirect (production)
- ✅ Admin access via .env only (not panel)
- ✅ Admin ad bypass (admins skip all ad verification)
- ✅ PIN hashing (scrypt + salt)
- ✅ Suspicious activity monitoring (failed auth, bot behavior, multi-IP)
- ✅ Audit logging (all admin actions logged with IP + timestamp)

## Monitoring

The monitoring system (`server/services/monitoring.js`) tracks:
- Failed authentication attempts (burst detection — 5+ in 15 min = flagged)
- Rate limit hits
- Large withdrawals (>100k ORL)
- New account withdrawals (<1hr old)
- Multiple IPs per user (>10 = flagged)
- Bot-like behavior (>30 actions/minute)

All suspicious events are logged to the `audit_log` table and visible in the admin panel under each user's detail view.

## Architecture

```
Orael4.0/
├── server/                 # Express.js backend
│   ├── index.js            # App entry + middleware + static serving
│   ├── auth.js             # Telegram initData HMAC verification + monitoring
│   ├── db.js               # SQLite schema + parameterized queries
│   ├── economy.js          # All economy constants (single source of truth)
│   ├── settings.js         # Feature flags + settings
│   ├── bot.js              # Telegram bot (long-polling, Pro payments)
│   ├── middleware/
│   │   ├── adminAuth.js    # Admin/mod permission checking (.env ADMIN_IDS)
│   │   └── rateLimit.js    # Per-user rate limiting
│   ├── routes/             # user, mining, play, earn, wallet, admin, profile, leaderboard
│   └── services/
│       ├── flutterwave.js  # Bank transfers + airtime + account verification + webhooks
│       ├── mining.js       # Mining accrual service
│       ├── referral.js     # 2-tier referral commission
│       ├── adTracking.js   # Ad view tracking + verification
│       ├── notifications.js# Telegram push notifications
│       ├── cron.js         # Scheduled tasks (lottery draws, etc.)
│       └── monitoring.js   # Suspicious activity detection
├── src/                    # Frontend (vanilla JS + Vite)
│   ├── main.js             # Boot sequence + render loops
│   ├── api.js              # HTTP client (attaches Telegram initData)
│   ├── telegram.js         # Telegram WebApp SDK wrapper
│   ├── ui.js               # Master render() — runs every second
│   ├── ads.js              # Adsgram rewarded ad player
│   ├── admin.js            # Admin control panel (9 tabs)
│   └── ...
├── public/                 # Static assets (avatars, admin panel, Telegram SDK)
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # app + Redis + Caddy + auto-backup
├── Caddyfile.prod          # Production reverse proxy config
├── backup.sh               # SQLite backup script (gzip, keeps 30)
└── .env.example            # Template for environment variables
```

## The Four Screens

1. **Miner** — Balance card + hourly faucet + analog engine gauge + Refuel / Boost + Mining rig upgrade
2. **Play** — Lucky Spin (requestAnimationFrame animation), Scratch & Win (canvas, gated), Coin Flip (3D toss animation), Mystery Chest, Daily Lottery, Weekly Leaderboard
3. **Earn** — Social media tasks (X, Telegram, YouTube, Instagram, Discord, TikTok) + Video Wall + Daily streak + Featured partners + Invite
4. **Wallet** — Withdrawal UI (Bank NGN / USDT / Airtime) + PIN setup + Transaction history

## Development

```bash
# Dev mode (server + client + bot)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Note:** This app requires a real Telegram environment. Browser users will see an "Open in Telegram" gate page. There is no mock/dev mode — all data comes from the real backend.

## License

Private — © Orael 2024
