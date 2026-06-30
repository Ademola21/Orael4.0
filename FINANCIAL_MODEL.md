# Orael — Production Financial Model

> **Updated June 2026 with real Adsgram dashboard data.**
> See `ECONOMY_CALCULATIONS.md` for the per-feature breakdown and proof math.

The job of this document: make sure **money in (ads + Pro) always exceeds
money out (ORL payouts)**, at every scale, even in a bad month, while
still letting users earn enough to stay.

---

## 1. Real-world assumptions (calibrated June 2026)

| Input | Value used | Source |
|---|---|---|
| Exchange rate | **$1 = ₦1,500** | adjustable; ~₦1,550 in mid-2026 |
| Rewarded video CPM (Nigeria) | **$2.24** | **REAL** — weighted avg from Adsgram dashboard (June 12-19, 2026) |
| → Revenue per rewarded ad view | **$0.00224** (₦3.36, 112 ORL) | = CPM ÷ 1000 |
| Telegram Star → your payout | **$0.013/star** | net via TON, ~0% Telegram fee |
| ORL peg | **1 ORL = ₦0.03 = $0.00002** | $1 = 50,000 ORL |

**The one rule everything obeys:**
> Every ORL we pay for a rewarded action must cost **≤ 35%** of the ad revenue
> that funded it. That locks in a **≥ 65% gross margin** at our real CPM,
> and still stays profitable down to a **$1.50 CPM** (worst realistic case).

### Where the $2.24 CPM came from

Real Adsgram data for ad unit 35273 (Oraelbot rewarded video):

| Date | Impressions | CPM (USD) |
|---|---|---|
| 06/19/2026 | 17 | $3.35 |
| 06/15/2026 | 34 | $1.68 |
| **Total** | **51** | **$2.24 weighted** |

Total earnings across this window: **$0.11 USD** for 51 ad views.

---

## 2. The ORL peg

**Current peg:** **1 ORL = $0.00002 = ₦0.03**  → **$1 = 50,000 ORL**.

Why this works: the same $0.00224 ad payout can be shown as a satisfying
**"+25 ORL"** or **"+30 ORL"** instead of "$0.0007". Big, fun numbers;
microscopic real cost. Minimum withdrawals land at sensible ₦ amounts.

Payout ceiling per single rewarded ad at this peg:
`35% × $0.00224 = $0.000784 = ` **~39 ORL max per ad**. Keep every
per-ad reward at or under this.

---

## 3. Reward table — what each action pays, and who funds it

Per-ad revenue = $0.00224 = 112 ORL. "Cost" = what we pay the user, in ORL.

| Mechanic | Reward (ORL) | Per-ad ORL cost | Funded by | Payout ratio |
|---|---|---|---|---|
| Refuel engine (1 ad) | 30 (full tank) | 30 | 1 rewarded ad | 26.8% ✅ |
| Watch & earn task | 25 | 25 | 1 rewarded ad | 22.3% ✅ |
| Featured partner task | 25 | 25 | 1 rewarded ad | 22.3% ✅ |
| Hourly faucet | 20 | 20 | 1 rewarded ad | 17.9% ✅ |
| Lucky spin (EV) | ~24.4 | 24.4 | 1 rewarded ad | 21.8% ✅ |
| Scratch card (EV) | ~18.2 | 18.2 | 1 rewarded ad | 16.3% ✅ |
| Mystery chest (5 ads → payout) | 100-150 (avg 125) | 25 per ad | 5 rewarded ads | 22.3% ✅ |
| 1.2× Boost (1 ad) | 1.2× for 3h | — | the boost ad pays for the extra ORL | self-funded ✅ |
| Daily lottery (free ticket) | 1 ticket | 0 | self-funded by entry ORL sinks | 0% ✅ |
| Daily lottery (buy ticket) | -500 ORL | — | ORL sink | removes ORL ✅ |
| Daily streak (7-day total) | 1,050 ORL total | — | retention bonus, amortized | 26.8% ✅ |
| Referral L1 / L2 | 10% / 3% | folded in | skimmed from referred users' mined ORL | absorbed in 35% ✅ |

**Full breakdown with $1.50 CPM stress test:** see `ECONOMY_CALCULATIONS.md` §3.

---

## 4. Mining & rig upgrades — the key safety mechanism

**The trap:** if a rig upgrade makes you mine 2× faster, then one refuel ad pays
out 2× the ORL — but still only earns 1 ad's revenue. Margin collapses at high
rigs.

**The fix — fixed-tank model:** A refuel grants a **fixed 30 ORL "tank"** that
drains over the session. The rig level changes **how fast** the tank drains
(and pays out), **not how much**. Higher rig = shorter session = the user
refuels more often = **more ad views = more revenue**, while ORL-per-ad stays
flat at 30. Everyone wins and the margin never moves.

| Rig | Tank | Session length | ORL/hr (display) | ORL per refuel ad | Max refuels/day |
|---|---|---|---|---|---|
| I | 30 ORL | 3h 00m | 10.0 | 30 ✅ | 8 |
| II | 30 ORL | 2h 30m | 12.0 | 30 ✅ | 10 |
| III | 30 ORL | 2h 00m | 15.0 | 30 ✅ | 12 |
| IV | 30 ORL | 1h 30m | 20.0 | 30 ✅ | 16 |
| V | 30 ORL | 1h 00m | 30.0 | 30 ✅ | 24 |

- Upgrades are bought with **ORL** (a sink — removes coins from circulation,
  protects the peg). No cash leaves the platform.
- Daily ceiling is naturally capped: even at Rig V (1h sessions, 24/day) a user
  maxes ~720 ORL/day = **$0.0144/day**, all funded by 24 refuel ads ($0.0540 rev).

Upgrade prices (ORL sink): Rig II 5,000 · III 20,000 · IV 60,000 · V 150,000.

---

## 5. Offerwall — REMOVED (not viable on Telegram)

**Offerwalls do not support Telegram Mini Apps.** The following integrations
were removed from the project entirely:

- ❌ Mmwall — `/api/mmwall-callback` + `MMWALL_SECRET`
- ❌ ayeT-Studios — `/api/ayet-callback` + `AYET_API_KEY`
- ❌ BitcoTasks — `/api/bitco-callback` + `BITCO_SECRET`
- ❌ Offers pane in the Earn tab (featured offers, offer partners, all offers
  list, paid surveys, live feed)

**What remains for monetization:**
1. ✅ Adsgram rewarded video (block 35273) — single-ad rewards across all features
2. ✅ Adsgram Tasks web component (block task-35279) — task-wall with S2S crediting
3. ✅ Telegram Stars — Orael Pro subscription (250 XTR/mo ≈ $3.25/mo)

If a Telegram-compatible offerwall emerges in the future, the integration
pattern (signed server-side callback → credit balance → log transaction) is
preserved in the Adsgram callback code at `/api/adsgram-callback`.

---

## 6. Spin & scratch — expected value caps

Random rewards must have an **expected value (EV) under the per-ad ceiling**, no
matter how big the top prize looks. Keep rare jackpots for excitement, weight
them low.

**Lucky spin** (8 segments) — current EV = 24.4 ORL:

| Prize | 80 | 40 | 200 | 0 | 25 | 12 | 400 | 5 |
|---|---|---|---|---|---|---|---|---|
| Weight | 10 | 16 | 1 | 20 | 14 | 20 | 0.3 | 18.7 |

EV = (80·10 + 40·16 + 200·1 + 0·20 + 25·14 + 12·20 + 400·0.3 + 5·18.7) / 100
   = **24.4 ORL** = $0.00049 per ad → 21.8% payout ratio ✅

**Scratch** — prizes 5/15/30/60/150/0 with the big ones rare:
EV ≈ **18.2 ORL** = 16.3% payout ratio ✅

Both well under the 35% ceiling. Top prizes stay exciting (400 ORL on spin,
150 ORL on scratch) but their weights are tiny.

---

## 7. Withdrawals — fee + thresholds

- **Minimum withdrawal** sets how long a non-paying user grinds (and watches
  ads) before any cash leaves. Current config:

| Method | Min ORL | = NGN | = USD |
|---|---|---|---|
| Bank (NGN) | 50,000 | ₦1,500 | $1.00 |
| USDT (TRC20) | 150,000 | ₦4,500 | $3.00 |

- **Withdrawal fee: 10%** (Pro: 5%). Pure margin + discourages micro-cashout spam.
- A user reaching the ₦1,500 bank minimum has watched enough ads to generate
  **~$3+ in ad revenue** for you along the way → cashout is comfortably covered.
- Non-Nigeria users are auto-routed to USDT only (Bank NGN option is hidden).

> ⚠ **Withdrawal endpoint is currently stubbed.** Wire it up before going live.

---

## 8. Orael Pro — does the subscription actually pay for itself?

Pro = **250 Stars/mo ($3.25 to you)**. Perks: 2× rate, **ad-free** refuels, 5%
withdrawals, daily chest.

The risk is ad-free refuels (no ad revenue) while still paying ORL. With the
fixed-tank model it's bounded:

```
Pro mining: 30 ORL tank, 2× speed → ~1.5h sessions → max ~16 tanks/day
  = 480 ORL/day = $0.0096/day = ~$0.29/mo
daily chest                              ≈ $0.30/mo
Total Pro payout cost                                 ≈ $0.60/mo
Pro revenue                                            $3.25/mo
Net profit per Pro user                              ≈ $2.65/mo  ✅
```

Pro users still do other ad-funded actions (tasks, spin, scratch, chest, faucet)
which generate **additional ad revenue on top of the $3.25**. Pro is your
**highest-margin product** — push it.

> Keep Pro at 250 Stars. Do not raise the 1.2× boost past 1.2×, and never make chest
> ad-free *and* uncapped, or the bound breaks.

---

## 9. Revenue projections (conservative, ads + Pro only)

Assume avg **9 rewarded ads/user/day**, ~22% blended payout ratio, **$2.24 CPM**.
Pro conversion assumed at 5% of DAU.

| DAU | Ad rev/day | Payout/day | Pro rev/day | **Net/day** | **Net/month** |
|---|---|---|---|---|---|
| 1,000 | $20.16 | $4.43 | $16.25 | **$31.98** | **~$959** |
| 10,000 | $201.60 | $44.32 | $162.50 | **$319.78** | **~$9,593** |
| 50,000 | $1,008.00 | $221.60 | $812.50 | **$1,598.90** | **~$47,967** |

**Worst-case stress test ($1.00 CPM):** payouts are fixed in ORL, so the ratio
rises to ~50% — still **50% gross margin** on ads, plus Pro revenue intact.
The system survives a bad month.

Below ~$1.00 CPM you'd dip toward break-even; that's what the admin panel is for
(§10).

---

## 10. Guardrails (so it can't break)

1. **Admin kill-switch levers** (build the admin panel): live control of base
   tank size, ORL→$ peg, reward amounts, min-withdrawal, and Pro price. If CPM
   drops, cut payouts in seconds.
2. **Server-side ad verification** — credit ORL only after Adsgram's signed
   completion callback (anti-bot). Never trust the client.
3. **Daily caps** per user on faucet (1/hr), chest (5 ads), tasks (1 each).
4. **Frequency cap** ads to 1–2 per session burst to protect CPM and UX.
5. **One account per Telegram ID**; referral self-invite detection.
6. **Hold withdrawals 24h** + manual review above a threshold.
7. **Watch the live margin**: alert if (daily payout ÷ daily ad revenue) > 45%.

---

## 11. Final app config (drop-in constants)

```js
// economy.js — single source of truth (already deployed)
ORL_TO_NGN      = 0.03;        // 1 ORL = ₦0.03  ($1 = 50,000 ORL)
USD_TO_NGN      = 1500;
AD_REVENUE_USD  = 0.00224;     // REAL rewarded-ad value (June 2026 Adsgram data)
MAX_PAYOUT_RATIO= 0.35;        // never exceed; alert at 0.45

TANK_ORL        = 30;          // fixed ORL per refuel (NOT rate × time)
RIGS = [                       // session length shrinks, tank stays 30
  { name:"Rig I",   sessionMin:180, cost:0 },
  { name:"Rig II",  sessionMin:150, cost:5000 },
  { name:"Rig III", sessionMin:120, cost:20000 },
  { name:"Rig IV",  sessionMin:90,  cost:60000 },
  { name:"Rig V",   sessionMin:60,  cost:150000 },
];

FAUCET_REWARD   = 20;
TASK_REWARD     = 25;
CHEST_REWARD    = [100,150];   // total payout after 5 ads
CHEST_GOAL      = 5;           // ads to fill
WHEEL_PRIZES    = [80,40,200,0,25,12,400,5];
WHEEL_WEIGHTS   = [10,16,1,20,14,20,0.3,18.7];   // EV ≈ 24.4 ORL
SCRATCH_PRIZES  = [5,15,30,60,150,0];
SCRATCH_WEIGHTS = [40,30,18,8,1,3];              // EV ≈ 18.2 ORL
STREAK_AMOUNTS  = [30,50,80,120,180,240,350];    // 7-day total = 1,050 ORL
LOTTO_TICKET_ORL= 500;

WITHDRAW_MIN    = { bank:50000, usdt:150000 };
WITHDRAW_FEE    = 0.10;        // Pro: 0.05
PRO_PRICE_STARS = 250;         // ≈ $3.25/mo to you
PRO_RATE_MULT   = 2;
BOOST_RATE_MULT = 1.2;
```

These numbers keep you safe at $1.50 CPM and comfortably profitable at $2.24+
(real current data).

---

## 12. Per-user worked example (reality check)

Average active free user, daily:
- 5 refuels × 1 ad = 5 ads → 150 ORL mined
- 1 faucet × 1 ad = 1 ad → 20 ORL
- 1 task × 1 ad = 1 ad → 25 ORL
- 1 spin × 1 ad = 1 ad → ~24 ORL EV
- 1 scratch × 1 ad = 1 ad → ~18 ORL EV
- Streak bonus (avg) → 150 ORL

**Daily ad views**: 9 ads
**Daily ad revenue (platform)**: 9 × $0.00224 = **$0.0202** (₦30.24)
**Daily ORL payout**: 387 ORL = $0.00774 (₦11.61)

**Daily margin**: $0.0202 - $0.00774 = **$0.0124** (61.6% margin) ✅

**Monthly per active user** (30 days):
- Revenue: $0.61
- Payout: $0.23
- **Margin: $0.38/user/month**

At **10,000 DAU + 5% Pro conversion**: ~$9,593/month net (see §9).
