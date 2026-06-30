import { Router } from 'express';
import {
  getUser,
  updateUser,
  addTransaction,
  getLotteryPool,
  upsertLotteryPool,
  unlockAchievement,
  getOne,
} from '../db.js';
import { accrueMinedORL } from '../services/mining.js';
import { trackAdWatched } from '../services/adTracking.js';
import { getUserState } from './user.js';
import { getEconomyConfig } from '../settings.js';
import { isFeatureEnabled } from '../settings.js';
import { isSuperAdmin } from '../middleware/adminAuth.js';

const router = Router();

/* ─── helpers ─────────────────────────────────────────────────────── */

function weightedRandomIndex(weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * sum;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return i;
  }
  return weights.length - 1;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/* ─── POST /spin ──────────────────────────────────────────────────── */

router.post('/spin', async (req, res) => {
  try {
    if (!isFeatureEnabled('games_enabled')) {
      return res.status(503).json({ error: 'Games are temporarily disabled' });
    }
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    const E = getEconomyConfig();
    const prizeIndex = weightedRandomIndex(E.WHEEL_WEIGHTS);
    const prizeAmount = E.WHEEL_PRIZES[prizeIndex];

    // Update daily counter (for backwards-compat with old clients)
    if (user.spin_date !== todayStr()) {
      user.spin_free_used = 0;
      user.spin_date = todayStr();
    }
    user.spin_free_used += 1;

    if (prizeAmount > 0) {
      user.balance += prizeAmount;
      await addTransaction(user.id, 'spin', prizeAmount, 'Spin the Wheel reward');
    }

    // Big winner achievement for 500+ ORL spin
    if (prizeAmount >= 500) {
      unlockAchievement(user.id, 'big_winner');
    }

    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({
      prizeIndex,
      prizeAmount,
      user: await getUserState(telegramUser.id)
    });
  } catch (err) {
    console.error('POST /spin error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /scratch — NO DAILY LIMIT ──────────────────────────────── */

router.post('/scratch', async (req, res) => {
  try {
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    // Daily reset (kept for backwards compat, but no longer enforced)
    if (user.scratch_date !== todayStr()) {
      user.scratch_left = 999; // effectively unlimited
      user.scratch_date = todayStr();
    }

    const E = getEconomyConfig();
    const prizeIndex = weightedRandomIndex(E.SCRATCH_WEIGHTS);
    const prizeAmount = E.SCRATCH_PRIZES[prizeIndex];

    if (prizeAmount > 0) {
      user.balance += prizeAmount;
      await addTransaction(user.id, 'scratch', prizeAmount, 'Scratch card reward');
    }

    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({
      prizeIndex,
      prizeAmount,
      user: await getUserState(telegramUser.id)
    });
  } catch (err) {
    console.error('POST /scratch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /chest ─────────────────────────────────────────────────── */

router.post('/chest', async (req, res) => {
  try {
    if (!isFeatureEnabled('games_enabled')) {
      return res.status(503).json({ error: 'Games are temporarily disabled' });
    }
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    const E = getEconomyConfig();
    user.chest_progress = (user.chest_progress || 0) + 1;

    if (user.chest_progress >= E.CHEST_GOAL) {
      user.chest_progress = 0;
      const reward =
        Math.floor(Math.random() * (E.CHEST_REWARD_MAX - E.CHEST_REWARD_MIN + 1)) +
        E.CHEST_REWARD_MIN;
      user.balance += reward;
      await addTransaction(user.id, 'chest', reward, 'Treasure chest reward');
      await updateUser(user);
      if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

      // Check chest_master achievement (10 chests opened lifetime)
      const chestCount = getOne("SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ? AND type = 'chest'", [user.id])?.cnt || 0;
      if (chestCount >= 10) {
        unlockAchievement(user.id, 'chest_master');
      }

      return res.json({
        chestOpened: true,
        prizeAmount: reward,
        user: await getUserState(telegramUser.id),
      });
    }

    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);
    return res.json({
      chestOpened: false,
      progress: user.chest_progress,
      user: await getUserState(telegramUser.id),
    });
  } catch (err) {
    console.error('POST /chest error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /coinflip — NEW GAME, no daily limit ───────────────────── */

router.post('/coinflip', async (req, res) => {
  try {
    if (!isFeatureEnabled('games_enabled')) {
      return res.status(503).json({ error: 'Games are temporarily disabled' });
    }
    const telegramUser = req.user;
    const { choice } = req.body; // 'heads' or 'tails'
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    if (!choice || (choice !== 'heads' && choice !== 'tails')) {
      return res.status(400).json({ error: 'Pick heads or tails' });
    }

    const E = getEconomyConfig();
    // Server picks the result (fair 50/50)
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const won = result === choice;
    const prizeAmount = won ? E.COINFLIP_WIN : E.COINFLIP_LOSE;

    if (prizeAmount > 0) {
      user.balance += prizeAmount;
      await addTransaction(user.id, 'coinflip', prizeAmount, won ? 'Coin flip won!' : 'Coin flip consolation');
    }

    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({
      result,
      won,
      prizeAmount,
      user: await getUserState(telegramUser.id)
    });
  } catch (err) {
    console.error('POST /coinflip error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /lottery/ticket ────────────────────────────────────────── */

router.post('/lottery/ticket', async (req, res) => {
  try {
    const telegramUser = req.user;
    const { type } = req.body;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    // Daily reset
    if (user.lotto_date !== todayStr()) {
      user.lotto_tickets = 0;
      user.lotto_date = todayStr();
      await updateUser(user);
      user = await getUser(telegramUser.id);
    }

    if (type === 'buy') {
      const E = getEconomyConfig();
      const LOTTO_TICKET_ORL = E.LOTTO_TICKET_ORL;
      if (user.balance < LOTTO_TICKET_ORL) {
        return res
          .status(400)
          .json({ error: 'Insufficient balance for lottery ticket' });
      }
      user.balance -= LOTTO_TICKET_ORL;
      await addTransaction(
        user.id,
        'lottery_buy',
        -LOTTO_TICKET_ORL,
        'Lottery ticket purchase',
      );
    } else {
      // Free ticket via ad — track ad
      if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);
    }

    user.lotto_tickets += 1;

    const E2 = getEconomyConfig();
    await upsertLotteryPool(todayStr(), E2.LOTTO_TICKET_ORL, 1);
    await updateUser(user);

    const pool = await getLotteryPool(todayStr());
    return res.json({
      tickets: user.lotto_tickets,
      pool,
      user: await getUserState(telegramUser.id),
    });
  } catch (err) {
    console.error('POST /lottery/ticket error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /lottery/status ─────────────────────────────────────────── */

router.get('/lottery/status', async (req, res) => {
  try {
    const telegramUser = req.user;
    const user = await getUser(telegramUser.id);
    const pool = await getLotteryPool(todayStr());

    return res.json({
      pool,
      userTickets: user.lotto_date === todayStr() ? user.lotto_tickets : 0,
    });
  } catch (err) {
    console.error('GET /lottery/status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
