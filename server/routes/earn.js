import { Router } from 'express';
import {
  getUser,
  updateUser,
  addTransaction,
  getCompletedTasks,
  completeTask,
  unlockAchievement,
} from '../db.js';
import { accrueMinedORL } from '../services/mining.js';
import { trackAdWatched } from '../services/adTracking.js';
import { getUserState } from './user.js';
import { getEconomyConfig } from '../settings.js';
import { isFeatureEnabled } from '../settings.js';
import { isSuperAdmin } from '../middleware/adminAuth.js';

const router = Router();

const QUIZ_POOL = [
  {
    id: "q1",
    question: "What is the primary token of the Orael ecosystem?",
    options: ["BTC", "ORL", "ETH", "USDT"],
    answer: "ORL"
  },
  {
    id: "q2",
    question: "What is the peg value of 1 ORL in Nigerian Naira?",
    options: ["₦0.01", "₦0.02", "₦0.05", "₦0.10"],
    answer: "₦0.02"
  },
  {
    id: "q3",
    question: "How long is the mining session duration for Rig I?",
    options: ["2 hours", "3 hours", "4 hours", "5 hours"],
    answer: "4 hours"
  },
  {
    id: "q4",
    question: "Which of the following is NOT an Orael cash out method?",
    options: ["Local Bank Transfer", "Airtime Payout", "USDT Transfer", "PayPal Cash"],
    answer: "PayPal Cash"
  },
  {
    id: "q5",
    question: "What percentage commission does Level 1 referrer earn?",
    options: ["5%", "7%", "10%", "12%"],
    answer: "7%"
  },
  {
    id: "q6",
    question: "What percentage commission does Level 2 referrer earn?",
    options: ["1%", "2%", "3%", "5%"],
    answer: "2%"
  },
  {
    id: "q7",
    question: "Which mini-game EV (Expected Value) is 40 ORL per watch?",
    options: ["Coin Flip", "Spin-the-wheel", "Mystery Chest", "Scratch Card"],
    answer: "Coin Flip"
  },
  {
    id: "q8",
    question: "What is the maximum single withdrawal limit by default?",
    options: ["50,000 ORL", "100,000 ORL", "200,000 ORL", "500,000 ORL"],
    answer: "200,000 ORL"
  },
  {
    id: "q9",
    question: "What is the default withdrawal fee for regular users?",
    options: ["2%", "5%", "8%", "10%"],
    answer: "10%"
  },
  {
    id: "q10",
    question: "What is the default withdrawal fee for Orael Pro users?",
    options: ["2%", "5%", "8%", "10%"],
    answer: "5%"
  },
  {
    id: "q11",
    question: "Which of these is the official Telegram Channel for Orael?",
    options: ["@OraelGlobal", "@OraelNG", "@OraelAnn", "@OraelChannel"],
    answer: "@OraelNG"
  },
  {
    id: "q12",
    question: "How often can you claim the Orael faucet?",
    options: ["Every 30 minutes", "Every 1 hour", "Every 6 hours", "Every 24 hours"],
    answer: "Every 1 hour"
  }
];

/* ─── helper ──────────────────────────────────────────────────────── */

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/* ─── POST /faucet ────────────────────────────────────────────────── */

router.post('/faucet', async (req, res) => {
  try {
    if (!isFeatureEnabled('faucet_enabled')) {
      return res.status(503).json({ error: 'Faucet is temporarily disabled' });
    }
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    const E = getEconomyConfig();
    const now = Date.now();
    const elapsed = now - (user.faucet_last || 0);

    if (elapsed < E.FAUCET_COOLDOWN) {
      const remaining = E.FAUCET_COOLDOWN - elapsed;
      return res.status(400).json({
        error: 'Faucet on cooldown',
        remaining,
      });
    }

    user.balance += E.FAUCET_REWARD;
    user.faucet_last = now;
    await addTransaction(user.id, 'faucet', E.FAUCET_REWARD, 'Faucet claim');
    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({ user: await getUserState(telegramUser.id) });
  } catch (err) {
    console.error('POST /faucet error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /quiz/question ──────────────────────────────────────────── */

router.get('/quiz/question', async (req, res) => {
  try {
    const telegramUser = req.user;
    const completed = await getCompletedTasks(telegramUser.id);
    if (completed.includes('t3')) {
      return res.status(400).json({ error: 'Daily quiz already completed today' });
    }

    const randomIndex = Math.floor(Math.random() * QUIZ_POOL.length);
    const question = QUIZ_POOL[randomIndex];

    return res.json({
      questionId: question.id,
      question: question.question,
      options: question.options
    });
  } catch (err) {
    console.error('GET /quiz/question error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /quiz/submit ───────────────────────────────────────────── */

router.post('/quiz/submit', async (req, res) => {
  try {
    const telegramUser = req.user;
    const { questionId, answer } = req.body;
    let user = await getUser(telegramUser.id);

    const completed = await getCompletedTasks(user.id);
    if (completed.includes('t3')) {
      return res.status(400).json({ error: 'Daily quiz already completed today' });
    }

    const question = QUIZ_POOL.find(q => q.id === questionId);
    if (!question) {
      return res.status(404).json({ error: 'Question not found' });
    }

    if (question.answer.toLowerCase().trim() !== answer.toLowerCase().trim()) {
      return res.status(400).json({ error: 'Incorrect answer. Try again tomorrow!' });
    }

    const E = getEconomyConfig();
    const task = E.TASKS.find(t => t.id === 't3');
    const rewardAmt = task ? task.reward : 35;

    user.balance += rewardAmt;
    await completeTask(user.id, 't3');
    await addTransaction(user.id, 'task', rewardAmt, 'Daily quiz completed');
    await updateUser(user);

    return res.json({
      success: true,
      reward: rewardAmt,
      user: await getUserState(telegramUser.id)
    });
  } catch (err) {
    console.error('POST /quiz/submit error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /task ──────────────────────────────────────────────────── */

router.post('/task', async (req, res) => {
  try {
    const telegramUser = req.user;
    const { taskId } = req.body;
    let user = await getUser(telegramUser.id);

    const completed = await getCompletedTasks(user.id);
    if (completed.includes(taskId)) {
      return res.status(400).json({ error: 'Task already completed' });
    }

    const E = getEconomyConfig();
    const task =
      E.TASKS.find((t) => t.id === taskId) ||
      E.FEATURED_TASKS.find((t) => t.id === taskId);

    if (!task) {
      return res.status(400).json({ error: 'Task not found' });
    }

    user.balance += task.reward;
    await completeTask(user.id, taskId);
    await addTransaction(
      user.id,
      'task',
      task.reward,
      `Task completed: ${task.id}`,
    );
    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({ user: await getUserState(telegramUser.id) });
  } catch (err) {
    console.error('POST /task error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /video-wall — NEW: unlimited watch & earn ──────────────── */
//  Each call = 1 ad watched = VIDEO_WALL_REWARD ORL credited.
//  No daily limit. Client plays Adsgram ad first, then calls this.

router.post('/video-wall', async (req, res) => {
  try {
    if (!isFeatureEnabled('faucet_enabled')) {
      return res.status(503).json({ error: 'Video wall is temporarily disabled' });
    }
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);
    await accrueMinedORL(user);

    const E = getEconomyConfig();
    user.balance += E.VIDEO_WALL_REWARD;
    await addTransaction(user.id, 'video_wall', E.VIDEO_WALL_REWARD, 'Video wall ad reward');
    await updateUser(user);
    if (!isSuperAdmin(user.telegram_id)) await trackAdWatched(user.id);

    return res.json({
      reward: E.VIDEO_WALL_REWARD,
      user: await getUserState(telegramUser.id)
    });
  } catch (err) {
    console.error('POST /video-wall error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── streak helpers ──────────────────────────────────────────────── */

function computeStreak(user) {
  const today = todayStr();
  const yesterday = yesterdayStr();

  let streakDay = user.streak_day || 0;
  let claimed = false;

  if (user.streak_last_date === today) {
    // Already claimed today
    claimed = true;
  } else if (user.streak_last_date === yesterday) {
    // Consecutive day — advance streak (wrap at 7)
    streakDay = streakDay >= 7 ? 1 : streakDay + 1;
  } else {
    // Streak broken or first time — start at day 1
    streakDay = 1;
  }

  return { streakDay, claimed };
}

/* ─── GET /streak ─────────────────────────────────────────────────── */

router.get('/streak', async (req, res) => {
  try {
    const telegramUser = req.user;
    const user = await getUser(telegramUser.id);
    const { streakDay, claimed } = computeStreak(user);

    const E = getEconomyConfig();
    return res.json({
      streakDay,
      amounts: E.STREAK_AMOUNTS,
      claimed,
    });
  } catch (err) {
    console.error('GET /streak error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /streak ────────────────────────────────────────────────── */

router.post('/streak', async (req, res) => {
  try {
    const telegramUser = req.user;
    let user = await getUser(telegramUser.id);

    const { streakDay, claimed } = computeStreak(user);

    if (claimed) {
      return res
        .status(400)
        .json({ error: 'Streak already claimed today' });
    }

    const E = getEconomyConfig();
    const reward = E.STREAK_AMOUNTS[streakDay - 1];
    user.balance += reward;
    user.streak_day = streakDay;
    user.streak_last_date = todayStr();

    await addTransaction(
      user.id,
      'streak',
      reward,
      `Daily streak day ${streakDay}`,
    );
    await updateUser(user);

    // Unlock streak_7 achievement
    if (streakDay >= 7) {
      unlockAchievement(user.id, 'streak_7');
    }

    return res.json({ user: await getUserState(telegramUser.id) });
  } catch (err) {
    console.error('POST /streak error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
