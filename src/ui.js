/* ========================================================================
   ui.js — Rendering engine & UI helpers
   Master render function that updates ALL DOM elements from current state.
   Runs on a 1-second interval for smooth gauge countdown animation.
   Between server syncs, the client ESTIMATES mining progress locally
   (but never writes it to server — the server is authoritative).
   ======================================================================== */

import { getState, setLocal } from './state.js';
import { haptic } from './telegram.js';
import { ARC_LEN } from './ads.js';

function isBankVerified() {
  const savedSelect = $('savedBankSelect');
  if (savedSelect && savedSelect.value) {
    return true;
  }
  return getState()._resolvedAccountName !== undefined && getState()._resolvedAccountName !== null;
}

/* ---- Economy config (100% server-authoritative) ----
   The server sends the full economy config in `state.economy` (see
   getUserState). The client has ZERO fallback values — if the server
   hasn't synced yet, we show loading state instead of stale numbers.
   This prevents financial displays from ever drifting from DB settings. */
function econ() {
  const e = getState().economy;
  if (!e || !e.ORL_TO_NGN) return null; // Not loaded yet
  return e;
}
function econReady() { return econ() !== null; }
export function orlToNgn() { const e = econ(); return e ? e.ORL_TO_NGN : 0; }
export function tankOrl()  { const e = econ(); return e ? e.TANK_ORL : 0; }
export function rigsList() { const e = econ(); return (e && e.RIGS && e.RIGS.length) ? e.RIGS : []; }
export function tierMul(t) { const e = econ(); return (e && e.TIER_MULTIPLIERS && e.TIER_MULTIPLIERS[t]) || 1; }
export function proMul()   { const e = econ(); return e ? e.PRO_MULTIPLIER : 1; }
export function boostMul() { const e = econ(); return e ? e.BOOST_MULTIPLIER : 1; }
export function withdrawalMethods() { const e = econ(); return e ? (e.WITHDRAWAL_METHODS || {}) : {}; }
export function faucetCooldown() { const e = econ(); return e ? e.FAUCET_COOLDOWN : 0; }
export function chestGoal() { const e = econ(); return e ? e.CHEST_GOAL : 0; }

/* ---- Format helpers ---- */

/**
 * Format number with commas and decimal places.
 * @param {number} n
 * @param {number} [d=2] — decimal places
 * @returns {string}
 */
export function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/**
 * Format integer with commas (no decimals).
 * @param {number} n
 * @returns {string}
 */
export function fmtInt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

/**
 * Convert ORL amount to naira string.
 * @param {number} orl
 * @returns {string}
 */
export function naira(orl) {
  return '₦' + fmt(orl * orlToNgn(), 2);
}

/**
 * Format milliseconds as h:mm:ss.
 * @param {number} ms
 * @returns {string}
 */
export function hms(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * getElementById shortcut.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function $(id) {
  return document.getElementById(id);
}

/* ---- SVG icon constants ---- */
const icoIn = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14m0 0 5-5m-5 5-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const icoOut = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5m0 0 5 5m-5-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---- Derived calculations (display-only, based on server state) ---- */

function now() { return Date.now(); }

// Tier multipliers read from econ() — no hardcoded copy

function isPro(S) { return now() < (S.proUntil || 0); }
function isBoosted(S) { return now() < (S.boostUntil || 0); }
function multiplier(S) {
  const proMulV = isPro(S) ? proMul() : 1;
  const boostMulV = isBoosted(S) ? boostMul() : 1;
  const tierMulV = tierMul(S.tier || 1);
  return proMulV * boostMulV * tierMulV;
}

function rigDef(S) {
  const rigs = rigsList();
  return rigs[S.rigLevel] || rigs[0];
}

function sessionHrs(S) {
  const r = rigDef(S);
  return (r.sessionMin || 240) / 60;
}

function ratePerHr(S) {
  return (tankOrl() / sessionHrs(S)) * multiplier(S);
}

function energyPct(S) {
  return Math.max(0, (tankOrl() - (S.tankMined || 0)) / tankOrl() * 100);
}

function isMining(S) {
  return (S.tankMined || 0) < tankOrl() - 1e-9;
}

function fuelMsLeft(S) {
  if (!isMining(S)) return 0;
  return ((tankOrl() - (S.tankMined || 0)) / ratePerHr(S)) * 3600000;
}

/**
 * Client-side mining estimation for smooth gauge animation.
 * Estimates how much has been mined since lastAccrue, WITHOUT writing to server.
 * Returns the estimated additional ORL mined since last server sync.
 */
function estimateMining(S) {
  if (!isMining(S)) return 0;
  const elapsed = now() - (S.lastAccrue || now());
  if (elapsed <= 0) return 0;
  const est = (elapsed / 3600000) * ratePerHr(S);
  return Math.min(est, tankOrl() - (S.tankMined || 0));
}

/* ========================================================================
   TOAST NOTIFICATION
   ======================================================================== */

/* ---- Toast icon SVGs ---- */
const TOAST_ICONS = {
  success: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  error: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 11v5m0-9h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  reward: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 5.8 6.6.6-5 4.3 1.5 6.5L12 16.2 6.5 19.2 8 12.7 3 8.4l6.6-.6L12 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
};

/**
 * Show a premium animated toast notification.
 * Auto-detects variant from message content, or use explicit variant.
 *
 * @param {string} title - main text (or message if only one arg)
 * @param {string|object} [coinOrOpts] - coin badge text OR options object
 *   Options: { variant?: 'success'|'error'|'info'|'reward', message?: string, coin?: string, duration?: number }
 *
 * @example
 *   toast('Engine refueled', 'Fuel at 100%')           // legacy 2-arg
 *   toast('Withdrawal failed', { variant: 'error' })    // explicit variant
 *   toast({ title: 'Chest unlocked!', message: '+200 ORL', variant: 'reward', coin: '+200' })
 */
export function toast(title, coinOrOpts) {
  const wrap = $('toastWrap');
  if (!wrap) return;

  // Normalize args
  let opts = { variant: 'info', message: '', coin: '', duration: 2600 };
  if (typeof title === 'object') {
    opts = { ...opts, ...title };
  } else if (typeof coinOrOpts === 'object') {
    opts = { ...opts, ...coinOrOpts };
    opts.coin = opts.coin || (typeof coinOrOpts === 'string' ? coinOrOpts : '');
  } else if (typeof coinOrOpts === 'string') {
    // Legacy 2-arg call: toast(title, coin) - infer variant from title
    opts.coin = coinOrOpts;
    opts.variant = inferVariant(title);
  } else {
    opts.variant = inferVariant(title);
  }

  // If only one arg, use as message
  if (!opts.title) opts.title = title;

  // Build the toast element
  const el = document.createElement('div');
  el.className = `toast ${opts.variant || 'info'}`;

  const iconSvg = TOAST_ICONS[opts.variant] || TOAST_ICONS.info;

  el.innerHTML = `
    <div class="toast-ic">${iconSvg}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(opts.title)}</div>
      ${opts.message ? `<div class="toast-msg">${escapeHtml(opts.message)}</div>` : ''}
    </div>
    ${opts.coin ? `<div class="toast-coin">${escapeHtml(opts.coin)}</div>` : ''}
  `;

  wrap.appendChild(el);

  // Trigger haptic feedback via Telegram
  try {
    const h = window.Telegram?.WebApp?.HapticFeedback;
    if (h) {
      if (opts.variant === 'success' || opts.variant === 'reward') h.notificationOccurred('success');
      else if (opts.variant === 'error') h.notificationOccurred('error');
      else h.impactOccurred('light');
    }
  } catch (e) {}

  // Auto-dismiss
  const duration = opts.duration || 2600;
  setTimeout(() => {
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 350);
  }, duration);
}

/**
 * Infer toast variant from message text.
 */
function inferVariant(text) {
  if (!text) return 'info';
  const lower = text.toLowerCase();
  if (/(success|claimed|refueled|credited|approved|completed|won|earned|unlocked|boost active|active)/i.test(lower)) return 'success';
  if (/(error|failed|failed to|invalid|insufficient|not enough|banned|rejected|coming soon|incomplete|missing)/i.test(lower)) return 'error';
  if (/(reward|bonus|\+\d)/i.test(lower)) return 'reward';
  return 'info';
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Show a floating "+X ORL" reward burst animation at the center of screen.
 * Used when user earns ORL from any feature.
 *
 * @param {number|string} amount - ORL amount to display
 */
export function rewardBurst(amount) {
  const el = document.createElement('div');
  el.className = 'reward-burst';
  el.textContent = `+${amount} ORL`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

/* ========================================================================
   REWARD MODAL
   ======================================================================== */

/**
 * Show the reward modal with amount, title, and body text.
 * Also triggers a floating "+X ORL" burst animation if amount > 0.
 * @param {number} amount
 * @param {string} title
 * @param {string} [body]
 */
export function reward(amount, title, body) {
  const titleEl = $('modalTitle');
  const amtEl   = $('modalAmt');
  const bodyEl  = $('modalBody');
  const veil    = $('modalVeil');

  if (!titleEl || !amtEl || !bodyEl || !veil) return;

  titleEl.textContent = title;
  if (amount === null || amount === undefined) {
    amtEl.style.display = 'none';
  } else {
    amtEl.style.display = '';
    amtEl.textContent   = (amount >= 0 ? '+' : '') + fmtInt(amount) + ' ORL';
  }
  bodyEl.textContent  = body || 'Added to your balance.';
  veil.classList.add('show');
  haptic('success');

  // Floating burst for positive rewards
  if (amount > 0) {
    rewardBurst(amount);
  }
}

/**
 * Wire up the modal close button.
 */
export function setupModal() {
  const closeBtn = $('modalClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      $('modalVeil')?.classList.remove('show');
    });
  }
}

/**
 * Wire the topbar user-chip to open the PROFILE overlay (which now houses
 * avatar, Pro subscription, and a link to the tier-progression modal).
 */
export function setupTierModal() {
  const userChip = $('userChip');
  const tierClose = $('tierClose');
  const tierVeil = $('tierVeil');
  const profileVeil = $('profileVeil');
  const profileClose = $('profileClose');
  const viewTiersBtn = $('profileViewTiers');

  // Tap avatar → open profile overlay
  if (userChip && profileVeil) {
    userChip.addEventListener('click', () => {
      const S = getState();
      renderProfile(S);
      profileVeil.classList.add('show');
      haptic('light');
    });
  }

  if (profileClose && profileVeil) {
    profileClose.addEventListener('click', () => {
      profileVeil.classList.remove('show');
      haptic('light');
    });
  }

  // Profile → open tier progression modal
  if (viewTiersBtn && tierVeil) {
    viewTiersBtn.addEventListener('click', () => {
      const S = getState();
      updateTierModalProgress(S);
      tierVeil.classList.add('show');
      haptic('light');
    });
  }

  if (tierClose && tierVeil) {
    tierClose.addEventListener('click', () => {
      tierVeil.classList.remove('show');
      haptic('light');
    });
  }
}

/**
 * Render user progress metrics in the tier details modal.
 */
export function updateTierModalProgress(S) {
  const currentTier = S.tier || 1;
  const balance = S.balance || 0;
  const referrals = (S.ref && S.ref.count) || 0;

  // Highlight active tier row
  for (let t = 1; t <= 5; t++) {
    const row = $('tier-row-' + t);
    if (row) {
      if (t === currentTier) {
        row.style.borderColor = 'rgba(224,162,91,0.5)';
        row.style.background = 'rgba(224,162,91,0.08)';
        row.style.boxShadow = '0 0 12px rgba(224,162,91,0.05)';
      } else {
        row.style.borderColor = 'transparent';
        row.style.background = 'rgba(255,255,255,0.03)';
        row.style.boxShadow = 'none';
      }
    }
  }

  const progEl = $('tierProgression');
  if (!progEl) return;

  if (currentTier >= 5) {
    progEl.innerHTML = `
      <div style="text-align:center;font-weight:600;color:var(--cu-1)">🏆 Max Tier Reached!</div>
      <div style="font-size:11px;color:var(--ink-soft);text-align:center;margin-top:4px">You are at Diamond Tier (2.0x mining multiplier)</div>
    `;
    return;
  }

  const tierSpecs = {
    2: { name: 'Silver', bal: 5000, refs: 3 },
    3: { name: 'Gold', bal: 25000, refs: 10 },
    4: { name: 'Platinum', bal: 100000, refs: 25 },
    5: { name: 'Diamond', bal: 500000, refs: 100 }
  };

  const nextTier = currentTier + 1;
  const spec = tierSpecs[nextTier];
  if (!spec) return;

  const balPct = Math.min(100, (balance / spec.bal) * 100);
  const refPct = Math.min(100, (referrals / spec.refs) * 100);

  progEl.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;color:var(--ink)">Next: Tier ${nextTier} (${spec.name})</div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--ink-soft);margin-bottom:3px">
        <span>Balance Progress</span>
        <span><b>${fmtInt(balance)}</b> / ${fmtInt(spec.bal)} ORL</span>
      </div>
      <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden">
        <div style="height:100%;width:${balPct}%;background:var(--cu-1);border-radius:2px"></div>
      </div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--ink-soft);margin-bottom:3px">
        <span>Invites Progress</span>
        <span><b>${referrals}</b> / ${spec.refs} referrals</span>
      </div>
      <div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);overflow:hidden">
        <div style="height:100%;width:${refPct}%;background:var(--cu-1);border-radius:2px"></div>
      </div>
    </div>
    <div style="font-size:10.5px;color:var(--ink-mute);margin-top:10px;text-align:center">
      Reach either requirement to upgrade to ${spec.name}!
    </div>
  `;
}

/* ========================================================================
   NAVIGATION
   ======================================================================== */

/**
 * Wire bottom nav buttons to switch screens.
 */
export function setupNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('light');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const screen = $('screen-' + btn.dataset.screen);
      if (screen) screen.classList.add('active');
      setLocal('_screen', btn.dataset.screen);
      document.querySelector('.scroll')?.scrollTo({ top: 0, behavior: 'smooth' });

      // Trigger wallet info section update when opening wallet tab
      if (btn.dataset.screen === 'wallet') {
        document.dispatchEvent(new CustomEvent('orael:method-change'));
      }
    });
  });
}

/**
 * Wire Earn sub-tabs (Tasks / Offers / Invite).
 */
export function setupSegmentedTabs() {
  document.querySelectorAll('.seg button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      document.querySelectorAll('[data-pane]').forEach(p => {
        p.hidden = p.dataset.pane !== b.dataset.seg;
      });
      setLocal('_earnTab', b.dataset.seg);
    });
  });
}

/* ========================================================================
   RENDER: HISTORY
   ======================================================================== */

/**
 * Render transaction history list.
 * @param {Array} transactions
 */
export function renderHistory(transactions) {
  const el = $('historyList');
  if (!el) return;

  const list = transactions || getState().transactions || [];

  el.innerHTML = list.map(h => `
    <div class="item"><div class="item-ic">${h.k === 'neg' ? icoOut : icoIn}</div>
    <div class="item-body"><div class="item-title">${h.t}</div><div class="item-sub">${h.d}</div></div>
    <div class="item-reward ${h.k}">${h.a}</div></div>`).join('');
}

/* ========================================================================
   RENDER: RIG
   ======================================================================== */

/**
 * Render the rig upgrade section.
 * @param {object} [state]
 */
export function renderRig(state) {
  const S = state || getState();
  const rigs = rigsList();
  const r = rigs[S.rigLevel] || rigs[0];
  const next = rigs[S.rigLevel + 1];

  const rigNameEl = $('rigName');
  const rigRateEl = $('rigRate');
  const rigMeterEl = $('rigMeter');
  const rigNextEl = $('rigNext');
  const rigBtnEl = $('rigBtn');

  if (rigNameEl) rigNameEl.textContent = r.name;
  if (rigRateEl) rigRateEl.textContent = fmt(tankOrl() / (r.sessionMin / 60), 1);

  if (rigMeterEl) {
    rigMeterEl.innerHTML = rigs.map((_, i) =>
      `<div class="rig-seg ${i <= S.rigLevel ? 'on' : ''}"></div>`
    ).join('');
  }

  if (next) {
    if (rigNextEl) rigNextEl.textContent = fmt(tankOrl() / (next.sessionMin / 60), 1);
    if (rigBtnEl) {
      rigBtnEl.textContent = `Upgrade · ${fmtInt(next.cost)} ORL`;
      rigBtnEl.disabled = S.balance < next.cost;
    }
  } else {
    if (rigNextEl) rigNextEl.textContent = 'MAX';
    if (rigBtnEl) {
      rigBtnEl.textContent = 'Max rig';
      rigBtnEl.disabled = true;
    }
  }
}

/* ========================================================================
   DYNAMIC METHOD GRID — 100% server-authoritative
   Renders withdrawal method cards from state.economy.WITHDRAWAL_METHODS.
   No hardcoded minimums, names, or fiat values anywhere.
   ======================================================================== */

const METHOD_ICONS = {
  airtime: `<svg class="m-ic" viewBox="0 0 24 24" fill="none"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" stroke="#e0a25b" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  bank: `<svg class="m-ic" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="13" rx="2" stroke="#e0a25b" stroke-width="1.8"/><path d="M3 10h18" stroke="#e0a25b" stroke-width="1.8"/></svg>`,
  usdt: `<svg class="m-ic" viewBox="0 0 24 24" fill="none"><path d="M12 2v20M7 6h7a3 3 0 0 1 0 6H7m0 0h8a3 3 0 0 1 0 6H7" stroke="#e0a25b" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

let _lastMethodGridHash = '';

function renderMethodGrid(S) {
  const grid = $('methodGrid');
  if (!grid) return;

  const methods = withdrawalMethods();
  if (!methods || Object.keys(methods).length === 0) {
    if (!_lastMethodGridHash) {
      grid.innerHTML = `<div style="text-align:center;padding:16px;color:var(--ink-soft);font-size:13px">Loading payout methods...</div>`;
      _lastMethodGridHash = 'loading';
    }
    return;
  }

  const isNG = !S.country || S.country === 'NG';
  const e = econ();

  // Build a hash to avoid unnecessary re-renders
  const hash = JSON.stringify({ methods, isNG, sel: S._selectedMethod?.id });
  if (hash === _lastMethodGridHash) return;
  _lastMethodGridHash = hash;

  // Filter methods by country
  const available = [];
  for (const [key, m] of Object.entries(methods)) {
    if (m.countries === 'all' || (Array.isArray(m.countries) && m.countries.includes(isNG ? 'NG' : (S.country || '')))) {
      available.push({ key, ...m });
    }
  }

  // If non-NG user has no methods, show USDT at minimum
  if (available.length === 0 && methods.usdt) {
    available.push({ key: 'usdt', ...methods.usdt });
  }

  // Auto-select first method if none selected or current selection is invalid
  const currentSel = S._selectedMethod?.id;
  const isCurrentValid = available.some(m => m.key === currentSel);

  if (!currentSel || !isCurrentValid) {
    // Default to first available method (usually bank for NG)
    const defaultMethod = available.find(m => m.key === 'bank') || available[0];
    if (defaultMethod) {
      setLocal('_selectedMethod', { id: defaultMethod.key, name: defaultMethod.name, min: defaultMethod.minOrl });
      document.dispatchEvent(new CustomEvent('orael:method-change'));
    }
  }

  const selectedId = S._selectedMethod?.id;

  grid.innerHTML = available.map(m => {
    const icon = METHOD_ICONS[m.key] || METHOD_ICONS.bank;
    const sel = m.key === selectedId ? ' sel' : '';
    const minDisplay = `Min ${fmtInt(m.minOrl)} ORL · ${m.fiat}`;
    return `<div class="method${sel}" id="method-${m.key}" data-min="${m.minOrl}" data-name="${m.name}" data-key="${m.key}">
      ${icon}
      <div class="m-name">${m.name}</div><div class="m-min">${minDisplay}</div>
    </div>`;
  }).join('');

  // Re-wire click events
  grid.querySelectorAll('.method').forEach(el => {
    el.addEventListener('click', () => {
      haptic('light');
      grid.querySelectorAll('.method').forEach(x => x.classList.remove('sel'));
      el.classList.add('sel');
      const key = el.dataset.key;
      const serverM = methods[key];
      setLocal('_selectedMethod', { id: key, name: serverM.name, min: serverM.minOrl });
      _lastMethodGridHash = ''; // Force re-render
      render();
      document.dispatchEvent(new CustomEvent('orael:method-change'));
    });
  });
}


/* ========================================================================
   MASTER RENDER
   Runs every second. Computes display values from server state.
   Estimates mining progress locally for smooth gauge animation.
   ======================================================================== */

/**
 * The master render function. Updates ALL DOM elements from current state.
 */
export function render() {
  const S = getState();

  if (!S._loaded || !econReady()) {
    const balEl = $('balance');
    if (balEl) balEl.textContent = '...';

    const fiatEl = $('balanceFiat');
    if (fiatEl) fiatEl.textContent = '≈ ₦...';

    const sessEl = $('sessionEarned');
    if (sessEl) sessEl.textContent = 'Loading...';

    const energyEl = $('energyNum');
    if (energyEl) energyEl.textContent = '...';

    const timeEl = $('timeLeft');
    if (timeEl) timeEl.textContent = '...';

    const wBalEl = $('wBalance');
    if (wBalEl) wBalEl.textContent = '...';

    const wFiatEl = $('wFiat');
    if (wFiatEl) wFiatEl.textContent = '...';

    const userTierEl = $('userTier');
    if (userTierEl) userTierEl.textContent = '...';

    return;
  }

  // Client-side estimation for smooth animation
  const estMined = estimateMining(S);
  const tOrl = tankOrl();
  const effectiveTankMined = Math.min(tOrl, (S.tankMined || 0) + estMined);
  const effectiveBalance = (S.balance || 0) + estMined;

  const e = Math.max(0, (tOrl - effectiveTankMined) / tOrl * 100);
  const mining = effectiveTankMined < tOrl - 1e-9;

  // Pro status class
  document.body.classList.toggle('is-pro', isPro(S));

  // Admin status class — show admin chip if user is admin/mod
  const isAdmin = S.role === 'admin' || S.role === 'mod' || (S.permissions && S.permissions.length > 0);
  document.body.classList.toggle('is-admin', isAdmin);

  // Tier
  const tierEl = $('userTier');
  if (tierEl) tierEl.textContent = S.tier || 1;
  updateTierModalProgress(S);

  // Update avatar — prefer the server-assigned avatar_url (custom upload or one
  // of the 10 defaults), then Telegram photo_url, then initial. Re-renders on
  // change (avatar picker / upload) — no dataset guard.
  const userAv = $('userAv');
  if (userAv) {
    const avUrl = S.avatarUrl || S.photoUrl || null;
    const initial = (S.firstName || 'A')[0]?.toUpperCase() || 'A';
    if (avUrl && avUrl !== userAv.dataset.src) {
      userAv.innerHTML = `<img src="${avUrl}" alt="avatar" onerror="this.parentElement.textContent='${initial}'" />`;
      userAv.dataset.src = avUrl;
    } else if (!avUrl && userAv.dataset.src !== 'initial') {
      userAv.textContent = initial;
      userAv.dataset.src = 'initial';
    }
  }

  // Balance
  const balEl = $('balance');
  if (balEl) balEl.textContent = fmt(effectiveBalance);

  const isNG = !S.country || S.country === 'NG';

  const fiatEl = $('balanceFiat');
  if (fiatEl) {
    const e = econ();
    if (isNG) {
      fiatEl.textContent = naira(effectiveBalance);
    } else if (e && e.ORL_PER_USD) {
      fiatEl.textContent = '≈ $' + fmt(effectiveBalance / e.ORL_PER_USD, 2);
    } else {
      fiatEl.textContent = '≈ $...';
    }
  }

  // Gauge arc
  const gaugeEl = $('gaugeArc');
  if (gaugeEl) gaugeEl.style.strokeDashoffset = (ARC_LEN * (1 - e / 100)).toFixed(1);

  const energyEl = $('energyNum');
  if (energyEl) energyEl.textContent = Math.round(e);

  // Engine status
  const st = $('engineStatus');
  if (st) {
    if (mining) {
      st.classList.remove('empty');
      st.textContent = isBoosted(S) ? 'Boosted · 1.2× speed' : (isPro(S) ? 'Pro mining' : 'Mining active');
    } else {
      st.classList.add('empty');
      st.textContent = 'Out of fuel';
    }
  }

  // Time left
  const timeEl = $('timeLeft');
  if (timeEl) {
    const remaining = mining
      ? ((tOrl - effectiveTankMined) / ratePerHr(S)) * 3600000
      : 0;
    timeEl.textContent = hms(remaining);
  }

  // Hashrate
  const hashEl = $('hashrate');
  if (hashEl) hashEl.textContent = fmt(ratePerHr(S), 1);

  // Multiplier
  const boostEl = $('boostState');
  if (boostEl) boostEl.textContent = multiplier(S).toFixed(1) + '×';

  // Session earned
  const sessEl = $('sessionEarned');
  if (sessEl) sessEl.textContent = fmt(effectiveTankMined, 4) + ' ORL mined';

  // Refuel / boost button states
  const refuelEl = $('refuelBtn');
  if (refuelEl) refuelEl.disabled = e > 95;

  const boostBtnEl = $('boostBtn');
  if (boostBtnEl) {
    boostBtnEl.disabled = isBoosted(S) || !mining;
    const stack = boostBtnEl.querySelector('.btn-stack');
    if (stack && stack.firstChild) {
      stack.firstChild.textContent = isBoosted(S) ? '1.2× Boost active' : 'Activate 1.2× Boost';
    }
  }

  // Faucet status and cooldown (from server config)
  const fCooldown = faucetCooldown();
  const elapsed = now() - (S.faucetLast || 0);
  const faucetStatusEl = $('faucetStatus');
  const faucetBtnEl = $('faucetBtn');
  if (faucetStatusEl && faucetBtnEl && fCooldown > 0) {
    if (elapsed >= fCooldown) {
      faucetStatusEl.textContent = 'Ready to claim';
      faucetBtnEl.disabled = false;
      faucetBtnEl.textContent = 'Claim';
    } else {
      faucetStatusEl.textContent = 'Next in ' + hms(fCooldown - elapsed);
      faucetBtnEl.disabled = true;
      faucetBtnEl.textContent = 'Wait';
    }
  }

  // Rig
  renderRig(S);

  // Render withdrawal method cards dynamically from server config
  renderMethodGrid(S);

  const methods = withdrawalMethods();
  const selectedMethod = S._selectedMethod || null;
  // If no method selected yet, don't show withdrawal info
  if (!selectedMethod || !methods[selectedMethod.id]) {
    const withdrawEl = $('withdrawBtn');
    if (withdrawEl) {
      withdrawEl.disabled = true;
      withdrawEl.textContent = econReady() ? 'Select a payout method' : 'Loading...';
    }
    return;
  }
  // Read the minimum LIVE from server config, not from the cached _selectedMethod
  const serverMethod = methods[selectedMethod.id];
  const selectedMin = serverMethod.minOrl;
  const selectedName = serverMethod.name;
  const selectedKey = selectedMethod.id;

  // Wallet info section rendering is managed entirely by updateWalletInfoSection in wallet.js
  // (we no longer override visibility or label text here on the render timer).

  const wBalEl = $('wBalance');
  if (wBalEl) wBalEl.textContent = fmt(effectiveBalance);

  const wFiatEl = $('wFiat');
  const e2 = econ();
  if (wFiatEl) {
    if (isNG) {
      wFiatEl.textContent = '₦' + fmt(effectiveBalance * orlToNgn(), 2);
    } else if (e2 && e2.ORL_PER_USD) {
      wFiatEl.textContent = '$' + fmt(effectiveBalance / e2.ORL_PER_USD, 2);
    } else {
      wFiatEl.textContent = '$...';
    }
  }

  const wProgEl = $('wProgress');
  if (wProgEl) wProgEl.style.width = Math.min(100, (effectiveBalance / selectedMin) * 100) + '%';

  const wProgLabelEl = $('wProgLabel');
  if (wProgLabelEl) wProgLabelEl.textContent = `${fmtInt(effectiveBalance)} / ${fmtInt(selectedMin)} ORL`;

  const can = effectiveBalance >= selectedMin;
  const feePctVal = isPro(S) ? 5 : 10;
  const amountInputEl = $('withdrawAmountInput');
  const toggleBtn = $('withdrawUnitToggle');
  const amountLabel = $('withdrawAmountLabel');
  const orlDeductionRow = $('orlDeductionRow');
  const orlDeductionVal = $('orlDeductionVal');

  // Verification gating
  let isVerified = true;
  if (selectedKey === 'bank') {
    isVerified = isBankVerified();
  }

  // Unit toggle visibility and texts
  const showToggle = (selectedKey === 'bank' || selectedKey === 'airtime');
  const unit = S._withdrawUnit || 'orl';

  if (toggleBtn) {
    toggleBtn.style.display = showToggle ? 'inline-block' : 'none';
    toggleBtn.textContent = unit === 'ngn' ? 'Switch to ORL' : 'Switch to ₦ NGN';
  }
  if (amountLabel) {
    amountLabel.textContent = (showToggle && unit === 'ngn') ? 'Amount to withdraw (NGN)' : 'Amount to withdraw (ORL)';
  }
  if (amountInputEl) {
    amountInputEl.placeholder = (showToggle && unit === 'ngn') ? 'Enter amount in Naira' : 'Enter amount to withdraw';
    amountInputEl.disabled = !isVerified;
  }

  let amt = 0;
  let inputError = false;
  let inputErrorMsg = '';

  if (!isVerified) {
    inputError = true;
    inputErrorMsg = 'Verify account name first';
  } else if (can) {
    if (amountInputEl && amountInputEl.value.trim() !== '') {
      if (showToggle && unit === 'ngn') {
        const ngnVal = parseFloat(amountInputEl.value);
        if (isNaN(ngnVal) || ngnVal <= 0) {
          inputError = true;
          inputErrorMsg = 'Invalid amount';
        } else {
          const grossOrl = Math.round(ngnVal / orlToNgn());
          const minNgn = Math.round(selectedMin * orlToNgn());
          const maxNgn = Math.round(effectiveBalance * orlToNgn());
          if (ngnVal < minNgn) {
            inputError = true;
            inputErrorMsg = `Min is ₦${fmt(minNgn, 0)}`;
          } else if (grossOrl > effectiveBalance) {
            inputError = true;
            inputErrorMsg = `Max is ₦${fmt(maxNgn, 0)}`;
          } else {
            amt = grossOrl;
          }
        }
      } else {
        const inputVal = parseInt(amountInputEl.value);
        if (isNaN(inputVal) || inputVal < selectedMin) {
          inputError = true;
          inputErrorMsg = `Min is ${fmtInt(selectedMin)} ORL`;
        } else if (inputVal > effectiveBalance) {
          inputError = true;
          inputErrorMsg = `Max is ${fmtInt(effectiveBalance)} ORL`;
        } else {
          amt = inputVal;
        }
      }
    } else {
      amt = Math.floor(effectiveBalance);
    }
  }

  // Display Total ORL deduction row if NGN mode
  if (orlDeductionRow) {
    if (showToggle && unit === 'ngn') {
      orlDeductionRow.style.display = 'flex';
      if (orlDeductionVal) {
        orlDeductionVal.textContent = fmtInt(amt) + ' ORL';
      }
    } else {
      orlDeductionRow.style.display = 'none';
    }
  }

  const withdrawEl = $('withdrawBtn');
  if (withdrawEl) {
    if (!isVerified) {
      withdrawEl.disabled = true;
      withdrawEl.textContent = 'Verify account name first';
    } else if (!can) {
      withdrawEl.disabled = true;
      withdrawEl.textContent = `Need ${fmtInt(selectedMin - effectiveBalance)} more ORL`;
    } else if (inputError) {
      withdrawEl.disabled = true;
      withdrawEl.textContent = inputErrorMsg;
    } else {
      withdrawEl.disabled = false;
      withdrawEl.textContent = `Withdraw to ${selectedName}`;
    }
  }

  // Fee calculations
  const fee = Math.floor(amt * feePctVal / 100);

  const feePctEl = $('feePct');
  if (feePctEl) feePctEl.textContent = feePctVal;

  const feeAmtEl = $('feeAmt');
  if (feeAmtEl) feeAmtEl.textContent = fmtInt(amt) + ' ORL';

  const feeValEl = $('feeVal');
  if (feeValEl) feeValEl.textContent = fmtInt(fee) + ' ORL';

  const feeNetEl = $('feeNet');
  if (feeNetEl) {
    if (selectedKey === 'usdt' && e2 && e2.ORL_PER_USD) {
      const usdVal = (amt - fee) / e2.ORL_PER_USD;
      feeNetEl.textContent = '$' + fmt(usdVal, 2) + ' USDT';
    } else {
      feeNetEl.textContent = naira(amt - fee);
    }
  }

  // Pro button state update
  const proBtnEl = $('proBtn');
  if (proBtnEl) {
    const stars = econ().PRO_PRICE_STARS || 250;
    if (isPro(S)) {
      proBtnEl.disabled = true;
      const daysLeft = Math.max(0, Math.ceil((S.proUntil - now()) / 86400000));
      proBtnEl.innerHTML = `Pro active · ${daysLeft}d left`;
      proBtnEl.style.opacity = '0.7';
    } else {
      proBtnEl.disabled = false;
      proBtnEl.innerHTML = `
        <svg class="stars-ico" viewBox="0 0 24 24" fill="#1c1109"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7L12 2z"/></svg>
        Go Pro · ${stars} Telegram Stars / mo
      `;
      proBtnEl.style.opacity = '1';
    }
  }

  // Pro free chest button
  const proChestBtnEl = $('proChestBtn');
  if (proChestBtnEl) {
    if (isPro(S)) {
      proChestBtnEl.style.display = '';
      proChestBtnEl.disabled = !S.proChestReady;
      proChestBtnEl.textContent = S.proChestReady ? 'Claim free daily chest' : 'Chest claimed · come back tomorrow';
    } else {
      proChestBtnEl.style.display = 'none';
    }
  }

  // Spin / scratch / chest / lotto display
  const spinTagEl = $('spinTag');
  if (spinTagEl) spinTagEl.textContent = 'Unlimited · 1 ad';

  const spinBtnEl = $('spinBtn');
  if (spinBtnEl) spinBtnEl.textContent = 'Spin the wheel';

  const scratchTagEl = $('scratchTag');
  if (scratchTagEl) scratchTagEl.textContent = 'Unlimited';

  const cGoal = chestGoal();
  const chestBarEl = $('chestBar');
  if (chestBarEl && cGoal > 0) chestBarEl.style.width = ((S.chestProgress || 0) / cGoal * 100) + '%';

  const chestCapEl = $('chestCap');
  if (chestCapEl && cGoal > 0) chestCapEl.textContent = `${S.chestProgress || 0} / ${cGoal} ads watched`;

  const lottoMineEl = $('lottoMine');
  if (lottoMineEl) lottoMineEl.textContent = S.lottoTickets || 0;

  const lottoPoolEl = $('lottoPool');
  if (lottoPoolEl) lottoPoolEl.textContent = fmtInt(S.lottoPool || 0) + ' ORL';

  const lottoPlayersEl = $('lottoPlayers');
  if (lottoPlayersEl) lottoPlayersEl.textContent = fmtInt(S.lottoPlayers || 0);

  // Referrals
  const refCountEl = $('refCount');
  if (refCountEl) refCountEl.textContent = S.ref?.count || 0;

  const refEarnedEl = $('refEarned');
  if (refEarnedEl) refEarnedEl.textContent = fmtInt(S.ref?.earned || 0);

  const refActiveEl = $('refActive');
  if (refActiveEl) refActiveEl.textContent = S.ref?.active || 0;

  const refCodeEl = $('refCode');
  if (refCodeEl && S.refCode) {
    refCodeEl.textContent = `https://t.me/Orael_bot?start=${S.refCode}`;
  }

  // Daily Ad Challenge
  const acCountEl = $('acCount');
  if (acCountEl) acCountEl.textContent = S.adChallenge?.count || 0;

  const acMilestonesEl = $('acMilestones');
  if (acMilestonesEl && S.adChallenge) {
    const milestones = S.adChallenge.milestones || [];
    acMilestonesEl.innerHTML = milestones.map(m => {
      const cls = m.claimed ? 'claimed' : '';
      return `<div class="ac-milestone ${cls}">
        <div class="ac-m-ads">${m.ads} ads</div>
        <div class="ac-m-bonus">+${m.bonus} ORL</div>
        <div class="ac-m-status">${m.claimed ? '✓ Claimed' : 'Locked'}</div>
      </div>`;
    }).join('');
  }

  // Profile overlay fields (avatar, name, tier, pro status)
  renderProfile(S);
}

/* ========================================================================
   PROFILE OVERLAY RENDER
   ======================================================================== */
function renderProfile(S) {
  const veil = $('profileVeil');
  if (!veil) return;

  // Big avatar
  const bigAv = $('profileAvatar');
  if (bigAv) {
    const avUrl = S.avatarUrl || S.photoUrl || null;
    const initial = (S.firstName || 'A')[0]?.toUpperCase() || 'A';
    if (avUrl && avUrl !== bigAv.dataset.src) {
      bigAv.innerHTML = `<img src="${avUrl}" alt="avatar" onerror="this.parentElement.textContent='${initial}'" />`;
      bigAv.dataset.src = avUrl;
    } else if (!avUrl && bigAv.dataset.src !== 'initial') {
      bigAv.textContent = initial;
      bigAv.dataset.src = 'initial';
    }
  }

  const nameEl = $('profileName');
  if (nameEl) nameEl.textContent = S.firstName ? `${S.firstName} ${S.lastName || ''}`.trim() : 'Orael Miner';

  const userEl = $('profileUsername');
  if (userEl) userEl.textContent = S.username ? '@' + S.username : '';

  const tierEl = $('profileTier');
  if (tierEl) tierEl.textContent = `Tier ${S.tier || 1}`;

  const proBadgeEl = $('profileProBadge');
  if (proBadgeEl) {
    if (isPro(S)) {
      const days = Math.max(0, Math.ceil((S.proUntil - now()) / 86400000));
      proBadgeEl.style.display = '';
      proBadgeEl.textContent = `PRO · ${days}d left`;
    } else {
      proBadgeEl.style.display = 'none';
    }
  }
}
