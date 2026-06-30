# Orael — Economy Calculations (Final Design)

> **Full economy overhaul — June 2026.**
> Calibrated against real Adsgram CPM ($2.24). Designed for maximum user
> earnings while keeping the platform profitable at every CPM level.

---

## 1. The Peg (my decision)

**1 ORL = ₦0.03 = $0.00002 → $1 = 50,000 ORL**

Why this peg:
- ✅ Big exciting numbers (30 ORL per ad, not $0.0007)
- ✅ Min withdrawal 50,000 ORL = $1 = ₦1,500 (meaningful cash)
- ✅ Easy mental math (50,000 ORL = $1)
- ✅ Airtime at 20,000 ORL = ₦600 — reachable in ~20 days

---

## 2. Real Per-Ad Revenue (from your Adsgram dashboard)

| Metric | Value |
|---|---|
| Weighted CPM (June 2026) | **$2.24** per 1,000 views |
| Per single ad view | $0.00224 USD |
| In NGN | ₦3.36 |
| **In ORL** | **112 ORL** |

### Payout ceilings (35% margin rule)
| CPM scenario | Per-ad revenue | 35% ceiling |
|---|---|---|
| **Real (current)** $2.24 | 112 ORL | 39.2 ORL |
| Conservative $1.80 | 90 ORL | 31.5 ORL |
| Pessimistic $1.50 | 75 ORL | 26.3 ORL |

---

## 3. Final Reward Schedule (my decision)

| Feature | Ads | Reward | Per-ad ORL | Payout % |
|---|---|---|---|---|
| Refuel engine | 1 | 30 ORL (full tank) | 30 | 26.8% ✅ |
| Watch & Earn task | 1 | 30 ORL | 30 | 26.8% ✅ |
| Featured task | 1 | 30 ORL | 30 | 26.8% ✅ |
| Hourly faucet | 1 | 25 ORL | 25 | 22.3% ✅ |
| Lucky Spin (EV) | 1 | ~30 ORL | 30 | 26.9% ✅ |
| Scratch card (EV) **[no limit]** | 1 | ~22 ORL | 22 | 19.3% ✅ |
| **Coin Flip (EV) [NEW, no limit]** | 1 | ~30 ORL | 30 | 26.8% ✅ |
| Mystery chest **[no limit]** | 5 | 150-200 ORL total | 35/ad | 31.3% ✅ |
| **Video Wall [NEW, no limit]** | 1 | 30 ORL | 30 | 26.8% ✅ |
| **Daily Ad Challenge [NEW]** | 10/25/50 | +50/+100/+250 bonus | +bonus | ~4.5% extra |
| 1.2× Boost | 1 | 1.2× for 3h | self-funded | — |
| Lottery free ticket | 1 | 1 ticket | 0 | 0% |
| Lottery buy ticket | 0 | -500 ORL (sink) | — | removes ORL |
| Daily streak (7-day total) | 0 | 1,400 ORL total | — | 26.8%* |

\* Streak amortized across ~35 ads/week per active user.

### Referral commission
- L1 = **8%** of mined ORL (direct referrer)
- L2 = **2%** of mined ORL (referrer's referrer)
- Total envelope: 10% on every mined ORL
- Refuel true cost with referral: 30 × 1.10 = **33 ORL = 29.5% payout** ✅

---

## 4. New Features Added

### 🎮 Coin Flip (Play screen)
- Watch 1 ad → pick heads or tails
- Win: **50 ORL** | Lose: **10 ORL** consolation
- EV = 30 ORL (26.8% payout) ✅
- **No daily limit** — unlimited flips

### 📺 Video Ads Wall (Earn screen)
- Watch 1 ad → get **30 ORL** instantly
- **No daily limit** — users watch as many as they want
- Same economics as refuel but simpler (no tank mechanic)

### 🏆 Daily Ad Challenge (Earn screen)
- Milestone bonuses credited automatically as users watch ads
- **10 ads → +50 ORL** bonus
- **25 ads → +100 ORL** bonus
- **50 ads → +250 ORL** bonus
- Total possible daily bonus: **400 ORL** ($0.008 cost to platform)
- All ad-funded features count (refuel, spin, scratch, coin flip, chest, faucet, tasks, video wall, lottery free ticket)

### ♾️ Removed Daily Limits
- ❌ Scratch card 3/day limit → **unlimited** (each requires 1 ad)
- ✅ Spin was already unlimited
- ✅ Chest was already unlimited
- ✅ Coin Flip — unlimited from day one
- ✅ Video Wall — unlimited from day one

---

## 5. Pro Subscription (my decision: KEEP)

**Price:** 250 Telegram Stars/month (≈ $3.25/month)

**Perks (updated):**
- ✅ 2× base mining rate (faster tank drain = more refuels = more ad revenue)
- ✅ 5% withdrawal fee (vs 10% for free users)
- ✅ Free daily mystery chest (150-200 ORL, no ad required)
- ✅ Priority withdrawals
- ✅ Exclusive Pro badge

**❌ Removed:** "ad-free refuels" — Pro users now watch ads just like free users. This keeps ad revenue flowing.

### Pro economics
```
Pro revenue:           $3.25/month
Pro cost (free chest): ~$0.14/month (175 ORL avg × 30 days × $0.00002)
Net profit per Pro:    $3.11/month ✅
```

Pro users generate **5× more revenue** than free users ($3.25 + residual ad revenue vs ~$0.60 from ads alone). Push Pro hard.

---

## 6. Withdrawal System (my decision)

### Methods by country
| Method | Min ORL | Fiat | Countries |
|---|---|---|---|
| **Airtime** | 20,000 ORL | ₦600 | 🇳🇬 Nigeria only |
| **Bank (NGN)** | 50,000 ORL | ₦1,500 | 🇳🇬 Nigeria only |
| **USDT (TRC20)** | 100,000 ORL | $2.00 | 🌍 All countries |

### Fee structure
- Free users: **10%** withdrawal fee
- Pro users: **5%** withdrawal fee
- Fee is pure margin on top of the 70%+ already captured at the ad level

### Country detection
- Server reads `cf-ipcountry` header from Cloudflare
- NG users see Airtime + Bank + USDT (3 options)
- Non-NG users see only USDT (1 option, auto-selected)
- Balance display adapts: NG users see ₦, others see $

### Withdrawal flow (now functional)
1. User selects method → enters wallet/account info (for bank/usdt)
2. Server validates balance, deducts ORL, calculates fee
3. Creates `withdrawals` record with status `pending`
4. Admin reviews + processes manually (24h SLA)
5. Limit: 1 pending withdrawal per user at a time

---

## 7. Per-User Daily Earnings (worked example)

**Average active free user** doing 15 ads/day:
| Action | Ads | ORL earned |
|---|---|---|
| 3 refuels | 3 | 90 |
| 1 faucet | 1 | 25 |
| 1 task | 1 | 30 |
| 2 video wall | 2 | 60 |
| 2 spins | 2 | ~60 (EV) |
| 2 scratches | 2 | ~44 (EV) |
| 2 coin flips | 2 | ~60 (EV) |
| 1 chest fill (5 ads) | 5 | 175 (avg) |
| **Subtotal** | **18** | **544 ORL** |
| Daily ad challenge (10+25 milestone) | — | +150 bonus |
| Daily streak (avg) | — | +200 |
| **Daily total** | **18 ads** | **~894 ORL** |

**Daily earnings:** ~894 ORL = $0.018 = ₦26.82
**Monthly:** ~26,820 ORL = $0.54 = ₦805

**Time to withdraw:**
- Airtime (20k ORL): ~22 days
- Bank (50k ORL): ~56 days
- USDT (100k ORL): ~112 days

Active users (30+ ads/day) reach these 2× faster.

---

## 8. Platform Revenue Projections

At **$2.24 CPM**, 15 ads/user/day, ~28% blended payout:

| DAU | Ad revenue/day | Payout/day | Pro revenue/day (5%) | **Net/day** | **Net/month** |
|---|---|---|---|---|---|
| 1,000 | $33.60 | $9.41 | $16.25 | **$40.44** | **~$1,213** |
| 10,000 | $336.00 | $94.08 | $162.50 | **$404.42** | **~$12,133** |
| 50,000 | $1,680.00 | $470.40 | $812.50 | **$2,022.10** | **~$60,663** |

**Worst case ($1.00 CPM):**
- Payout ratio rises to ~60% (still 40% margin on ads)
- Pro revenue intact ($3.25/mo per Pro user)
- At 10k DAU: still ~$5,000/month net ✅

---

## 9. Database Changes

### New columns on `users` table
- `ads_today_count` INTEGER — daily ad counter (resets at midnight)
- `ads_today_date` TEXT — date string for counter reset
- `ad_milestones_claimed` TEXT — comma-separated list of claimed milestone ad-counts (e.g. "10,25")
- `pro_chest_last` INTEGER — timestamp of last Pro free chest claim
- `scratch_reset_date` TEXT — kept for backwards compat (scratch now unlimited)

### New table: `withdrawals`
```sql
CREATE TABLE withdrawals (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER,
  method       TEXT,        -- 'airtime' | 'bank' | 'usdt'
  amount_orl   REAL,
  fee_orl      REAL,
  net_amount   REAL,
  status       TEXT DEFAULT 'pending',  -- 'pending' | 'completed' | 'rejected'
  wallet_info  TEXT,        -- wallet address or bank account
  created_at   INTEGER,
  processed_at INTEGER
);
```

---

## 10. File Changes Summary

### Server
| File | Changes |
|---|---|
| `server/economy.js` | Full rewrite — new constants, new features (Coin Flip, Video Wall, Ad Milestones), updated rewards, withdrawal config |
| `server/db.js` | Added 5 new user columns + `withdrawals` table + helper functions |
| `server/services/adTracking.js` | **NEW** — Daily Ad Challenge milestone tracker |
| `server/routes/mining.js` | Ad tracking on refuel/boost + new `/pro-chest` endpoint |
| `server/routes/play.js` | Ad tracking on all games + new `/coinflip` endpoint + removed scratch daily limit |
| `server/routes/earn.js` | Ad tracking on faucet/task + new `/video-wall` endpoint |
| `server/routes/wallet.js` | Full withdrawal request system + `/methods` + `/withdrawals` endpoints |
| `server/routes/user.js` | Returns ad challenge progress, Pro chest status, streak amounts |
| `server/index.js` | Adsgram callback default reward 50 → 30 ORL |
| `server/bot.js` | Updated welcome message |

### Frontend
| File | Changes |
|---|---|
| `index.html` | Added Coin Flip, Ad Challenge, Video Wall sections + Airtime method + wallet info input + Pro chest button + updated Pro perks |
| `src/state.js` | New state fields: adChallenge, proChestReady, streakAmounts, updated _selectedMethod |
| `src/ui.js` | Renders ad challenge milestones + country-based withdrawal methods + wallet info box + Pro chest button |
| `src/play.js` | Coin Flip logic with animation |
| `src/earn.js` | Video Wall setup + updated streak amounts |
| `src/wallet.js` | Full withdrawal flow with wallet info + Pro chest claim |
| `src/styles/play.css` | Coin Flip styles + animation |
| `src/styles/earn.css` | Ad Challenge + Video Wall styles |

---

## 11. Guardrails

| Signal | Action |
|---|---|
| CPM < $1.80 for 2 weeks | Lower TANK_ORL from 30 → 25 |
| CPM < $1.50 for 2 weeks | Also lower referral: 8%+2% → 6%+1.5% |
| CPM > $3.00 for 2 weeks | Consider bumping rewards 10-15% |
| Withdrawal fraud spike | Increase fee from 10% → 15% |
| Pro conversion < 2% | Add Pro trial (3 days free) |
| Ad fill rate < 60% | Add backup ad network (Adsterra) |

---

## 12. What Users See (marketing copy)

> **Earn 25-35 ORL per ad watched!**
> 
> 🎮 Play games: Spin, Scratch, Coin Flip, Mystery Chest
> 📺 Watch videos: Unlimited Video Wall
> ⛏️ Mine ORL: Refuel your engine, upgrade your rig
> 🏆 Daily Ad Challenge: Up to +400 ORL bonus
> 👥 Refer friends: 8% + 2% lifetime commission
> 
> **Cash out to:**
> 🇳🇬 Airtime (₦600) · Bank (₦1,500) · USDT ($2)
> 🌍 USDT ($2) — all countries
> 
> **Go Pro for 2× mining + half-fee withdrawals + free daily chest!**
