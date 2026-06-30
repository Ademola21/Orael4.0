// ─────────────────────────────────────────────────────────────
//  Orael – In-Memory Per-User Rate Limiter (sliding window)
// ─────────────────────────────────────────────────────────────

/**
 * Each bucket stores an array of request timestamps (ms).
 * On every request we discard timestamps older than the window,
 * then check whether the remaining count exceeds the limit.
 *
 * @typedef {Map<number, number[]>} BucketMap
 *   key   = telegramUser.id
 *   value = array of Unix-ms timestamps within the current window
 */

const MINUTE_MS  = 60 * 1000;
const CLEANUP_MS = 5 * 60 * 1000; // purge stale entries every 5 min

// ── Separate bucket maps for each limiter ────────────────────
/** @type {BucketMap} */
const generalBuckets = new Map();
/** @type {BucketMap} */
const actionBuckets  = new Map();
/** @type {BucketMap} */
const sensitiveBuckets = new Map();
/** @type {BucketMap} */
const webhookBuckets = new Map();

// ── Periodic cleanup ─────────────────────────────────────────
/**
 * Remove entries whose most-recent timestamp is older than the
 * window so the Map doesn't grow unboundedly.
 *
 * @param {BucketMap} buckets
 * @param {number}    windowMs
 */
function purge(buckets, windowMs) {
  const cutoff = Date.now() - windowMs;
  for (const [uid, timestamps] of buckets) {
    // If every timestamp in the bucket is older than the window, drop it
    if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
      buckets.delete(uid);
    }
  }
}

const cleanupTimer = setInterval(() => {
  purge(generalBuckets, MINUTE_MS);
  purge(actionBuckets, MINUTE_MS);
  purge(sensitiveBuckets, MINUTE_MS);
  purge(webhookBuckets, MINUTE_MS);
}, CLEANUP_MS);

// Allow the Node process to exit cleanly without waiting for the timer
if (cleanupTimer.unref) {
  cleanupTimer.unref();
}

// ── Core sliding-window check ────────────────────────────────
/**
 * Creates an Express middleware that enforces a per-user
 * request limit within a one-minute sliding window.
 *
 * @param {BucketMap} buckets – the Map storing per-user timestamps
 * @param {number}    limit   – max requests allowed per window
 * @returns {import('express').RequestHandler}
 */
function createLimiter(buckets, limit) {
  return function rateLimitMiddleware(req, res, next) {
    // The auth middleware must run first and set req.telegramUser
    const userId = req.telegramUser?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthenticated – rate limiter requires telegramUser' });
    }

    const now = Date.now();
    const windowStart = now - MINUTE_MS;

    // Retrieve or initialise the bucket
    let timestamps = buckets.get(userId);
    if (!timestamps) {
      timestamps = [];
      buckets.set(userId, timestamps);
    }

    // Slide the window — drop timestamps older than 1 minute.
    // Because timestamps are appended in order we can binary-trim
    // from the front, but a simple findIndex is clear enough for
    // the expected bucket sizes (≤ 120 entries).
    const firstValid = timestamps.findIndex((t) => t > windowStart);
    if (firstValid === -1) {
      // All entries are stale
      timestamps.length = 0;
    } else if (firstValid > 0) {
      timestamps.splice(0, firstValid);
    }

    // Enforce the limit
    if (timestamps.length >= limit) {
      const retryAfterMs = timestamps[0] + MINUTE_MS - now;
      const retryAfterS  = Math.ceil(retryAfterMs / 1000);

      res.set('Retry-After', String(retryAfterS));
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: retryAfterS,
      });
    }

    // Record this request
    timestamps.push(now);
    next();
  };
}

// ── Exported middleware instances ─────────────────────────────

/** 120 requests / minute – general API endpoints */
export const generalLimit = createLimiter(generalBuckets, 120);

/** 20 requests / minute – action endpoints (claim, spin, etc.) */
export const actionLimit  = createLimiter(actionBuckets, 20);

/** 5 requests / minute – sensitive endpoints (withdraw, bank resolve, save-bank) */
export const sensitiveLimit = createLimiter(sensitiveBuckets, 5);

/** 30 requests / minute – webhook endpoints (Flutterwave retries) */
export const webhookLimit = createLimiter(webhookBuckets, 30);
