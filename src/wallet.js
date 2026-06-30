import { api } from './api.js';
import { getState, updateState, setLocal } from './state.js';
import { $, render, toast, reward, fmtInt, fmt } from './ui.js';
import { haptic } from './telegram.js';
import { launchConfetti } from './animations.js';

let historyPage = 1;
let historyTotalPages = 1;

// Bank selection state
let banksCache = null;
let selectedBank = null;
let resolvedAccountName = null;
let savedBankAccounts = [];

export function setupWallet() {
  const withdrawBtn = $('withdrawBtn');
  const methods     = document.querySelectorAll('.method');

  // Load paginated transaction history
  loadHistory(1);

  // Load saved bank accounts on init
  loadSavedBankAccounts();

  // 1. Withdrawal method selection
  if (methods.length > 0) {
    methods.forEach(m => {
      m.addEventListener('click', () => {
        haptic('light');
        methods.forEach(x => x.classList.remove('sel'));
        m.classList.add('sel');

        const S = getState();
        S._selectedMethod = {
          id: m.dataset.key || m.dataset.name.toLowerCase(),
          name: m.dataset.name,
          min: parseInt(m.dataset.min)
        };
        render();
        updateWalletInfoSection();
      });
    });
  }

  // 2. Withdrawal action
  if (withdrawBtn) {
    withdrawBtn.addEventListener('click', handleWithdraw);
  }

  // Pro subscription + Pro chest are now wired in profile.js (relocated to the
  // Profile overlay — tap your avatar to access them).

  // 3. Wire up bank-selection UI handlers
  setupBankSelectionUI();
}

/* ─── Update wallet info section based on selected method ─── */

function updateWalletInfoSection() {
  const S = getState();
  const methodKey = S._selectedMethod?.id || 'bank';

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
      <input type="text" id="bankSearchInput" placeholder="Search bank name..." style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-bottom:8px" />
      <select id="bankSelect" style="width:100%;padding:10px;border-radius:10px;border:1px solid var(--line);background:var(--bg-inset);color:var(--ink);font-size:13px;margin-bottom:12px">
        <option value="">Loading banks...</option>
      </select>

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
  savedSelect?.addEventListener('change', () => {
    newFields.style.display = savedSelect.value ? 'none' : 'block';
    haptic('light');
  });

  const bankSearch = $('bankSearchInput');
  bankSearch?.addEventListener('input', () => filterBanks(bankSearch.value));

  const bankSelect = $('bankSelect');
  bankSelect?.addEventListener('change', () => {
    selectedBank = banksCache?.find(b => b.code === bankSelect.value) || null;
    haptic('light');
  });

  const acctInput = $('accountNumberInput');
  acctInput?.addEventListener('input', () => {
    // Only allow digits
    acctInput.value = acctInput.value.replace(/\D/g, '').slice(0, 10);
    resolvedAccountName = null;
    $('accountNameInput').value = '';
  });

  $('resolveAccountBtn')?.addEventListener('click', handleResolveAccount);

  // Load banks
  loadBanks();
}

/* ─── Load banks from Flutterwave ─── */

async function loadBanks() {
  const bankSelect = $('bankSelect');
  if (!bankSelect) return;

  try {
    bankSelect.innerHTML = '<option value="">Loading banks...</option>';
    const res = await api('/api/wallet/banks');
    banksCache = res.banks || [];
    renderBankOptions('');
  } catch (e) {
    bankSelect.innerHTML = '<option value="">Failed to load banks</option>';
  }
}

function renderBankOptions(filter) {
  const bankSelect = $('bankSelect');
  if (!bankSelect || !banksCache) return;

  const filtered = filter
    ? banksCache.filter(b => b.name.toLowerCase().includes(filter.toLowerCase()))
    : banksCache;

  bankSelect.innerHTML = `
    <option value="">— Select bank (${filtered.length}) —</option>
    ${filtered.map(b => `<option value="${b.code}">${b.name}</option>`).join('')}
  `;
}

function filterBanks(query) {
  renderBankOptions(query);
}

/* ─── Resolve account name ─── */

async function handleResolveAccount() {
  const bankSelect = $('bankSelect');
  const acctInput = $('accountNumberInput');
  const nameInput = $('accountNameInput');
  const resolveBtn = $('resolveAccountBtn');

  if (!bankSelect?.value || !acctInput?.value) {
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
        account_bank: bankSelect.value,
      }
    });

    resolvedAccountName = res.account_name;
    nameInput.value = res.account_name;
    haptic('success');
    toast({ title: 'Account verified', message: res.account_name, variant: 'success' });
  } catch (e) {
    resolvedAccountName = null;
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

/* ─── Handle withdrawal submission ─── */

async function handleWithdraw() {
  const S = getState();
  const minRequired = S._selectedMethod?.min || 75000;
  if (S.balance < minRequired) {
    toast({ title: 'Insufficient balance', message: `Minimum is ${minRequired} ORL`, variant: 'error' });
    return;
  }

  const methodKey = S._selectedMethod?.id || 'bank';
  let body = { method: methodKey };

  if (methodKey === 'bank') {
    const savedSelect = $('savedBankSelect');
    if (savedSelect?.value) {
      // Use saved bank account
      body.bankAccountId = parseInt(savedSelect.value);
    } else {
      // Use new bank account — must be verified
      if (!selectedBank) {
        toast({ title: 'Select bank', message: 'Pick your bank from the list', variant: 'error' });
        return;
      }
      const acctInput = $('accountNumberInput');
      if (!acctInput?.value || acctInput.value.length !== 10) {
        toast({ title: 'Invalid account', message: 'Enter a valid 10-digit account number', variant: 'error' });
        return;
      }
      if (!resolvedAccountName) {
        toast({ title: 'Verify account', message: 'Click "Verify account name" first', variant: 'error' });
        return;
      }
      body.walletInfo = `${selectedBank.code}|${acctInput.value}|${resolvedAccountName}|${selectedBank.name}`;
    }
  } else if (methodKey === 'usdt') {
    const walletInput = $('walletInfoInput');
    if (!walletInput?.value?.trim()) {
      toast({ title: 'Wallet required', message: 'Enter your USDT TRC20 wallet address', variant: 'error' });
      return;
    }
    body.walletInfo = walletInput.value.trim();
  } else if (methodKey === 'airtime') {
    const phoneInput = $('phoneNumberInput');
    if (!phoneInput?.value?.trim()) {
      toast({ title: 'Phone required', message: 'Enter your Nigerian phone number', variant: 'error' });
      return;
    }
    body.phoneNumber = phoneInput.value.trim();
  }

  haptic('medium');

  // Disable button during processing
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
      render();
      reward(0, 'Withdrawal requested!', res.message || 'Processing within 24h.');
      launchConfetti(20);
      // Reload saved bank accounts (in case a new one was saved)
      loadSavedBankAccounts();
      // Reload history
      loadHistory(1);
    } else {
      toast({ title: 'Withdrawal failed', message: res.message || '', variant: 'error' });
    }
  } catch (e) {
    // api() already toasted
  } finally {
    if (withdrawBtn) {
      withdrawBtn.disabled = false;
      withdrawBtn.textContent = `Withdraw to ${S._selectedMethod?.name || ''}`;
    }
  }
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

    el.innerHTML = data.transactions.map(h => {
      const isNeg = h.amount < 0;
      const amt = (h.amount >= 0 ? '+' : '') + fmtInt(h.amount);
      return `<div class="item">
        <div class="item-ic">${isNeg ? icoOut : icoIn}</div>
        <div class="item-body">
          <div class="item-title">${h.description || h.type}</div>
          <div class="item-sub">${new Date(h.created_at).toLocaleString()}</div>
        </div>
        <div class="item-reward ${isNeg ? 'neg' : 'pos'}">${amt}</div>
      </div>`;
    }).join('');

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

function setupBankSelectionUI() {
  // Initial render — will be triggered by updateWalletInfoSection when method changes
  // Listen for method changes
  document.addEventListener('click', (e) => {
    const method = e.target.closest('.method');
    if (method) {
      setTimeout(updateWalletInfoSection, 50);
    }
  });
}
