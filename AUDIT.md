# Orael — Feature & Security Audit (v3.2)

> **Updated after manual approval + PIN + notifications + cron + achievements
> + promo codes + leaderboard rewards + security headers integration.**

---

## ✅ WHAT'S BEEN BUILT (current state — v3.2)

### Core Economy
- ✅ Mining engine with fixed-tank model (40 ORL/refuel, 4h sessions)
- ✅ 5 rig tiers (Rig I-V) with faster drain rates
- ✅ 5 tier multipliers (Bronze → Diamond)
- ✅ Pro subscription (250 Telegram Stars/mo) with 2× mining + free daily chest
- ✅ Boost (1.2× for 4h via 1 ad)
- ✅ Daily login streak (7 days, 1,950 ORL total)
- ✅ 2-tier referral system (L1 8%, L2 2%)
- ✅ All rewards calibrated to ≤29% payout ratio at real $2.24 CPM

### Games & Earn Features
- ✅ Lucky Spin (unlimited, 1 ad per spin)
- ✅ Scratch card (unlimited, 1 ad per scratch)
- ✅ Coin Flip (unlimited, 1 ad per flip)
- ✅ Mystery Chest (5 ads → 200-280 ORL)
- ✅ Hourly Faucet (1 ad → 35 ORL)
- ✅ Video Ads Wall (unlimited, 1 ad → 40 ORL)
- ✅ Daily Ad Challenge (10/25/50 ads → +70/+140/+350 bonus)
- ✅ Daily Lottery (500 ORL/ticket or free via ad)
- ✅ Watch & Earn tasks + Featured partner tasks
- ✅ Adsgram Tasks web component

### Payouts (Flutterwave — FULLY INTEGRATED, real API)
- ✅ Real bank transfer via Flutterwave v3 API
- ✅ Real airtime purchase via Flutterwave bills payment API
- ✅ USDT TRC20 (manual admin processing)
- ✅ List Nigerian banks (live from Flutterwave, cached 1h)
- ✅ Account number resolution (verify → account name)
- ✅ Save up to 3 bank accounts per user
- ✅ Flutterwave webhook with `verif-hash` signature verification
- ✅ Transfer status updates (SUCCESSFUL → completed, FAILED → refund)
- ✅ Airtime status webhooks (singlebillpayment.status)
- ✅ Idempotency keys on all Flutterwave calls
- ✅ Retry with exponential backoff on 429

### Withdrawal Security (NEW in v3.2)
- ✅ **Withdrawal PIN** — 4-digit PIN set by user, required for ALL withdrawals
  - SHA-256 hashed with per-user salt (telegram_id)
  - Weak PINs blocked (0000, 1111, 1234, etc.)
  - Set via `/api/wallet/set-pin`, verified via `/api/wallet/verify-pin`
- ✅ **Manual admin approval for large withdrawals** — withdrawals ≥ 100,000 ORL
  (₦2,000) require admin approval BEFORE Flutterwave transfer is initiated
- ✅ USDT withdrawals ALWAYS require manual approval (no automation)
- ✅ Daily withdrawal cap: 500,000 ORL (₦10,000)
- ✅ Monthly withdrawal cap: 5,000,000 ORL (₦100,000)
- ✅ Max single withdrawal: 200,000 ORL (₦4,000)
- ✅ 1 pending withdrawal per user at a time
- ✅ Audit log for ALL withdrawal actions (user + admin + system)

### Notifications (NEW in v3.2)
- ✅ Telegram bot push notifications for all withdrawal events:
  - ✅ Withdrawal completed (with amount + method)
  - Withdrawal failed + refunded (with reason)
  - Withdrawal pending admin approval
- ✅ Admin notification when large withdrawal needs approval
- ✅ Pro subscription activation message
- ✅ Lottery win notification (existing in db.js)
- ✅ Achievement unlock notifications (via bot)

### Admin & Moderation
- ✅ Super admin via `ADMIN_IDS` env var
- ✅ Mod role with 6 granular permissions
- ✅ Admin panel at `/admin` (dashboard, users, withdrawals, transactions)
- ✅ Ban/unban users
- ✅ Adjust user balances
- ✅ Process withdrawals (approve/reject)
- ✅ **NEW: Approve large withdrawals → triggers real Flutterwave transfer**
- ✅ **NEW: Re-query Flutterwave for stuck withdrawals** (`/admin/withdrawals/:id/requery`)
- ✅ **NEW: Bulk process withdrawals** (`/admin/withdrawals/bulk-process`)
- ✅ Promote users to mod/admin
- ✅ Audit log for all admin actions
- ✅ **NEW: Manual DB backup button** (`/admin/backup-db`)
- ✅ **NEW: Promo code management** (create/list/deactivate)

### Background Tasks (NEW in v3.2 — cron.js)
- ✅ **Stuck withdrawal recovery** — every 15 min, polls Flutterwave for
  pending withdrawals older than 1 hour. Updates status + sends notifications.
- ✅ **Daily DB backup** — at 3 AM, copies `data/orael.db` to
  `data/backups/orael-YYYY-MM-DD.db`. Keeps last 14 backups.
- ✅ **Weekly leaderboard rewards** — Sundays at midnight, distributes
  50,000 ORL pool to top 20 miners (proportional to balance).

### Gamification (NEW in v3.2)
- ✅ **10 achievements** with auto-unlock:
  - ⛽ First Refuel · 💰 First Payout · 🔥 Week Warrior (7-day streak)
  - 👥 Recruiter (10 referrals) · 📺 Ad Master (100 ads) · 🏆 Ad Legend (500 ads)
  - 🎰 Big Winner (500+ ORL spin) · 🎁 Chest Master (10 chests)
  - 👑 Pro Member · 💎 Saver (100k ORL balance)
- ✅ `/api/user/achievements` endpoint returns all achievements + unlock status

### Promo Codes (NEW in v3.2)
- ✅ Admin can create promo codes with reward amount, max uses, expiry
- ✅ Users redeem via `/api/user/redeem-promo`
- ✅ One redemption per user per code
- ✅ Usage counter + auto-deactivation when max_uses reached
- ✅ Admin panel management (create, list, deactivate)

### UX & Design
- ✅ Premium "Sapphire & Gold" design system
- ✅ 6-step onboarding tutorial
- ✅ Animated Telegram gate (particle field, rotating rings, shimmer)
- ✅ 4-variant toast notification system (success/error/info/reward)
- ✅ Confetti on big wins
- ✅ Number count-up on balance changes
- ✅ Ripple on button clicks
- ✅ Screen slide transitions
- ✅ Scroll-reveal cards
- ✅ Pulse glow on actionable items
- ✅ Live mining indicator
- ✅ Paginated transaction + withdrawal history
- ✅ Telegram profile photos for avatars + leaderboard

### Infrastructure
- ✅ Docker (multi-stage Dockerfile + docker-compose)
- ✅ install.sh one-command installer
- ✅ Health check endpoint
- ✅ Persistent DB volume
- ✅ Log rotation

### Security (v3.2 — significantly hardened)
- ✅ Telegram initData HMAC-SHA256 verification (24h freshness)
- ✅ Banned user blocking
- ✅ Rate limiting (120/min general, 20/min actions, 5/min sensitive)
- ✅ Per-user sliding window buckets
- ✅ Server-authoritative balances + game outcomes
- ✅ Country-based withdrawal method filtering
- ✅ Withdrawal amount validation (min per method)
- ✅ Daily + monthly + single withdrawal caps
- ✅ 1 pending withdrawal per user at a time
- ✅ **NEW: Withdrawal PIN (4-digit, SHA-256 hashed)**
- ✅ **NEW: Manual admin approval for withdrawals ≥ 100k ORL**
- ✅ Flutterwave webhook signature verification (constant-time)
- ✅ Idempotency keys on Flutterwave API calls
- ✅ Audit log for sensitive actions
- ✅ **NEW: HTTPS redirect in production**
- ✅ **NEW: HSTS header (1 year, includeSubDomains, preload)**
- ✅ **NEW: Content-Security-Policy header** (restricts scripts/styles/img)
- ✅ **NEW: Permissions-Policy header** (disables camera/mic/geo)
- ✅ **NEW: Request body size limit (10kb)**
- ✅ **NEW: Sanitized request logger (no PII, no tokens in logs)**
- ✅ X-Content-Type-Options, X-Frame-Options, X-XSS-Protection headers
- ✅ CORS restricted to DOMAIN + localhost

---

## ❌ WHAT'S STILL MISSING

### 🟡 MEDIUM PRIORITY

1. **USDT withdrawal automation** — Currently USDT requires manual admin processing.
   Could integrate a TRC20 USDT dispatcher (Tatum, TronGrid, custom Tron wallet).

2. **Fraud detection system** — No automated detection of:
   - Multiple accounts from same device/IP
   - Unusual withdrawal patterns
   - Referral farming (self-invite via VPN)
   - Recommended: fingerprint via Telegram's `initDataUnsafe` + IP logging + heuristics

3. **Webhook retry queue** — If our webhook handler fails to respond 200, Flutterwave
   retries 3×. But if we crash mid-processing, we lose the event. Could add a
   persistent queue (BullMQ + Redis) for retrying failed webhook processing.
   Current mitigation: cron polls Flutterwave every 15 min for stuck withdrawals.

4. **Multi-language** — Currently English-only. Add Yoruba, Hausa, Igbo, Pidgin.

5. **In-app support chat** — Link to a Telegram support group.

6. **PWA support** — Add manifest.json + service worker for installable PWA.

### 🟢 LOW PRIORITY

7. Transaction export (CSV/PDF)
8. Dark/light theme toggle
9. Daily challenges beyond the ad challenge (e.g. "Mine 100 ORL today")
10. Email notifications (in addition to Telegram push)

---

## 🔒 SECURITY AUDIT — Current Posture (v3.2)

### ✅ Strong Controls

| Control | Status | Notes |
|---|---|---|
| Telegram initData verification | ✅ Strong | HMAC-SHA256, 24h expiry, timing-safe compare |
| Server-authoritative balances | ✅ Strong | Client never writes balance |
| Server-authoritative game outcomes | ✅ Strong | All RNG server-side |
| Banned user enforcement | ✅ Strong | Checked in auth middleware |
| Rate limiting (3 tiers) | ✅ Strong | 120/20/5 per-min, sliding window |
| **Withdrawal PIN** | ✅ Strong | **NEW: 4-digit, SHA-256 + salt, weak-PIN blocklist** |
| **Manual approval threshold** | ✅ Strong | **NEW: 100k ORL triggers admin review** |
| Flutterwave webhook signature | ✅ Strong | Constant-time `verif-hash` comparison |
| Idempotency on Flutterwave calls | ✅ Strong | X-Idempotency-Key prevents duplicates |
| Withdrawal amount validation | ✅ Strong | Min per method, max single, daily, monthly caps |
| 1 pending withdrawal limit | ✅ Strong | Prevents balance draining |
| Country-based withdrawal filtering | ✅ Good | NG-only methods hidden for non-NG |
| CORS allowlist | ✅ Good | Restricted to DOMAIN + localhost |
| **CSP header** | ✅ Strong | **NEW: restricts script/style/img sources** |
| **HSTS header** | ✅ Strong | **NEW: 1 year + preload** |
| **Permissions-Policy** | ✅ Good | **NEW: camera/mic/geo disabled** |
| **Request body size limit** | ✅ Good | **NEW: 10kb max** |
| **HTTPS redirect** | ✅ Strong | **NEW: production force-HTTPS** |
| Security headers | ✅ Good | nosniff, DENY frame, XSS protection, referrer-policy |
| Audit logging | ✅ Strong | All admin + withdrawal actions logged |
| Input validation | ✅ Strong | NUBAN, phone, TRC20, PIN format |
| **Sanitized logs** | ✅ Good | **NEW: no PII/tokens in request logs** |
| **Daily DB backups** | ✅ Good | **NEW: 3 AM daily, 14-day retention** |

### ⚠️ Remaining Gaps

| Gap | Severity | Recommendation |
|---|---|---|
| `.env` + `data/orael.db` in git history | 🟡 Medium | Repo is private so risk is lower, but rotate secrets if any contributor leaves |
| No 2FA for admin actions | 🟡 Low | Telegram login + admin role check is reasonable. Could add TOTP for >500k ORL balance adjustments |
| No webhook IP allowlist | 🟢 Low | Signature verification is sufficient protection |
| No encryption at rest | 🟢 Low | SQLite is plaintext. Consider SQLCipher if PII grows |
| No double-spend protection on mining | 🟢 Low | `last_accrue_at` + server-side accrual mitigates this |

---

## 📋 Pre-Launch Checklist (v3.2)

- [ ] Set `FLW_SECRET_KEY` and `FLW_SECRET_HASH` in production `.env`
- [ ] Register webhook URL `https://yorubacinemax.xyz/api/flutterwave-webhook` on Flutterwave dashboard
- [ ] Set webhook secret hash on Flutterwave dashboard (must match `FLW_SECRET_HASH`)
- [ ] Set `ADMIN_IDS` to your Telegram user ID(s)
- [ ] Test bank transfer with ₦100 (test mode first)
- [ ] Test airtime with ₦50
- [ ] Test withdrawal PIN set + verify flow
- [ ] Test large withdrawal (≥100k ORL) → verify admin approval triggers
- [ ] Test webhook signature verification
- [ ] Verify cron jobs running (check server logs for `[cron]` messages)
- [ ] Verify daily DB backup directory exists: `data/backups/`
- [ ] Configure Docker logs rotation (already done in docker-compose)
- [ ] Set up monitoring/alerting for failed withdrawals

---

## 📊 File Inventory (v3.2)

### Server (23 files)
```
server/
├── index.js                  — Express app + security headers + HTTPS redirect + cron startup
├── auth.js                   — Telegram initData verification
├── bot.js                    — Telegram bot polling + Pro payment handler + achievement unlock
├── db.js                     — SQLite schema + all helpers (withdrawals, bank accounts, promo codes, achievements, audit log, backups)
├── economy.js                — All economy constants + manual approval threshold
├── middleware/
│   ├── adminAuth.js          — Admin/mod role + permission checking
│   └── rateLimit.js          — 3-tier rate limiting (general/action/sensitive)
├── routes/
│   ├── user.js               — User state + tutorial + transactions + withdrawals + promo redemption + achievements
│   ├── mining.js             — Refuel/boost/rig-upgrade + pro-chest + achievement unlock
│   ├── play.js               — Spin/scratch/chest/coinflip/lottery + achievement unlock
│   ├── earn.js               — Faucet/tasks/video-wall/streak + achievement unlock
│   ├── wallet.js             — Full Flutterwave integration + PIN + manual approval + notifications
│   ├── leaderboard.js        — Weekly leaderboard
│   └── admin.js              — Admin panel + withdrawal approve/reject + re-query + bulk + promo codes + backup
└── services/
    ├── mining.js             — Mining accrual logic
    ├── referral.js           — 2-tier referral commission + achievement unlock
    ├── adTracking.js         — Daily ad challenge + lifetime ad counter + achievement unlock
    ├── flutterwave.js        — Real Flutterwave v3 API client (banks, resolve, transfer, airtime, webhook verify)
    ├── notifications.js      — Telegram bot push notifications (8 notification types)
    └── cron.js               — Background tasks (stuck withdrawal polling, DB backup, weekly leaderboard)
```

### Frontend (12 files)
```
src/
├── main.js                   — Boot sequence + animation systems init
├── api.js                    — Fetch wrapper (attaches Telegram initData)
├── state.js                  — State store + localStorage cache
├── telegram.js               — Telegram WebApp SDK wrapper
├── ui.js                     — Master render + 4-variant toast + reward burst
├── ads.js                    — Adsgram rewarded ad player
├── mining.js                 — Mining UI actions
├── play.js                   — Play screen UI + coin flip + confetti
├── earn.js                   — Earn screen UI + video wall
├── wallet.js                 — Wallet UI + bank selection + PIN flow
├── tutorial.js               — 6-step onboarding
├── animations.js             — Count-up, ripple, confetti, scroll-reveal, parallax
└── styles/                   — 10 CSS files (base, layout, components, miner, play, earn, wallet, overlays, animations, index)
```

### Public (2 files)
```
public/
├── admin.html                — Admin panel HTML
└── admin.js                  — Admin panel JS (dashboard, users, withdrawals, transactions)
```

### Config (8 files)
```
.env                          — Real secrets (BOT_TOKEN, FLW_SECRET_KEY, etc.) — tracked in private repo
.env.example                  — Template
.gitignore                    — Ignores node_modules, dist, backups, logs
Dockerfile                    — Multi-stage build
docker-compose.yml            — Production deployment
.dockerignore                 — Docker build exclusions
install.sh                    — One-command installer
package.json                  — v3.2.0 with Docker scripts
```

### Documentation (4 files)
```
README.md                     — Project overview + setup
ECONOMY_CALCULATIONS.md       — Full economy math + payout ratios
FINANCIAL_MODEL.md            — Production financial model + revenue projections
AUDIT.md                      — This file
```
