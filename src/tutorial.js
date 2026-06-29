/* ========================================================================
   tutorial.js — Video-game-style interactive tutorial
   ------------------------------------------------------------------------
   Instead of static cards, this tutorial highlights actual UI elements
   with a spotlight overlay, animated tooltips, and progress tracking.
   Takes the user on a guided tour of all 4 screens (Miner, Play, Earn,
   Wallet) just like a video game onboarding sequence.

   Features:
   - Spotlight overlay that dims everything except the target element
   - Animated tooltip with title, description, and Next/Back buttons
   - Progress bar showing tour completion
   - Auto-navigation between screens
   - Skip button for experienced users
   ======================================================================== */

import { api } from './api.js';
import { getState, setLocal } from './state.js';
import { $, toast } from './ui.js';
import { haptic } from './telegram.js';

/* ── Tutorial steps ────────────────────────────────────────────── */
const STEPS = [
  {
    screen: 'mine',
    target: '.balance-card',
    placement: 'bottom',
    title: 'Your balance',
    body: 'This is your <b>ORL balance</b> — the main currency you earn by mining, playing games, and completing tasks. The fiat value updates in real time.',
    icon: 'wallet',
  },
  {
    screen: 'mine',
    target: '.engine',
    placement: 'bottom',
    title: 'Mining engine',
    body: 'The gauge shows your <b>engine fuel</b>. When it drains, the engine stops. Watch one ad to <b>refuel</b> and keep ORL flowing.',
    icon: 'engine',
  },
  {
    screen: 'mine',
    target: '#refuelBtn',
    placement: 'top',
    title: 'Refuel & boost',
    body: 'Tap <b>Refuel</b> to watch a short ad and refill your tank to 100%. Use <b>Boost</b> for 1.2× mining speed for 3 hours.',
    icon: 'bolt',
  },
  {
    screen: 'mine',
    target: '.rig-card, .feat:has(#rigBtn)',
    placement: 'top',
    title: 'Upgrade your rig',
    body: 'Upgrade your <b>mining rig</b> to drain the tank faster. Faster drain = more refuels = more ad revenue = more ORL for you.',
    icon: 'rig',
  },
  {
    screen: 'play',
    target: '.wheel-wrap',
    placement: 'top',
    title: 'Lucky spin',
    body: 'Spin the wheel for a chance to win up to <b>600 ORL</b>. Each spin costs one ad — no daily limit. Tap the wheel center or the button below.',
    icon: 'spin',
  },
  {
    screen: 'play',
    target: '#scratchBtn',
    placement: 'top',
    title: 'Scratch & win',
    body: 'Get a scratch card, then scratch with your finger to reveal prizes up to <b>250 ORL</b>. The card stays locked until you tap the button.',
    icon: 'scratch',
  },
  {
    screen: 'play',
    target: '#cfHeadsBtn',
    placement: 'top',
    title: 'Coin flip',
    body: 'Pick <b>heads or tails</b> — win 65 ORL or get 15 ORL consolation. The coin does a real 3D flip animation.',
    icon: 'coin',
  },
  {
    screen: 'play',
    target: '#chestBtn',
    placement: 'top',
    title: 'Mystery chest',
    body: 'Watch <b>5 ads</b> to fill the chest, then unlock it for <b>200–280 ORL</b>. The progress bar fills with each ad.',
    icon: 'chest',
  },
  {
    screen: 'earn',
    target: '.ad-challenge',
    placement: 'bottom',
    title: 'Daily ad challenge',
    body: 'Every ad you watch counts toward <b>milestone bonuses</b>. Hit 10, 25, and 50 ads for extra ORL rewards.',
    icon: 'trophy',
  },
  {
    screen: 'earn',
    target: '#videoWallBtn',
    placement: 'top',
    title: 'Video wall',
    body: 'Watch unlimited video ads for <b>40 ORL each</b>. No daily cap — earn as much as you want.',
    icon: 'video',
  },
  {
    screen: 'earn',
    target: '.seg',
    placement: 'bottom',
    title: 'Tasks & invites',
    body: 'Switch between <b>Tasks</b> (earn by completing actions) and <b>Invite</b> (earn 7% forever on referrals).',
    icon: 'share',
  },
  {
    screen: 'wallet',
    target: '.withdraw-head',
    placement: 'bottom',
    title: 'Withdrawals',
    body: 'Cash out to <b>Bank (NGN)</b>, <b>Airtime</b>, or <b>USDT</b>. The progress bar shows how close you are to the minimum.',
    icon: 'bank',
  },
  {
    screen: 'wallet',
    target: '#methodGrid',
    placement: 'top',
    title: 'Payout methods',
    body: 'Pick your preferred payout method. Bank transfers verify your account name automatically before withdrawal.',
    icon: 'payment',
  },
  {
    screen: 'wallet',
    target: '#historyList',
    placement: 'top',
    title: 'Recent activity',
    body: 'Every transaction is logged here. <b>Tap any transaction</b> to see full details — withdrawal status, payout reference, and more.',
    icon: 'history',
  },
  {
    screen: null,
    target: null,
    placement: 'center',
    title: 'You\'re all set!',
    body: 'You now know everything about Orael. Start mining, play games, and cash out your earnings. <b>Welcome to the engine room.</b>',
    icon: 'rocket',
  },
];

/* ── Icon SVGs ─────────────────────────────────────────────────── */
const ICONS = {
  wallet: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M16 12h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  engine: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 12 7 7m5 5 5-5m-5 5v7" stroke="currentColor" stroke-width="1.5"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  rig: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="11" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M7 9V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3" stroke="currentColor" stroke-width="1.7"/></svg>`,
  spin: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 12 7 7m5 5 5-5" stroke="currentColor" stroke-width="1.5"/></svg>`,
  scratch: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M7 14c2-3 4-3 6 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  coin: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  chest: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 9h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9z" stroke="currentColor" stroke-width="1.7"/><path d="M4 9l2-4h12l2 4M12 9v11" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" fill="none"><path d="M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0V4zM6 6H4v2a3 3 0 0 0 2 2.8M18 6h2v2a3 3 0 0 1-2 2.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 3v13m0-13L8 7m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bank: `<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.8"/></svg>`,
  payment: `<svg viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" stroke-width="1.8"/><path d="M2 10h20" stroke="currentColor" stroke-width="1.8"/></svg>`,
  history: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/></svg>`,
  rocket: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l-2 8 9-5 9 5-2-8M12 2v13m0-13L8 7m4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

let currentStep = 0;
let overlayEl = null;
let tooltipEl = null;
let spotlightEl = null;

/* ── Build overlay DOM ─────────────────────────────────────────── */
function buildOverlay() {
  if (overlayEl) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'tutorial-overlay';
  overlayEl.innerHTML = `
    <div class="tutorial-spotlight" id="tutorialSpotlight"></div>
    <div class="tutorial-tooltip" id="tutorialTooltip">
      <div class="tutorial-tooltip-inner">
        <div class="tutorial-header">
          <div class="tutorial-icon" id="tutorialIcon"></div>
          <div class="tutorial-progress-bar">
            <div class="tutorial-progress-fill" id="tutorialProgressFill"></div>
          </div>
          <button class="tutorial-skip-btn" id="tutorialSkipBtn">Skip</button>
        </div>
        <div class="tutorial-content">
          <h3 class="tutorial-step-title" id="tutorialStepTitle"></h3>
          <p class="tutorial-step-body" id="tutorialStepBody"></p>
        </div>
        <div class="tutorial-footer">
          <div class="tutorial-dots" id="tutorialDots"></div>
          <div class="tutorial-nav-buttons">
            <button class="btn btn-ghost tutorial-back-btn" id="tutorialBackBtn">Back</button>
            <button class="btn btn-primary tutorial-next-btn" id="tutorialNextBtn">Next</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlayEl);

  // Wire up buttons
  $('tutorialNextBtn')?.addEventListener('click', () => {
    haptic('light');
    if (currentStep < STEPS.length - 1) {
      currentStep++;
      renderStep();
    } else {
      completeTutorial();
    }
  });

  $('tutorialBackBtn')?.addEventListener('click', () => {
    haptic('light');
    if (currentStep > 0) {
      currentStep--;
      renderStep();
    }
  });

  $('tutorialSkipBtn')?.addEventListener('click', () => {
    haptic('light');
    completeTutorial();
  });
}

/* ── Navigate to a screen ──────────────────────────────────────── */
function navigateToScreen(screen) {
  if (!screen) return;
  const navBtn = document.querySelector(`.nav-btn[data-screen="${screen}"]`);
  if (navBtn) {
    navBtn.click();
  }
}

/* ── Render a step ─────────────────────────────────────────────── */
function renderStep() {
  const step = STEPS[currentStep];
  if (!step) return;

  buildOverlay();

  // Navigate to the correct screen
  if (step.screen) {
    navigateToScreen(step.screen);
  }

  // Wait for screen transition, then position spotlight
  setTimeout(() => positionSpotlight(step), 350);

  // Update tooltip content
  $('tutorialStepTitle').textContent = step.title;
  $('tutorialStepBody').innerHTML = step.body;
  $('tutorialIcon').innerHTML = ICONS[step.icon] || ICONS.rocket;

  // Progress bar
  const progress = ((currentStep + 1) / STEPS.length) * 100;
  $('tutorialProgressFill').style.width = progress + '%';

  // Dots
  const dotsEl = $('tutorialDots');
  if (dotsEl) {
    dotsEl.innerHTML = STEPS.map((_, i) => {
      const cls = i < currentStep ? 'done' : (i === currentStep ? 'active' : '');
      return `<div class="tutorial-dot ${cls}"></div>`;
    }).join('');
  }

  // Back button visibility
  $('tutorialBackBtn').style.display = currentStep === 0 ? 'none' : '';

  // Next button text
  $('tutorialNextBtn').textContent = currentStep === STEPS.length - 1 ? 'Get started' : 'Next';
}

/* ── Position the spotlight and tooltip ────────────────────────── */
function positionSpotlight(step) {
  const spotlight = $('tutorialSpotlight');
  const tooltip = $('tutorialTooltip');
  if (!spotlight || !tooltip) return;

  if (!step.target) {
    // Center tooltip, no spotlight
    spotlight.style.display = 'none';
    tooltip.classList.add('center');
    tooltip.style.left = '50%';
    tooltip.style.top = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    return;
  }

  // Find the target element
  const target = document.querySelector(step.target);
  if (!target) {
    // Target not found — just center the tooltip
    spotlight.style.display = 'none';
    tooltip.classList.add('center');
    tooltip.style.left = '50%';
    tooltip.style.top = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
    return;
  }

  // Scroll target into view
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Wait for scroll to settle
  setTimeout(() => {
    const rect = target.getBoundingClientRect();
    const padding = 8;

    // Position spotlight
    spotlight.style.display = '';
    spotlight.style.left = (rect.left - padding) + 'px';
    spotlight.style.top = (rect.top - padding) + 'px';
    spotlight.style.width = (rect.width + padding * 2) + 'px';
    spotlight.style.height = (rect.height + padding * 2) + 'px';

    // Position tooltip below or above the target
    tooltip.classList.remove('center');
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    let tooltipTop;
    if (step.placement === 'top' || (spaceBelow < 220 && spaceAbove > 220)) {
      tooltipTop = rect.top - tooltipRect.height - 16;
      tooltip.classList.add('above');
      tooltip.classList.remove('below');
    } else {
      tooltipTop = rect.bottom + 16;
      tooltip.classList.add('below');
      tooltip.classList.remove('above');
    }

    // Center horizontally, but clamp to viewport
    let tooltipLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
    tooltipLeft = Math.max(16, Math.min(tooltipLeft, window.innerWidth - tooltipRect.width - 16));

    tooltip.style.left = tooltipLeft + 'px';
    tooltip.style.top = tooltipTop + 'px';
    tooltip.style.transform = 'none';
  }, 300);
}

/* ── Complete the tutorial ─────────────────────────────────────── */
async function completeTutorial() {
  try {
    await api('/api/user/tutorial-seen', { method: 'POST' });
  } catch (e) {
    console.error('Failed to mark tutorial as seen:', e);
  }

  if (overlayEl) {
    overlayEl.classList.add('leaving');
    setTimeout(() => {
      if (overlayEl) {
        overlayEl.remove();
        overlayEl = null;
      }
    }, 400);
  }

  setLocal('_tutorialSeen', true);
  haptic('success');

  // Navigate back to miner screen
  navigateToScreen('mine');

  toast({ title: 'Welcome to Orael!', message: 'Start mining to earn your first ORL', variant: 'success' });
}

/* ── Reposition on resize / scroll ─────────────────────────────── */
let repositionTimer = null;
function reposition() {
  if (!overlayEl) return;
  clearTimeout(repositionTimer);
  repositionTimer = setTimeout(() => {
    const step = STEPS[currentStep];
    if (step) positionSpotlight(step);
  }, 100);
}

/* ── Setup ─────────────────────────────────────────────────────── */
export function setupTutorial() {
  const S = getState();
  if (S.tutorialSeen) return;

  // Delay tutorial start so the app fully loads
  setTimeout(() => {
    currentStep = 0;
    renderStep();

    // Reposition on resize/scroll
    window.addEventListener('resize', reposition);
    document.querySelector('.scroll')?.addEventListener('scroll', reposition, { passive: true });
  }, 600);
}
