/* ========================================================================
   ads.js — AdsGram rewarded ad player
   Plays real AdsGram rewarded video ads in production.

   Per AdsGram docs (https://docs.adsgram.ai/publisher/api-reference):
   - `show()` RESOLVES only when the user watches the ad to the end; it
     REJECTS on error / skip / no-banner. So `result.done` in `.then` is
     always true (the dead `else` branch was removed).
   - The rejection payload is a `ShowPromiseResult` with `.description` (no
     `.message`), so the catch handler reads `err.description`.
   - For granular UX we subscribe to `onBannerNotFound` / `onTooLongSession`
     / `onNonStopShow` on the AdController so we show OUR toast instead of
     AdsGram's default alert.
   ======================================================================== */

import { haptic } from './telegram.js';
import { getState } from './state.js';

/** SVG arc circumference for the main gauge */
export const ARC_LEN = 395.8;

/** SVG arc circumference for the ad countdown ring */
export const AD_RING = 276.46;

/** @type {object|null} */
let adsgramController = null;

/** @type {boolean} */
let adPlaying = false;

function showToast(title, body) {
  import('./ui.js').then(({ toast }) => toast(title, body));
}

/**
 * Lazily init the AdsGram controller once and attach granular event listeners
 * so we surface OUR toasts (not AdsGram's default alerts) for the recoverable
 * "no ad / slow down / restart" cases.
 */
function getController() {
  const blockId = import.meta.env.VITE_ADSGRAM_BLOCK_ID;
  if (!window.Adsgram || !blockId) return null;
  if (!adsgramController) {
    adsgramController = window.Adsgram.init({ blockId });
    try {
      adsgramController.addEventListener?.('onBannerNotFound', () => {
        showToast('No ads right now', 'Please try again in a moment.');
      });
      adsgramController.addEventListener?.('onTooLongSession', () => {
        showToast('Session expired', 'Restart the app to load fresh ads.');
      });
      adsgramController.addEventListener?.('onNonStopShow', () => {
        showToast('Slow down', 'Wait a moment before watching another ad.');
      });
    } catch (e) { /* listeners are best-effort */ }
  }
  return adsgramController;
}

/**
 * Play a real AdsGram rewarded ad.
 *
 * @param {string}   _title    — unused (AdsGram renders its own UI)
 * @param {string}   _body     — unused
 * @param {number}   _seconds  — unused (AdsGram controls video length)
 * @param {Function} onReward  — callback fired when the ad completes successfully
 */
export function playAd(_title, _body, _seconds, onReward) {
  if (adPlaying) {
    console.warn('An ad is already playing. Ignoring request.');
    return;
  }

  // Admin bypass — admins skip ads entirely
  const S = getState();
  if (S.role === 'admin' || S.role === 'mod') {
    haptic('success');
    if (onReward) onReward();
    return;
  }

  const controller = getController();
  if (!controller) {
    showToast('Ad failed to load', 'Please disable ad blockers and try again.');
    return;
  }

  adPlaying = true;
  haptic('light');

  controller.show()
    .then((result) => {
      // Promise only resolves on a completed watch → result.done is true here.
      adPlaying = false;
      if (result && result.done) {
        haptic('success');
        if (onReward) onReward();
      } else {
        // Defensive: treat an unexpected non-done resolve as a skip.
        showToast('Ad not completed', 'Please watch to the end to earn.');
      }
    })
    .catch((err) => {
      adPlaying = false;
      // ShowPromiseResult has .description (no .message). The granular event
      // listeners above already toasted onBannerNotFound/onTooLongSession/
      // onNonStopShow, so only show a generic message for other errors.
      console.error('Adsgram error:', err);
      const desc = err && err.description;
      if (desc && !/banner|session|nonstop/i.test(desc)) {
        showToast('Ad Error', desc);
      }
    });
}
