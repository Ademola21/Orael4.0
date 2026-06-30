// ─────────────────────────────────────────────────────────────
//  Orael – Telegram initData HMAC-SHA256 Validation Middleware
// ─────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getUser } from './db.js';
import { trackFailedAuth, trackUserIp, checkBotBehavior } from './services/monitoring.js';

/** Maximum age of auth_date before it's considered stale (24 h). */
const MAX_AUTH_AGE_S = 86_400;

/**
 * Express middleware that validates the Telegram Web App `initData`
 * signature and attaches the authenticated user to `req.telegramUser`.
 *
 * Expected header:
 *   X-Telegram-Init-Data: <url-encoded initData string>
 *
 * Responds with 403 if:
 *  - BOT_TOKEN is not configured
 *  - the header is missing or empty
 *  - the HMAC hash does not match
 *  - auth_date is older than 24 hours
 *  - the `user` field is missing or unparseable
 */
export default function verifyTelegramInitData(req, res, next) {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  // ── 0. Ensure the server has a bot token ───────────────────
  if (!BOT_TOKEN) {
    console.error('[auth] BOT_TOKEN is not set in environment');
    return res.status(403).json({ error: 'Server misconfiguration' });
  }

  // ── 1. Read the raw initData from the header ───────────────
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) {
    return res.status(403).json({ error: 'Missing Telegram init data' });
  }

  try {
    // ── 2. Parse as URLSearchParams ────────────────────────────
    const params = new URLSearchParams(initData);

    // ── 3. Extract and remove `hash` ───────────────────────────
    const hash = params.get('hash');
    if (!hash) {
      return res.status(403).json({ error: 'Missing hash in init data' });
    }
    params.delete('hash');

    // ── 4. Sort remaining params alphabetically ────────────────
    const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));

    // ── 5. Build data_check_string (key=value joined by \n) ───
    const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');

    // ── 6. secret_key = HMAC-SHA256('WebAppData', BOT_TOKEN) ──
    const secretKey = createHmac('sha256', 'WebAppData')
      .update(BOT_TOKEN)
      .digest();

    // ── 7. check_hash = HMAC-SHA256(secret_key, data_check_string) ─
    const checkHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // ── 8. Timing-safe comparison ──────────────────────────────
    const hashBuffer  = Buffer.from(hash, 'hex');
    const checkBuffer = Buffer.from(checkHash, 'hex');

    if (hashBuffer.length !== checkBuffer.length || !timingSafeEqual(hashBuffer, checkBuffer)) {
      return res.status(403).json({ error: 'Invalid init data signature' });
    }

    // ── 9. Verify auth_date freshness (24 h window) ───────────
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Number.isNaN(authDate)) {
      return res.status(403).json({ error: 'Missing or invalid auth_date' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > MAX_AUTH_AGE_S) {
      return res.status(403).json({ error: 'Init data has expired' });
    }

    // ── 10. Parse the `user` JSON field ────────────────────────
    const userRaw = params.get('user');
    if (!userRaw) {
      return res.status(403).json({ error: 'Missing user field in init data' });
    }

    let user;
    try {
      user = JSON.parse(userRaw);
    } catch {
      return res.status(403).json({ error: 'Malformed user JSON in init data' });
    }

    if (!user || !user.id) {
      return res.status(403).json({ error: 'User object missing id' });
    }

    // Check if user is banned
    const dbUser = getUser(user.id);
    if (dbUser && dbUser.banned === 1) {
      return res.status(403).json({ error: 'User is banned' });
    }

    // ── 11. Attach to request and continue ─────────────────────
    req.telegramUser = user;
    req.user = user;

    // ── 12. Monitoring: track IP + check bot behavior ──────────
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    trackUserIp(user.id, ip);
    checkBotBehavior(user.id);

    next();
  } catch (err) {
    console.error('[auth] Unexpected error during init data validation:', err);
    // Track failed auth
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    trackFailedAuth(ip);
    return res.status(403).json({ error: 'Init data validation failed' });
  }
}
