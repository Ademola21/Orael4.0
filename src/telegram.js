/* ========================================================================
   telegram.js — Telegram WebApp SDK wrapper
   Provides helpers for initializing, detecting, and interacting with the
   Telegram Mini App runtime environment.
   ======================================================================== */

/**
 * Initialize the Telegram WebApp.
 * Calls tg.ready(), tg.expand(), sets safe-area CSS vars,
 * enables closing confirmation, and extracts user data.
 *
 * @returns {{ tg: object, user: object|null, startParam: string }}
 */
export function initTelegram() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return { tg: null, user: null, startParam: '' };

  try { tg.ready(); } catch (e) { /* silent */ }
  try { tg.expand(); } catch (e) { /* silent */ }

  // Enable closing confirmation so users don't accidentally lose progress
  try { tg.enableClosingConfirmation(); } catch (e) { /* silent */ }

  // Set safe-area CSS custom properties for notch / status bar padding
  const safeTop = tg.safeAreaInset?.top || 0;
  const safeBot = tg.safeAreaInset?.bottom || 0;
  document.documentElement.style.setProperty('--safe-top', safeTop + 'px');
  document.documentElement.style.setProperty('--safe-bot', safeBot + 'px');

  // Also handle content safe area (Telegram ≥ 7.7)
  const contentTop = tg.contentSafeAreaInset?.top || 0;
  document.documentElement.style.setProperty('--content-safe-top', contentTop + 'px');

  // Extract user data
  const user = tg.initDataUnsafe?.user || null;

  // Extract start parameter (for deep links / referrals)
  const startParam = tg.initDataUnsafe?.start_param || '';

  return { tg, user, startParam };
}

/**
 * Check whether we're running inside a real Telegram WebApp environment.
 * Returns true only if initData exists and is non-empty.
 *
 * @returns {boolean}
 */
export function isTelegramEnv() {
  const initData = window.Telegram?.WebApp?.initData;
  return typeof initData === 'string' && initData.length > 0;
}

/**
 * Trigger haptic feedback via Telegram's HapticFeedback API.
 *
 * @param {'light'|'medium'|'success'} type
 */
export function haptic(type) {
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (!h) return;
    if (type === 'success') {
      h.notificationOccurred('success');
    } else {
      h.impactOccurred(type === 'light' ? 'light' : 'medium');
    }
  } catch (e) { /* silent */ }
}

/**
 * Open the Telegram share dialog with a URL and text.
 *
 * @param {string} url  — URL to share
 * @param {string} text — message text to accompany the link
 */
export function shareLink(url, text) {
  const tg = window.Telegram?.WebApp;
  try {
    if (tg) {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
      );
      return;
    }
  } catch (e) { /* silent */ }
  // Fallback: copy to clipboard
  navigator.clipboard?.writeText(url);
}

/**
 * Open a link inside Telegram WebApp or fallback to browser.
 * @param {string} url
 */
export function openLink(url) {
  const tg = window.Telegram?.WebApp;
  try {
    if (tg) {
      if (url.includes('t.me/') || url.includes('telegram.me/')) {
        tg.openTelegramLink(url);
      } else {
        tg.openLink(url);
      }
      return;
    }
  } catch (e) { /* silent */ }
  window.open(url, '_blank');
}

/**
 * Show the Telegram back button and attach a callback.
 *
 * @param {Function} onBack — callback when user presses back
 */
export function showBackButton(onBack) {
  const tg = window.Telegram?.WebApp;
  try {
    if (tg?.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(onBack);
    }
  } catch (e) { /* silent */ }
}

/**
 * Hide the Telegram back button and remove any listeners.
 */
export function hideBackButton() {
  const tg = window.Telegram?.WebApp;
  try {
    if (tg?.BackButton) {
      tg.BackButton.hide();
      tg.BackButton.offClick();
    }
  } catch (e) { /* silent */ }
}
