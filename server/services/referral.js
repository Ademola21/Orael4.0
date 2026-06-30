import { getUserById, updateUser, addTransaction, unlockAchievement } from '../db.js';
import { getEconomyConfig } from '../settings.js';

/**
 * Pay two-level referral commissions when a user mines ORL.
 *
 * L1: direct referrer receives REFERRAL_L1_PCT (10%) of mined amount.
 * L2: the referrer's referrer receives REFERRAL_L2_PCT (3%) of mined amount.
 *
 * @param {number} userId       - ID of the user who mined.
 * @param {number} minedAmount  - Amount of ORL mined.
 */
export async function payReferralCommission(userId, minedAmount) {
  const user = await getUserById(userId);
  if (!user || !user.referred_by) return;

  const E = getEconomyConfig();
  const REFERRAL_L1_PCT = E.REFERRAL_L1_PCT;
  const REFERRAL_L2_PCT = E.REFERRAL_L2_PCT;

  // ── L1 commission ──
  const l1Referrer = await getUserById(user.referred_by);
  if (!l1Referrer) return;

  const l1Reward = Math.round(minedAmount * REFERRAL_L1_PCT * 1e6) / 1e6;

  if (l1Reward > 0) {
    await updateUser(l1Referrer.id, {
      balance: l1Referrer.balance + l1Reward,
      ref_earnings: (l1Referrer.ref_earnings || 0) + l1Reward,
    });

    await addTransaction(
      l1Referrer.id,
      'referral_l1',
      l1Reward,
      `L1 commission from user #${userId}`,
    );

    // Check referrer_10 achievement
    if ((l1Referrer.ref_count || 0) >= 10) {
      unlockAchievement(l1Referrer.id, 'referrer_10');
    }
  }

  // ── L2 commission ──
  if (!l1Referrer.referred_by) return;

  const l2Referrer = await getUserById(l1Referrer.referred_by);
  if (!l2Referrer) return;

  const l2Reward = Math.round(minedAmount * REFERRAL_L2_PCT * 1e6) / 1e6;

  if (l2Reward > 0) {
    await updateUser(l2Referrer.id, {
      balance: l2Referrer.balance + l2Reward,
      ref_earnings: (l2Referrer.ref_earnings || 0) + l2Reward,
    });

    await addTransaction(
      l2Referrer.id,
      'referral_l2',
      l2Reward,
      `L2 commission from user #${userId}`,
    );
  }
}
