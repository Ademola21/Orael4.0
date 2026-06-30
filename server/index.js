import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

import { initDB, checkAndRunDraws, getUser, updateUser, addTransaction } from './db.js';
import verifyTelegramInitData from './auth.js';
import { generalLimit, actionLimit, webhookLimit, sensitiveLimit } from './middleware/rateLimit.js';
import { verifyWebhookSignature } from './services/flutterwave.js';
import { trackFailedAuth, trackUserIp, checkBotBehavior } from './services/monitoring.js';

// Route Imports
import userRoutes from './routes/user.js';
import miningRoutes from './routes/mining.js';
import playRoutes from './routes/play.js';
import earnRoutes from './routes/earn.js';
import walletRoutes, { handleFlutterwaveWebhook } from './routes/wallet.js';
import leaderboardRoutes from './routes/leaderboard.js';
import adminRoutes from './routes/admin.js';
import profileRoutes from './routes/profile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy hop (Caddy → Express, and Cloudflare → Caddy in prod) so
// req.ip / req.protocol / x-forwarded-* reflect the REAL client, not the proxy.
// Without this, audit logs and HTTPS detection see the proxy's IP.
app.set('trust proxy', 1);

// ─── Public webhook endpoints (signature-verified, NOT Telegram-auth-verified) ───
// Flutterwave webhook — receives transfer.completed + singlebillpayment.status events
// No per-user rate limit (no telegramUser). Signature verification is the protection.
app.post('/api/flutterwave-webhook', handleFlutterwaveWebhook);

// Body parsing middleware — 10kb limit to prevent abuse
app.use(express.json({ limit: '10kb' }));

// SCALABILITY: Compress all JSON / HTML / CSS / JS responses. At 1M users,
// uncompressed API responses waste ~70% bandwidth. gzip gives 5-10x reduction
// for JSON with negligible CPU cost (streamed, native zlib).
app.use(compression({
  level: 6,           // balanced speed/ratio (1=fast, 9=best)
  threshold: 1024,    // only compress responses > 1KB
  filter: (req, res) => {
    // Don't compress already-compressed assets (images, pre-gzipped JS/CSS)
    if (req.headers['accept']?.includes('image/')) return false;
    return compression.filter(req, res);
  },
}));

// ─── Helmet: comprehensive security headers ──────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // We set our own CSP manually below
  crossOriginEmbedderPolicy: false,
}));

// ─── Security: HTTPS redirect (production only) ─────────────────
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Allow webhook endpoints to skip HTTPS redirect (Flutterwave may POST over HTTP from some regions)
    if (req.path === '/api/flutterwave-webhook' || req.path === '/api/adsgram-callback') {
      return next();
    }
    // Check for HTTPS via Cloudflare/proxy headers
    const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.secure;
    if (!isHttps) {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

// Simple request logger — sanitized (no PII, no tokens, no amounts)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Sanitize URL — strip query params (may contain tokens)
    const safePath = req.path;
    console.log(`[HTTP] ${req.method} ${safePath} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Configure CORS
const DOMAIN = process.env.DOMAIN || 'https://yorubacinemax.xyz';
app.use(cors({
  origin: [DOMAIN, 'http://localhost:5173', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  credentials: true,
}));

// Basic Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HSTS — force HTTPS for 1 year (production only, HTTPS only)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  // Content-Security-Policy — restrict script/style/img sources
  // Allowed: self, Telegram SDK, Adsgram SDK, Google Fonts
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://telegram.org https://sad.adsgram.ai",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: blob:",
    "connect-src 'self' https://api.telegram.org https://api.adsgram.ai",
    "frame-src 'self' https://oauth.telegram.org",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; '));

  // Permissions Policy — disable camera/microphone/geolocation
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  next();
});

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// AdsGram S2S Reward URL acknowledgment (public, unauthenticated by design).
//
// Per AdsGram docs (https://docs.adsgram.ai/publisher/get-block-id): the S2S
// reward URL is OPTIONAL (>50k DAU) and AdsGram sends a GET with ONLY the
// user's telegram id substituted into the configured URL. There is NO secret,
// NO signature, and NO reward value sent — the request is unauthenticated by
// design. The PRIMARY reward flow is the client-side `show()` callback → our
// Telegram-authed /api/earn/* routes (which credit + call trackAdWatched).
//
// This endpoint therefore merely acknowledges receipt (200) so AdsGram doesn't
// retry, and optionally credits a small SERVER-defined bonus if
// ADSGRAM_S2S_BONUS_ORL > 0 (off by default → no double-credit with the client
// flow, no balance-injection vuln). It NEVER trusts a client-supplied amount
// and has NO hardcoded secret fallback.
app.get('/api/adsgram-callback', async (req, res) => {
  const userId = Number(req.query.userId);
  const bonus = parseInt(process.env.ADSGRAM_S2S_BONUS_ORL || '0', 10) || 0;
  if (!Number.isFinite(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Missing userId' });
  }
  try {
    if (bonus > 0) {
      const dbUser = getUser(userId);
      if (dbUser) {
        const newBalance = (dbUser.balance || 0) + bonus;
        updateUser(dbUser.id, { balance: newBalance });
        addTransaction(dbUser.id, 'ad', bonus, 'AdsGram S2S bonus');
        const { trackAdWatched } = await import('./services/adTracking.js');
        await trackAdWatched(dbUser.id);
      }
    }
  } catch (e) {
    console.error('[adsgram-callback] error:', e);
  }
  // Always 200 so AdsGram does not retry.
  return res.json({ success: true });
});

// NOTE: Offerwall callback endpoints (Mmwall, ayeT-Studios, BitcoTasks)
// were removed because those networks do not support Telegram Mini Apps.
// Only Adsgram rewarded video + Adsgram Tasks web component remain.

// Flutterwave webhook is mounted INSIDE /api/wallet routes (POST /flutterwave-webhook)
// It's signature-verified, not Telegram-auth-verified, so it bypasses the
// verifyTelegramInitData middleware naturally because it's a sub-route.

// Mount Routes (auth is applied as middleware, meaning initData is required)
app.use('/api/user', verifyTelegramInitData, generalLimit, userRoutes);
app.use('/api/mining', verifyTelegramInitData, generalLimit, actionLimit, miningRoutes);
app.use('/api/play', verifyTelegramInitData, generalLimit, actionLimit, playRoutes);
app.use('/api/earn', verifyTelegramInitData, generalLimit, actionLimit, earnRoutes);
app.use('/api/wallet', verifyTelegramInitData, generalLimit, actionLimit, walletRoutes);
app.use('/api/leaderboard', verifyTelegramInitData, generalLimit, leaderboardRoutes);
app.use('/api/admin', verifyTelegramInitData, generalLimit, adminRoutes);
app.use('/api/profile', verifyTelegramInitData, generalLimit, profileRoutes);

// Serve user-uploaded files (custom avatars, etc.) from data/uploads. Mounted
// before the catch-all so it works in both prod and dev. avatars default set is
// served from /avatars via the dist/public static handler below.
const uploadsPath = path.resolve(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(uploadsPath, { recursive: true });
app.use('/uploads', express.static(uploadsPath, {
  maxAge: '7d',
  etag: true,
  setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'self' img-src 'self' data: blob: https: " ),
}));

// In production, serve static front-end assets
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    etag: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        // HTML must always be re-fetched (no cache) so users get the latest
        // build immediately.
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
      } else if (filePath.includes('/assets/')) {
        // Vite outputs JS/CSS with content hashes in filenames (e.g.
        // index-A1b2c3d4.js) → safe to cache aggressively (1 year). When a
        // new build deploys, the filename changes and the browser fetches
        // the new file. This eliminates re-downloading on every page load.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else if (filePath.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/)) {
        // Images + fonts: cache 7 days.
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));
  // Default avatars — served from public/avatars directly so they always work
  // even if the dist build is stale.
  app.use('/avatars', express.static(path.resolve(__dirname, '..', 'public', 'avatars'), { maxAge: '7d', etag: true }));

  // Serve admin panel at /admin
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(distPath, 'admin.html'));
  });
  app.get('/admin.js', (req, res) => {
    res.sendFile(path.join(distPath, 'admin.js'));
  });

  // Catch-all route to serve the built index.html
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  // Dev mode: serve admin panel + /avatars default set from public dir
  const publicPath = path.resolve(__dirname, '..', 'public');
  app.use('/avatars', express.static(path.join(publicPath, 'avatars'), { maxAge: '7d' }));
  app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.html'));
  });
  app.get('/admin.js', (req, res) => {
    res.sendFile(path.join(publicPath, 'admin.js'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Global Error Handler]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database then start listening
async function startServer() {
  try {
    console.log('Initializing Orael Database...');
    await initDB();
    console.log('Database initialized successfully.');

    console.log('Checking lottery draws...');
    checkAndRunDraws();

    // Start background cron jobs (Flutterwave polling, DB backups, weekly leaderboard)
    const { startCronJobs } = await import('./services/cron.js');
    startCronJobs();

    app.listen(PORT, () => {
      console.log(`\n🚀 Orael server running on port ${PORT}`);
      console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`   Domain: ${DOMAIN}`);
      console.log(`   Database Path: data/orael.db\n`);
    });
  } catch (error) {
    console.error('Failed to start Orael server:', error);
    process.exit(1);
  }
}

startServer();
