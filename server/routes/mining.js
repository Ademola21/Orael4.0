import { Router } from 'express';
import {
  getUser,
  updateUser,
  addTransaction,
  unlockAchievement
} from '../db.js';
import { accrueMinedORL } from '../services/mining.js';
import { trackAdWatched } from '../services/adTracking.js';
import { getUserState } from './user.js';
import { TANK_ORL, RIGS, SESSION_MS } from '../economy.js';
import { isSuperAdmin } from '../middleware/adminAuth.js';

const router = Router();

// POST /api/mining/refuel
router.post('/refuel', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Accrue first
    await accrueMinedORL(user);
    user = getUser(telegramUser.id); // re-fetch

    // Calculate energy %
    const energy = ((TANK_ORL - user.tank_mined) / TANK_ORL) * 100;
    if (energy >= 95) {
      return res.status(400).json({ error: 'Engine fuel level is already full' });
    }

    // Reset tank
    updateUser(user.id, {
      tank_mined: 0,
      last_accrue_at: Date.now()
    });

    // Track ad for Daily Ad Challenge (Pro users and admins skip the ad)
    const isPro = user.pro_until > Date.now();
    if (!isPro && !isSuperAdmin(user.telegram_id)) {
      await trackAdWatched(user.id);
    }

    // Unlock first_refuel achievement
    unlockAchievement(user.id, 'first_refuel');

    const state = await getUserState(telegramUser.id);
    return res.json(state);
  } catch (err) {
    console.error('POST /refuel error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mining/boost
router.post('/boost', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Accrue first
    await accrueMinedORL(user);
    user = getUser(telegramUser.id);

    const now = Date.now();
    // Validate not already boosted
    if (user.boost_until > now) {
      return res.status(400).json({ error: 'Boost is already active' });
    }

    // Validate mining is active (tank is not completely mined and last_accrue_at exists)
    if (user.tank_mined >= TANK_ORL) {
      return res.status(400).json({ error: 'Mining engine is idle. Refuel first.' });
    }

    updateUser(user.id, {
      boost_until: now + SESSION_MS
    });

    // Track ad for Daily Ad Challenge (admins bypass ads)
    if (!isSuperAdmin(user.telegram_id)) {
      await trackAdWatched(user.id);
    }

    const state = await getUserState(telegramUser.id);
    return res.json(state);
  } catch (err) {
    console.error('POST /boost error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mining/rig-upgrade
router.post('/rig-upgrade', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Accrue first
    await accrueMinedORL(user);
    user = getUser(telegramUser.id);

    const nextLevel = user.rig_level + 1;
    if (nextLevel >= RIGS.length) {
      return res.status(400).json({ error: 'Already at maximum rig level' });
    }

    const nextRig = RIGS[nextLevel];
    if (user.balance < nextRig.cost) {
      return res.status(400).json({ error: 'Insufficient balance to purchase this rig' });
    }

    const newBalance = user.balance - nextRig.cost;
    updateUser(user.id, {
      balance: newBalance,
      rig_level: nextLevel
    });

    addTransaction(user.id, 'upgrade', -nextRig.cost, `Upgraded to ${nextRig.name}`);

    const state = await getUserState(telegramUser.id);
    return res.json(state);
  } catch (err) {
    console.error('POST /rig-upgrade error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mining/pro-chest — Pro daily free chest (no ad required)
router.post('/pro-chest', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    let user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const now = Date.now();
    const isPro = user.pro_until > now;
    if (!isPro) {
      return res.status(403).json({ error: 'Pro subscription required' });
    }

    // Check 24h cooldown
    const lastClaim = user.pro_chest_last || 0;
    if (now - lastClaim < 24 * 60 * 60 * 1000) {
      const remaining = 24 * 60 * 60 * 1000 - (now - lastClaim);
      return res.status(400).json({ error: 'Daily free chest already claimed', remaining });
    }

    // Award chest reward (150-200 ORL)
    const reward = Math.floor(Math.random() * 51) + 150; // 150-200
    user.balance += reward;
    updateUser(user.id, {
      balance: user.balance,
      pro_chest_last: now
    });
    addTransaction(user.id, 'pro_chest', reward, 'Pro daily free chest');

    const state = await getUserState(telegramUser.id);
    return res.json({ reward, user: state });
  } catch (err) {
    console.error('POST /pro-chest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
