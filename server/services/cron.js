// ─────────────────────────────────────────────────────────────
//  cron.js — Background maintenance tasks
//  - Poll Flutterwave for stuck withdrawals (every 15 min)
//  - Daily DB backup (every 24h)
//  - Weekly leaderboard reward distribution (Sundays at midnight)
//
//  CRON LEADERSHIP: When running multiple Docker replicas for HA/scale, only
//  ONE replica should run these background tasks (otherwise you get duplicate
//  backups, duplicate reward distributions, etc.). Set CRON_LEADER=true on
//  exactly one replica. If CRON_LEADER is unset, crons run (single-replica
//  default for backwards compat). If CRON_LEADER=false, crons are skipped.
// ─────────────────────────────────────────────────────────────

import { getWithdrawalsByStatus, updateWithdrawalStatusById, getUserById, updateUser, addTransaction, backupDatabase, logAudit, getAll, getOne, run } from '../db.js';
import { getTransferStatus } from './flutterwave.js';
import { notifyWithdrawalCompleted, notifyWithdrawalFailed } from './notifications.js';

const FIFTEEN_MIN = 15 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/**
 * Whether this replica should run cron jobs. In a multi-replica Docker setup,
 * set CRON_LEADER=true on exactly one container. Default: true (single-replica).
 */
function isCronLeader() {
  const v = process.env.CRON_LEADER;
  return v === undefined || v === 'true' || v === '1';
}

/**
 * Start all background cron tasks (only if this replica is the cron leader).
 */
export function startCronJobs() {
  if (!isCronLeader()) {
    console.log('[cron] CRON_LEADER=false — background tasks skipped on this replica.');
    return;
  }
  console.log('[cron] Starting background tasks (this replica is the cron leader)...');

  // Poll Flutterwave for stuck pending withdrawals every 15 minutes
  setInterval(pollStuckWithdrawals, FIFTEEN_MIN);
  // Run once at startup (after 30s delay)
  setTimeout(pollStuckWithdrawals, 30 * 1000);

  // Daily DB backup at 3 AM
  scheduleDailyBackup();

  // Weekly leaderboard reward distribution — check every hour
  setInterval(checkWeeklyLeaderboard, ONE_HOUR);
}

/**
 * Find pending withdrawals older than 1 hour and poll Flutterwave for their status.
 */
async function pollStuckWithdrawals() {
  try {
    const cutoff = Date.now() - ONE_HOUR;
    const stuck = getWithdrawalsByStatus('pending', 50, 0);
    const stuckOld = stuck.filter(w => w.created_at < cutoff && w.flw_transfer_id);

    if (stuckOld.length === 0) return;

    console.log(`[cron] Found ${stuckOld.length} stuck withdrawals to poll`);

    for (const withdrawal of stuckOld) {
      try {
        const status = await getTransferStatus(withdrawal.flw_transfer_id);
        console.log(`[cron] Withdrawal #${withdrawal.id} Flutterwave status: ${status.status}`);

        if (status.status === 'SUCCESSFUL') {
          updateWithdrawalStatusById(withdrawal.id, 'completed', status.complete_message);
          addTransaction(withdrawal.user_id, 'withdraw_completed', 0, `Withdrawal #${withdrawal.id} completed (cron poll)`);
          logAudit(null, 'system', 'withdrawal_completed_cron', withdrawal.user_id, {
            withdrawal_id: withdrawal.id,
            flw_status: status.status,
          }, null);

          // Notify user
          const user = getUserById(withdrawal.user_id);
          if (user) {
            await notifyWithdrawalCompleted(user.telegram_id, withdrawal.amount_orl, withdrawal.method, withdrawal.net_fiat || '');
          }
        } else if (status.status === 'FAILED') {
          updateWithdrawalStatusById(withdrawal.id, 'rejected', status.complete_message || 'Transfer failed');
          const user = getUserById(withdrawal.user_id);
          if (user) {
            updateUser(user.id, { balance: user.balance + withdrawal.amount_orl });
            addTransaction(user.id, 'withdraw_refund', withdrawal.amount_orl, `Withdrawal #${withdrawal.id} failed (cron) — refunded`);
            await notifyWithdrawalFailed(user.telegram_id, withdrawal.amount_orl, status.complete_message);
          }
          logAudit(null, 'system', 'withdrawal_failed_cron', withdrawal.user_id, {
            withdrawal_id: withdrawal.id,
            reason: status.complete_message,
          }, null);
        }
        // PENDING / NEW — leave alone, will retry next interval
      } catch (err) {
        console.error(`[cron] Error polling withdrawal #${withdrawal.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[cron] pollStuckWithdrawals failed:', err);
  }
}

/**
 * Schedule daily DB backup at 3 AM local time.
 */
function scheduleDailyBackup() {
  const now = new Date();
  const tomorrow3am = new Date(now);
  tomorrow3am.setDate(now.getDate() + 1);
  tomorrow3am.setHours(3, 0, 0, 0);
  const msUntil3am = tomorrow3am - now;

  setTimeout(() => {
    backupDatabase();
    setInterval(backupDatabase, ONE_DAY);
  }, msUntil3am);

  console.log(`[cron] Daily DB backup scheduled for 3 AM (in ${Math.round(msUntil3am / 1000 / 60)} min)`);
}

/**
 * Check if it's Sunday midnight → distribute weekly leaderboard rewards.
 * Top 20 miners split a 50,000 ORL pool (proportional to balance).
 */
async function checkWeeklyLeaderboard() {
  const now = new Date();
  // Sunday = 0
  if (now.getDay() !== 0) return;
  if (now.getHours() !== 0) return;

  console.log('[cron] Running weekly leaderboard distribution...');

  try {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    const weekKey = weekStart.toISOString().slice(0, 10);

    // Check if we already distributed for this week
    const alreadyDone = getOne('SELECT 1 FROM weekly_leaderboard WHERE week_start = ?', [weekKey]);
    if (alreadyDone) return;

    const top20 = getAll('SELECT id, telegram_id, first_name, balance FROM users WHERE balance > 0 ORDER BY balance DESC LIMIT 20');
    if (top20.length === 0) return;

    const totalPool = 50000; // 50,000 ORL weekly pool
    const totalBalance = top20.reduce((sum, u) => sum + u.balance, 0);
    if (totalBalance === 0) return;

    let distributed = 0;
    for (let i = 0; i < top20.length; i++) {
      const user = top20[i];
      const share = Math.floor((user.balance / totalBalance) * totalPool);
      if (share > 0) {
        updateUser(user.id, { balance: user.balance + share });
        addTransaction(user.id, 'leaderboard_reward', share, `Weekly leaderboard rank #${i + 1} — ${share} ORL`);
        distributed += share;

        // Save snapshot
        run('INSERT OR REPLACE INTO weekly_leaderboard (week_start, user_id, rank, balance, reward_paid, snapshot_at) VALUES (?, ?, ?, ?, ?, ?)',
          [weekKey, user.id, i + 1, user.balance, share, Date.now()]);
      }
    }

    logAudit(null, 'system', 'weekly_leaderboard_distribution', null, {
      week: weekKey,
      total_distributed: distributed,
      winners: top20.length,
    }, null);

    console.log(`[cron] Distributed ${distributed} ORL to ${top20.length} users for week ${weekKey}`);
  } catch (err) {
    console.error('[cron] Weekly leaderboard distribution failed:', err);
  }
}
