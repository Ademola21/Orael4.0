import { Router } from 'express';
import { getUser, getLeaderboard, getUserRank } from '../db.js';

const router = Router();

// GET /api/leaderboard
router.get('/', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    if (!telegramUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUser(telegramUser.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const rawLeaderboard = getLeaderboard(20);
    const leaderboard = rawLeaderboard.map((u, index) => ({
      rank: index + 1,
      first_name: u.first_name || 'Anonymous',
      username: u.username || '',
      balance: u.balance,
      photo_url: u.photo_url || null,
      avatar_url: u.avatar_url || null
    }));

    const userRankVal = getUserRank(user.id);

    return res.json({
      leaderboard,
      userRank: userRankVal + 1, // 1-indexed rank
      userBalance: user.balance,
      userPhoto: user.photo_url || null
    });
  } catch (err) {
    console.error('GET /leaderboard error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
