/* ========================================================================
   api.js — HTTP client for Orael Telegram Mini App
   Every request attaches Telegram initData for server-side auth.
   ======================================================================== */

import { toast } from './ui.js';

/**
 * Show the Telegram-only gate screen.
 * Hides the main app and reveals the gate overlay.
 */
function showTelegramGate() {
  const gate = document.getElementById('tg-gate');
  const app = document.querySelector('.app');
  if (gate) gate.style.display = 'flex';
  if (app) app.style.display = 'none';
}

/**
 * Core API fetch wrapper.
 * - Attaches `X-Telegram-Init-Data` header from Telegram WebApp SDK
 * - Sets `Content-Type: application/json`
 * - Parses JSON response
 * - On 403 → shows Telegram-only gate
 * - On other errors → shows toast notification
 *
 * @param {string} path  — API path, e.g. '/api/user'
 * @param {object} [options={}] — fetch options (method, body, etc.)
 * @returns {Promise<any>} parsed JSON response
 */
export async function api(path, options = {}) {
  const initData = window.Telegram?.WebApp?.initData || '';

  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData,
    ...(options.headers || {}),
  };

  // DEV_MODE preview: send the dev Telegram id so the server can auth
  // without a real initData HMAC.
  if (window.__ORAEL_DEV__) {
    headers['X-Dev-Telegram-Id'] = String(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || '');
  }

  try {
    const res = await fetch(path, {
      ...options,
      headers,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
    });

    if (res.status === 503 || res.status === 403) {
      const errBody = await res.clone().json().catch(() => ({}));
      if (errBody && errBody.error === 'maintenance') {
        const maintenanceGate = document.getElementById('maintenance-gate');
        const banGate = document.getElementById('ban-gate');
        const tgGate = document.getElementById('tg-gate');
        const appEl = document.querySelector('.app');
        if (maintenanceGate) maintenanceGate.style.display = 'flex';
        if (banGate) banGate.style.display = 'none';
        if (tgGate) tgGate.style.display = 'none';
        if (appEl) appEl.style.display = 'none';
        throw new Error('maintenance');
      }
    }

    if (res.status === 403) {
      const errBody = await res.clone().json().catch(() => ({}));
      if (errBody && errBody.error === 'User is banned') {
        const banGate = document.getElementById('ban-gate');
        const tgGate = document.getElementById('tg-gate');
        const appEl = document.querySelector('.app');
        if (banGate) banGate.style.display = 'flex';
        if (tgGate) tgGate.style.display = 'none';
        if (appEl) appEl.style.display = 'none';
        throw new Error('Account banned');
      }
      const authErrors = [
        'Missing Telegram init data',
        'Missing hash in init data',
        'Invalid init data signature',
        'Missing or invalid auth_date',
        'Init data has expired',
        'Missing user field in init data',
        'Malformed user JSON in init data',
        'User object missing id',
        'Init data validation failed'
      ];
      if (errBody && errBody.error && !authErrors.includes(errBody.error)) {
        throw new Error(errBody.error);
      }
      showTelegramGate();
      throw new Error('Telegram-only access');
    }

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    if (err.message !== 'Telegram-only access' && err.message !== 'maintenance') {
      toast(err.message || 'Network error');
    }
    throw err;
  }
}

export default api;
