import { updateUser, addTransaction, getUserById, run } from '../db.js';
import { getEconomyConfig } from '../settings.js';
import { payReferralCommission } from './referral.js';
import { isFeatureEnabled } from '../settings.js';

/**
 * Accrue mined ORL for a user based on elapsed time, rig level, and active boosts.
 *
 * @param {object} user - User row from the database.
 * @returns {number} The amount of ORL mined (0 if no mining is active).
 */
export async function accrueMinedORL(user) {
  const now = Date.now();
  const E = getEconomyConfig();
  const TANK_ORL = E.TANK_ORL;
  const RIGS = E.RIGS;

  // If mining is globally disabled (maintenance), pause accrual.
  if (!isFeatureEnabled('mining_enabled')) return 0;

  // Initialize accrual timestamp if missing
  if (!user.last_accrue_at) {
    await updateUser(user.id, { last_accrue_at: now });
    user.last_accrue_at = now;
  }

  // Tank already full
  if (user.tank_mined >= TANK_ORL) {
    return 0;
  }

  const timeDelta = (now - user.last_accrue_at) / (1000 * 60 * 60); // hours

  const rig = RIGS[user.rig_level];
  const sessionHours = rig.sessionMin / 60;
  const baseRate = TANK_ORL / sessionHours; // ORL per hour

  const isPro = user.pro_until > now;
  const isBoosted = user.boost_until > now;
  const tierMul = (E.TIER_MULTIPLIERS && E.TIER_MULTIPLIERS[user.tier]) || 1;
  const multiplier = (isPro ? E.PRO_MULTIPLIER : 1) * (isBoosted ? E.BOOST_MULTIPLIER : 1) * tierMul;

  const effectiveRate = baseRate * multiplier;

  let mined = Math.min(timeDelta * effectiveRate, TANK_ORL - user.tank_mined);
  mined = Math.max(0, mined);
  mined = Math.round(mined * 1e6) / 1e6; // 6 decimal places

  if (mined > 0) {
    // SCALABILITY: Use a single atomic UPDATE that increments balance + tank_mined
    // and sets last_accrue_at in one query (was 3 separate field writes). This
    // halves the write load at scale.
    run(
      'UPDATE users SET balance = balance + ?, tank_mined = tank_mined + ?, last_accrue_at = ? WHERE id = ?',
      [mined, mined, now, user.id]
    );

    // Do not log a transaction row for automatic continuous mining accruals
    // as it spams the transaction history. The balance is credited atomically in the database.

    if (user.referred_by) {
      await payReferralCommission(user.id, mined);
    }

    // Update the in-memory user object so the caller sees the new values.
    user.balance = (user.balance || 0) + mined;
    user.tank_mined = (user.tank_mined || 0) + mined;
    user.last_accrue_at = now;
  }

  return mined;
}
