// ─────────────────────────────────────────────────────────────
//  profile.js — Profile / avatar routes
//  - List the 10 built-in default avatars
//  - Choose a default avatar
//  - Upload a custom avatar (multer, client-side canvas-resized)
//  - Reset to a random default
// ─────────────────────────────────────────────────────────────

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getUser, updateUser, flushNow } from '../db.js';
import { getUserState } from './user.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'data', 'uploads', 'avatars');

export const AVATAR_COUNT = 10;
function defaultAvatars() {
  return Array.from({ length: AVATAR_COUNT }, (_, i) => `/avatars/avatar-${i + 1}.png`);
}
function randomDefaultAvatar() {
  const n = Math.floor(Math.random() * AVATAR_COUNT) + 1;
  return `/avatars/avatar-${n}.png`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
      const ext = file.mimetype === 'image/png' ? 'png'
        : file.mimetype === 'image/jpeg' ? 'jpg'
        : file.mimetype === 'image/webp' ? 'webp'
        : 'png';
      cb(null, `user-${req.telegramUser.id}-${Date.now()}.${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB (client resizes to ~256px first)
  fileFilter: (_req, file, cb) => {
    if (['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPEG or WEBP images are allowed'));
  },
});

const router = Router();

/* ─── GET /api/profile/avatars — list the 10 default avatars ─── */
router.get('/avatars', (req, res) => {
  res.json({ avatars: defaultAvatars() });
});

/* ─── POST /api/profile/avatar/choose — pick a default avatar ─── */
router.post('/avatar/choose', (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { avatar } = req.body;
    // Only allow picking one of the 10 known defaults (no arbitrary paths).
    const allowed = defaultAvatars();
    if (!allowed.includes(avatar)) {
      return res.status(400).json({ error: 'Invalid avatar selection' });
    }

    // If switching away from a custom upload, delete the old uploaded file.
    if (user.avatar_url && user.avatar_url.startsWith('/uploads/avatars/')) {
      try {
        const oldPath = path.resolve(__dirname, '..', '..', user.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (e) { /* best-effort */ }
    }

    updateUser(user.id, { avatar_url: avatar });
    flushNow();
    return res.json({ success: true, avatarUrl: avatar });
  } catch (err) {
    console.error('POST /profile/avatar/choose error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── POST /api/profile/avatar/upload — upload custom avatar ─── */
router.post('/avatar/upload', upload.single('avatar'), (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

    // Delete previous custom upload (if any) to avoid orphaned files.
    if (user.avatar_url && user.avatar_url.startsWith('/uploads/avatars/')) {
      try {
        const oldPath = path.resolve(__dirname, '..', '..', user.avatar_url);
        if (fs.existsSync(oldPath) && oldPath !== req.file.path) fs.unlinkSync(oldPath);
      } catch (e) { /* best-effort */ }
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    updateUser(user.id, { avatar_url: avatarUrl });
    flushNow();
    return res.json({ success: true, avatarUrl });
  } catch (err) {
    console.error('POST /profile/avatar/upload error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/* ─── POST /api/profile/avatar/reset — random default avatar ─── */
router.post('/avatar/reset', (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const user = getUser(telegramUser.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.avatar_url && user.avatar_url.startsWith('/uploads/avatars/')) {
      try {
        const oldPath = path.resolve(__dirname, '..', '..', user.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      } catch (e) { /* best-effort */ }
    }

    const avatarUrl = randomDefaultAvatar();
    updateUser(user.id, { avatar_url: avatarUrl });
    flushNow();
    return res.json({ success: true, avatarUrl });
  } catch (err) {
    console.error('POST /profile/avatar/reset error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/* ─── GET /api/profile/me — fresh full user state ─── */
router.get('/me', async (req, res) => {
  try {
    const telegramUser = req.telegramUser;
    const state = await getUserState(telegramUser.id);
    if (!state) return res.status(404).json({ error: 'User not found' });
    return res.json(state);
  } catch (err) {
    console.error('GET /profile/me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
