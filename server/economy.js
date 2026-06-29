// ─────────────────────────────────────────────────────────────
//  Orael – Economy Constants (single source of truth)
// ─────────────────────────────────────────────────────────────
//
//  UPDATED PEG (June 2026):
//     1 ORL = $0.002 USD
//     $1 USD = ₦1,387 NGN (current market rate)
//     Therefore: 1 ORL = ₦2.774 (0.002 × 1387)
//
//  REVENUE CALCULATIONS:
//     Adsgram CPM ≈ $2.24 per 1000 views
//     Revenue per ad = $0.00224 = ₦3.11
//     At 40 ORL per ad = ₦111 revenue per 40 ORL
//     Payout ratio ≈ 27-30% (sustainable)
// ─────────────────────────────────────────────────────────────

/** ORL → NGN exchange rate (peg: 1 ORL = $0.002, $1 = ₦1,387, so 1 ORL = ₦2.774) */
export const ORL_TO_NGN = 2.774;

/** USD → NGN exchange rate */
export const USD_TO_NGN = 1387;

/** ORL per USD (derived from peg: $0.002 per ORL) */
export const ORL_PER_USD = 500;

/** ORL earned per full tank session (one refuel ad = one tank) */
export const TANK_ORL = 40;

/**
 * Pre-ad mining cap: user can only mine this % of tank before forced refuel.
 * Pushes refuel conversions = more ad views = more revenue.
 * Set to 0.6 = 60% of tank drains freely, then engine stops until refuel.
 */
export const FREE_MINING_CAP = 0.6;

/**
 * Mining rig tiers — fixed-tank model.
 * Each rig pays out the SAME 40 ORL per refuel, but drains faster.
 * Faster drain → user refuels more often → more ad views → more revenue.
 * Per-ad payout ratio stays flat at ~24% regardless of rig level.
 */
export const RIGS = [
  { name: 'Rig I',   sessionMin: 240, cost: 0 },      // 4h
  { name: 'Rig II',  sessionMin: 200, cost: 8000 },   // 3h 20m
  { name: 'Rig III', sessionMin: 160, cost: 30000 },  // 2h 40m
  { name: 'Rig IV',  sessionMin: 120, cost: 90000 },  // 2h
  { name: 'Rig V',   sessionMin: 80,  cost: 250000 }, // 1h 20m
];

// ── Faucet ──────────────────────────────────────────────────
//  1 ad → 35 ORL = 20.8% payout ratio ✅
export const FAUCET_COOLDOWN = 60 * 60 * 1000;   // 1 hour in ms
export const FAUCET_REWARD   = 35;                // ORL per claim

// ── Lottery ─────────────────────────────────────────────────
//  ORL sink — removes coins from circulation, self-funds the prize pool.
export const LOTTO_TICKET_ORL = 750;

// ── Chest mini-game ─────────────────────────────────────────
//  5 ads to unlock → 200-280 ORL payout.
//  Per-ad cost = (240 avg) / 5 = 48 ORL = 28.6% payout ratio ✅
//  NO daily limit — users can fill chests unlimited (each requires 5 ads)
export const CHEST_GOAL       = 5;    // ads needed to unlock reward
export const CHEST_REWARD_MIN = 200;
export const CHEST_REWARD_MAX = 280;

// ── Spin-the-wheel ──────────────────────────────────────────
//  EV = 40.3 ORL per spin = 24.0% payout ratio ✅
//  NO daily limit — each spin requires 1 ad
export const WHEEL_PRIZES  = [120, 60, 300, 0, 40, 20, 600, 8];
export const WHEEL_WEIGHTS = [10, 16, 1, 20, 14, 20, 0.3, 18.7];

// ── Scratch card ────────────────────────────────────────────
//  EV = 29.8 ORL per scratch = 17.7% payout ratio ✅
//  NO daily limit — each scratch requires 1 ad
export const SCRATCH_PRIZES  = [8, 20, 40, 100, 250, 0];
export const SCRATCH_WEIGHTS = [38, 28, 20, 10, 1, 3];

// ── Coin Flip (NEW game) ────────────────────────────────────
//  Watch 1 ad, pick heads or tails.
//  Win: 65 ORL | Lose: 15 ORL consolation
//  EV = (0.5 × 65) + (0.5 × 15) = 40 ORL = 23.8% payout ratio ✅
//  NO daily limit — unlimited flips, each requires 1 ad
export const COINFLIP_WIN  = 65;
export const COINFLIP_LOSE = 15;

// ── Video Wall (unlimited watch & earn) ─────────────────────
//  Each video ad watched → 40 ORL = 23.8% payout ratio ✅
//  NO daily limit — users watch as many as they want
export const VIDEO_WALL_REWARD = 40;

// ── Daily Ad Challenge (milestone bonuses) ──────────────────
//  Milestone bonuses credited automatically when ad count is reached.
//  One-time per day per milestone. Resets at midnight.
export const AD_MILESTONES = [
  { ads: 10, bonus: 70 },
  { ads: 25, bonus: 140 },
  { ads: 50, bonus: 350 },
];

// ── Daily login streak ──────────────────────────────────────
//  7-day total = 1,950 ORL
//  Amortized across ~35 ads/week per active user = 24% payout ratio ✅
export const STREAK_AMOUNTS = [60, 90, 140, 210, 290, 390, 770];

// ── Session duration ────────────────────────────────────────
export const SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours in ms (boost duration)

// ── Referral programme ──────────────────────────────────────
//  L1 7% + L2 2% = 9% extra on every mined ORL.
//  Refuel true cost: 40 × 1.09 = 43.6 ORL = 26% payout ratio ✅
export const REFERRAL_L1_PCT = 0.07; // 7% of referee earnings
export const REFERRAL_L2_PCT = 0.02; // 2% second-level

// ── Earn tasks (1 ad per task → 40 ORL = 23.8% payout ratio ✅) ──
export const TASKS = [
  { id: 't1', title: 'Watch a sponsored video', sub: '15s · rewarded ad', reward: 40, url: '' },
  { id: 't2', title: 'Visit partner offer',     sub: 'Open link · 10s',  reward: 35, url: '' },
  { id: 't3', title: 'Daily quiz',              sub: 'Answer 1 question', reward: 35, url: '' },
];

export const FEATURED_TASKS = [
  { id: 'f1', title: 'Join Orael Bot',          sub: 'Open & start the bot', reward: 40, url: 'https://t.me/Orael_bot' },
  { id: 'f2', title: 'Follow Orael on X',        sub: 'Tap follow',           reward: 40, url: 'https://x.com/Orael_Network' },
  { id: 'f3', title: 'Subscribe Orael channel',  sub: 'Telegram',             reward: 40, url: 'https://t.me/Orael_Channel' },
];

// ── Tier Multipliers ────────────────────────────────────────
//  Tiers are passive multipliers stacked on top of base mining rate.
//  They DO NOT change per-ad payout — only mining speed.
//  Higher tier → faster tank drain → more refuels → more ad revenue.
export const TIER_MULTIPLIERS = {
  1: 1.0,
  2: 1.1,
  3: 1.25,
  4: 1.5,
  5: 2.0
};

export function getTierMultiplier(tier) {
  return TIER_MULTIPLIERS[tier || 1] || 1.0;
}

// ── Pro / Boost Multipliers ──────────────────────────────────
//  PRO: 250 Telegram Stars/mo (≈ $3.25/mo). Perks:
//    - 2× base mining rate (faster tank drain = more refuels = more ad revenue)
//    - 5% withdrawal fee (vs 10% for free users)
//    - 1 free mystery chest per day (no ad required, 200-280 ORL value)
//    - Priority withdrawals
//  NOTE: Pro users STILL watch ads for refuels (no more ad-free refuels).
//  Net profit per Pro user: $3.25 - $0.20 (free chest cost) = $3.05/mo ✅
//
//  BOOST: 1 ad → 1.2× speed for 4h. The boost ad's revenue pays
//         for the extra ORL mined during the boost window.
export const PRO_MULTIPLIER = 2.0;
export const BOOST_MULTIPLIER = 1.2;

// ── Withdrawal Configuration ────────────────────────────────
//  Fee: 10% for free users, 5% for Pro users (pure margin)
//  Methods vary by country (NG gets airtime + bank, others get USDT only)
//  Updated: 1 ORL = $0.002 = ₦2.774 (at $1 = ₦1,387)
//  Minimum withdrawal: ₦100 ≈ 40 ORL
export const WITHDRAWAL_FEE_PCT = 0.10;
export const WITHDRAWAL_FEE_PRO_PCT = 0.05;

// Manual approval threshold — withdrawals at or above this ORL amount
// require admin approval BEFORE being sent to Flutterwave.
// Below this threshold, withdrawals auto-process instantly.
// ₦5,000 ÷ 2.774 = 1,802 ORL → rounded to 1,800 ORL
export const MANUAL_APPROVAL_THRESHOLD_ORL = 1800; // ₦5,000 ≈ 1,800 ORL

export const WITHDRAWAL_METHODS = {
  airtime: {
    name: 'Airtime',
    minOrl: 40,        // ₦100 minimum (40 ORL × ₦2.774)
    fiat: '₦100',
    countries: ['NG'],
    icon: 'phone'
  },
  bank: {
    name: 'Bank (NGN)',
    minOrl: 40,        // ₦100 minimum (same as airtime)
    fiat: '₦100',
    countries: ['NG'],
    icon: 'bank'
  },
  usdt: {
    name: 'USDT (TRC20)',
    minOrl: 720,       // $2.00 minimum (720 ORL × $0.002)
    fiat: '$2.00',
    countries: 'all',
    icon: 'crypto'
  },
};

/**
 * Full client-facing economy config. Sent to the client in `getUserState` so the
 * frontend uses SERVER-AUTHORITATIVE values instead of stale hardcoded copies
 * (the old client had TANK_ORL=30 / ORL_TO_NGN=0.03 / 8% referral while the
 * server used 40 / 0.02 / 7% — displays drifted and fiat conversions were wrong).
 */
export const ECONOMY_CONFIG = {
  ORL_TO_NGN,
  USD_TO_NGN,
  ORL_PER_USD,
  TANK_ORL,
  FREE_MINING_CAP,
  RIGS,
  FAUCET_REWARD,
  FAUCET_COOLDOWN,
  LOTTO_TICKET_ORL,
  CHEST_GOAL,
  CHEST_REWARD_MIN,
  CHEST_REWARD_MAX,
  WHEEL_PRIZES,
  WHEEL_WEIGHTS,
  SCRATCH_PRIZES,
  SCRATCH_WEIGHTS,
  COINFLIP_WIN,
  COINFLIP_LOSE,
  VIDEO_WALL_REWARD,
  AD_MILESTONES,
  STREAK_AMOUNTS,
  SESSION_MS,
  REFERRAL_L1_PCT,
  REFERRAL_L2_PCT,
  PRO_MULTIPLIER,
  BOOST_MULTIPLIER,
  TIER_MULTIPLIERS,
  WITHDRAWAL_FEE_PCT,
  WITHDRAWAL_FEE_PRO_PCT,
  MANUAL_APPROVAL_THRESHOLD_ORL,
  WITHDRAWAL_METHODS,
  TASKS,
  FEATURED_TASKS,
  PRO_PRICE_STARS: 250,
  PRO_DURATION_DAYS: 30,
};
