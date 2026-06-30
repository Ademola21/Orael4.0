/* ========================================================================
   tutorial.js — Onboarding flow for new users
   6-step animated walkthrough covering all key features.
   ======================================================================== */

import { api } from './api.js';
import { getState, setLocal } from './state.js';
import { $ } from './ui.js';
import { haptic } from './telegram.js';

const STEPS = [
  {
    title: 'Welcome to Orael',
    body: 'Earn <b>ORL coins</b> by watching ads, playing games, and referring friends. Cash out to airtime, bank, or crypto.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 5.8 6.6.6-5 4.3 1.5 6.5L12 16.2 6.5 19.2 8 12.7 3 8.4l6.6-.6L12 2z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`
  },
  {
    title: 'Mining & Refuels',
    body: 'Your engine mines ORL automatically. When fuel runs out, watch <b>1 ad to refuel</b> for 40 ORL. Upgrade rigs to mine faster.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`
  },
  {
    title: 'Play & Win',
    body: 'Try <b>Lucky Spin</b>, <b>Scratch cards</b>, <b>Coin Flip</b>, and <b>Mystery Chest</b> — all unlimited, each just 1 ad per play.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>`
  },
  {
    title: 'Earn More',
    body: 'Watch videos on the <b>Video Wall</b>, complete tasks, and hit daily <b>Ad Challenge</b> milestones for bonus ORL.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>`
  },
  {
    title: 'Invite Friends',
    body: 'Earn <b>7% commission</b> on everything your referrals mine — forever. Plus <b>2% on their referrals</b>.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
  },
  {
    title: 'Cash Out',
    body: 'Withdraw to <b>Airtime (₦600)</b>, <b>Bank (₦1,500)</b>, or <b>USDT ($2)</b>. Go Pro for 2× mining + half-fee withdrawals.',
    icon: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M16 12h2M3 9h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`
  }
];

let currentStep = 0;

function renderStep() {
  const step = STEPS[currentStep];
  if (!step) return;

  const titleEl = $('tutorialTitle');
  const bodyEl = $('tutorialBody');
  const illusEl = $('tutorialIllustration');
  const progressEl = $('tutorialProgress');
  const backBtn = $('tutorialBack');
  const nextBtn = $('tutorialNext');

  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.innerHTML = step.body;
  if (illusEl) illusEl.innerHTML = step.icon;

  // Progress dots
  if (progressEl) {
    progressEl.innerHTML = STEPS.map((_, i) => {
      const cls = i < currentStep ? 'done' : (i === currentStep ? 'active' : '');
      return `<div class="tutorial-dot ${cls}"></div>`;
    }).join('');
  }

  // Back button
  if (backBtn) {
    backBtn.style.display = currentStep === 0 ? 'none' : '';
  }

  // Next button text
  if (nextBtn) {
    nextBtn.textContent = currentStep === STEPS.length - 1 ? 'Get started' : 'Next';
  }
}

async function completeTutorial() {
  try {
    await api('/api/user/tutorial-seen', { method: 'POST' });
  } catch (e) {
    console.error('Failed to mark tutorial as seen:', e);
  }
  const veil = $('tutorialVeil');
  if (veil) veil.classList.remove('show');
  setLocal('_tutorialSeen', true);
  haptic('success');
}

export function setupTutorial() {
  const S = getState();
  // Only show if user hasn't seen it
  if (S.tutorialSeen) return;

  const veil = $('tutorialVeil');
  const nextBtn = $('tutorialNext');
  const backBtn = $('tutorialBack');
  const skipBtn = $('tutorialSkip');

  if (!veil) return;

  currentStep = 0;
  renderStep();
  veil.classList.add('show');
  haptic('light');

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      haptic('light');
      if (currentStep < STEPS.length - 1) {
        currentStep++;
        renderStep();
      } else {
        completeTutorial();
      }
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', () => {
      haptic('light');
      if (currentStep > 0) {
        currentStep--;
        renderStep();
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      haptic('light');
      completeTutorial();
    });
  }
}
