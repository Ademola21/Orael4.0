/* ========================================================================
   profile.js — Profile overlay logic
   - Renders + handles the avatar picker (10 defaults) and device upload
     (client-side canvas resize to 256px before upload)
   - Wires the Pro subscription button (Telegram Stars invoice
     ) and the Pro free daily chest
   ======================================================================== */

import { api } from './api.js';
import { getState, updateState } from './state.js';
import { $, render, toast, reward } from './ui.js';
import { haptic } from './telegram.js';

let avatarsCache = null;
let avatarGridBuilt = false;

/** Fetch the 10 default avatars once and cache them. */
async function loadAvatars() {
  if (avatarsCache) return avatarsCache;
  try {
    const res = await api('/api/profile/avatars');
    avatarsCache = res.avatars || [];
  } catch (e) {
    avatarsCache = [];
  }
  return avatarsCache;
}

/** Highlight the currently-selected avatar in the grid. */
function highlightSelected() {
  const S = getState();
  const current = S.avatarUrl || '';
  const grid = $('avatarGrid');
  if (!grid) return;
  grid.querySelectorAll('.avatar-opt').forEach(el => {
    el.classList.toggle('sel', el.dataset.url === current);
  });
}

/** Build the 10-avatar picker grid. */
async function buildAvatarGrid() {
  const grid = $('avatarGrid');
  if (!grid || avatarGridBuilt) return;
  const avatars = await loadAvatars();
  grid.innerHTML = avatars.map(url =>
    `<button class="avatar-opt" data-url="${url}" style="background-image:url('${url}')"></button>`
  ).join('');
  avatarGridBuilt = true;
  highlightSelected();
  grid.querySelectorAll('.avatar-opt').forEach(el => {
    el.addEventListener('click', () => chooseAvatar(el.dataset.url));
  });
}

/** Choose one of the default avatars. */
async function chooseAvatar(url) {
  haptic('light');
  try {
    await api('/api/profile/avatar/choose', { method: 'POST', body: { avatar: url } });
    const res = await api('/api/user');
    updateState(res);
    render();
    highlightSelected();
    toast({ title: 'Avatar updated', variant: 'success' });
  } catch (e) { /* api() toasted */ }
}

/**
 * Resize an uploaded image to 256×256 via canvas and convert to PNG blob, so we
 * never upload huge camera photos (server limit 2MB; resized blob is ~30-80KB).
 */
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      // Cover-crop to square
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode image'));
      }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    img.src = url;
  });
}

/** Upload a custom avatar (resized client-side first). */
async function uploadAvatar(file) {
  if (!file) return;
  haptic('light');
  let blob;
  try {
    blob = await resizeImage(file);
  } catch (e) {
    toast({ title: 'Image error', message: e.message, variant: 'error' });
    return;
  }
  try {
    const form = new FormData();
    form.append('avatar', blob, 'avatar.png');
    // api() auto-stringifies body objects; bypass by passing a FormData with an
    // explicit no-transform flag via headers.
    const initData = window.Telegram?.WebApp?.initData || '';
    const headers = { 'X-Telegram-Init-Data': initData };
    const res = await fetch('/api/profile/avatar/upload', { method: 'POST', headers, body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || 'Upload failed');
    }
    const data = await res.json();
    const state = await api('/api/user');
    updateState(state);
    render();
    highlightSelected();
    toast({ title: 'Avatar uploaded', variant: 'success' });
  } catch (e) {
    toast({ title: 'Upload failed', message: e.message, variant: 'error' });
  }
}

/** Reset to a random default avatar. */
async function resetAvatar() {
  haptic('light');
  try {
    await api('/api/profile/avatar/reset', { method: 'POST' });
    const res = await api('/api/user');
    updateState(res);
    render();
    highlightSelected();
    toast({ title: 'Random avatar assigned', variant: 'success' });
  } catch (e) { /* api() toasted */ }
}

/* ─── Pro subscription ─────────────────────────────────────────── */

async function handleProClick() {
  const tg = window.Telegram?.WebApp;
  haptic('light');
  try {
    const res = await api('/api/wallet/pro', { method: 'POST' });
    if (res.invoiceLink) {
      if (tg?.openInvoice) {
        tg.openInvoice(res.invoiceLink, async (status) => {
          if (status === 'paid') {
            haptic('success');
            toast({ title: 'Payment successful!', message: 'Orael Pro active', variant: 'success' });
            const state = await api('/api/user');
            updateState(state);
            render();
          } else {
            toast({ title: 'Payment incomplete', message: 'Subscription not activated', variant: 'error' });
          }
        });
      } else {
        toast({ title: 'Open inside Telegram', message: 'Stars checkout requires the Telegram app.', variant: 'info' });
      }
    }
  } catch (e) { /* api() toasted */ }
}

async function handleProChest() {
  haptic('light');
  try {
    const res = await api('/api/mining/pro-chest', { method: 'POST' });
    if (res.reward) {
      updateState(res.user);
      render();
      reward(res.reward, 'Pro chest unlocked!', 'Free daily chest, no ad needed.');
    }
  } catch (e) { /* api() toasted */ }
}

/* ─── Setup ────────────────────────────────────────────────────── */

export function setupProfile() {
  // Avatar grid (built lazily; re-highlight on each open via render)
  buildAvatarGrid();

  const fileInput = $('avatarFile');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) uploadAvatar(file);
      e.target.value = '';
    });
  }

  const resetBtn = $('avatarResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetAvatar);

  const proBtn = $('proBtn');
  if (proBtn) proBtn.addEventListener('click', handleProClick);

  const proChestBtn = $('proChestBtn');
  if (proChestBtn) proChestBtn.addEventListener('click', handleProChest);
}
