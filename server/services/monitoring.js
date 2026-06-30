// ─────────────────────────────────────────────────────────────
//  monitoring.js — Suspicious activity detection & logging
// ─────────────────────────────────────────────────────────────
//
//  Tracks:
//    - Failed auth attempts (wrong initData signature)
//    - Rate limit hits
//    - Unusual withdrawal patterns (large amounts, rapid succession)
//    - Multiple accounts from same IP
//    - Bot-like behavior (too fast clicks, identical patterns)
//
//  All events are logged to console + audit_log table in DB
// ─────────────────────────────────────────────────────────────

import { logAudit } from '../db.js';

/**
 * Log a suspicious activity event
 * @param {string} type - Event type (e.g. 'FAILED_AUTH', 'RATE_LIMIT', 'LARGE_WITHDRAWAL')
 * @param {object} details - { userId, ip, userAgent, amount, reason, ... }
 */
export function logSuspicious(type, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    ...details,
  };

  // Console log (for Docker logs / monitoring tools)
  console.warn(`[MONITOR] ${type}:`, JSON.stringify(entry));

  // Persist to audit_log table
  try {
    logAudit(
      details.userId || 0,
      'system',
      `SUSPICIOUS_${type}`,
      null,
      details,
      null
    );
  } catch (e) {
    console.error('[MONITOR] Failed to persist audit log:', e);
  }
}

/**
 * Track failed authentication attempts per IP
 */
const failedAuthByIp = new Map(); // ip → { count, lastAttempt }

export function trackFailedAuth(ip) {
  const now = Date.now();
  const entry = failedAuthByIp.get(ip) || { count: 0, lastAttempt: 0 };

  // Reset counter if last attempt was > 15 minutes ago
  if (now - entry.lastAttempt > 15 * 60 * 1000) {
    entry.count = 0;
  }

  entry.count++;
  entry.lastAttempt = now;
  failedAuthByIp.set(ip, entry);

  // Flag if more than 5 failed attempts in 15 minutes
  if (entry.count >= 5) {
    logSuspicious('FAILED_AUTH_BURST', {
      ip,
      count: entry.count,
      reason: `${entry.count} failed auth attempts from IP ${ip}`,
    });
  }

  return entry.count;
}

/**
 * Check for unusual withdrawal patterns
 */
export function checkWithdrawalPattern(user, amountOrl) {
  // Flag withdrawals over 100k ORL
  if (amountOrl >= 100000) {
    logSuspicious('LARGE_WITHDRAWAL', {
      userId: user.telegram_id,
      amount: amountOrl,
      reason: `Large withdrawal: ${amountOrl} ORL`,
    });
  }

  // Flag if user is very new (< 1 hour old) and withdrawing
  const userAge = Date.now() - (user.created_at || Date.now());
  if (userAge < 60 * 60 * 1000 && amountOrl > 1000) {
    logSuspicious('NEW_ACCOUNT_WITHDRAWAL', {
      userId: user.telegram_id,
      amount: amountOrl,
      accountAgeMs: userAge,
      reason: `New account (${Math.floor(userAge / 60000)}min old) withdrawing ${amountOrl} ORL`,
    });
  }
}

/**
 * Track IP addresses per user (detect multi-accounting)
 */
const userIps = new Map(); // userId → Set of IPs

export function trackUserIp(userId, ip) {
  if (!userIps.has(userId)) {
    userIps.set(userId, new Set());
  }
  const ips = userIps.get(userId);
  ips.add(ip);

  // Flag if user has used more than 10 different IPs (possible VPN/proxy abuse)
  if (ips.size > 10) {
    logSuspicious('MULTIPLE_IPS', {
      userId,
      ipCount: ips.size,
      reason: `User ${userId} has connected from ${ips.size} different IPs`,
    });
  }
}

/**
 * Check for bot-like behavior (too many actions too fast)
 */
const actionTimestamps = new Map(); // userId → [timestamp, timestamp, ...]

export function checkBotBehavior(userId) {
  const now = Date.now();
  if (!actionTimestamps.has(userId)) {
    actionTimestamps.set(userId, []);
  }
  const timestamps = actionTimestamps.get(userId);

  // Keep only last 60 seconds
  const recent = timestamps.filter(t => now - t < 60000);
  recent.push(now);
  actionTimestamps.set(userId, recent);

  // Flag if more than 30 actions in 60 seconds (human can't do that)
  if (recent.length > 30) {
    logSuspicious('BOT_BEHAVIOR', {
      userId,
      actionCount: recent.length,
      windowSeconds: 60,
      reason: `${recent.length} actions in 60 seconds — likely bot`,
    });
    return true; // is bot
  }

  return false;
}

// Clean up old entries every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAuthByIp) {
    if (now - entry.lastAttempt > 30 * 60 * 1000) {
      failedAuthByIp.delete(ip);
    }
  }
  for (const [userId, timestamps] of actionTimestamps) {
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length === 0) {
      actionTimestamps.delete(userId);
    } else {
      actionTimestamps.set(userId, recent);
    }
  }
}, 5 * 60 * 1000);
