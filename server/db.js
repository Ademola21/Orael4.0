import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
const DB_PATH = path.resolve(DATA_DIR, 'orael.db');

let db = null;

const AVATAR_COUNT = 10;
function randomDefaultAvatar() {
  const n = Math.floor(Math.random() * AVATAR_COUNT) + 1;
  return `/avatars/avatar-${n}.png`;
}

/**
 * Initialize the native SQLite database (better-sqlite3).
 *
 * Why better-sqlite3 instead of sql.js?
 *  - sql.js loads the ENTIRE database into a JS ArrayBuffer and re-exports the
 *    whole file on every write — at 1M users this blocks the event loop and
 *    caps throughput at ~hundreds of writes/sec.
 *  - better-sqlite3 is a native C++ binding to SQLite. Writes go directly to
 *    the file (incrementally, via WAL). Reads are concurrent with writes.
 *    Throughput is ~50,000+ writes/sec on commodity hardware.
 *  - WAL (Write-Ahead Logging) mode allows multiple readers simultaneously
 *    while a writer is writing — critical for high-concurrency APIs.
 */
export async function initDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);

  // ── Performance pragmas ──
  // WAL mode: concurrent reads + single writer, much faster than default
  //   rollback-journal mode. Readers never block writers.
  db.pragma('journal_mode = WAL');
  // NORMAL synchronous is safe with WAL (only loses last transaction on power
  //   loss, not the whole DB) and ~10x faster than FULL.
  db.pragma('synchronous = NORMAL');
  // Enforce foreign keys (referential integrity).
  db.pragma('foreign_keys = ON');
  // Wait up to 5s if another writer holds the lock instead of throwing.
  db.pragma('busy_timeout = 5000');
  // Larger cache = fewer disk reads. 64MB.
  db.pragma('cache_size = -65536');
  // Store temporary tables in memory.
  db.pragma('temp_store = MEMORY');

  // Schema creation
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id     INTEGER UNIQUE NOT NULL,
      first_name      TEXT,
      last_name       TEXT,
      username        TEXT,
      balance         REAL    DEFAULT 0,
      rig_level       INTEGER DEFAULT 0,
      tank_mined      REAL    DEFAULT 0,
      last_accrue_at  INTEGER,
      boost_until     INTEGER DEFAULT 0,
      pro_until       INTEGER DEFAULT 0,
      faucet_last     INTEGER DEFAULT 0,
      streak_day      INTEGER DEFAULT 1,
      streak_last_date TEXT,
      spin_date       TEXT,
      spin_free_used  INTEGER DEFAULT 0,
      scratch_date    TEXT,
      scratch_left    INTEGER DEFAULT 3,
      chest_progress  INTEGER DEFAULT 0,
      lotto_date      TEXT,
      lotto_tickets   INTEGER DEFAULT 0,
      referral_code   TEXT UNIQUE,
      referred_by     INTEGER,
      ref_count       INTEGER DEFAULT 0,
      ref_earnings    REAL    DEFAULT 0,
      ref_active      INTEGER DEFAULT 0,
      tier            INTEGER DEFAULT 1,
      country         TEXT,
      banned          INTEGER DEFAULT 0,
      created_at      INTEGER,
      updated_at      INTEGER
    );
  `);

  // Migration: Add country column if table already exists
  try { db.exec("ALTER TABLE users ADD COLUMN country TEXT;"); } catch (e) {}

  // Migration: Add banned column if table already exists
  try { db.exec("ALTER TABLE users ADD COLUMN banned INTEGER DEFAULT 0;"); } catch (e) {}

  // Migration: Add ad-tracking columns (Daily Ad Challenge)
  try { db.exec("ALTER TABLE users ADD COLUMN ads_today_count INTEGER DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN ads_today_date TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN ad_milestones_claimed TEXT DEFAULT '';"); } catch (e) {}

  // Migration: Add Pro free chest tracking
  try { db.exec("ALTER TABLE users ADD COLUMN pro_chest_last INTEGER DEFAULT 0;"); } catch (e) {}

  // Migration: Remove scratch daily limit — keep column for backwards compat but default high
  try { db.exec("ALTER TABLE users ADD COLUMN scratch_reset_date TEXT;"); } catch (e) {}

  // Migration: Add role + permissions + avatar columns
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT '';"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN photo_url TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN tutorial_seen INTEGER DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN withdrawal_pin TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN total_withdrawn REAL DEFAULT 0;"); } catch (e) {}
  try { db.exec("ALTER TABLE users ADD COLUMN total_ads_watched INTEGER DEFAULT 0;"); } catch (e) {}

  // Migration: avatar_url — random default assigned at signup, or a custom
  // uploaded image path. Defaults are served from /avatars/avatar-<n>.png.
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT;"); } catch (e) {}

  // Backfill: assign a random default avatar to users created before this
  // column existed (avatar_url IS NULL). Idempotent.
  try {
    const needAvatar = getAll("SELECT id FROM users WHERE avatar_url IS NULL OR avatar_url = ''");
    for (const u of needAvatar) {
      const n = Math.floor(Math.random() * AVATAR_COUNT) + 1;
      run('UPDATE users SET avatar_url = ? WHERE id = ?', [`/avatars/avatar-${n}.png`, u.id]);
    }
    if (needAvatar.length > 0) {
      console.log(`[db] Backfilled ${needAvatar.length} user(s) with random default avatars.`);
    }
  } catch (e) { /* ignore */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      type        TEXT,
      amount      REAL,
      description TEXT,
      created_at  INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      user_id      INTEGER NOT NULL,
      task_id      TEXT    NOT NULL,
      completed_at INTEGER,
      PRIMARY KEY (user_id, task_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lottery_pools (
      draw_date     TEXT PRIMARY KEY,
      total_pool    REAL    DEFAULT 0,
      total_tickets INTEGER DEFAULT 0,
      winner_id     INTEGER,
      drawn         INTEGER DEFAULT 0,
      created_at    INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      method       TEXT,
      amount_orl   REAL,
      fee_orl      REAL,
      net_amount   REAL,
      net_fiat     TEXT,
      status       TEXT DEFAULT 'pending',
      wallet_info  TEXT,
      flw_transfer_id INTEGER,
      flw_reference   TEXT,
      flw_status      TEXT,
      failure_reason  TEXT,
      created_at   INTEGER,
      processed_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migration: add Flutterwave columns to existing withdrawals table
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN flw_transfer_id INTEGER;"); } catch (e) {}
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN flw_reference TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN flw_status TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN failure_reason TEXT;"); } catch (e) {}
  try { db.exec("ALTER TABLE withdrawals ADD COLUMN net_fiat TEXT;"); } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      account_number  TEXT NOT NULL,
      account_bank    TEXT NOT NULL,
      bank_code       TEXT NOT NULL,
      bank_name       TEXT NOT NULL,
      account_name    TEXT NOT NULL,
      created_at      INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id     INTEGER,
      actor_role   TEXT,
      action       TEXT,
      target_user  INTEGER,
      details      TEXT,
      ip_address   TEXT,
      created_at   INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      code         TEXT PRIMARY KEY,
      reward_orl   REAL    NOT NULL,
      max_uses     INTEGER DEFAULT 0,
      uses         INTEGER DEFAULT 0,
      expires_at   INTEGER,
      active       INTEGER DEFAULT 1,
      created_at   INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS promo_redemptions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      code         TEXT    NOT NULL,
      reward_orl   REAL,
      redeemed_at  INTEGER,
      UNIQUE(user_id, code)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS achievements (
      user_id      INTEGER NOT NULL,
      achievement  TEXT    NOT NULL,
      unlocked_at  INTEGER,
      PRIMARY KEY (user_id, achievement)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_leaderboard (
      week_start   TEXT NOT NULL,
      user_id      INTEGER NOT NULL,
      rank         INTEGER,
      balance      REAL,
      reward_paid  REAL DEFAULT 0,
      snapshot_at  INTEGER,
      PRIMARY KEY (week_start, user_id)
    );
  `);

  // Migration: fix the old weekly_leaderboard schema that used `week_start TEXT
  // PRIMARY KEY` alone. With a single-column PK, the cron's INSERT OR REPLACE
  // loop overwrote all but the LAST user per week, so historical snapshots were
  // broken. Detect the old schema and recreate with a composite PK.
  try {
    const rows = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='weekly_leaderboard'");
    const oldSql = rows.length > 0 && rows[0].values.length > 0 ? String(rows[0].values[0][0] || '') : '';
    if (oldSql && !oldSql.includes('PRIMARY KEY (week_start, user_id)')) {
      db.exec('DROP TABLE weekly_leaderboard');
      db.exec(`
        CREATE TABLE weekly_leaderboard (
          week_start   TEXT NOT NULL,
          user_id      INTEGER NOT NULL,
          rank         INTEGER,
          balance      REAL,
          reward_paid  REAL DEFAULT 0,
          snapshot_at  INTEGER,
          PRIMARY KEY (week_start, user_id)
        );
      `);
      console.log('[db] Migrated weekly_leaderboard to composite PK (week_start, user_id).');
    }
  } catch (e) { /* ignore */ }

  // ── Indexes (critical for performance at scale) ──
  // Without these, every leaderboard / history / admin query does a full table
  // scan. At 1M users that means reading millions of rows per request.
  db.exec(`
    -- User lookups
    CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
    CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);
    CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance DESC);
    CREATE INDEX IF NOT EXISTS idx_users_lotto ON users(lotto_date, lotto_tickets);
    CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);

    -- Transaction history (user-facing + admin stats)
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);

    -- Completed tasks
    CREATE INDEX IF NOT EXISTS idx_completed_tasks_user ON completed_tasks(user_id);

    -- Withdrawals (user history + admin queue)
    CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_withdrawals_status_amt ON withdrawals(status, amount_orl DESC);

    -- Bank accounts
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id);

    -- Audit log (admin, filtered by action + time)
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at DESC);

    -- Promo redemptions
    CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON promo_redemptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_redemptions(code);

    -- Achievements
    CREATE INDEX IF NOT EXISTS idx_achievements_user ON achievements(user_id);
  `);

  // Settings table — admin-editable key/value store (economy overrides,
  // feature flags, etc.). Values are JSON strings.
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT,
      updated_at  INTEGER,
      updated_by  INTEGER
    );
  `);

  // better-sqlite3 writes are incremental and durable by default (WAL + sync
  // NORMAL). No full-DB-export needed. A WAL checkpoint on graceful shutdown
  // ensures the WAL file is merged back into the main DB file.
  db.pragma('wal_checkpoint(TRUNCATE)');
  return db;
}

/* ─── Settings helpers (admin-editable config store) ──────────── */

export function getSetting(key, fallback = null) {
  const row = getOne('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row || row.value == null) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export function setSetting(key, value, updatedBy = null) {
  const json = JSON.stringify(value);
  return run(`
    INSERT INTO settings (key, value, updated_at, updated_by)
    VALUES (@key, @value, @updated_at, @updated_by)
    ON CONFLICT(key) DO UPDATE SET
      value = @value, updated_at = @updated_at, updated_by = @updated_by
  `, { key, value: json, updated_at: Date.now(), updated_by: updatedBy });
}

export function getAllSettings() {
  const rows = getAll('SELECT key, value, updated_at, updated_by FROM settings', []);
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

/**
 * better-sqlite3 writes are synchronous and incremental — they go directly to
 * the WAL file, not a full-DB export. So saveDB() is a no-op kept only for
 * backwards compatibility with callers that still reference it.
 */
export function saveDB() {
  // No-op: better-sqlite3 writes are already durable (WAL + synchronous=NORMAL).
}

/**
 * No-op for backwards compat. better-sqlite3 writes are already instant.
 */
export function flushNow() {
  // No-op: better-sqlite3 writes are synchronous and already on disk.
}

// Graceful shutdown: checkpoint the WAL so the main DB file is up-to-date.
function _gracefulShutdown() {
  try {
    if (db) db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', _gracefulShutdown);
process.on('SIGTERM', _gracefulShutdown);

/**
 * Get active db instance.
 */
export function getDB() {
  return db;
}

/* ─── Query execution helpers ───────────────────────────────────────
   better-sqlite3 API:
   - db.prepare(sql).get(...params)  → single row object or undefined
   - db.prepare(sql).all(...params)  → array of row objects
   - db.prepare(sql).run(...params)  → { changes, lastInsertRowid }
   Params can be positional (?) via array OR named (@/$/:) via object.
   All synchronous (no Promises needed). */

export function getOne(sql, params = []) {
  return db.prepare(sql).get(...(Array.isArray(params) ? params : [params]));
}

export function getAll(sql, params = []) {
  return db.prepare(sql).all(...(Array.isArray(params) ? params : [params]));
}

export function run(sql, params = []) {
  const stmt = db.prepare(sql);
  let result;
  if (Array.isArray(params)) {
    result = stmt.run(...params);
  } else if (params && typeof params === 'object') {
    // Named params — better-sqlite3 accepts an object directly. The SQL uses
    // @key style; better-sqlite3 matches @key, $key, and :key automatically.
    result = stmt.run(params);
  } else {
    result = stmt.run();
  }
  return { lastInsertRowid: result.lastInsertRowid, changes: result.changes };
}

/* ─── Business Logic DB Helpers ───────────────────────────────────── */

function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function getUser(telegramId) {
  return getOne('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

export function getUserById(id) {
  return getOne('SELECT * FROM users WHERE id = ?', [id]);
}

export function calculateUserTier(user) {
  const balance = user.balance || 0;
  const refCount = user.ref_count || 0;

  if (balance >= 500000 || refCount >= 100) return 5;
  if (balance >= 100000 || refCount >= 25) return 4;
  if (balance >= 25000 || refCount >= 10) return 3;
  if (balance >= 5000 || refCount >= 3) return 2;
  return 1;
}

export function checkTierUpgrade(user) {
  const currentTier = user.tier || 1;
  const newTier = calculateUserTier(user);
  if (newTier > currentTier) {
    run('UPDATE users SET tier = ? WHERE id = ?', [newTier, user.id]);
    addTransaction(user.id, 'tier_up', 0, `Leveled up to Tier ${newTier}!`);
    user.tier = newTier;
    return true;
  }
  return false;
}

export function createUser(telegramId, firstName, lastName, username, referralCode, referredByCode, country) {
  const nowTime = Date.now();
  const code = referralCode || generateReferralCode();
  let referredBy = null;

  if (referredByCode) {
    const referrer = getOne('SELECT * FROM users WHERE referral_code = ?', [referredByCode]);
    if (referrer) {
      referredBy = referrer.id;
      run('UPDATE users SET ref_count = ref_count + 1, updated_at = ? WHERE id = ?', [nowTime, referrer.id]);
    }
  }

  const avatarUrl = randomDefaultAvatar();
  const info = run(`
    INSERT INTO users (telegram_id, first_name, last_name, username, referral_code, referred_by, last_accrue_at, country, avatar_url, created_at, updated_at)
    VALUES (@telegram_id, @first_name, @last_name, @username, @referral_code, @referred_by, @last_accrue_at, @country, @avatar_url, @created_at, @updated_at)
  `, {
    telegram_id: telegramId,
    first_name: firstName || null,
    last_name: lastName || null,
    username: username || null,
    referral_code: code,
    referred_by: referredBy,
    last_accrue_at: nowTime,
    country: country || null,
    avatar_url: avatarUrl,
    created_at: nowTime,
    updated_at: nowTime
  });

  return getUserById(info.lastInsertRowid);
}

export function updateUser(id, fields) {
  let actualId = id;
  let actualFields = fields;

  if (typeof id === 'object' && id !== null && id.id && !fields) {
    actualId = id.id;
    actualFields = { ...id };
    delete actualFields.id;
  }

  const keys = Object.keys(actualFields);
  if (keys.length === 0) return;

  const sets = keys.map(k => `${k} = @${k}`);
  sets.push('updated_at = @updated_at');

  const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = @id`;
  return run(sql, { ...actualFields, updated_at: Date.now(), id: actualId });
}

export function addTransaction(userId, type, amount, description) {
  return run(`
    INSERT INTO transactions (user_id, type, amount, description, created_at)
    VALUES (@user_id, @type, @amount, @description, @created_at)
  `, {
    user_id: userId,
    type,
    amount,
    description: description || null,
    created_at: Date.now()
  });
}

export function getTransactions(userId, limit = 20) {
  return getAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}

export function getCompletedTasks(userId) {
  const rows = getAll('SELECT task_id FROM completed_tasks WHERE user_id = ?', [userId]);
  return rows.map(r => r.task_id);
}

export function completeTask(userId, taskId) {
  return run(`
    INSERT INTO completed_tasks (user_id, task_id, completed_at)
    VALUES (?, ?, ?)
  `, [userId, taskId, Date.now()]);
}



export function getLotteryPool(date) {
  return getOne('SELECT * FROM lottery_pools WHERE draw_date = ?', [date]);
}

export function upsertLotteryPool(date, amount, tickets) {
  return run(`
    INSERT INTO lottery_pools (draw_date, total_pool, total_tickets, created_at)
    VALUES (@draw_date, @amount, @tickets, @created_at)
    ON CONFLICT(draw_date) DO UPDATE SET
      total_pool    = total_pool + @amount,
      total_tickets = total_tickets + @tickets
  `, {
    draw_date: date,
    amount,
    tickets,
    created_at: Date.now()
  });
}

/**
 * Perform drawing for a specific date pool.
 *
 * SCALABILITY: Uses a weighted random pick via SQL (ORDER BY random() * tickets)
 * instead of loading all participants × tickets into memory. The old approach
 * built an array with one entry PER TICKET — at scale (100k users × 10 tickets
 * = 1M entries) this caused OOM. The SQL approach is O(n) in the DB with an
 * index on (lotto_date, lotto_tickets) and uses constant memory.
 */
export function drawLottery(date) {
  const pool = getLotteryPool(date);
  if (!pool || pool.drawn) return;

  console.log(`[lottery] Running draw for date: ${date}`);

  // Weighted random: pick a single winner where probability ∝ ticket count.
  // `ORDER BY (random() / lotto_tickets)` gives each user a chance inversely
  // proportional to their ticket count → effectively proportional to tickets.
  // This is a single indexed query, constant memory, no array building.
  const winner = getOne(
    `SELECT id, telegram_id FROM users
     WHERE lotto_date = ? AND lotto_tickets > 0
     ORDER BY (random() / lotto_tickets) ASC
     LIMIT 1`,
    [date]
  );

  let winnerId = null;
  let winnerTelegramId = null;

  if (winner) {
    winnerId = winner.id;
    winnerTelegramId = winner.telegram_id;

    const prize = pool.total_pool || 0;
    if (prize > 0) {
      run('UPDATE users SET balance = balance + ? WHERE id = ?', [prize, winnerId]);
      addTransaction(winnerId, 'lottery_win', prize, `Won lottery draw for ${date}`);
      console.log(`[lottery] Winner picked: User ID ${winnerId} won ${prize} ORL`);

      // Notify winner via Bot
      try {
        const token = process.env.BOT_TOKEN;
        if (token) {
          fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: winnerTelegramId,
              text: `🎉 Congratulations! You won the Orael Lottery draw for ${date}! A prize of ${prize} ORL has been credited to your balance! 🚀`
            })
          }).catch(e => console.error('[lottery] Bot notify error:', e));
        }
      } catch (err) {
        console.error('[lottery] Failed to send win notification:', err);
      }
    }
  }

  run('UPDATE lottery_pools SET winner_id = ?, drawn = 1 WHERE draw_date = ?', [winnerId, date]);
}

/**
 * Check for any past undrawn pools and draw them
 */
export function checkAndRunDraws() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const undrawn = getAll('SELECT draw_date FROM lottery_pools WHERE drawn = 0 AND draw_date < ?', [today]);
    for (const p of undrawn) {
      drawLottery(p.draw_date);
    }
  } catch (err) {
    console.error('[lottery] checkAndRunDraws failed:', err);
  }
}

export function getLeaderboard(limit = 20) {
  return getAll('SELECT * FROM users WHERE balance > 0 ORDER BY balance DESC LIMIT ?', [limit]);
}

export function getUserRank(userId) {
  const res = getOne('SELECT COUNT(*) AS rank FROM users WHERE balance > (SELECT balance FROM users WHERE id = ?)', [userId]);
  return res ? res.rank : 0;
}

/* ─── Withdrawal helpers ──────────────────────────────────── */

export function createWithdrawal(userId, method, amountOrl, feeOrl, netAmount, walletInfo) {
  return run(`
    INSERT INTO withdrawals (user_id, method, amount_orl, fee_orl, net_amount, status, wallet_info, created_at)
    VALUES (@user_id, @method, @amount_orl, @fee_orl, @net_amount, 'pending', @wallet_info, @created_at)
  `, {
    user_id: userId,
    method,
    amount_orl: amountOrl,
    fee_orl: feeOrl,
    net_amount: netAmount,
    wallet_info: walletInfo || null,
    created_at: Date.now()
  });
}

export function getPendingWithdrawalsCount(userId) {
  // Count both 'pending' and 'needs_approval' so a user can't stack a second
  // withdrawal while one is already awaiting processing.
  const res = getOne("SELECT COUNT(*) AS cnt FROM withdrawals WHERE user_id = ? AND status IN ('pending','needs_approval')", [userId]);
  return res ? res.cnt : 0;
}

export function getRecentWithdrawals(userId, limit = 10) {
  return getAll('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
}

/* ─── Bank account helpers ──────────────────────────────────── */

export function saveBankAccount(userId, accountNumber, accountBank, bankCode, bankName, accountName) {
  // Check if account already exists for this user
  const existing = getOne(
    'SELECT id FROM bank_accounts WHERE user_id = ? AND account_number = ? AND account_bank = ?',
    [userId, accountNumber, bankCode]
  );
  if (existing) return existing;

  return run(`
    INSERT INTO bank_accounts (user_id, account_number, account_bank, bank_code, bank_name, account_name, created_at)
    VALUES (@user_id, @account_number, @account_bank, @bank_code, @bank_name, @account_name, @created_at)
  `, {
    user_id: userId,
    account_number: accountNumber,
    account_bank: accountBank,
    bank_code: bankCode,
    bank_name: bankName,
    account_name: accountName,
    created_at: Date.now()
  });
}

export function getBankAccounts(userId) {
  return getAll('SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY created_at DESC', [userId]);
}

export function getBankAccountById(userId, accountId) {
  return getOne('SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
}

export function deleteBankAccount(userId, accountId) {
  return run('DELETE FROM bank_accounts WHERE id = ? AND user_id = ?', [accountId, userId]);
}

/* ─── Withdrawal helpers (Flutterwave-aware) ────────────────── */

export function updateWithdrawalFlutterwave(id, flwTransferId, flwReference, flwStatus) {
  return run(
    'UPDATE withdrawals SET flw_transfer_id = ?, flw_reference = ?, flw_status = ? WHERE id = ?',
    [flwTransferId, flwReference, flwStatus, id]
  );
}

export function updateWithdrawalStatusById(id, status, failureReason = null) {
  return run(
    'UPDATE withdrawals SET status = ?, failure_reason = ?, processed_at = ? WHERE id = ?',
    [status, failureReason, Date.now(), id]
  );
}

export function getWithdrawalById(id) {
  return getOne('SELECT * FROM withdrawals WHERE id = ?', [id]);
}

export function getWithdrawalByReference(reference) {
  return getOne('SELECT * FROM withdrawals WHERE flw_reference = ?', [reference]);
}

export function getWithdrawalsByStatus(status, limit = 100, offset = 0) {
  return getAll('SELECT * FROM withdrawals WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?', [status, limit, offset]);
}

/* ─── Daily/monthly withdrawal limits ───────────────────────── */

export function getDailyWithdrawalTotal(userId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const res = getOne(
    "SELECT SUM(amount_orl) AS total FROM withdrawals WHERE user_id = ? AND status IN ('pending','completed') AND created_at >= ?",
    [userId, startOfDay.getTime()]
  );
  return res?.total || 0;
}

export function getMonthlyWithdrawalTotal(userId) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const res = getOne(
    "SELECT SUM(amount_orl) AS total FROM withdrawals WHERE user_id = ? AND status IN ('pending','completed') AND created_at >= ?",
    [userId, startOfMonth.getTime()]
  );
  return res?.total || 0;
}

/* ─── Audit log ─────────────────────────────────────────────── */

export function logAudit(actorId, actorRole, action, targetUser, details, ipAddress) {
  return run(`
    INSERT INTO audit_log (actor_id, actor_role, action, target_user, details, ip_address, created_at)
    VALUES (@actor_id, @actor_role, @action, @target_user, @details, @ip_address, @created_at)
  `, {
    actor_id: actorId,
    actor_role: actorRole,
    action,
    target_user: targetUser,
    details: typeof details === 'string' ? details : JSON.stringify(details),
    ip_address: ipAddress || null,
    created_at: Date.now()
  });
}

export function getAuditLog(limit = 100, offset = 0) {
  return getAll('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
}

/* ─── Promo code helpers ────────────────────────────────────── */

export function createPromoCode(code, rewardOrl, maxUses = 0, expiresAt = null) {
  return run(`
    INSERT INTO promo_codes (code, reward_orl, max_uses, uses, expires_at, active, created_at)
    VALUES (@code, @reward_orl, @max_uses, 0, @expires_at, 1, @created_at)
  `, {
    code: code.toUpperCase(),
    reward_orl: rewardOrl,
    max_uses: maxUses,
    expires_at: expiresAt,
    created_at: Date.now()
  });
}

export function getPromoCode(code) {
  return getOne('SELECT * FROM promo_codes WHERE code = ? AND active = 1', [code.toUpperCase()]);
}

export function incrementPromoUse(code) {
  return run('UPDATE promo_codes SET uses = uses + 1 WHERE code = ?', [code.toUpperCase()]);
}

export function redeemPromoCode(userId, code, rewardOrl) {
  return run(`
    INSERT INTO promo_redemptions (user_id, code, reward_orl, redeemed_at)
    VALUES (@user_id, @code, @reward_orl, @redeemed_at)
  `, {
    user_id: userId,
    code: code.toUpperCase(),
    reward_orl: rewardOrl,
    redeemed_at: Date.now()
  });
}

export function hasRedeemedPromo(userId, code) {
  const res = getOne('SELECT 1 FROM promo_redemptions WHERE user_id = ? AND code = ?', [userId, code.toUpperCase()]);
  return !!res;
}

export function getAllPromoCodes() {
  return getAll('SELECT * FROM promo_codes ORDER BY created_at DESC');
}

export function deactivatePromoCode(code) {
  return run('UPDATE promo_codes SET active = 0 WHERE code = ?', [code.toUpperCase()]);
}

/* ─── Achievement helpers ───────────────────────────────────── */

export const ACHIEVEMENTS = {
  first_refuel:      { name: 'First Refuel',      desc: 'Refuel your engine for the first time',   icon: '⛽' },
  first_withdrawal:  { name: 'First Payout',      desc: 'Complete your first withdrawal',          icon: '💰' },
  streak_7:          { name: 'Week Warrior',      desc: 'Reach a 7-day streak',                    icon: '🔥' },
  referrer_10:       { name: 'Recruiter',         desc: 'Invite 10 friends',                       icon: '👥' },
  ads_100:           { name: 'Ad Master',         desc: 'Watch 100 total ads',                     icon: '📺' },
  ads_500:           { name: 'Ad Legend',         desc: 'Watch 500 total ads',                     icon: '🏆' },
  big_winner:        { name: 'Big Winner',        desc: 'Win 500+ ORL in a single spin',           icon: '🎰' },
  chest_master:      { name: 'Chest Master',      desc: 'Open 10 mystery chests',                  icon: '🎁' },
  pro_member:        { name: 'Pro Member',        desc: 'Subscribe to Orael Pro',                  icon: '👑' },
  balance_100k:      { name: 'Saver',             desc: 'Reach 100,000 ORL balance',               icon: '💎' },
};

export function unlockAchievement(userId, achievementKey) {
  if (!ACHIEVEMENTS[achievementKey]) return false;
  try {
    run(`
      INSERT INTO achievements (user_id, achievement, unlocked_at)
      VALUES (?, ?, ?)
    `, [userId, achievementKey, Date.now()]);
    return true;
  } catch (e) {
    return false; // already unlocked
  }
}

export function getUserAchievements(userId) {
  return getAll('SELECT * FROM achievements WHERE user_id = ? ORDER BY unlocked_at DESC', [userId]);
}

/* ─── DB backup ─────────────────────────────────────────────── */
// Uses better-sqlite3's online backup API which creates a consistent snapshot
// even while the DB is being actively written to (unlike file copy which can
// produce a corrupt copy if WAL hasn't been checkpointed).

export function backupDatabase() {
  try {
    const backupDir = path.resolve(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const backupPath = path.resolve(backupDir, `orael-${dateStr}.db`);
    // Online backup: safe to run while the server is serving traffic.
    db.backup(backupPath);
    console.log(`[backup] Database backed up to ${backupPath}`);

    // Keep only the last 14 backups
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('orael-') && f.endsWith('.db'))
      .sort().reverse();
    for (const old of backups.slice(14)) {
      fs.unlinkSync(path.resolve(backupDir, old));
    }
    return backupPath;
  } catch (err) {
    console.error('[backup] Failed:', err);
    return null;
  }
}

/* ─── Total ads watched (lifetime) ──────────────────────────── */

export function incrementTotalAdsWatched(userId) {
  return run('UPDATE users SET total_ads_watched = total_ads_watched + 1 WHERE id = ?', [userId]);
}

export function incrementTotalWithdrawn(userId, amount) {
  return run('UPDATE users SET total_withdrawn = total_withdrawn + ? WHERE id = ?', [amount, userId]);
}

/* ─── Admin helpers ────────────────────────────────────────── */

export function getAllUsers(limit = 100, offset = 0) {
  return getAll('SELECT id, telegram_id, first_name, last_name, username, balance, role, permissions, banned, country, created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset]);
}

/**
 * Search users by name / username / telegram id using SQL LIKE (NOT the old
 * load-100k-into-memory approach). sql.js `?` placeholders work fine with
 * LIKE and `%` patterns.
 */
export function searchUsers(query, limit = 50, offset = 0) {
  const q = `%${query}%`;
  return getAll(
    `SELECT id, telegram_id, first_name, last_name, username, balance, role, permissions, banned, country, created_at
     FROM users
     WHERE first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR CAST(telegram_id AS TEXT) LIKE ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [q, q, q, q, limit, offset]
  );
}

export function countSearchUsers(query) {
  const q = `%${query}%`;
  const res = getOne(
    `SELECT COUNT(*) AS cnt FROM users
     WHERE first_name LIKE ? OR last_name LIKE ? OR username LIKE ? OR CAST(telegram_id AS TEXT) LIKE ?`,
    [q, q, q, q]
  );
  return res ? res.cnt : 0;
}

export function countUsers() {
  const res = getOne('SELECT COUNT(*) AS cnt FROM users');
  return res ? res.cnt : 0;
}

export function countActiveUsersSince(timestamp) {
  const res = getOne('SELECT COUNT(*) AS cnt FROM users WHERE updated_at > ?', [timestamp]);
  return res ? res.cnt : 0;
}

export function getPendingWithdrawalsAll(limit = 100, offset = 0) {
  return getAll(`
    SELECT w.*, u.telegram_id, u.first_name, u.username, u.country
    FROM withdrawals w
    JOIN users u ON w.user_id = u.id
    WHERE w.status = 'pending'
    ORDER BY w.created_at ASC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

export function countPendingWithdrawals() {
  const res = getOne("SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'pending'");
  return res ? res.cnt : 0;
}

export function updateWithdrawalStatus(id, status) {
  return run('UPDATE withdrawals SET status = ?, processed_at = ? WHERE id = ?', [status, Date.now(), id]);
}

export function getAllTransactions(limit = 50, offset = 0) {
  return getAll(`
    SELECT t.*, u.telegram_id, u.first_name, u.username
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);
}

export function countTransactions() {
  const res = getOne('SELECT COUNT(*) AS cnt FROM transactions');
  return res ? res.cnt : 0;
}

export function getStats() {
  const totalUsers = countUsers();
  const totalBalance = getOne('SELECT SUM(balance) AS s FROM users')?.s || 0;
  const totalMined = getOne("SELECT SUM(amount) AS s FROM transactions WHERE type = 'mining'")?.s || 0;
  const totalAds = getOne("SELECT SUM(amount) AS s FROM transactions WHERE type IN ('ad','video_wall','faucet','task','spin','scratch','chest','coinflip')")?.s || 0;
  const totalWithdrawals = getOne("SELECT SUM(amount_orl) AS s FROM withdrawals WHERE status = 'completed'")?.s || 0;
  const pendingWithdrawals = countPendingWithdrawals();
  const proUsers = getOne("SELECT COUNT(*) AS cnt FROM users WHERE pro_until > ?", [Date.now()])?.cnt || 0;
  const bannedUsers = getOne("SELECT COUNT(*) AS cnt FROM users WHERE banned = 1")?.cnt || 0;

  return {
    totalUsers,
    totalBalance,
    totalMined,
    totalAds,
    totalWithdrawals,
    pendingWithdrawals,
    proUsers,
    bannedUsers
  };
}

export default {
  initDB,
  saveDB,
  flushNow,
  getDB,
  getUser,
  getUserById,
  createUser,
  updateUser,
  addTransaction,
  getTransactions,
  getCompletedTasks,
  completeTask,
  getLotteryPool,
  upsertLotteryPool,
  drawLottery,
  checkAndRunDraws,
  getLeaderboard,
  getUserRank,
  checkTierUpgrade,
  calculateUserTier,
  createWithdrawal,
  getPendingWithdrawalsCount,
  getRecentWithdrawals,
  saveBankAccount,
  getBankAccounts,
  getBankAccountById,
  deleteBankAccount,
  updateWithdrawalFlutterwave,
  updateWithdrawalStatusById,
  getWithdrawalById,
  getWithdrawalByReference,
  getWithdrawalsByStatus,
  getDailyWithdrawalTotal,
  getMonthlyWithdrawalTotal,
  logAudit,
  getAuditLog,
  getAllUsers,
  countUsers,
  countActiveUsersSince,
  getPendingWithdrawalsAll,
  countPendingWithdrawals,
  updateWithdrawalStatus,
  getAllTransactions,
  countTransactions,
  getStats
};
