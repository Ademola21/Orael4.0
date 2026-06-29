import './devmock.js'; // side-effect: installs Telegram WebApp mock + Adsgram mock in any browser
import { initTelegram, isTelegramEnv } from './telegram.js';
import { api } from './api.js';
import { updateState, setLocal, loadCachedState, getState } from './state.js';
import { $, render, setupNavigation, setupSegmentedTabs, setupTierModal, setupModal } from './ui.js';
import { setupMining } from './mining.js';
import { buildWheel, setupPlay, renderLeaderboard, isGameActive } from './play.js';
import { setupEarn, renderTasks, renderStreak } from './earn.js';
import { setupWallet } from './wallet.js';
import { setupProfile } from './profile.js';
import { setupTutorial } from './tutorial.js';
import {
  checkBalanceAnimation,
  attachAllRipples,
  animateScreenTransition,
  initScrollReveal,
  refreshScrollReveal,
  updatePulseGlow,
  updateLiveIndicator,
  initParallax,
} from './animations.js';

import './styles/index.css';
import './styles/profile.css';

function hideSplash() {
  const splash = document.getElementById('splash-screen');
  const appEl = document.querySelector('.app');
  if (splash) {
    splash.style.opacity = '0';
    splash.style.transition = 'opacity 0.4s ease';
    setTimeout(() => {
      splash.style.display = 'none';
      const tgGate = document.getElementById('tg-gate');
      const banGate = document.getElementById('ban-gate');
      const maintenanceGate = document.getElementById('maintenance-gate');
      const isGateVisible = 
        (tgGate && tgGate.style.display === 'flex') ||
        (banGate && banGate.style.display === 'flex') ||
        (maintenanceGate && maintenanceGate.style.display === 'flex');
      
      if (!isGateVisible && appEl) {
        appEl.style.display = 'flex';
      }
    }, 400);
  } else {
    const tgGate = document.getElementById('tg-gate');
    const banGate = document.getElementById('ban-gate');
    const maintenanceGate = document.getElementById('maintenance-gate');
    const isGateVisible = 
      (tgGate && tgGate.style.display === 'flex') ||
      (banGate && banGate.style.display === 'flex') ||
      (maintenanceGate && maintenanceGate.style.display === 'flex');
    if (!isGateVisible && appEl) {
      appEl.style.display = 'flex';
    }
  }
}

async function boot() {
  // 1. Initialize Telegram SDK
  const { tg, user, startParam } = initTelegram();

  // 2. Verify Telegram environment
  if (!isTelegramEnv()) {
    const gate = document.getElementById('tg-gate');
    const appEl = document.querySelector('.app');
    if (gate) gate.style.display = 'flex';
    if (appEl) appEl.style.display = 'none';
    hideSplash();
    return;
  }

  // Load cached user state if available to prevent flash of 0/lag
  if (user && user.id) {
    loadCachedState(user.id);
  }

  // Initial render (shows cached state or loading placeholders instantly)
  render();

  // Set user avatar (Telegram photo or initial fallback)
  if (user) {
    updateUserAvatar(user);
  }

  // 3. Fetch initial state from server
  try {
    let url = '/api/user';
    if (startParam) {
      url += `?start_param=${encodeURIComponent(startParam)}`;
    }
    const serverState = await api(url);
    updateState(serverState);
  } catch (error) {
    console.error('Failed to fetch user state on boot:', error);
  }

  // Mark state as loaded to render balance/energy
  setLocal('_loaded', true);

  hideSplash();

  // Update avatar again with server-side photo_url
  const S = getState();
  updateUserAvatar({
    first_name: S.firstName,
    photo_url: S.photoUrl
  });

  // Fetch and render leaderboard helper
  async function fetchAndRenderLeaderboard() {
    try {
      const lbData = await api('/api/leaderboard');
      updateState({
        leaderboard: lbData.leaderboard,
        _userRank: lbData.userRank
      });
      renderLeaderboard(lbData.leaderboard);
    } catch (e) {
      console.error('Failed to fetch leaderboard:', e);
    }
  }

  // Fetch initial leaderboard
  await fetchAndRenderLeaderboard();

  // 4. Initialize UI and wire listeners
  buildWheel();
  setupNavigation();
  setupSegmentedTabs();
  setupTierModal();
  setupModal();
  setupMining();
  setupPlay();
  setupEarn();
  setupWallet();
  setupProfile();

  // 5. Initial render
  render();

  // 6. Initialize animation systems
  attachAllRipples();
  initScrollReveal();
  initParallax();
  updatePulseGlow();
  updateLiveIndicator();

  // 7. Show tutorial for new users
  setupTutorial();

  // 8. Start interval loops
  // Client-side local mining estimation, gauge update, and animations (every second)
  setInterval(() => {
    if (isGameActive && isGameActive()) return;
    render();
    checkBalanceAnimation();
    updatePulseGlow();
    updateLiveIndicator();
  }, 1000);

  // Re-attach ripples + scroll reveal every 5 seconds (catches dynamically added elements)
  setInterval(() => {
    if (isGameActive && isGameActive()) return;
    attachAllRipples();
    refreshScrollReveal();
  }, 5000);

  // Authoritative server state sync (every 30 seconds)
  setInterval(async () => {
    if (isGameActive && isGameActive()) return;
    try {
      const serverState = await api('/api/user');
      updateState(serverState);
      render();
      renderTasks();
      renderStreak();
      await fetchAndRenderLeaderboard();
    } catch (e) {
      console.error('Background state sync failed:', e);
    }
  }, 30000);
}

/**
 * Update the user avatar element with either a Telegram photo or initial.
 */
function updateUserAvatar(user) {
  const userAv = $('userAv');
  if (!userAv) return;

  const photoUrl = user.photo_url || (getState && getState().photoUrl) || null;
  if (photoUrl) {
    userAv.innerHTML = `<img src="${photoUrl}" alt="avatar" onerror="this.parentElement.textContent='${(user.first_name || 'A')[0].toUpperCase()}'" />`;
  } else {
    const initial = (user.first_name || 'A')[0].toUpperCase();
    userAv.textContent = initial;
  }
}

// Override navigation to trigger screen transition animations
const originalSetupNavigation = setupNavigation;
// Note: setupNavigation is already called above, but we patch it to add transition
// We'll wrap the nav button clicks instead
document.addEventListener('click', (e) => {
  const navBtn = e.target.closest('.nav-btn');
  if (navBtn && navBtn.dataset.screen) {
    animateScreenTransition(navBtn.dataset.screen);
  }
}, true);

// Start boot sequence when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
