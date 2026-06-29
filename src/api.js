/* ========================================================================
   api.js — Mock API client for Orael 3.0 frontend-only mode
   ------------------------------------------------------------------------
   Replaces the real Express + SQLite backend with an in-memory +
   localStorage-backed mock that simulates every /api/* endpoint the
   frontend calls.

   - State persisted to localStorage (key: "orael_mock_state")
   - Mining accrues passively between calls (mirrors server behavior)
   - Game outcomes (spin, scratch, chest, coinflip) randomized client-side
   - Returns the same ECONOMY_CONFIG the real server sends, so the
     frontend's economy-aware code works unmodified
   - Telegram initData header silently ignored (works in any browser)
   ======================================================================== */

import { toast } from './ui.js';

/* ─── Economy config (mirrors server/economy.js) ──────────────────── */
export const ECONOMY = {
  ORL_TO_NGN: 2.774,
  USD_TO_NGN: 1387,
  ORL_PER_USD: 500,
  TANK_ORL: 40,
  FREE_MINING_CAP: 0.6,
  RIGS: [
    { name: 'Rig I',   sessionMin: 240, cost: 0 },
    { name: 'Rig II',  sessionMin: 200, cost: 8000 },
    { name: 'Rig III', sessionMin: 160, cost: 30000 },
    { name: 'Rig IV',  sessionMin: 120, cost: 90000 },
    { name: 'Rig V',   sessionMin: 80,  cost: 250000 },
  ],
  FAUCET_REWARD: 35,
  FAUCET_COOLDOWN: 60 * 60 * 1000,
  LOTTO_TICKET_ORL: 750,
  CHEST_GOAL: 5,
  CHEST_REWARD_MIN: 200,
  CHEST_REWARD_MAX: 280,
  WHEEL_PRIZES:  [120, 60, 300, 0, 40, 20, 600, 8],
  WHEEL_WEIGHTS: [10, 16, 1, 20, 14, 20, 0.3, 18.7],
  SCRATCH_PRIZES:  [8, 20, 40, 100, 250, 0],
  SCRATCH_WEIGHTS: [38, 28, 20, 10, 1, 3],
  COINFLIP_WIN:  65,
  COINFLIP_LOSE: 15,
  VIDEO_WALL_REWARD: 40,
  AD_MILESTONES: [
    { ads: 10, bonus: 70 },
    { ads: 25, bonus: 140 },
    { ads: 50, bonus: 350 },
  ],
  STREAK_AMOUNTS: [60, 90, 140, 210, 290, 390, 770],
  SESSION_MS: 4 * 60 * 60 * 1000,
  REFERRAL_L1_PCT: 0.07,
  REFERRAL_L2_PCT: 0.02,
  PRO_MULTIPLIER: 2.0,
  BOOST_MULTIPLIER: 1.2,
  TIER_MULTIPLIERS: { 1: 1.0, 2: 1.1, 3: 1.25, 4: 1.5, 5: 2.0 },
  WITHDRAWAL_FEE_PCT: 0.10,
  WITHDRAWAL_FEE_PRO_PCT: 0.05,
  MANUAL_APPROVAL_THRESHOLD_ORL: 1800,
  WITHDRAWAL_METHODS: {
    airtime: { name: 'Airtime', minOrl: 40,   fiat: '₦100', countries: ['NG'], icon: 'phone' },
    bank:    { name: 'Bank (NGN)', minOrl: 40, fiat: '₦100', countries: ['NG'], icon: 'bank' },
    usdt:    { name: 'USDT (TRC20)', minOrl: 720, fiat: '$2.00', countries: 'all', icon: 'crypto' },
  },
  TASKS: [
    { id: 't1', title: 'Watch a sponsored video', sub: '15s · rewarded ad', reward: 40, url: '' },
    { id: 't2', title: 'Visit partner offer',     sub: 'Open link · 10s',  reward: 35, url: '' },
    { id: 't3', title: 'Daily quiz',              sub: 'Answer 1 question', reward: 35, url: '' },
  ],
  FEATURED_TASKS: [
    { id: 'f1', title: 'Join Orael Bot',          sub: 'Open & start the bot', reward: 40, url: 'https://t.me/Orael_bot' },
    { id: 'f2', title: 'Follow Orael on X',        sub: 'Tap follow',           reward: 40, url: 'https://x.com/Orael_Network' },
    { id: 'f3', title: 'Subscribe Orael channel',  sub: 'Telegram',             reward: 40, url: 'https://t.me/Orael_Channel' },
  ],
  PRO_PRICE_STARS: 250,
  PRO_DURATION_DAYS: 30,
};

/* ─── Mock banks list (Flutterwave-style) ─────────────────────────── */
const MOCK_BANKS = [
  { code: '044', name: 'Access Bank' },
  { code: '035', name: 'ALAT by WEMA' },
  { code: '401', name: 'ASO Savings and Loans' },
  { code: '023', name: 'Citibank Nigeria' },
  { code: '063', name: 'Diamond Bank' },
  { code: '050', name: 'Ecobank Nigeria' },
  { code: '562', name: 'Ekondo Microfinance Bank' },
  { code: '084', name: 'Enterprise Bank' },
  { code: '058', name: 'Fidelity Bank' },
  { code: '070', name: 'First Bank of Nigeria' },
  { code: '011', name: 'First City Monument Bank' },
  { code: '214', name: 'FCMB' },
  { code: '051', name: 'Guaranty Trust Bank' },
  { code: '030', name: 'Heritage Bank' },
  { code: '082', name: 'Keystone Bank' },
  { code: '014', name: 'MainStreet Bank' },
  { code: '076', name: 'Polaris Bank' },
  { code: '101', name: 'Providus Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '068', name: 'Standard Chartered Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '033', name: 'United Bank For Africa' },
  { code: '215', name: 'Unity Bank' },
  { code: '035', name: 'Wema Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '999', name: 'Rubies Bank' },
  { code: '327', name: 'Paga' },
  { code: '901', name: 'Opay' },
  { code: '329', name: 'Palmpay' },
  { code: '305', name: 'Kuda Microfinance Bank' },
  { code: '993', name: 'Paycom' },
  { code: '307', name: 'Eyowo' },
];

/* ─── Initial mock state ──────────────────────────────────────────── */
// Use relative avatar paths so they work with any base path (GitHub Pages)
const AV = (n) => `${import.meta.env.BASE_URL}avatars/avatar-${n}.png`;

function freshState() {
  const now = Date.now();
  return {
    /* identity */
    firstName: 'Ademola',
    lastName: 'O.',
    username: 'ademola21',
    photoUrl: AV(1),
    avatarUrl: AV(1),
    country: 'NG',
    role: 'user',
    permissions: '',
    tutorialSeen: false,
    pinSet: false,

    /* mining */
    balance: 18_750.00,
    tier: 1,
    rigLevel: 0,
    tankMined: 12.5,
    lastAccrue: now,
    boostUntil: 0,
    proUntil: 0,

    /* faucet / streak */
    faucetLast: now - 65 * 60 * 1000,
    streakDay: 3,
    streakClaimedToday: false,
    streakAmounts: ECONOMY.STREAK_AMOUNTS,

    /* play */
    spinFreeUsed: false,
    scratchLeft: 999,
    chestProgress: 2,
    lottoTickets: 1,
    lottoPool: 184_500,
    lottoPlayers: 247,
    lottoDrawAt: now + 8 * 3600 * 1000,

    /* ad challenge */
    adChallenge: {
      count: 4,
      nextMilestone: { ads: 10, bonus: 70 },
      milestones: ECONOMY.AD_MILESTONES.map(m => ({ ...m, claimed: false })),
    },

    /* pro free chest */
    proChestReady: false,
    proChestLast: 0,

    /* referral */
    ref: { count: 2, earned: 540, active: 1 },
    refCode: 'ADEMOLA21',

    /* rig */
    rig: ECONOMY.RIGS[0],
    rigs: ECONOMY.RIGS,

    /* tasks */
    tasks: ECONOMY.TASKS,
    featuredTasks: ECONOMY.FEATURED_TASKS,
    completedTasks: { t1: true },

    /* transactions */
    transactions: [],

    /* leaderboard */
    leaderboard: [
      { id: 1,  first_name: 'Ngozi',   balance: 284_500, avatar_url: AV(2) },
      { id: 2,  first_name: 'Tunde',   balance: 242_800, avatar_url: AV(3) },
      { id: 3,  first_name: 'Amaka',   balance: 198_200, avatar_url: AV(4) },
      { id: 4,  first_name: 'Bisi',    balance: 174_100, avatar_url: AV(5) },
      { id: 5,  first_name: 'Chidi',   balance: 161_500, avatar_url: AV(6) },
      { id: 6,  first_name: 'Halima',  balance: 148_900, avatar_url: AV(7) },
      { id: 7,  first_name: 'Emeka',   balance: 137_400, avatar_url: AV(8) },
      { id: 8,  first_name: 'Sade',    balance: 129_800, avatar_url: AV(9) },
      { id: 9,  first_name: 'Yakubu',  balance: 122_100, avatar_url: AV(10) },
      { id: 10, first_name: 'Zainab',  balance: 116_400, avatar_url: AV(1) },
    ],
    _userRank: null,

    /* economy config (server-authoritative in real app) */
    economy: ECONOMY,
  };
}

/* ─── Persistence ─────────────────────────────────────────────────── */
const STORE_KEY = 'orael_mock_state';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Always refresh economy config + rigs in case constants change
      parsed.economy = ECONOMY;
      parsed.rigs = ECONOMY.RIGS;
      parsed.streakAmounts = ECONOMY.STREAK_AMOUNTS;
      return parsed;
    }
  } catch (e) { /* fall through to fresh */ }
  return freshState();
}

let M = loadState();

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(M));
  } catch (e) {
    console.warn('Mock state persist failed', e);
  }
}

/* ─── Mining accrual ──────────────────────────────────────────────── */
function accrue() {
  const now = Date.now();
  const cap = ECONOMY.TANK_ORL * ECONOMY.FREE_MINING_CAP;
  if (M.tankMined >= cap) {
    M.lastAccrue = now;
    return;
  }
  const rig = ECONOMY.RIGS[M.rigLevel] || ECONOMY.RIGS[0];
  const sessionHrs = (rig.sessionMin || 240) / 60;
  const proMul = now < (M.proUntil || 0) ? ECONOMY.PRO_MULTIPLIER : 1;
  const boostMul = now < (M.boostUntil || 0) ? ECONOMY.BOOST_MULTIPLIER : 1;
  const tierMul = ECONOMY.TIER_MULTIPLIERS[M.tier || 1] || 1.0;
  const ratePerHr = (ECONOMY.TANK_ORL / sessionHrs) * proMul * boostMul * tierMul;

  const elapsedHrs = (now - (M.lastAccrue || now)) / 3600000;
  const mined = elapsedHrs * ratePerHr;
  const remaining = cap - (M.tankMined || 0);
  const actual = Math.min(mined, remaining);

  if (actual > 0) {
    M.tankMined += actual;
    M.balance += actual;
    pushTransaction('mining', 'Mining reward', actual);
  }
  M.lastAccrue = now;
}

/* ─── Transaction log ─────────────────────────────────────────────── */
function pushTransaction(type, description, amount) {
  if (!amount) return;
  M.transactions.unshift({
    id: Date.now() + Math.random(),
    type,
    description,
    amount,
    created_at: new Date().toISOString(),
  });
  if (M.transactions.length > 200) M.transactions.length = 200;
}

/* ─── Helpers ─────────────────────────────────────────────────────── */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function isPro() { return Date.now() < (M.proUntil || 0); }
function isBoosted() { return Date.now() < (M.boostUntil || 0); }

function publicState() {
  const { _userRank, ...rest } = M;
  return JSON.parse(JSON.stringify(rest));
}

function weightedRandomIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function computeRank() {
  const sorted = [...M.leaderboard].sort((a, b) => b.balance - a.balance);
  const me = { first_name: M.firstName, balance: M.balance, avatar_url: M.avatarUrl };
  const merged = [...sorted, me].sort((a, b) => b.balance - a.balance);
  const rank = merged.findIndex(u =>
    (u.first_name === me.first_name) && (u.balance === me.balance)
  ) + 1;
  return rank;
}

function bumpAdChallenge() {
  if (!M.adChallenge) M.adChallenge = { count: 0, milestones: [], nextMilestone: null };
  M.adChallenge.count = (M.adChallenge.count || 0) + 1;
  if (M.adChallenge.milestones) {
    M.adChallenge.milestones.forEach(m => {
      if (!m.claimed && M.adChallenge.count >= m.ads) {
        m.claimed = true;
        M.balance += m.bonus;
        pushTransaction('milestone', `Ad challenge: ${m.ads} ads`, m.bonus);
      }
    });
    const next = M.adChallenge.milestones.find(m => !m.claimed);
    M.adChallenge.nextMilestone = next || null;
  }
}

/* ─── Main router ─────────────────────────────────────────────────── */

export async function api(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body || null;
  const query = path.split('?')[1] || '';
  const cleanPath = path.split('?')[0];

  // Simulate network latency
  await sleep(100 + Math.random() * 150);

  try {
    accrue();

    /* ─── USER ──────────────────────────────────────────────────── */
    if (cleanPath === '/api/user' && method === 'GET') {
      return publicState();
    }

    if (cleanPath === '/api/user/tutorial-seen' && method === 'POST') {
      M.tutorialSeen = true;
      persist();
      return { ok: true };
    }

    if (cleanPath === '/api/user/transactions' && method === 'GET') {
      const params = new URLSearchParams(query);
      const page = parseInt(params.get('page') || '1');
      const limit = parseInt(params.get('limit') || '15');
      const start = (page - 1) * limit;
      const slice = M.transactions.slice(start, start + limit);
      const totalPages = Math.max(1, Math.ceil(M.transactions.length / limit));
      return {
        transactions: slice,
        pagination: { page, limit, total: M.transactions.length, totalPages },
      };
    }

    if (cleanPath === '/api/user/redeem-promo' && method === 'POST') {
      const code = (body && body.code) || '';
      const reward = 100;
      M.balance += reward;
      pushTransaction('promo', `Promo code: ${code}`, reward);
      persist();
      return { success: true, reward, message: 'Promo code redeemed!' };
    }

    /* ─── LEADERBOARD ───────────────────────────────────────────── */
    if (cleanPath === '/api/leaderboard' && method === 'GET') {
      const lb = M.leaderboard.map(u => ({
        ...u,
        balance: Math.max(0, Math.floor(u.balance + (Math.random() - 0.5) * 200)),
      }));
      return { leaderboard: lb, userRank: computeRank() };
    }

    /* ─── PROFILE / AVATARS ─────────────────────────────────────── */
    if (cleanPath === '/api/profile/avatars' && method === 'GET') {
      return {
        avatars: [1,2,3,4,5,6,7,8,9,10].map(n => AV(n)),
      };
    }

    if (cleanPath === '/api/profile/avatar/choose' && method === 'POST') {
      const avatar = (body && body.avatar) || AV(1);
      M.avatarUrl = avatar;
      M.photoUrl = avatar;
      persist();
      return { ok: true, avatarUrl: avatar };
    }

    if (cleanPath === '/api/profile/avatar/reset' && method === 'POST') {
      const idx = Math.floor(Math.random() * 10) + 1;
      const avatar = AV(idx);
      M.avatarUrl = avatar;
      M.photoUrl = avatar;
      persist();
      return { ok: true, avatarUrl: avatar };
    }

    // /api/profile/avatar/upload is handled separately (multipart) — see below

    /* ─── MINING ────────────────────────────────────────────────── */
    if (cleanPath === '/api/mining/refuel' && method === 'POST') {
      M.tankMined = 0;
      M.lastAccrue = Date.now();
      M.balance += ECONOMY.TANK_ORL;
      pushTransaction('refuel', 'Refuel bonus', ECONOMY.TANK_ORL);
      bumpAdChallenge();
      persist();
      return publicState();
    }

    if (cleanPath === '/api/mining/boost' && method === 'POST') {
      M.boostUntil = Date.now() + ECONOMY.SESSION_MS;
      bumpAdChallenge();
      persist();
      return publicState();
    }

    if (cleanPath === '/api/mining/rig-upgrade' && method === 'POST') {
      const next = ECONOMY.RIGS[M.rigLevel + 1];
      if (!next) throw new Error('Already at max rig');
      if (M.balance < next.cost) throw new Error('Insufficient balance');
      M.balance -= next.cost;
      M.rigLevel += 1;
      M.rig = next;
      M.tankMined = 0;
      M.lastAccrue = Date.now();
      pushTransaction('upgrade', `Upgraded to ${next.name}`, -next.cost);
      persist();
      return publicState();
    }

    if (cleanPath === '/api/mining/pro-chest' && method === 'POST') {
      if (!isPro()) throw new Error('Pro only');
      if (!M.proChestReady) throw new Error('Chest not ready yet');
      const reward = ECONOMY.CHEST_REWARD_MIN +
        Math.floor(Math.random() * (ECONOMY.CHEST_REWARD_MAX - ECONOMY.CHEST_REWARD_MIN));
      M.balance += reward;
      M.proChestReady = false;
      M.proChestLast = Date.now();
      pushTransaction('pro-chest', 'Pro daily chest', reward);
      persist();
      return { user: publicState(), reward };
    }

    /* ─── PLAY ──────────────────────────────────────────────────── */
    if (cleanPath === '/api/play/spin' && method === 'POST') {
      const prizes = ECONOMY.WHEEL_PRIZES;
      const weights = ECONOMY.WHEEL_WEIGHTS;
      const prizeIndex = weightedRandomIndex(weights);
      const prizeAmount = prizes[prizeIndex];
      if (prizeAmount > 0) {
        M.balance += prizeAmount;
        pushTransaction('spin', 'Lucky Spin reward', prizeAmount);
      }
      bumpAdChallenge();
      persist();
      return { ...publicState(), prizeIndex, prizeAmount };
    }

    if (cleanPath === '/api/play/scratch' && method === 'POST') {
      if (M.scratchLeft <= 0) throw new Error('No scratch cards left today');
      M.scratchLeft -= 1;
      const prizeIndex = weightedRandomIndex(ECONOMY.SCRATCH_WEIGHTS);
      const prize = ECONOMY.SCRATCH_PRIZES[prizeIndex];
      if (prize > 0) {
        M.balance += prize;
        pushTransaction('scratch', 'Scratch & Win reward', prize);
      }
      bumpAdChallenge();
      persist();
      return { ...publicState(), prizeIndex, prizeAmount: prize };
    }

    if (cleanPath === '/api/play/chest' && method === 'POST') {
      M.chestProgress = (M.chestProgress || 0) + 1;
      let prizeAmount = 0;
      let chestOpened = false;
      if (M.chestProgress >= ECONOMY.CHEST_GOAL) {
        chestOpened = true;
        prizeAmount = ECONOMY.CHEST_REWARD_MIN +
          Math.floor(Math.random() * (ECONOMY.CHEST_REWARD_MAX - ECONOMY.CHEST_REWARD_MIN));
        M.balance += prizeAmount;
        M.chestProgress = 0;
        pushTransaction('chest', 'Mystery Chest reward', prizeAmount);
      }
      bumpAdChallenge();
      persist();
      return { ...publicState(), chestOpened, prizeAmount };
    }

    if (cleanPath === '/api/play/lottery/ticket' && method === 'POST') {
      const type = (body && body.type) || 'ad';
      if (type === 'buy') {
        const price = ECONOMY.LOTTO_TICKET_ORL;
        if (M.balance < price) throw new Error('Insufficient balance');
        M.balance -= price;
        M.lottoPool += price;
        M.lottoTickets += 1;
        pushTransaction('lotto', 'Lottery ticket purchase', -price);
      } else {
        M.lottoTickets += 1;
        bumpAdChallenge();
      }
      persist();
      return publicState();
    }

    if (cleanPath === '/api/play/coinflip' && method === 'POST') {
      const choice = (body && body.choice) || 'heads';
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      const won = choice === result;
      const prizeAmount = won ? ECONOMY.COINFLIP_WIN : ECONOMY.COINFLIP_LOSE;
      M.balance += prizeAmount;
      pushTransaction('coinflip', won ? 'Coin flip win' : 'Coin flip consolation', prizeAmount);
      bumpAdChallenge();
      persist();
      return { ...publicState(), result, won, prizeAmount };
    }

    /* ─── EARN ──────────────────────────────────────────────────── */
    if (cleanPath === '/api/earn/task' && method === 'POST') {
      const { taskId } = body || {};
      const list = [...ECONOMY.TASKS, ...ECONOMY.FEATURED_TASKS];
      const task = list.find(t => t.id === taskId);
      if (!task) throw new Error('Task not found');
      if (M.completedTasks[taskId]) throw new Error('Task already completed');
      M.completedTasks[taskId] = true;
      M.balance += task.reward;
      pushTransaction('task', `Task: ${task.title}`, task.reward);
      bumpAdChallenge();
      persist();
      return publicState();
    }

    if (cleanPath === '/api/earn/streak' && method === 'POST') {
      if (M.streakClaimedToday) throw new Error('Already claimed today');
      const idx = Math.min(6, Math.max(0, (M.streakDay || 1) - 1));
      const reward = ECONOMY.STREAK_AMOUNTS[idx];
      M.balance += reward;
      M.streakClaimedToday = true;
      pushTransaction('streak', `Daily streak day ${M.streakDay}`, reward);
      persist();
      return { user: publicState(), reward };
    }

    if (cleanPath === '/api/earn/faucet' && method === 'POST') {
      const elapsed = Date.now() - (M.faucetLast || 0);
      if (elapsed < ECONOMY.FAUCET_COOLDOWN) throw new Error('Faucet on cooldown');
      const reward = ECONOMY.FAUCET_REWARD;
      M.balance += reward;
      M.faucetLast = Date.now();
      pushTransaction('faucet', 'Hourly faucet', reward);
      bumpAdChallenge();
      persist();
      return { ...publicState(), reward };
    }

    if (cleanPath === '/api/earn/video-wall' && method === 'POST') {
      const reward = ECONOMY.VIDEO_WALL_REWARD;
      M.balance += reward;
      pushTransaction('video', 'Video Wall reward', reward);
      bumpAdChallenge();
      persist();
      return { ...publicState(), reward };
    }

    /* ─── WALLET ────────────────────────────────────────────────── */
    if (cleanPath === '/api/wallet/banks' && method === 'GET') {
      return { banks: MOCK_BANKS };
    }

    if (cleanPath === '/api/wallet/bank-accounts' && method === 'GET') {
      const saved = JSON.parse(localStorage.getItem('orael_mock_bank_accounts') || '[]');
      return { accounts: saved };
    }

    if (cleanPath === '/api/wallet/resolve-account' && method === 'POST') {
      const acctNum = (body && body.account_number) || '';
      const last4 = acctNum.slice(-4);
      const names = [
        'ADEWALE JOHNSON', 'FUNMI BALOGUN', 'CHUKWUEMEKA NWOSU',
        'BISI ADEYEMI', 'IBRAHIM MUSA', 'NKEM IGWE', 'TITILOPE OLAOYE',
        'SANNI ABDUL', 'GRACE OKORO', 'YUSUF MOHAMMED',
      ];
      const idx = (parseInt(last4) || 0) % names.length;
      return { account_name: names[idx] };
    }

    if (cleanPath === '/api/wallet/set-pin' && method === 'POST') {
      M.pinSet = true;
      persist();
      return { ok: true };
    }

    if (cleanPath === '/api/wallet/withdraw' && method === 'POST') {
      const methodKey = (body && body.method) || 'bank';
      const minMap = { bank: 40, usdt: 720, airtime: 40 };
      const min = minMap[methodKey] || 40;
      if (M.balance < min) throw new Error(`Minimum is ${min} ORL`);

      const feePct = isPro() ? ECONOMY.WITHDRAWAL_FEE_PRO_PCT : ECONOMY.WITHDRAWAL_FEE_PCT;
      const fee = Math.floor(M.balance * feePct);
      const net = M.balance - fee;

      if (methodKey === 'bank' && body && body.walletInfo && !body.bankAccountId) {
        const parts = body.walletInfo.split('|');
        if (parts.length >= 4) {
          const saved = JSON.parse(localStorage.getItem('orael_mock_bank_accounts') || '[]');
          saved.push({
            id: Date.now(),
            bank_code: parts[0],
            account_number: parts[1],
            account_name: parts[2],
            bank_name: parts[3],
          });
          localStorage.setItem('orael_mock_bank_accounts', JSON.stringify(saved));
        }
      }

      pushTransaction('withdraw', `Withdrawal via ${methodKey}`, -M.balance);
      M.balance = 0;
      persist();

      return {
        success: true,
        user: publicState(),
        message: `Withdrawal of ${net} ORL (fee ${fee}) is processing. Funds arrive within 24h.`,
      };
    }

    if (cleanPath === '/api/wallet/pro' && method === 'POST') {
      // Mock: return a fake invoice link. devmock.js intercepts openInvoice
      // and simulates a successful payment after 900ms.
      return { invoiceLink: 'mock-invoice-link', ok: true };
    }

    if (cleanPath === '/api/wallet/pro/dev-activate' && method === 'POST') {
      M.proUntil = Date.now() + ECONOMY.PRO_DURATION_DAYS * 24 * 3600 * 1000;
      M.proChestReady = true;
      persist();
      return { state: publicState() };
    }

    /* ─── ADSGRAM CALLBACK ──────────────────────────────────────── */
    if (cleanPath === '/api/adsgram-callback' && method === 'POST') {
      return { ok: true };
    }

    /* ─── FALLBACK ──────────────────────────────────────────────── */
    console.warn('[mock api] Unhandled route:', method, cleanPath);
    return { ok: true };

  } catch (err) {
    if (err.message !== 'Telegram-only access' && err.message !== 'maintenance') {
      toast(err.message || 'Mock API error');
    }
    throw err;
  }
}

/* ─── Dev helper: reset mock state ────────────────────────────────── */
export function resetMockState() {
  M = freshState();
  persist();
  return M;
}

export default api;
