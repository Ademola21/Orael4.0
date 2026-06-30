// ─────────────────────────────────────────────────────────────
//  adTracking.js — Daily Ad Challenge milestone tracker
//  Called after every ad-funded action to increment the daily
//  ad counter and credit milestone bonuses automatically.
// ─────────────────────────────────────────────────────────────

import { getUserById, updateUser, addTransaction, incrementTotalAdsWatched, unlockAchievement } from '../db.js';
import { getEconomyConfig } from '../settings.js';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increment the user's daily ad counter and credit any milestone bonuses.
 * Should be called AFTER every ad-funded action completes successfully.
 *
 * @param {number} userId - internal user ID
 * @returns {Promise<{ count: number, milestonesHit: Array<{ads:number, bonus:number}> }>}
 */
export async function trackAdWatched(userId) {
  const user = await getUserById(userId);
  if (!user) return { count: 0, milestonesHit: [] };

  const E = getEconomyConfig();
  const AD_MILESTONES = E.AD_MILESTONES;
  const today = todayStr();

  // Reset daily counter if new day
  if (user.ads_today_date !== today) {
    user.ads_today_count = 0;
    user.ad_milestones_claimed = '';
  }

  user.ads_today_count = (user.ads_today_count || 0) + 1;
  const count = user.ads_today_count;

  // Check which milestones are newly reached
  const claimedStr = user.ad_milestones_claimed || '';
  const claimedSet = new Set(claimedStr.split(',').filter(Boolean));

  const milestonesHit = [];
  let totalBonus = 0;

  for (const m of AD_MILESTONES) {
    if (count >= m.ads && !claimedSet.has(String(m.ads))) {
      milestonesHit.push(m);
      totalBonus += m.bonus;
      claimedSet.add(String(m.ads));
    }
  }

  // Credit bonus + record transactions
  if (totalBonus > 0) {
    user.balance = (user.balance || 0) + totalBonus;
    for (const m of milestonesHit) {
      await addTransaction(userId, 'ad_milestone', m.bonus, `Daily ad challenge: ${m.ads} ads! +${m.bonus} ORL`);
    }
  }

  // Persist counter + claimed milestones
  await updateUser(userId, {
    ads_today_count: count,
    ads_today_date: today,
    ad_milestones_claimed: Array.from(claimedSet).join(','),
    balance: user.balance
  });

  // Track lifetime ad count for achievements
  await incrementTotalAdsWatched(userId);

  // Check achievements
  const totalAds = (user.total_ads_watched || 0) + 1;
  if (totalAds >= 100) unlockAchievement(userId, 'ads_100');
  if (totalAds >= 500) unlockAchievement(userId, 'ads_500');

  return { count, milestonesHit, totalBonus };
}

/**
 * Get the user's daily ad challenge progress for frontend display.
 * @param {object} user - user row from DB
 * @returns {object} { count, milestones: [{ads, bonus, claimed}, ...], nextMilestone }
 */
export function getAdChallengeProgress(user) {
  const E = getEconomyConfig();
  const AD_MILESTONES = E.AD_MILESTONES;
  const today = todayStr();
  const count = user.ads_today_date === today ? (user.ads_today_count || 0) : 0;
  const claimedStr = user.ads_today_date === today ? (user.ad_milestones_claimed || '') : '';
  const claimedSet = new Set(claimedStr.split(',').filter(Boolean));

  const milestones = AD_MILESTONES.map(m => ({
    ads: m.ads,
    bonus: m.bonus,
    claimed: claimedSet.has(String(m.ads)) || count >= m.ads
  }));

  const nextMilestone = AD_MILESTONES.find(m => !claimedSet.has(String(m.ads)) && count < m.ads) || null;

  return { count, milestones, nextMilestone };
}
