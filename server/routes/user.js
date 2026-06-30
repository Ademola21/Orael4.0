import { Router } from 'express';
import {
  getUser,
  createUser,
  updateUser,
  addTransaction,
  getTransactions,
  getCompletedTasks,
  getLotteryPool,
  checkAndRunDraws,
  checkTierUpgrade,
  getAll,
  getOne,
  getPromoCode,
  hasRedeemedPromo,
  redeemPromoCode,
  incrementPromoUse,
  getUserAchievements,
  ACHIEVEMENTS,
  unlockAchievement,
} from '../db.js';
import { accrueMinedORL } from '../services/mining.js';
import { getAdChallengeProgress } from '../services/adTracking.js';
import {
  TANK_ORL,
  RIGS,
  FAUCET_COOLDOWN,
  STREAK_AMOUNTS,
  SESSION_MS,
  TASKS,
  FEATURED_TASKS,
  PRO_MULTIPLIER,
  BOOST_MULTIPLIER,
  ECONOMY_CONFIG,
  getTierMultiplier
} from '../economy.js';
import { getEconomyConfig, getFeatureFlags } from '../settings.js';

const router = Router();

/**
 * Helper to build the fully serialized state of a user.
 * Calculates all client-facing derived fields like energy, hashrate, cooldowns.
 * Maps snake_case DB columns to the camelCase properties the frontend expects.
 * @param {number} telegramId
 * @returns {Promise<object>}
 */
export function getUserState(telegramId) {
  const user = getUser(telegramId);
  if (!user) return null;

  // Use the live, admin-editable economy config (not the static defaults).
  const E = getEconomyConfig();

  // Ensure user tier is updated automatically
  checkTierUpgrade(user);

  const now = Date.now();

  // Energy: percentage of tank left
  const energy = Math.max(0, Math.min(100, ((E.TANK_ORL - user.tank_mined) / E.TANK_ORL) * 100));

  // Current Rig details
  const rig = E.RIGS[user.rig_level] || E.RIGS[0];
  const sessionMs = rig.sessionMin * 60 * 1000;

  // Multipliers
  const isPro = user.pro_until > now;
  const isBoosted = user.boost_until > now;
  const tierMul = (E.TIER_MULTIPLIERS && E.TIER_MULTIPLIERS[user.tier]) || 1;
  const multiplier = (isPro ? E.PRO_MULTIPLIER : 1) * (isBoosted ? E.BOOST_MULTIPLIER : 1) * tierMul;

  // Hashrate: ORL/hour
  const hashrate = (E.TANK_ORL / (rig.sessionMin / 60)) * multiplier;

  // Fuel time left (ms)
  let fuelTimeLeft = 0;
  if (user.last_accrue_at && user.tank_mined < E.TANK_ORL) {
    const elapsed = now - user.last_accrue_at;
    fuelTimeLeft = Math.max(0, sessionMs - elapsed);
  }

  // Faucet state
  const faucetReady = !user.faucet_last || (now - user.faucet_last >= E.FAUCET_COOLDOWN);
  const faucetCooldown = user.faucet_last ? Math.max(0, E.FAUCET_COOLDOWN - (now - user.faucet_last)) : 0;

  // Streak status
  let streakClaimedToday = false;
  if (user.streak_last_date) {
    const todayStr = new Date().toISOString().slice(0, 10);
    streakClaimedToday = (user.streak_last_date === todayStr);
  }

  // Fetch related database data
  const transactions = getTransactions(user.id, 15);
  const completedTaskIds = getCompletedTasks(user.id);

  // Today's lottery pool stats from DB
  const todayStr = new Date().toISOString().slice(0, 10);
  const pool = getLotteryPool(todayStr) || { total_pool: 0, total_tickets: 0 };
  const lottoPool = pool.total_pool;
  const lottoPlayers = pool.total_tickets;

  // Convert completed task IDs to object mapping task_id -> true
  const completedTasksObj = {};
  for (const taskId of completedTaskIds) {
    completedTasksObj[taskId] = true;
  }

  // Map tasks to include the client expected 'r' property instead of 'reward'
  const clientTasks = E.TASKS.map(t => ({ id: t.id, title: t.title, sub: t.sub, r: t.reward, url: t.url }));
  const clientFeaturedTasks = E.FEATURED_TASKS.map(t => ({ id: t.id, title: t.title, sub: t.sub, r: t.reward, url: t.url }));

  // Ad challenge progress
  const adChallenge = getAdChallengeProgress(user);

  // Pro free chest status
  const proChestLast = user.pro_chest_last || 0;
  const proChestReady = isPro && (now - proChestLast >= 24 * 60 * 60 * 1000);

  // Streak amounts for frontend
  const streakAmounts = E.STREAK_AMOUNTS;

  return {
    id: user.id,
    telegramId: user.telegram_id,
    firstName: user.first_name || '',
    lastName: user.last_name || '',
    username: user.username || '',
    balance: user.balance,
    rigLevel: user.rig_level,
    tankMined: user.tank_mined,
    lastAccrue: user.last_accrue_at || now,
    boostUntil: user.boost_until,
    proUntil: user.pro_until,
    faucetLast: user.faucet_last,
    streakDay: user.streak_day,
    streakLastDate: user.streak_last_date,
    streakClaimedToday,
    streakAmounts,
    spinDate: user.spin_date,
    spinFreeUsed: user.spin_free_used > 0,
    scratchDate: user.scratch_date,
    scratchLeft: 999, // unlimited now — kept for client compat
    chestProgress: user.chest_progress,
    lottoDate: user.lotto_date,
    lottoTickets: user.lotto_tickets,
    refCode: user.referral_code,
    tier: user.tier,
    country: user.country || null,
    ref: {
      count: user.ref_count,
      earned: user.ref_earnings,
      active: user.ref_active
    },
    energy,
    hashrate,
    fuelTimeLeft,
    faucetReady,
    faucetCooldown,
    isPro,
    isBoosted,
    rig,
    rigs: E.RIGS,
    nextRig: user.rig_level + 1 < E.RIGS.length ? E.RIGS[user.rig_level + 1] : null,
    tasks: clientTasks,
    featuredTasks: clientFeaturedTasks,
    completedTasks: completedTasksObj,
    lottoPool,
    lottoPlayers,
    transactions,
    adChallenge,
    proChestReady,
    proChestLast,
    photoUrl: user.photo_url || null,
    avatarUrl: user.avatar_url || null,
    tutorialSeen: user.tutorial_seen === 1,
    role: user.role || 'user',
    permissions: user.permissions || '',
    // Server-authoritative economy config — the client must use these values
    // for ALL displays (tank size, peg, prizes, referral %, rig costs, etc.)
    // instead of its own stale hardcoded copies.
    economy: getEconomyConfig(),
    // Feature flags so the client can show "temporarily disabled" states.
    flags: getFeatureFlags(),
  };
}

// GET /api/user
router.get('/', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Run any pending lottery drawings first
    checkAndRunDraws();

    let user = getUser(telegramUser.id);
    const now = Date.now();
    const country = req.headers['cf-ipcountry'] || null;

    if (!user) {
      // Parse start_param for referral
      const initData = req.headers['x-telegram-init-data'] || '';
      const params = new URLSearchParams(initData);
      const startParam = params.get('start_param') || null;

      user = createUser(
        telegramUser.id,
        telegramUser.first_name,
        telegramUser.last_name || '',
        telegramUser.username || '',
        null,
        startParam,
        country
      );

      // Create initial transaction for joining
      addTransaction(user.id, 'join', 0, 'Welcome to Orael!');
    } else {
      // Update country if it changed
      if (country && user.country !== country) {
        updateUser(user.id, { country });
        user.country = country;
      }
      // Update photo_url + name if changed
      const photoUrl = telegramUser.photo_url || null;
      if (photoUrl && user.photo_url !== photoUrl) {
        updateUser(user.id, { photo_url: photoUrl });
        user.photo_url = photoUrl;
      }
      if (telegramUser.first_name && user.first_name !== telegramUser.first_name) {
        updateUser(user.id, { first_name: telegramUser.first_name });
      }
      if (telegramUser.username && user.username !== telegramUser.username) {
        updateUser(user.id, { username: telegramUser.username });
      }
      // Accrue mining first
      await accrueMinedORL(user);

      // Check balance_100k achievement
      const freshUser = getUser(telegramUser.id);
      if (freshUser && freshUser.balance >= 100000) {
        unlockAchievement(user.id, 'balance_100k');
      }
      // Check pro_member achievement
      if (freshUser && freshUser.pro_until > Date.now()) {
        unlockAchievement(user.id, 'pro_member');
      }
    }

    const state = await getUserState(telegramUser.id);
    return res.json(state);
  } catch (err) {
    console.error('GET /api/user error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/user/tutorial-seen — mark tutorial as seen
router.post('/tutorial-seen', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    updateUser(user.id, { tutorial_seen: 1 });
    return res.json({ success: true });
  } catch (err) {
    console.error('POST /tutorial-seen error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/user/transactions — paginated transaction history
router.get('/transactions', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const transactions = getAll(
      'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [user.id, limit, offset]
    );
    const total = getOne('SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ?', [user.id])?.cnt || 0;

    return res.json({
      transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('GET /transactions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/user/withdrawals — paginated withdrawal history
router.get('/withdrawals', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const withdrawals = getAll(
      'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [user.id, limit, offset]
    );
    const total = getOne('SELECT COUNT(*) AS cnt FROM withdrawals WHERE user_id = ?', [user.id])?.cnt || 0;

    return res.json({
      withdrawals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error('GET /withdrawals error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/user/redeem-promo — redeem a promo code ───────── */

router.post('/redeem-promo', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Promo code required' });

    const promo = getPromoCode(code);
    if (!promo) return res.status(400).json({ error: 'Invalid or expired promo code' });
    if (!promo.active) return res.status(400).json({ error: 'This promo code is no longer active' });
    if (promo.expires_at && promo.expires_at < Date.now()) {
      return res.status(400).json({ error: 'This promo code has expired' });
    }
    if (promo.max_uses > 0 && promo.uses >= promo.max_uses) {
      return res.status(400).json({ error: 'This promo code has reached its usage limit' });
    }
    if (hasRedeemedPromo(user.id, code)) {
      return res.status(400).json({ error: 'You have already redeemed this promo code' });
    }

    // Credit reward
    const newBalance = (user.balance || 0) + promo.reward_orl;
    updateUser(user.id, { balance: newBalance });
    addTransaction(user.id, 'promo', promo.reward_orl, `Promo code redeemed: ${code.toUpperCase()}`);
    incrementPromoUse(code);
    redeemPromoCode(user.id, code, promo.reward_orl);

    return res.json({
      success: true,
      reward: promo.reward_orl,
      newBalance,
      message: `Promo redeemed! +${promo.reward_orl} ORL added to your balance.`
    });
  } catch (err) {
    console.error('POST /redeem-promo error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/user/achievements — list unlocked achievements ─── */

router.get('/achievements', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const unlocked = getUserAchievements(user.id);
    const unlockedKeys = new Set(unlocked.map(a => a.achievement));

    const all = Object.entries(ACHIEVEMENTS).map(([key, def]) => ({
      key,
      name: def.name,
      desc: def.desc,
      icon: def.icon,
      unlocked: unlockedKeys.has(key),
      unlocked_at: unlocked.find(a => a.achievement === key)?.unlocked_at || null,
    }));

    return res.json({ achievements: all });
  } catch (err) {
    console.error('GET /achievements error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
