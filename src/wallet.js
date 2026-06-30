import { api } from './api.js';
import { getState, updateState, setLocal } from './state.js';
import { $, render, toast, reward, fmtInt, fmt, naira } from './ui.js';
import { haptic } from './telegram.js';
import { launchConfetti } from './animations.js';

let historyPage = 1;
let historyTotalPages = 1;

// Bank selection state
let banksCache = null;
let selectedBank = null;
let resolvedAccountName = null;
let savedBankAccounts = [];  // ← fix: was implicit global, caused TypeError crash

export function isBankVerified() {
  const savedSelect = $('savedBankSelect');
  if (savedSelect && savedSelect.value) {
    return true;
  }
  return getState()._resolvedAccountName !== undefined && getState()._resolvedAccountName !== null;
}

export function setupWallet() {
  const withdrawBtn = $('withdrawBtn');

  // Load paginated transaction history
  loadHistory(1);

  // Load saved bank accounts on init
  loadSavedBankAccounts();

  // Method selection is now handled dynamically by renderMethodGrid() in ui.js
  // which reads from state.economy.WITHDRAWAL_METHODS (server config).
  // No hardcoded method initialization needed here.

  // 2. Withdrawal action
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', handleWithdraw);
  }

  const amtInput = $('withdrawAmountInput');
  amtInput?.addEventListener('input', () => {
    render();
  });

  const unitToggle = $('withdrawUnitToggle');
  unitToggle?.addEventListener('click', () => {
    haptic('light');
    const S = getState();
    const currentUnit = S._withdrawUnit || 'orl';
    const nextUnit = currentUnit === 'orl' ? 'ngn' : 'orl';
    setLocal('_withdrawUnit', nextUnit);
    const amtInputEl = $('withdrawAmountInput');
    if (amtInputEl) amtInputEl.value = '';
    render();
  });

  // Pro subscription + Pro chest are now wired in profile.js (relocated to the
  // Profile overlay — tap your avatar to access them).

  // 3. Wire up bank-selection UI handlers
  setupBankSelectionUI();
  setupBankModal();
  setupTxDetailsModal();

  // 4. Promo code redemption handler
  setupPromoCodeRedemption();

  // 5. Reload transaction history when switching to wallet screen
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('.nav-btn');
    if (navBtn && navBtn.dataset.screen === 'wallet') {
      loadHistory(1);
    }
  });
}

/* ─── Update wallet info section based on selected method ─── */

function updateWalletInfoSection() {
  const S = getState();
  const methodKey = S._selectedMethod?.id;
  if (!methodKey) return;

  const walletInfoBox = $('walletInfoBox');
  if (!walletInfoBox) return;

  if (methodKey === 'bank') {
    renderBankSelectionUI(walletInfoBox);
  } else if (methodKey === 'usdt') {
    walletInfoBox.style.display = '';
    walletInfoBox.innerHTML = `
      <div class="fee-row"><span>USDT TRC20 wallet address</span></div>
      <input type="text" id="walletInfoInput" placeholder="TXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-top:6px" />
    `;
  } else if (methodKey === 'airtime') {
    walletInfoBox.style.display = '';
    walletInfoBox.innerHTML = `
      <div class="fee-row"><span>Phone number (Nigeria)</span></div>
      <input type="tel" id="phoneNumberInput" placeholder="08012345678" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-top:6px" />
    `;
  } else {
    walletInfoBox.style.display = 'none';
  }
}

/* ─── Render bank-selection UI ─── */

function renderBankSelectionUI(container) {
  container.style.display = '';

  const savedOptions = savedBankAccounts.length > 0
    ? savedBankAccounts.map(a => `<option value="${a.id}">${a.bank_name} • ${a.account_number} (${a.account_name})</option>`).join('')
    : '';

  container.innerHTML = `
    <div class="fee-row" style="margin-bottom:8px">
      <span>Saved bank account</span>
    </div>
    <select id="savedBankSelect" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-bottom:12px">
      <option value="">— Use new account —</option>
      ${savedOptions}
    </select>

    <div id="newBankFields" style="display:none">
      <div class="fee-row" style="margin-bottom:8px;margin-top:12px">
        <span>Select bank</span>
      </div>
      
      <div id="bankSelectTrigger" class="custom-select-trigger" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:8px">
          <div id="selectedBankIcon" style="width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,0.06);display:none;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:var(--gold-1);overflow:hidden;flex-shrink:0;"></div>
          <span id="selectedBankText">— Select bank —</span>
        </div>
        <svg viewBox="0 0 24 24" fill="none" style="width:16px;height:16px;stroke:var(--ink-soft);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;transition:transform 0.2s;"><path d="M6 9l6 6 6-6"/></svg>
      </div>

      <div class="fee-row" style="margin-bottom:8px">
        <span>Account number (10 digits)</span>
      </div>
      <input type="text" id="accountNumberInput" placeholder="0123456789" maxlength="10" inputmode="numeric" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-bottom:12px" />

      <button class="btn btn-ghost" id="resolveAccountBtn" style="margin-bottom:12px">Verify account name</button>

      <div class="fee-row" style="margin-bottom:8px">
        <span>Account name (auto-filled)</span>
      </div>
      <input type="text" id="accountNameInput" placeholder="Will appear after verification" disabled style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-2);color:var(--gold-1);font-size:13px;margin-bottom:12px;font-weight:600" />
    </div>
  `;

  // Wire up events
  const savedSelect = $('savedBankSelect');
  const newFields = $('newBankFields');
  if (savedSelect && newFields) {
    newFields.style.display = savedSelect.value ? 'none' : 'block';
  }
  savedSelect?.addEventListener('change', () => {
    newFields.style.display = savedSelect.value ? 'none' : 'block';
    haptic('light');
  });

  const trigger = $('bankSelectTrigger');
  trigger?.addEventListener('click', () => {
    haptic('light');
    const modalVeil = $('bankModalVeil');
    if (modalVeil) modalVeil.classList.add('show');
    const searchInput = $('bankModalSearchInput');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    renderBankModalList('');
  });

  const acctInput = $('accountNumberInput');
  acctInput?.addEventListener('input', () => {
    acctInput.value = acctInput.value.replace(/\D/g, '').slice(0, 10);
    resolvedAccountName = null;
    setLocal('_resolvedAccountName', null);
    const nameInput = $('accountNameInput');
    if (nameInput) nameInput.value = '';
  });

  $('resolveAccountBtn')?.addEventListener('click', handleResolveAccount);

  // Load banks
  loadBanks();
}

/* ─── Load banks from Flutterwave ─── */

async function loadBanks() {
  const trigger = $('bankSelectTrigger');
  if (!trigger) return;

  try {
    trigger.classList.add('loading');
    const textEl = $('selectedBankText');
    if (textEl) textEl.textContent = 'Loading banks...';

    if (!banksCache) {
      const res = await api('/api/wallet/banks');
      banksCache = sortBanks(res.banks || []);
    }

    trigger.classList.remove('loading');
    updateSelectedBankUI();
  } catch (e) {
    trigger.classList.remove('loading');
    const textEl = $('selectedBankText');
    if (textEl) textEl.textContent = 'Failed to load banks';
  }
}

/* ─── Custom Modal Bank Selection list ─── */

function setupBankModal() {
  const veil = $('bankModalVeil');
  const closeBtn = $('bankModalClose');
  const searchInput = $('bankModalSearchInput');

  closeBtn?.addEventListener('click', () => {
    veil?.classList.remove('show');
    haptic('light');
  });

  veil?.addEventListener('click', (e) => {
    if (e.target === veil) {
      veil.classList.remove('show');
      haptic('light');
    }
  });

  searchInput?.addEventListener('input', () => {
    renderBankModalList(searchInput.value);
  });
}

function renderBankModalList(filter = '') {
  const listEl = $('bankModalList');
  if (!listEl) return;

  if (!banksCache || banksCache.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);font-size:13px">Loading banks...</div>`;
    return;
  }

  const filtered = filter
    ? banksCache.filter(b => b.name.toLowerCase().includes(filter.toLowerCase()))
    : banksCache;

  if (filtered.length === 0) {
    listEl.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);font-size:13px">No banks found.</div>`;
    return;
  }

  listEl.innerHTML = filtered.map(b => {
    const initials = getInitials(b.name);
    return `
      <div class="bank-item" data-code="${b.code}">
        <div style="position:relative; width:28px; height:28px; border-radius:50%; overflow:hidden; background:rgba(255,255,255,0.04); flex-shrink:0; display:flex; align-items:center; justify-content:center;">
          <img src="${getBankLogoUrl(b.code, b.name)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
          <div style="width:100%; height:100%; display:none; align-items:center; justify-content:center; font-size:10px; font-weight:700; color:var(--gold-1); background:rgba(255,255,255,0.06); text-transform:uppercase;">${initials}</div>
        </div>
        <span style="font-size:13.5px;font-weight:500;color:var(--ink);">${b.name}</span>
      </div>
    `;
  }).join('');

  // Attach click events
  listEl.querySelectorAll('.bank-item').forEach(item => {
    item.addEventListener('click', () => {
      const code = item.dataset.code;
      selectedBank = banksCache.find(b => b.code === code) || null;
      haptic('light');
      updateSelectedBankUI();
      
      // Reset account verification state
      resolvedAccountName = null;
      setLocal('_resolvedAccountName', null);
      const nameInput = $('accountNameInput');
      if (nameInput) nameInput.value = '';

      // Close modal
      $('bankModalVeil')?.classList.remove('show');
    });
  });
}

function updateSelectedBankUI() {
  const textEl = $('selectedBankText');
  const iconEl = $('selectedBankIcon');
  if (!textEl || !iconEl) return;

  if (selectedBank) {
    textEl.textContent = selectedBank.name;
    iconEl.style.display = 'flex';
    
    const initials = getInitials(selectedBank.name);
    iconEl.innerHTML = `
      <img src="${getBankLogoUrl(selectedBank.code, selectedBank.name)}" style="width:100%; height:100%; object-fit:cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
      <div style="width:100%; height:100%; display:none; align-items:center; justify-content:center; background:rgba(255,255,255,0.06); font-size:8px; font-weight:700; color:var(--gold-1);">${initials}</div>
    `;
  } else {
    textEl.textContent = '— Select bank —';
    iconEl.style.display = 'none';
    iconEl.innerHTML = '';
  }
}

function getInitials(name) {
  if (!name) return '';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getBankLogoUrl(code, name) {
  if (!name) return '';
  const cleanName = name.toLowerCase();
  
  // Direct mappings for major Nigerian banks & fintechs
  if (code === '044' || cleanName.includes('access bank')) {
    if (cleanName.includes('diamond')) return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/access-bank-diamond.png';
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/access-bank.png';
  }
  if (code === '058' || cleanName.includes('gtbank') || cleanName.includes('guaranty trust')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/guaranty-trust-bank.png';
  }
  if (code === '033' || cleanName.includes('uba') || cleanName.includes('united bank for africa')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/united-bank-for-africa.png';
  }
  if (code === '057' || cleanName.includes('zenith')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/zenith-bank.png';
  }
  if (code === '011' || cleanName.includes('first bank')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/first-bank-of-nigeria.png';
  }
  if (code === '090267' || code === '50211' || cleanName.includes('kuda')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/kuda-bank.png';
  }
  if (code === '100004' || code === '999992' || code === '305' || cleanName.includes('opay') || cleanName.includes('paycom')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/paycom.png';
  }
  if (code === '100033' || code === '999991' || cleanName.includes('palmpay')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/palmpay.png';
  }
  if (code === '090405' || code === '50515' || cleanName.includes('moniepoint')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/moniepoint-mfb-ng.png';
  }
  if (code === '232' || cleanName.includes('sterling')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/sterling-bank.png';
  }
  if (code === '035' || cleanName.includes('wema')) {
    if (cleanName.includes('alat')) return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/alat-by-wema.png';
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/wema-bank.png';
  }
  if (code === '070' || cleanName.includes('fidelity')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/fidelity-bank.png';
  }
  if (code === '032' || cleanName.includes('union bank')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/union-bank-of-nigeria.png';
  }
  if (code === '050' || cleanName.includes('ecobank')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/ecobank-nigeria.png';
  }
  if (code === '076' || cleanName.includes('polaris')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/polaris-bank.png';
  }
  if (code === '221' || cleanName.includes('stanbic')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/stanbic-ibtc-bank.png';
  }
  if (code === '068' || cleanName.includes('standard chartered')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/standard-chartered-bank.png';
  }
  if (code === '215' || cleanName.includes('unity')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/unity-bank.png';
  }
  if (code === '100' || cleanName.includes('suntrust')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/suntrust-bank.png';
  }
  if (code === '101' || cleanName.includes('providus')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/providus-bank.png';
  }
  if (code === '301' || cleanName.includes('jaiz')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/jaiz-bank.png';
  }
  if (code === '082' || cleanName.includes('keystone')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/keystone-bank.png';
  }
  if (code === '214' || cleanName.includes('fcmb') || cleanName.includes('first city monument')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/first-city-monument-bank.png';
  }
  if (code === '102' || cleanName.includes('globus')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/globus-bank.png';
  }
  if (code === '303' || cleanName.includes('lotus')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/lotus-bank.png';
  }
  if (code === '302' || cleanName.includes('taj')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/taj-bank.png';
  }
  if (code === '030' || cleanName.includes('heritage')) {
    return 'https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/heritage-bank.png';
  }

  // Fallback: slugify name
  const slug = cleanName
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `https://cdn.jsdelivr.net/gh/ridbay/nigerian-banks@master/src/logos/${slug}.png`;
}

function sortBanks(banks) {
  const popularKeywords = [
    'opay',
    'palmpay',
    'moniepoint',
    'kuda',
    'access bank',
    'gtbank',
    'guaranty trust',
    'zenith',
    'united bank for africa',
    'uba',
    'first bank',
    'fcmb',
    'sterling',
    'wema',
    'fidelity',
    'union bank',
    'ecobank',
    'stanbic'
  ];

  return [...banks].sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    let aIndex = popularKeywords.findIndex(kw => aName.includes(kw));
    let bIndex = popularKeywords.findIndex(kw => bName.includes(kw));

    if (aIndex === -1) aIndex = 999;
    if (bIndex === -1) bIndex = 999;

    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }

    return a.name.localeCompare(b.name);
  });
}

/* ─── Resolve account name ─── */

async function handleResolveAccount() {
  const acctInput = $('accountNumberInput');
  const nameInput = $('accountNameInput');
  const resolveBtn = $('resolveAccountBtn');

  if (!selectedBank || !acctInput?.value) {
    toast({ title: 'Select bank + account', message: 'Pick a bank and enter your 10-digit account number', variant: 'error' });
    return;
  }

  if (acctInput.value.length !== 10) {
    toast({ title: 'Invalid account', message: 'Account number must be 10 digits', variant: 'error' });
    return;
  }

  resolveBtn.disabled = true;
  resolveBtn.textContent = 'Verifying...';
  nameInput.value = '';

  try {
    const res = await api('/api/wallet/resolve-account', {
      method: 'POST',
      body: {
        account_number: acctInput.value,
        account_bank: selectedBank.code,
      }
    });

    resolvedAccountName = res.account_name;
    setLocal('_resolvedAccountName', res.account_name);
    nameInput.value = res.account_name;
    haptic('success');
    toast({ title: 'Account verified', message: res.account_name, variant: 'success' });
  } catch (e) {
    resolvedAccountName = null;
    setLocal('_resolvedAccountName', null);
    toast({ title: 'Verification failed', message: e.message || 'Could not verify account', variant: 'error' });
  } finally {
    resolveBtn.disabled = false;
    resolveBtn.textContent = 'Verify account name';
  }
}

/* ─── Load saved bank accounts ─── */

async function loadSavedBankAccounts() {
  try {
    const res = await api('/api/wallet/bank-accounts');
    savedBankAccounts = res.accounts || [];
    // Re-render bank UI if it's currently showing
    const walletInfoBox = $('walletInfoBox');
    if (walletInfoBox && walletInfoBox.style.display !== 'none') {
      updateWalletInfoSection();
    }
  } catch (e) {
    // Silent — user may not have any saved accounts yet
  }
}

/* ─── Prompt user for withdrawal PIN ─── */

function promptPIN(mode, body) {
  const veil = $('pinModalVeil');
  const title = $('pinModalTitle');
  const desc = $('pinModalDesc');
  const pinInput = $('pinInput');
  const confirmGroup = $('pinConfirmGroup');
  const confirmInput = $('pinConfirmInput');
  const cancelBtn = $('pinModalCancel');
  const proceedBtn = $('pinModalProceed');

  if (!veil || !title || !desc || !pinInput || !confirmGroup || !confirmInput || !cancelBtn || !proceedBtn) return;

  // Clone nodes to purge old event listeners
  const newPinInput = pinInput.cloneNode(true);
  const newConfirmInput = confirmInput.cloneNode(true);
  pinInput.parentNode.replaceChild(newPinInput, pinInput);
  confirmInput.parentNode.replaceChild(newConfirmInput, confirmInput);

  newPinInput.value = '';
  newConfirmInput.value = '';

  const onPinInput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  };
  newPinInput.addEventListener('input', onPinInput);
  newConfirmInput.addEventListener('input', onPinInput);

  if (mode === 'set') {
    title.textContent = 'Set Withdrawal PIN';
    desc.textContent = 'Create a secure 4-digit PIN to authorize withdrawals. Keep this safe!';
    confirmGroup.style.display = 'block';
    proceedBtn.textContent = 'Save PIN';
  } else {
    title.textContent = 'Enter Withdrawal PIN';
    desc.textContent = 'Enter your 4-digit PIN to proceed with the withdrawal.';
    confirmGroup.style.display = 'none';
    proceedBtn.textContent = 'Proceed';
  }

  const closePIN = () => {
    veil.classList.remove('show');
  };

  const newCancel = cancelBtn.cloneNode(true);
  const newProceed = proceedBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  proceedBtn.parentNode.replaceChild(newProceed, proceedBtn);

  newCancel.addEventListener('click', () => {
    haptic('light');
    closePIN();
  });

  const handleProceed = async () => {
    const pin = newPinInput.value;
    if (!/^\d{4}$/.test(pin)) {
      toast({ title: 'Invalid PIN', message: 'PIN must be exactly 4 digits', variant: 'error' });
      return;
    }

    if (mode === 'set') {
      const confirmPin = newConfirmInput.value;
      if (pin !== confirmPin) {
        toast({ title: 'Mismatch', message: 'PINs do not match', variant: 'error' });
        return;
      }

      newProceed.disabled = true;
      newProceed.textContent = 'Saving...';
      try {
        const res = await api('/api/wallet/set-pin', {
          method: 'POST',
          body: { pin }
        });
        
        if (res.success) {
          toast({ title: 'Success', message: 'Withdrawal PIN set successfully', variant: 'success' });
          haptic('success');
          // Update local state
          const S = getState();
          S.hasPin = true;
          updateState(S);
          
          // Switch to verify mode
          closePIN();
          setTimeout(() => {
            promptPIN('verify', body);
          }, 300);
        } else {
          toast({ title: 'Error', message: res.message || 'Failed to set PIN', variant: 'error' });
        }
      } catch (err) {
        toast({ title: 'Error', message: err.message || 'Failed to set PIN', variant: 'error' });
      } finally {
        newProceed.disabled = false;
        newProceed.textContent = 'Save PIN';
      }
    } else {
      haptic('medium');
      closePIN();
      body.pin = pin;
      executeWithdrawalAPI(body);
    }
  };

  newProceed.addEventListener('click', handleProceed);
  newPinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleProceed();
  });
  newConfirmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleProceed();
  });

  veil.classList.add('show');
  setTimeout(() => newPinInput.focus(), 200);
}

/* ─── Execute withdrawal API ─── */

async function executeWithdrawalAPI(body) {
  const S = getState();
  const withdrawBtn = $('withdrawBtn');
  if (withdrawBtn) {
    withdrawBtn.disabled = true;
    withdrawBtn.textContent = 'Processing...';
  }

  try {
    const res = await api('/api/wallet/withdraw', {
      method: 'POST',
      body
    });

    if (res.success) {
      updateState(res.user || res);

      const amtInput = $('withdrawAmountInput');
      if (amtInput) amtInput.value = '';

      render();

      // Show professional withdrawal confirmation with the actual amount
      const S = getState();
      const e = S.economy || {};
      const methodLabel = S._selectedMethod?.name || 'your account';
      if (res.needsApproval) {
        reward(null, 'Withdrawal Submitted', `Your withdrawal is waiting for admin approval. You'll be notified once it's processed.`);
      } else {
        reward(null, 'Withdrawal Successful', `${res.message || 'Your payout is being processed.'} Funds will arrive in your ${methodLabel} within 24 hours.`);
      }

      launchConfetti(20);
      loadSavedBankAccounts();
      loadHistory(1);
    } else {
      toast({ title: 'Withdrawal failed', message: res.message || '', variant: 'error' });
    }
  } catch (e) {
    // api() already toasted
    if (e.message === 'Incorrect PIN') {
      setTimeout(() => {
        promptPIN('verify', body);
      }, 500);
    }
  } finally {
    if (withdrawBtn) {
      withdrawBtn.disabled = false;
      render();
    }
  }
}

async function handleWithdraw() {
  const S = getState();
  const methods = S.economy?.WITHDRAWAL_METHODS || {};
  const methodKey = S._selectedMethod?.id;

  if (!methodKey || !methods[methodKey]) {
    toast({ title: 'Select method', message: 'Pick a payout method first', variant: 'error' });
    return;
  }

  // Read minimum LIVE from server config — no fallback
  const minRequired = methods[methodKey].minOrl;
  if (S.balance < minRequired) {
    toast({ title: 'Insufficient balance', message: `Minimum is ${minRequired} ORL`, variant: 'error' });
    return;
  }

  const amtInput = $('withdrawAmountInput');
  const unit = S._withdrawUnit || 'orl';
  const showToggle = (methodKey === 'bank' || methodKey === 'airtime');
  
  let withdrawAmt = Math.floor(S.balance);
  if (amtInput && amtInput.value.trim() !== '') {
    if (showToggle && unit === 'ngn') {
      const ngnVal = parseFloat(amtInput.value);
      if (isNaN(ngnVal) || ngnVal <= 0) {
        toast({ title: 'Invalid amount', message: 'Enter a valid amount', variant: 'error' });
        return;
      }
      withdrawAmt = Math.round(ngnVal / S.economy.ORL_TO_NGN);
    } else {
      const parsed = parseInt(amtInput.value);
      if (isNaN(parsed) || parsed < minRequired) {
        toast({ title: 'Amount too low', message: `Minimum is ${minRequired} ORL`, variant: 'error' });
        return;
      }
      withdrawAmt = parsed;
    }
  }

  if (withdrawAmt > S.balance) {
    toast({ title: 'Amount too high', message: `Maximum is ${Math.floor(S.balance)} ORL`, variant: 'error' });
    return;
  }
  if (withdrawAmt < minRequired) {
    toast({ title: 'Amount too low', message: `Minimum is ${minRequired} ORL`, variant: 'error' });
    return;
  }

  let body = { method: methodKey, amount: withdrawAmt };
  const isPro = Date.now() < (S.proUntil || 0);
  const feePct = isPro ? S.economy.WITHDRAWAL_FEE_PRO_PCT : S.economy.WITHDRAWAL_FEE_PCT;
  const feeOrl = Math.floor(withdrawAmt * feePct);
  const netOrl = withdrawAmt - feeOrl;
  const netNgn = Math.round(netOrl * S.economy.ORL_TO_NGN);

  let detailsHtml = '';

  if (methodKey === 'bank') {
    let destText = '';
    const savedSelect = $('savedBankSelect');
    if (savedSelect?.value) {
      const bankAccount = savedBankAccounts.find(a => a.id === parseInt(savedSelect.value));
      if (!bankAccount) {
        toast({ title: 'Select account', message: 'Saved bank account not found', variant: 'error' });
        return;
      }
      body.bankAccountId = bankAccount.id;
      destText = `
        <div><b>Bank:</b> ${bankAccount.bank_name}</div>
        <div><b>Account Number:</b> ${bankAccount.account_number}</div>
        <div><b>Account Name:</b> ${bankAccount.account_name}</div>
      `;
    } else {
      if (!selectedBank || !resolvedAccountName) {
        toast({ title: 'Verify account', message: 'Click "Verify account name" first', variant: 'error' });
        return;
      }
      const acctInput = $('accountNumberInput');
      body.walletInfo = `${selectedBank.code}|${acctInput.value}|${resolvedAccountName}|${selectedBank.name}`;
      destText = `
        <div><b>Bank:</b> ${selectedBank.name}</div>
        <div><b>Account Number:</b> ${acctInput.value}</div>
        <div><b>Account Name:</b> ${resolvedAccountName}</div>
      `;
    }
    detailsHtml = `
      <div style="font-weight:700;margin-bottom:8px;color:var(--cu-1);">BANK TRANSFER (NGN)</div>
      ${destText}
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0;" />
      <div><b>Withdrawal Amount:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div><b>Fee (${Math.round(feePct * 100)}%):</b> ${fmtInt(feeOrl)} ORL</div>
      <div><b>Total Deduction:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div style="font-size:14px;margin-top:6px;color:var(--cu-1);"><b>You Receive: ₦${fmt(netNgn, 2)}</b></div>
    `;
  } else if (methodKey === 'airtime') {
    const phoneInput = $('phoneNumberInput');
    const phone = phoneInput?.value?.trim();
    if (!phone) {
      toast({ title: 'Phone required', message: 'Enter phone number', variant: 'error' });
      return;
    }
    body.phoneNumber = phone;
    detailsHtml = `
      <div style="font-weight:700;margin-bottom:8px;color:var(--cu-1);">AIRTIME RECHARGE</div>
      <div><b>Phone Number:</b> ${phone}</div>
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0;" />
      <div><b>Withdrawal Amount:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div><b>Fee (${Math.round(feePct * 100)}%):</b> ${fmtInt(feeOrl)} ORL</div>
      <div><b>Total Deduction:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div style="font-size:14px;margin-top:6px;color:var(--cu-1);"><b>You Receive: ₦${fmt(netNgn, 0)} Airtime</b></div>
    `;
  } else if (methodKey === 'usdt') {
    const walletInput = $('walletInfoInput');
    const address = walletInput?.value?.trim();
    if (!address) {
      toast({ title: 'Address required', message: 'Enter USDT TRC20 address', variant: 'error' });
      return;
    }
    body.walletInfo = address;
    const netUsd = netOrl / S.economy.ORL_PER_USD;
    detailsHtml = `
      <div style="font-weight:700;margin-bottom:8px;color:var(--cu-1);">USDT TRC20 TRANSFER</div>
      <div style="word-break:break-all;"><b>Address:</b> ${address}</div>
      <hr style="border:0;border-top:1px solid var(--line);margin:10px 0;" />
      <div><b>Withdrawal Amount:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div><b>Fee (${Math.round(feePct * 100)}%):</b> ${fmtInt(feeOrl)} ORL</div>
      <div><b>Total Deduction:</b> ${fmtInt(withdrawAmt)} ORL</div>
      <div style="font-size:14px;margin-top:6px;color:var(--cu-1);"><b>You Receive: $${fmt(netUsd, 2)} USDT</b></div>
    `;
  }

  const veil = $('withdrawConfirmVeil');
  const cancelBtn = $('withdrawConfirmCancel');
  const proceedBtn = $('withdrawConfirmProceed');
  const detailsEl = $('withdrawConfirmDetails');

  if (!veil || !cancelBtn || !proceedBtn || !detailsEl) return;

  detailsEl.innerHTML = detailsHtml;

  const closeConfirm = () => {
    veil.classList.remove('show');
  };

  const newCancel = cancelBtn.cloneNode(true);
  const newProceed = proceedBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  proceedBtn.parentNode.replaceChild(newProceed, proceedBtn);

  newCancel.addEventListener('click', () => {
    haptic('light');
    closeConfirm();
  });

  newProceed.addEventListener('click', () => {
    haptic('medium');
    closeConfirm();
    if (S.hasPin) {
      promptPIN('verify', body);
    } else {
      promptPIN('set', body);
    }
  });

  veil.classList.add('show');
}

/* ─── Load paginated transaction history ─── */

async function loadHistory(page) {
  try {
    const data = await api(`/api/user/transactions?page=${page}&limit=15`);
    historyPage = data.pagination.page;
    historyTotalPages = data.pagination.totalPages;

    const el = $('historyList');
    if (!el) return;

    if (!data.transactions.length) {
      el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);font-size:13px">No transactions yet.</div>`;
      return;
    }

    const icoIn = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14m0 0 5-5m-5 5-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const icoOut = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5m0 0 5 5m-5-5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    el.innerHTML = data.transactions.map((h, index) => {
      const isNeg = h.amount < 0;
      const amt = (h.amount >= 0 ? '+' : '') + fmtInt(h.amount);

      let statusHtml = '';
      if (h.type === 'withdraw' || h.withdrawal_status) {
        const status = h.withdrawal_status || 'pending';
        let badgeClass = 'pending';
        let badgeText = 'Processing';
        if (status === 'completed') {
          badgeClass = 'completed';
          badgeText = 'Success';
        } else if (status === 'failed' || status === 'rejected') {
          badgeClass = 'failed';
          badgeText = 'Failed';
        } else if (status === 'needs_approval') {
          badgeClass = 'approval';
          badgeText = 'Awaiting Approval';
        }
        statusHtml = `<span class="tx-badge ${badgeClass}">${badgeText}</span>`;
      }

      return `<div class="item tx-item" data-index="${index}">
        <div class="item-ic">${isNeg ? icoOut : icoIn}</div>
        <div class="item-body">
          <div class="item-title">
            ${h.description || h.type}
          </div>
          <div class="item-sub">${new Date(h.created_at).toLocaleString()}</div>
        </div>
        <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; justify-content: center; gap: 4px; flex-shrink: 0;">
          <div class="item-reward ${isNeg ? 'neg' : 'pos'}" style="margin: 0;">${amt}</div>
          ${statusHtml}
        </div>
      </div>`;
    }).join('');

    const txItems = el.querySelectorAll('.tx-item');
    txItems.forEach(item => {
      item.addEventListener('click', () => {
        try {
          haptic('light');
          const idx = parseInt(item.dataset.index);
          const tx = data.transactions[idx];
          if (!tx) {
            toast({ title: 'Error', message: 'Transaction not found', variant: 'error' });
            return;
          }
          showTransactionDetails(tx);
        } catch (err) {
          toast({ title: 'Error', message: 'Failed to load details', variant: 'error' });
        }
      });
    });

    if (historyTotalPages > 1) {
      el.innerHTML += `
        <div class="pagination">
          <button class="pg-btn" id="pgPrev" ${historyPage <= 1 ? 'disabled' : ''}>← Prev</button>
          <span class="pg-info">${historyPage} / ${historyTotalPages}</span>
          <button class="pg-btn" id="pgNext" ${historyPage >= historyTotalPages ? 'disabled' : ''}>Next →</button>
        </div>
      `;

      const pgPrev = $('pgPrev');
      const pgNext = $('pgNext');
      if (pgPrev) pgPrev.addEventListener('click', () => loadHistory(historyPage - 1));
      if (pgNext) pgNext.addEventListener('click', () => loadHistory(historyPage + 1));
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

function setupTxDetailsModal() {
  const veil = $('txDetailsVeil');
  const closeBtn = $('txDetailsClose');
  if (!veil || !closeBtn) return;

  closeBtn.addEventListener('click', () => {
    haptic('light');
    veil.classList.remove('show');
  });

  veil.addEventListener('click', (e) => {
    if (e.target === veil) {
      haptic('light');
      veil.classList.remove('show');
    }
  });
}

function showTransactionDetails(tx) {
  if (!tx) {
    toast({ title: 'Error', message: 'Transaction data missing', variant: 'error' });
    return;
  }
  const veil = $('txDetailsVeil');
  const content = $('txDetailsContent');
  if (!veil || !content) {
    toast({ title: 'Error', message: 'Modal not available', variant: 'error' });
    return;
  }

  const isNeg = tx.amount < 0;
  const typeText = tx.type.toUpperCase().replace(/_/g, ' ');
  const amountSign = isNeg ? '' : '+';
  const amountColor = isNeg ? 'var(--ink)' : 'var(--emerald)';

  // Copy button SVG
  const copyIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

  // Helper: build a field row (label on top, value below)
  const field = (label, valueHtml) => `
    <div class="tx-field">
      <span class="tx-field-label">${label}</span>
      <div class="tx-field-value">${valueHtml}</div>
    </div>
  `;

  // Helper: build a field with a copy button
  const fieldWithCopy = (label, value, copyValue, valueClass = 'id') => `
    <div class="tx-field">
      <span class="tx-field-label">${label}</span>
      <div class="tx-field-value ${valueClass}">
        <span>${value}</span>
        <button class="tx-copy-btn" data-copy="${copyValue}" aria-label="Copy ${label}">${copyIcon}</button>
      </div>
    </div>
  `;

  // Build detail fields — flat list, no separate "Withdrawal Tracking" section
  let html = fieldWithCopy('Transaction ID', `#${tx.id}`, tx.id, 'id');
  html += field('Type', typeText);
  html += field('Amount', `<span style="color:${amountColor};font-family:var(--font-mono);">${amountSign}${fmtInt(tx.amount)} ORL</span>`);
  html += field('Date', new Date(tx.created_at).toLocaleString());
  html += field('Description', tx.description || 'N/A');

  // For withdrawal transactions, show status + payout details inline
  // (no separate "Withdrawal Tracking" section — the Transaction ID is the
  // main reference; admins can search by it in the admin panel where the
  // Flutterwave reference is also visible)
  if (tx.type === 'withdraw' || tx.type === 'withdraw_completed' || tx.type === 'withdraw_refund' ||
      tx.withdrawal_status || tx.withdrawal_id) {

    const status = tx.withdrawal_status || 'pending';
    let statusText = 'Processing';
    let badgeClass = 'pending';
    if (status === 'completed') {
      statusText = 'Completed';
      badgeClass = 'completed';
    } else if (status === 'failed' || status === 'rejected') {
      statusText = 'Failed';
      badgeClass = 'failed';
    } else if (status === 'needs_approval') {
      statusText = 'Awaiting Approval';
      badgeClass = 'approval';
    }
    html += field('Status', `<span class="tx-status-badge ${badgeClass}">${statusText}</span>`);

    if (tx.net_fiat) {
      html += field('Net Payout', `<span style="color:var(--emerald);font-family:var(--font-mono);">${tx.net_fiat}</span>`);
    }
    if (tx.fee_orl !== undefined && tx.fee_orl !== null) {
      html += field('Processing Fee', `<span style="font-family:var(--font-mono);">${fmtInt(tx.fee_orl)} ORL</span>`);
    }
    if (tx.wallet_info) {
      const parts = tx.wallet_info.split('|');
      let destHtml;
      if (parts.length >= 4) {
        destHtml = `<div style="display:flex;flex-direction:column;gap:2px;">
          <div>${parts[3]}</div>
          <div style="font-family:var(--font-mono);font-size:12px;color:var(--ink-mute);">${parts[1]}</div>
          <div style="font-size:12px;color:var(--ink-mute);">${parts[2]}</div>
        </div>`;
      } else {
        destHtml = tx.wallet_info;
      }
      html += field('Payout Destination', destHtml);
    }

    if ((status === 'failed' || status === 'rejected') && tx.failure_reason) {
      html += `<div class="tx-failure-box"><b>Failure Reason:</b> ${tx.failure_reason}</div>`;
    }
  }

  content.innerHTML = html;

  // Bind copy events
  content.querySelectorAll('.tx-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      haptic('light');
      const text = btn.dataset.copy;
      navigator.clipboard.writeText(text).then(() => {
        toast({ title: 'Copied', message: 'Copied to clipboard', variant: 'success' });
      }).catch(() => {
        toast({ title: 'Error', message: 'Failed to copy', variant: 'error' });
      });
    });
  });

  // Scroll content to top on open
  content.scrollTop = 0;
  veil.classList.add('show');
}

function setupBankSelectionUI() {
  document.addEventListener('orael:method-change', updateWalletInfoSection);
  // Trigger once initially
  updateWalletInfoSection();
}

function setupPromoCodeRedemption() {
  const promoBtn = $('promoBtn');
  const promoInput = $('promoInput');
  if (!promoBtn || !promoInput) return;

  promoBtn.addEventListener('click', async () => {
    const code = promoInput.value.trim().toUpperCase();
    if (!code) {
      toast({ title: 'Enter a code', message: 'Please enter a promo code first', variant: 'error' });
      return;
    }

    promoBtn.disabled = true;
    promoBtn.textContent = 'Verifying...';

    try {
      const res = await api('/api/user/redeem-promo', {
        method: 'POST',
        body: { code }
      });

      updateState(res.user || res);
      render();
      // Show reward only if there's an actual amount, otherwise just show a success message
      if (res.reward && res.reward > 0) {
        reward(res.reward, 'Promo Redeemed!', res.message || 'Reward added to your balance.');
      } else {
        reward(null, 'Promo Redeemed!', res.message || 'Promo code applied successfully.');
      }
      launchConfetti(30);
      promoInput.value = '';
      // Reload history to show the promo transaction
      loadHistory(1);
    } catch (e) {
      // API request failures are handled or throw an error
      toast({ title: 'Redemption failed', message: e.message || 'Invalid or expired code', variant: 'error' });
    } finally {
      promoBtn.disabled = false;
      promoBtn.textContent = 'Redeem';
    }
  });
}
