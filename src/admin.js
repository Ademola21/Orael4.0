/* ========================================================================
   admin.js — In-bot Admin Control Panel overlay
   - 9 tabs: Dashboard, Users, Withdrawals, Transactions, Economy, Promos,
             Audit, Broadcast, Settings
   - Full-screen overlay (#adminVeil) wired to the topbar #adminChip
   - Uses api() (handles Telegram initData), toast(), haptic(),
     getState() for admin role/permission checks
   - Vanilla JS DOM. Each tab has a load function that renders into #adminBody
     and attaches its own event listeners.
   ======================================================================== */

import { api } from './api.js';
import { toast } from './ui.js';
import { haptic } from './telegram.js';
import { getState } from './state.js';

/* ─── Helpers ─────────────────────────────────────────────────── */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtNum(n, d = 2) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return v.toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}
function fmtInt(n) {
  const v = Number(n);
  if (!isFinite(v)) return '0';
  return Math.floor(v).toLocaleString('en-US');
}
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return esc(s);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function fmtMoney(usd) {
  if (!isFinite(Number(usd))) return '$0.00';
  return '$' + fmtNum(usd, 2);
}

/** Get current admin status from client state. */
function adminInfo() {
  const S = getState();
  const perms = (S.permissions || '').split(',').map(p => p.trim()).filter(Boolean);
  const isMod = S.role === 'mod';
  const isAdmin = S.role === 'admin';
  return {
    role: S.role || 'user',
    perms,
    canAll: isAdmin || perms.includes('all'),
    isAdmin,
    isMod,
  };
}

let _isSuperAdmin = null;
async function isSuperAdmin() {
  if (_isSuperAdmin !== null) return _isSuperAdmin;
  try {
    const res = await api('/api/admin/permissions');
    _isSuperAdmin = !!res.isSuperAdmin;
  } catch (e) {
    _isSuperAdmin = false;
  }
  return _isSuperAdmin;
}

function loading(html = 'Loading…') {
  const body = $('adminBody');
  if (!body) return;
  body.innerHTML = `<div class="admin-loading"><div class="spinner"></div><span>${esc(html)}</span></div>`;
}
function emptyState(msg, sub = '') {
  return `<div class="admin-empty">
    <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M9 9l6 6M15 9l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <div>${esc(msg)}</div>
    ${sub ? `<div style="font-size:11.5px;margin-top:4px;color:var(--ink-faint)">${esc(sub)}</div>` : ''}
  </div>`;
}

function $(id) { return document.getElementById(id); }

/** Render a standard pagination bar. */
function paginationHtml(page, totalPages, total, onPage) {
  if (totalPages <= 1) {
    return `<div class="admin-pagination"><span class="page-info">${fmtInt(total)} record${total === 1 ? '' : 's'}</span><div class="pages"></div></div>`;
  }
  return `<div class="admin-pagination">
    <span class="page-info">Page ${page} of ${totalPages} · ${fmtInt(total)} records</span>
    <div class="pages">
      <button data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
      <button data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
    </div>
  </div>`;
}

function wirePagination(container, onPage) {
  if (!container) return;
  container.querySelectorAll('.admin-pagination button[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page);
      if (!isNaN(p) && p > 0) onPage(p);
    });
  });
}

/* ─── State per tab ───────────────────────────────────────────── */

const tabState = {
  dashboard: { loaded: false },
  users: { page: 1, limit: 20, search: '' },
  withdrawals: { status: 'needs_approval', page: 1, limit: 20, selected: new Set() },
  transactions: { page: 1, limit: 50 },
  economy: { data: null },
  promos: { loaded: false },
  audit: { page: 1, limit: 30, action: '' },
  broadcast: { jobId: null, pollTimer: null },
  settings: { data: null },
};

let currentTab = 'dashboard';
let broadcastPollTimer = null;

/* ─── Tab dispatcher ──────────────────────────────────────────── */

const TAB_LOADERS = {
  dashboard: loadDashboard,
  users: loadUsers,
  withdrawals: loadWithdrawals,
  transactions: loadTransactions,
  economy: loadEconomy,
  promos: loadPromos,
  audit: loadAudit,
  broadcast: loadBroadcast,
  settings: loadSettings,
};

async function switchTab(tab) {
  if (currentTab === tab && tabState[tab] && tabState[tab].loaded) return;
  currentTab = tab;
  // Update tab button states
  document.querySelectorAll('.admin-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  loading('Loading ' + tab + '…');
  try {
    await TAB_LOADERS[tab]();
    if (tabState[tab]) tabState[tab].loaded = true;
  } catch (e) {
    const body = $('adminBody');
    if (body) body.innerHTML = emptyState('Failed to load', e.message || String(e));
  }
}

/* ═══════════════════════════════════════════════════════════════
   TAB 1: DASHBOARD
   ═══════════════════════════════════════════════════════════════ */

async function loadDashboard() {
  loading('Fetching stats…');
  let stats;
  try {
    stats = await api('/api/admin/stats');
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load stats', e.message);
    return;
  }

  const flagDefs = [
    { key: 'maintenance_mode', label: 'Maintenance', desc: 'Block all writes' },
    { key: 'withdrawals_enabled', label: 'Withdrawals', desc: 'Allow cash-outs' },
    { key: 'games_enabled', label: 'Games', desc: 'Spin/scratch/etc' },
    { key: 'mining_enabled', label: 'Mining', desc: 'Accrual + refuel' },
    { key: 'faucet_enabled', label: 'Faucet', desc: 'Hourly claim' },
  ];

  const statCards = [
    { lbl: 'Total Users', val: fmtInt(stats.totalUsers), sub: '', cls: '' },
    { lbl: 'Total Balance', val: fmtInt(stats.totalBalance), sub: `≈ ${fmtMoney(stats.totalBalanceUsd)} · ${fmtInt(stats.totalBalance)} ORL`, cls: '' },
    { lbl: 'Total Mined', val: fmtInt(stats.totalMined), sub: `≈ ${fmtMoney(stats.totalMinedUsd)}`, cls: 'muted' },
    { lbl: 'Total Ads', val: fmtInt(stats.totalAds), sub: 'Lifetime views', cls: 'muted' },
    { lbl: 'Total Withdrawals', val: fmtInt(stats.totalWithdrawals), sub: `≈ ${fmtMoney(stats.totalWithdrawalsUsd)}`, cls: 'muted' },
    { lbl: 'Pending Withdrawals', val: fmtInt(stats.pendingWithdrawals), sub: 'Needs action', cls: stats.pendingWithdrawals > 0 ? 'danger' : 'muted' },
    { lbl: 'Pro Users', val: fmtInt(stats.proUsers || 0), sub: 'Active subs', cls: 'success' },
    { lbl: 'Banned Users', val: fmtInt(stats.bannedUsers || 0), sub: 'Suspended', cls: stats.bannedUsers > 0 ? 'danger' : 'muted' },
  ];

  const html = `
    <div class="admin-section">
      <div class="admin-section-title">Platform Metrics</div>
      <div class="admin-stat-grid">
        ${statCards.map(c => `
          <div class="admin-stat ${c.cls}">
            <div class="lbl">${esc(c.lbl)}</div>
            <div class="val">${c.val}</div>
            ${c.sub ? `<div class="sub">${c.sub}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    ${stats.flags && stats.flags.maintenance_mode ? `
      <div class="admin-banner">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        <div><b>Maintenance mode is ON.</b> All non-admin write actions are blocked for regular users.</div>
      </div>
    ` : ''}

    <div class="admin-section">
      <div class="admin-section-title">Feature Flags (quick toggle)</div>
      <div class="admin-flags-row" id="adminFlagRow">
        ${flagDefs.map(f => `
          <label class="admin-flag-chip">
            <span class="lbl"><b>${esc(f.label)}</b><span>${esc(f.desc)}</span></span>
            <span class="admin-toggle">
              <input type="checkbox" data-flag="${f.key}" ${(stats.flags && stats.flags[f.key]) ? 'checked' : ''} ${!_isSuperAdmin ? 'disabled' : ''} />
              <span class="track"></span>
            </span>
          </label>
        `).join('')}
      </div>
      ${!_isSuperAdmin ? '<div style="font-size:11px;color:var(--ink-faint);margin-top:6px">Super admin only — you have view-only access.</div>' : ''}
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Quick Actions</div>
      <div class="admin-toolbar">
        <button class="btn btn-ghost" id="adminRefreshStats">↻ Refresh Stats</button>
        <button class="btn btn-primary" id="adminBackupDb" ${!_isSuperAdmin ? 'disabled' : ''}>💾 Backup DB</button>
      </div>
    </div>
  `;

  $('adminBody').innerHTML = html;

  // Wire flag toggles
  $('adminFlagRow')?.querySelectorAll('input[data-flag]').forEach(input => {
    input.addEventListener('change', async () => {
      if (!_isSuperAdmin) { input.checked = !input.checked; return; }
      const key = input.dataset.flag;
      const val = input.checked;
      haptic('light');
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { flags: { [key]: val } } });
        toast({ title: `${key} ${val ? 'enabled' : 'disabled'}`, variant: 'success' });
        tabState.dashboard.loaded = false;
      } catch (e) { /* api() toasted */ }
    });
  });

  $('adminRefreshStats')?.addEventListener('click', () => {
    haptic('light');
    tabState.dashboard.loaded = false;
    loadDashboard();
  });

  $('adminBackupDb')?.addEventListener('click', async () => {
    if (!_isSuperAdmin) return;
    haptic('light');
    const btn = $('adminBackupDb');
    btn.disabled = true; btn.textContent = 'Backing up…';
    try {
      const res = await api('/api/admin/backup-db', { method: 'POST' });
      toast({ title: 'Backup created', message: res.path || 'OK', variant: 'success' });
    } catch (e) { /* api() toasted */ }
    btn.disabled = false; btn.textContent = '💾 Backup DB';
  });
}

/* ═══════════════════════════════════════════════════════════════
   TAB 2: USERS
   ═══════════════════════════════════════════════════════════════ */

async function loadUsers(page) {
  if (page) tabState.users.page = page;
  const { page: p, limit, search } = tabState.users;
  loading('Fetching users…');

  let data;
  try {
    const qs = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (search) qs.set('search', search);
    data = await api('/api/admin/users?' + qs.toString());
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load users', e.message);
    return;
  }

  const { users, pagination } = data;

  const html = `
    <div class="admin-section">
      <div class="admin-h">
        <div>
          <h3>Users</h3>
          <div class="admin-h-sub">${fmtInt(pagination.total)} total · page ${pagination.page}/${pagination.totalPages}</div>
        </div>
      </div>

      <div class="admin-toolbar">
        <input type="search" class="admin-input grow" id="adminUserSearch"
               placeholder="Search name, @username, or Telegram ID…"
               value="${esc(search)}" />
        <button class="btn btn-primary" id="adminUserSearchBtn">Search</button>
      </div>

      ${users.length === 0 ? emptyState('No users found', search ? 'Try a different search term.' : '') : `
        <div class="admin-table-wrap">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>ID</th><th>Name</th><th>@username</th><th>TG ID</th>
                  <th>Balance</th><th>Tier</th><th>Role</th><th>Country</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => `
                  <tr class="row-link" data-uid="${u.id}">
                    <td class="num">${u.id}</td>
                    <td><b>${esc(u.first_name || '—')}</b>${u.username ? '' : ''}</td>
                    <td class="muted">${u.username ? '@' + esc(u.username) : '—'}</td>
                    <td class="mono muted">${esc(u.telegram_id)}</td>
                    <td class="num gold">${fmtInt(u.balance)}</td>
                    <td><span class="admin-pill muted">T${u.tier || 1}</span></td>
                    <td>${rolePill(u.role)}</td>
                    <td class="muted">${esc(u.country || '—')}</td>
                    <td>${u.banned ? '<span class="admin-pill ruby">Banned</span>' : '<span class="admin-pill emerald">Active</span>'}</td>
                    <td class="actions"><button class="btn btn-ghost btn-sm" data-view="${u.id}">View</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ${paginationHtml(pagination.page, pagination.totalPages, pagination.total, '__PAGE__')}
      `}
    </div>
  `;

  $('adminBody').innerHTML = html.replace(
    /__PAGE__/g,
    ''
  );

  // Wire search
  const searchInput = $('adminUserSearch');
  const doSearch = () => {
    tabState.users.search = (searchInput.value || '').trim();
    tabState.users.page = 1;
    tabState.users.loaded = false;
    loadUsers();
  };
  $('adminUserSearchBtn')?.addEventListener('click', doSearch);
  searchInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

  // Wire view buttons
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openUserDrawer(parseInt(btn.dataset.view));
    });
  });
  document.querySelectorAll('tr.row-link').forEach(tr => {
    tr.addEventListener('click', () => openUserDrawer(parseInt(tr.dataset.uid)));
  });

  // Pagination
  wirePagination($('adminBody'), (p) => loadUsers(p));
}

function rolePill(role) {
  if (role === 'admin') return '<span class="admin-pill gold">Admin</span>';
  if (role === 'mod') return '<span class="admin-pill sapphire">Mod</span>';
  return '<span class="admin-pill muted">User</span>';
}

async function openUserDrawer(userId) {
  haptic('light');
  // Build drawer veil if missing
  let veil = $('adminDrawerVeil');
  if (!veil) {
    veil = document.createElement('div');
    veil.id = 'adminDrawerVeil';
    veil.className = 'admin-drawer-veil';
    veil.innerHTML = `<div class="admin-drawer"><div class="admin-drawer-head"><h3 id="adminDrawerTitle">User</h3><button class="close" id="adminDrawerClose">&times;</button></div><div class="admin-drawer-body" id="adminDrawerBody"></div></div>`;
    $('adminVeil').appendChild(veil);
    veil.addEventListener('click', (e) => { if (e.target === veil) veil.classList.remove('show'); });
    $('adminDrawerClose').addEventListener('click', () => veil.classList.remove('show'));
  }
  veil.classList.add('show');
  $('adminDrawerTitle').textContent = 'User #' + userId;
  $('adminDrawerBody').innerHTML = `<div class="admin-loading"><div class="spinner"></div><span>Loading user…</span></div>`;

  let data;
  try {
    data = await api('/api/admin/users/' + userId + '/detail');
  } catch (e) {
    $('adminDrawerBody').innerHTML = emptyState('Failed to load user', e.message);
    return;
  }

  const { user, transactions, withdrawals, achievements, referrer, referrals, allAchievements } = data;
  const ai = adminInfo();
  const canBan = ai.canAll || ai.perms.includes('ban_users');
  const canAdjust = ai.canAll || ai.perms.includes('adjust_balance');
  const canRole = _isSuperAdmin;

  $('adminDrawerTitle').textContent = user.first_name || ('User #' + user.id);

  const infoRows = [
    ['ID', user.id],
    ['Telegram ID', user.telegram_id],
    ['Username', user.username ? '@' + user.username : '—'],
    ['Balance', fmtInt(user.balance) + ' ORL'],
    ['Tier', 'T' + (user.tier || 1)],
    ['Rig', user.rig_level != null ? 'L' + user.rig_level : '—'],
    ['Role', user.role || 'user'],
    ['Country', user.country || '—'],
    ['Banned', user.banned ? 'YES' : 'no'],
    ['Pro', user.pro_until && new Date(user.pro_until) > new Date() ? 'until ' + fmtDate(user.pro_until) : 'no'],
    ['Referral code', user.referral_code || '—'],
    ['Joined', fmtDate(user.created_at)],
  ];

  $('adminDrawerBody').innerHTML = `
    <div class="admin-section">
      <div class="admin-section-title">Profile</div>
      <div class="admin-info-grid">
        ${infoRows.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}
      </div>
      ${user.isSuperAdmin ? '<div class="admin-pill gold" style="margin-top:6px">Super Admin</div>' : ''}
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Actions</div>
      ${canBan && !user.isSuperAdmin ? `
        <div class="admin-toolbar">
          <button class="btn ${user.banned ? 'btn-success' : 'btn-danger'} btn-sm" id="uBanBtn">${user.banned ? 'Unban user' : 'Ban user'}</button>
        </div>` : ''}
      ${canAdjust && !user.isSuperAdmin ? `
        <div class="admin-form-card">
          <div class="admin-field">
            <label>Adjust balance (±ORL)</label>
            <div class="admin-field-row">
              <input type="number" class="admin-input" id="uBalAmt" placeholder="e.g. -500 or +1000" step="any" />
              <input type="text" class="admin-input" id="uBalReason" placeholder="Reason (optional)" style="flex:1.4" />
            </div>
            <button class="btn btn-primary btn-sm" id="uBalBtn" style="margin-top:8px">Apply adjustment</button>
          </div>
        </div>` : ''}
      ${canRole && !user.isSuperAdmin ? `
        <div class="admin-form-card">
          <div class="admin-field">
            <label>Role</label>
            <select class="admin-select" id="uRoleSel">
              <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
              <option value="mod" ${user.role === 'mod' ? 'selected' : ''}>Moderator</option>
              <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </div>
          <div class="admin-field">
            <label>Permissions (comma-separated: view_users, ban_users, adjust_balance, process_withdrawals, view_transactions, manage_mods)</label>
            <input type="text" class="admin-input" id="uPermsInput" value="${esc(user.permissions || '')}" placeholder="e.g. view_users,ban_users" />
          </div>
          <button class="btn btn-primary btn-sm" id="uRoleBtn">Save role</button>
        </div>` : ''}
      ${user.isSuperAdmin ? '<div class="admin-banner warn"><svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg><div><b>Super admin.</b> Cannot be modified.</div></div>' : ''}
    </div>

    ${referrer || (referrals && referrals.length) ? `
      <div class="admin-section">
        <div class="admin-section-title">Referral Tree</div>
        ${referrer ? `<div style="font-size:11.5px;color:var(--ink-faint);margin-bottom:6px">Referred by:</div>
          <div class="admin-ref-tree">
            <div class="admin-ref-tree-item">
              <div class="av">${esc((referrer.first_name || '?')[0])}</div>
              <div><b>${esc(referrer.first_name || 'User')}</b> <span class="muted">@${esc(referrer.username || '—')} · TG ${esc(referrer.telegram_id)}</span></div>
            </div>
          </div>` : ''}
        ${referrals && referrals.length ? `
          <div style="font-size:11.5px;color:var(--ink-faint);margin:10px 0 6px">Direct referrals (${referrals.length}):</div>
          <div class="admin-ref-tree">
            ${referrals.map(r => `
              <div class="admin-ref-tree-item">
                <div class="av">${esc((r.first_name || '?')[0])}</div>
                <div><b>${esc(r.first_name || 'User')}</b> <span class="muted">@${esc(r.username || '—')} · ${fmtInt(r.balance)} ORL · ${fmtDate(r.created_at)}</span></div>
              </div>
            `).join('')}
          </div>` : ''}
      </div>` : ''}

    ${achievements && achievements.length ? `
      <div class="admin-section">
        <div class="admin-section-title">Achievements (${achievements.length})</div>
        <div class="admin-ref-tree">
          ${achievements.map(a => `<div class="admin-ref-tree-item"><div class="av">★</div><div><b>${esc(a.code || a.id)}</b> <span class="muted">${esc(a.title || '')} · ${fmtDate(a.earned_at)}</span></div></div>`).join('')}
        </div>
      </div>` : ''}

    <div class="admin-section">
      <div class="admin-section-title">Recent Withdrawals</div>
      ${withdrawals && withdrawals.length ? `
        <div class="admin-table-wrap"><div class="admin-table-scroll">
          <table class="admin-table">
            <thead><tr><th>ID</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              ${withdrawals.map(w => `
                <tr>
                  <td class="num">${w.id}</td>
                  <td>${esc(w.method)}</td>
                  <td class="num gold">${fmtInt(w.amount_orl)}</td>
                  <td>${withdrawalStatusPill(w.status)}</td>
                  <td class="muted">${fmtDate(w.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div></div>
      ` : emptyState('No withdrawals')}
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Recent Transactions</div>
      ${transactions && transactions.length ? `
        <div class="admin-table-wrap"><div class="admin-table-scroll">
          <table class="admin-table">
            <thead><tr><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr></thead>
            <tbody>
              ${transactions.slice(0, 20).map(t => `
                <tr>
                  <td>${txTypePill(t.type)}</td>
                  <td class="num ${txAmountClass(t.amount, t.type)}">${t.amount >= 0 ? '+' : ''}${fmtNum(t.amount, 2)}</td>
                  <td class="muted">${esc(t.description || '')}</td>
                  <td class="muted">${fmtDate(t.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div></div>
      ` : emptyState('No transactions')}
    </div>
  `;

  // Wire action buttons
  $('uBanBtn')?.addEventListener('click', async () => {
    haptic('light');
    try {
      await api('/api/admin/users/' + userId + '/ban', { method: 'POST', body: { banned: !user.banned } });
      toast({ title: user.banned ? 'User unbanned' : 'User banned', variant: 'success' });
      openUserDrawer(userId); // refresh
      tabState.users.loaded = false;
    } catch (e) { /* api() toasted */ }
  });

  $('uBalBtn')?.addEventListener('click', async () => {
    const amt = parseFloat($('uBalAmt').value);
    const reason = $('uBalReason').value || '';
    if (!amt || isNaN(amt)) { toast({ title: 'Enter a valid amount', variant: 'error' }); return; }
    haptic('light');
    try {
      const res = await api('/api/admin/users/' + userId + '/balance', { method: 'POST', body: { amount: amt, reason } });
      toast({ title: 'Balance adjusted', message: 'New: ' + fmtInt(res.newBalance) + ' ORL', variant: 'success' });
      openUserDrawer(userId);
      tabState.users.loaded = false;
    } catch (e) { /* api() toasted */ }
  });

  $('uRoleBtn')?.addEventListener('click', async () => {
    const role = $('uRoleSel').value;
    const perms = $('uPermsInput').value.split(',').map(s => s.trim()).filter(Boolean);
    haptic('light');
    try {
      await api('/api/admin/users/' + userId + '/role', { method: 'POST', body: { role, permissions: perms } });
      toast({ title: 'Role updated', variant: 'success' });
      openUserDrawer(userId);
      tabState.users.loaded = false;
    } catch (e) { /* api() toasted */ }
  });
}

function withdrawalStatusPill(status) {
  const map = {
    completed: 'emerald',
    rejected: 'ruby',
    pending: 'sapphire',
    needs_approval: 'gold',
  };
  const cls = map[status] || 'muted';
  return `<span class="admin-pill ${cls}">${esc(status || '—')}</span>`;
}

function txTypePill(type) {
  const map = {
    mining: 'gold',
    faucet: 'gold',
    spin_win: 'gold',
    scratch_win: 'gold',
    coinflip_win: 'gold',
    chest: 'gold',
    referral: 'sapphire',
    ad_milestone: 'emerald',
    deposit: 'emerald',
    withdraw: 'ruby',
    withdraw_refund: 'sapphire',
    withdraw_completed: 'emerald',
    admin_adjust: 'violet',
    admin_action: 'violet',
    pro_activate: 'violet',
    lottery_win: 'gold',
    lottery_ticket: 'ruby',
  };
  const cls = map[type] || 'muted';
  return `<span class="admin-pill ${cls}">${esc(type || '—')}</span>`;
}

function txAmountClass(amount, type) {
  if (type === 'withdraw' || type === 'withdraw_refund') return amount < 0 ? 'ruby' : 'sapphire';
  if (amount < 0) return 'ruby';
  if (type && type.startsWith('admin')) return 'violet';
  return 'emerald';
}

/* ═══════════════════════════════════════════════════════════════
   TAB 3: WITHDRAWALS
   ═══════════════════════════════════════════════════════════════ */

async function loadWithdrawals(page) {
  if (page) tabState.withdrawals.page = page;
  else tabState.withdrawals.page = 1;
  const { status, page: p, limit } = tabState.withdrawals;
  loading('Fetching withdrawals…');

  let data;
  try {
    const qs = new URLSearchParams({ status, page: String(p), limit: String(limit) });
    data = await api('/api/admin/withdrawals?' + qs.toString());
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load withdrawals', e.message);
    return;
  }

  const { withdrawals, pagination } = data;
  tabState.withdrawals.selected = new Set();

  const statusTabs = [
    { key: 'needs_approval', label: 'Needs Approval' },
    { key: 'pending', label: 'Pending' },
    { key: 'completed', label: 'Completed' },
    { key: 'rejected', label: 'Rejected' },
  ];

  const html = `
    <div class="admin-section">
      <div class="admin-h">
        <div>
          <h3>Withdrawals</h3>
          <div class="admin-h-sub">${fmtInt(pagination.total)} records · page ${pagination.page}/${pagination.totalPages}</div>
        </div>
      </div>

      <div class="admin-status-tabs" id="wStatusTabs">
        ${statusTabs.map(t => `
          <button class="admin-status-tab ${t.key === status ? 'active' : ''}" data-status="${t.key}">${esc(t.label)}</button>
        `).join('')}
      </div>

      ${status === 'needs_approval' ? `
        <div class="admin-banner warn">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          <div><b>Bulk approve skips Flutterwave.</b> Bulk-approving a <code>needs_approval</code> bank/airtime withdrawal will mark it paid <b>without</b> actually sending money. Always approve those individually so the Flutterwave transfer is initiated.</div>
        </div>
      ` : ''}

      ${withdrawals.length === 0 ? emptyState('No withdrawals in this status') : `
        <div class="admin-toolbar">
          <label class="admin-flag-chip" style="padding:6px 10px">
            <span class="admin-toggle"><input type="checkbox" id="wSelectAll" /><span class="track"></span></span>
            <span class="lbl"><b>Select all</b></span>
          </label>
          <span class="info"><span id="wSelCount">0</span> selected</span>
          <button class="btn btn-success btn-sm" id="wBulkApprove">✓ Approve Selected</button>
          <button class="btn btn-danger btn-sm" id="wBulkReject">✕ Reject Selected</button>
        </div>
        <div class="admin-table-wrap">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr>
                  <th></th><th>ID</th><th>User</th><th>Method</th>
                  <th>ORL</th><th>Fee</th><th>Net</th><th>Status</th><th>Created</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${withdrawals.map(w => `
                  <tr data-wid="${w.id}">
                    <td><input type="checkbox" class="admin-check w-check" data-wid="${w.id}" /></td>
                    <td class="num">${w.id}</td>
                    <td>
                      <b>${esc(w.first_name || 'User')}</b>
                      <span class="muted mono">@${esc(w.username || '—')}</span><br/>
                      <span class="muted mono">${esc(w.telegram_id)}</span>
                    </td>
                    <td>${esc(w.method)}</td>
                    <td class="num gold">${fmtInt(w.amount_orl)}</td>
                    <td class="num muted">${fmtInt(w.fee_orl || 0)}</td>
                    <td class="num">${esc(w.net_fiat || '—')}</td>
                    <td>${withdrawalStatusPill(w.status)}</td>
                    <td class="muted">${fmtDate(w.created_at)}</td>
                    <td class="actions">
                      ${w.status === 'needs_approval' || w.status === 'pending' ? `
                        <button class="btn btn-success btn-sm" data-approve="${w.id}">Approve</button>
                        <button class="btn btn-danger btn-sm" data-reject="${w.id}">Reject</button>
                      ` : ''}
                      ${w.flw_transfer_id ? `<button class="btn btn-ghost btn-sm" data-requery="${w.id}">Requery</button>` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ${paginationHtml(pagination.page, pagination.totalPages, pagination.total, '__PAGE__')}
      `}
    </div>
  `;

  $('adminBody').innerHTML = html.replace(/__PAGE__/g, '');

  // Status tab switching
  $('wStatusTabs')?.querySelectorAll('.admin-status-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      haptic('light');
      tabState.withdrawals.status = btn.dataset.status;
      tabState.withdrawals.page = 1;
      tabState.withdrawals.loaded = false;
      loadWithdrawals();
    });
  });

  // Select all
  $('wSelectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.w-check').forEach(c => {
      c.checked = e.target.checked;
      if (e.target.checked) tabState.withdrawals.selected.add(parseInt(c.dataset.wid));
      else tabState.withdrawals.selected.delete(parseInt(c.dataset.wid));
    });
    updateSelCount();
  });

  document.querySelectorAll('.w-check').forEach(c => {
    c.addEventListener('change', () => {
      const id = parseInt(c.dataset.wid);
      if (c.checked) tabState.withdrawals.selected.add(id);
      else tabState.withdrawals.selected.delete(id);
      updateSelCount();
    });
  });

  // Individual approve/reject/requery
  document.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => processWithdrawal(parseInt(b.dataset.approve), 'completed')));
  document.querySelectorAll('[data-reject]').forEach(b => b.addEventListener('click', () => processWithdrawal(parseInt(b.dataset.reject), 'rejected')));
  document.querySelectorAll('[data-requery]').forEach(b => b.addEventListener('click', () => requeryWithdrawal(parseInt(b.dataset.requery))));

  // Bulk
  $('wBulkApprove')?.addEventListener('click', () => bulkProcess('approve'));
  $('wBulkReject')?.addEventListener('click', () => bulkProcess('reject'));

  wirePagination($('adminBody'), (p) => loadWithdrawals(p));
}

function updateSelCount() {
  const el = $('wSelCount');
  if (el) el.textContent = tabState.withdrawals.selected.size;
}

async function processWithdrawal(wid, status) {
  haptic('light');
  if (!confirm(`Are you sure you want to ${status === 'completed' ? 'APPROVE' : 'REJECT'} withdrawal #${wid}?`)) return;
  try {
    const res = await api('/api/admin/withdrawals/' + wid + '/process', { method: 'POST', body: { status } });
    toast({ title: 'Withdrawal ' + (res.status || status), message: res.message || '', variant: 'success' });
    tabState.withdrawals.loaded = false;
    loadWithdrawals();
  } catch (e) { /* api() toasted */ }
}

async function requeryWithdrawal(wid) {
  haptic('light');
  try {
    const res = await api('/api/admin/withdrawals/' + wid + '/requery', { method: 'POST' });
    toast({ title: 'Requery done', message: `FLW: ${res.flw_status} · local: ${res.local_status}`, variant: 'info', duration: 4000 });
    tabState.withdrawals.loaded = false;
    loadWithdrawals();
  } catch (e) { /* api() toasted */ }
}

async function bulkProcess(action) {
  const ids = Array.from(tabState.withdrawals.selected);
  if (!ids.length) { toast({ title: 'Select at least one row', variant: 'error' }); return; }
  haptic('light');
  if (!confirm(`${action === 'approve' ? 'APPROVE' : 'REJECT'} ${ids.length} withdrawal(s)?`)) return;
  try {
    const res = await api('/api/admin/withdrawals/bulk-process', { method: 'POST', body: { ids, action } });
    const ok = res.results.filter(r => r.status === 'success').length;
    const skipped = res.results.filter(r => r.status === 'skipped').length;
    const failed = res.results.filter(r => r.status === 'error').length;
    toast({
      title: 'Bulk done',
      message: `${ok} ok, ${skipped} skipped, ${failed} failed`,
      variant: failed ? 'error' : 'success',
      duration: 5000,
    });
    tabState.withdrawals.loaded = false;
    loadWithdrawals();
  } catch (e) { /* api() toasted */ }
}

/* ═══════════════════════════════════════════════════════════════
   TAB 4: TRANSACTIONS
   ═══════════════════════════════════════════════════════════════ */

async function loadTransactions(page) {
  if (page) tabState.transactions.page = page;
  const { page: p, limit } = tabState.transactions;
  loading('Fetching transactions…');

  let data;
  try {
    const qs = new URLSearchParams({ page: String(p), limit: String(limit) });
    data = await api('/api/admin/transactions?' + qs.toString());
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load transactions', e.message);
    return;
  }

  const { transactions, pagination } = data;

  const html = `
    <div class="admin-section">
      <div class="admin-h">
        <div>
          <h3>Transactions</h3>
          <div class="admin-h-sub">${fmtInt(pagination.total)} records · page ${pagination.page}/${pagination.totalPages}</div>
        </div>
      </div>

      ${transactions.length === 0 ? emptyState('No transactions') : `
        <div class="admin-table-wrap">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr><th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Description</th><th>Date</th></tr>
              </thead>
              <tbody>
                ${transactions.map(t => `
                  <tr>
                    <td class="num">${t.id}</td>
                    <td><b>${esc(t.user_first_name || t.user_name || 'User #' + t.user_id)}</b><br/><span class="muted mono">${esc(t.user_username ? '@' + t.user_username : '')}</span></td>
                    <td>${txTypePill(t.type)}</td>
                    <td class="num ${txAmountClass(t.amount, t.type)}">${t.amount >= 0 ? '+' : ''}${fmtNum(t.amount, 2)}</td>
                    <td class="muted">${esc(t.description || '—')}</td>
                    <td class="muted">${fmtDate(t.created_at)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ${paginationHtml(pagination.page, pagination.totalPages, pagination.total, '__PAGE__')}
      `}
    </div>
  `;

  $('adminBody').innerHTML = html.replace(/__PAGE__/g, '');
  wirePagination($('adminBody'), (p) => loadTransactions(p));
}

/* ═══════════════════════════════════════════════════════════════
   TAB 5: ECONOMY (super admin only)
   ═══════════════════════════════════════════════════════════════ */

async function loadEconomy() {
  if (!_isSuperAdmin) {
    $('adminBody').innerHTML = `
      <div class="admin-empty">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <div><b>Super admin only</b></div>
        <div style="font-size:11.5px;margin-top:4px;color:var(--ink-faint)">Economy configuration is restricted to super admins.</div>
      </div>`;
    return;
  }

  loading('Fetching economy config…');
  let data;
  try {
    data = await api('/api/admin/economy');
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load economy', e.message);
    return;
  }

  const E = data.economy || {};
  tabState.economy.data = E;

  const adRevenue = 168; // ORL per ad view (1 ad = $0.00224 = 168 ORL at peg)

  // Helper: payout-ratio hint for a reward field
  const hint = (reward) => {
    const r = Number(reward);
    if (!isFinite(r) || r <= 0) return '';
    const pct = (r / adRevenue) * 100;
    return `<div class="hint">${pct.toFixed(1)}% of ad revenue</div>`;
  };

  // RIGS editor
  const rigsHtml = (E.RIGS || []).map((r, i) => `
    <div class="admin-rig-row" data-idx="${i}">
      <input class="admin-input" data-rig-key="name" value="${esc(r.name)}" placeholder="Name" />
      <input class="admin-input" data-rig-key="sessionMin" type="number" value="${r.sessionMin}" placeholder="Session min" />
      <input class="admin-input" data-rig-key="cost" type="number" value="${r.cost}" placeholder="Cost" />
    </div>
  `).join('');

  // Withdrawal methods editor (compact — per method: minOrl, fiat, countries)
  const methodsHtml = Object.keys(E.WITHDRAWAL_METHODS || {}).map(k => {
    const m = E.WITHDRAWAL_METHODS[k];
    return `<div class="admin-econ-field" style="grid-column:1/-1">
      <label>${esc(k)} method</label>
      <div class="admin-field-row" style="margin-top:4px">
        <input class="admin-input" data-method="${k}" data-mk="minOrl" type="number" value="${m.minOrl}" placeholder="min ORL" />
        <input class="admin-input" data-method="${k}" data-mk="fiat" value="${esc(m.fiat)}" placeholder="fiat label" />
        <input class="admin-input" data-method="${k}" data-mk="countries" value="${Array.isArray(m.countries) ? m.countries.join(',') : esc(m.countries)}" placeholder="countries (NG or 'all')" />
      </div>
    </div>`;
  }).join('');

  // Tier multipliers (1-5)
  const tiers = E.TIER_MULTIPLIERS || { 1:1, 2:1.1, 3:1.25, 4:1.5, 5:2.0 };
  const tiersHtml = [1,2,3,4,5].map(t => `
    <div class="admin-econ-field">
      <label>Tier ${t} multiplier</label>
      <input type="number" step="0.01" data-tier="${t}" value="${tiers[t]}" />
    </div>
  `).join('');

  // AD_MILESTONES editor (array of {ads, bonus})
  const msHtml = (E.AD_MILESTONES || []).map((m, i) => `
    <div class="admin-rig-row" data-ms-idx="${i}">
      <input class="admin-input" data-ms-key="ads" type="number" value="${m.ads}" placeholder="ads" />
      <input class="admin-input" data-ms-key="bonus" type="number" value="${m.bonus}" placeholder="bonus ORL" />
      <button class="btn btn-ghost btn-sm" data-ms-del="${i}">✕</button>
    </div>
  `).join('');

  const html = `
    <div class="admin-banner warn">
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
      <div><b>Editing economy config affects all users immediately.</b> Reward fields show their expected payout ratio (reward ÷ 168 ORL per-ad revenue). Stay in the 22–30% safe zone.</div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Peg &amp; Rates</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>ORL → NGN</label>
          <input type="number" step="0.0001" data-econ="ORL_TO_NGN" value="${E.ORL_TO_NGN}" />
          ${hint(E.FAUCET_REWARD ? E.FAUCET_REWARD / E.ORL_TO_NGN * E.USD_TO_NGN : 0)}
        </div>
        <div class="admin-econ-field">
          <label>USD → NGN</label>
          <input type="number" step="1" data-econ="USD_TO_NGN" value="${E.USD_TO_NGN}" />
        </div>
        <div class="admin-econ-field">
          <label>ORL per USD (derived, read-only)</label>
          <input type="text" value="${fmtInt(E.ORL_PER_USD)}" readonly />
          <div class="hint dim">= USD_TO_NGN / ORL_TO_NGN</div>
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Mining</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>Tank ORL (per refuel)</label>
          <input type="number" data-econ="TANK_ORL" value="${E.TANK_ORL}" />
          ${hint(E.TANK_ORL)}
        </div>
        <div class="admin-econ-field">
          <label>Free mining cap (0-1)</label>
          <input type="number" step="0.05" data-econ="FREE_MINING_CAP" value="${E.FREE_MINING_CAP}" />
        </div>
        <div class="admin-econ-field">
          <label>Pro multiplier</label>
          <input type="number" step="0.1" data-econ="PRO_MULTIPLIER" value="${E.PRO_MULTIPLIER}" />
        </div>
        <div class="admin-econ-field">
          <label>Boost multiplier</label>
          <input type="number" step="0.05" data-econ="BOOST_MULTIPLIER" value="${E.BOOST_MULTIPLIER}" />
        </div>
        <div class="admin-econ-field">
          <label>Session duration (ms)</label>
          <input type="number" step="1000" data-econ="SESSION_MS" value="${E.SESSION_MS}" />
        </div>
      </div>
      <div style="margin-top:10px"><label style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-faint)">Rigs</label></div>
      <div class="admin-rigs-editor" id="rigsEditor">${rigsHtml}</div>
      <div style="margin-top:10px"><label style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-faint)">Tier multipliers</label></div>
      <div class="admin-econ-grid" style="margin-top:6px">${tiersHtml}</div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Games</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>Wheel prizes (CSV)</label>
          <input type="text" data-econ-arr="WHEEL_PRIZES" value="${(E.WHEEL_PRIZES || []).join(',')}" />
        </div>
        <div class="admin-econ-field">
          <label>Wheel weights (CSV)</label>
          <input type="text" data-econ-arr="WHEEL_WEIGHTS" value="${(E.WHEEL_WEIGHTS || []).join(',')}" />
        </div>
        <div class="admin-econ-field">
          <label>Scratch prizes (CSV)</label>
          <input type="text" data-econ-arr="SCRATCH_PRIZES" value="${(E.SCRATCH_PRIZES || []).join(',')}" />
          ${hint((E.SCRATCH_PRIZES || []).reduce((a,b)=>a+b,0) / (E.SCRATCH_PRIZES || []).length)}
        </div>
        <div class="admin-econ-field">
          <label>Scratch weights (CSV)</label>
          <input type="text" data-econ-arr="SCRATCH_WEIGHTS" value="${(E.SCRATCH_WEIGHTS || []).join(',')}" />
        </div>
        <div class="admin-econ-field">
          <label>Coinflip win</label>
          <input type="number" data-econ="COINFLIP_WIN" value="${E.COINFLIP_WIN}" />
          ${hint(E.COINFLIP_WIN)}
        </div>
        <div class="admin-econ-field">
          <label>Coinflip lose</label>
          <input type="number" data-econ="COINFLIP_LOSE" value="${E.COINFLIP_LOSE}" />
        </div>
        <div class="admin-econ-field">
          <label>Chest goal (ads)</label>
          <input type="number" data-econ="CHEST_GOAL" value="${E.CHEST_GOAL}" />
        </div>
        <div class="admin-econ-field">
          <label>Chest reward min</label>
          <input type="number" data-econ="CHEST_REWARD_MIN" value="${E.CHEST_REWARD_MIN}" />
          ${hint((E.CHEST_REWARD_MIN + E.CHEST_REWARD_MAX) / 2 / (E.CHEST_GOAL || 1))}
        </div>
        <div class="admin-econ-field">
          <label>Chest reward max</label>
          <input type="number" data-econ="CHEST_REWARD_MAX" value="${E.CHEST_REWARD_MAX}" />
        </div>
        <div class="admin-econ-field">
          <label>Lottery ticket (ORL)</label>
          <input type="number" data-econ="LOTTO_TICKET_ORL" value="${E.LOTTO_TICKET_ORL}" />
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Earn</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>Faucet reward</label>
          <input type="number" data-econ="FAUCET_REWARD" value="${E.FAUCET_REWARD}" />
          ${hint(E.FAUCET_REWARD)}
        </div>
        <div class="admin-econ-field">
          <label>Faucet cooldown (ms)</label>
          <input type="number" step="1000" data-econ="FAUCET_COOLDOWN" value="${E.FAUCET_COOLDOWN}" />
        </div>
        <div class="admin-econ-field">
          <label>Video wall reward</label>
          <input type="number" data-econ="VIDEO_WALL_REWARD" value="${E.VIDEO_WALL_REWARD}" />
          ${hint(E.VIDEO_WALL_REWARD)}
        </div>
        <div class="admin-econ-field">
          <label>Streak amounts (7 CSV)</label>
          <input type="text" data-econ-arr="STREAK_AMOUNTS" value="${(E.STREAK_AMOUNTS || []).join(',')}" />
        </div>
      </div>
      <div style="margin-top:10px"><label style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-faint)">Ad milestones</label></div>
      <div class="admin-rigs-editor" id="msEditor">${msHtml}</div>
      <button class="btn btn-ghost btn-sm" id="msAdd" style="margin-top:6px">+ Add milestone</button>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Referral</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>L1 commission (0-1)</label>
          <input type="number" step="0.01" data-econ="REFERRAL_L1_PCT" value="${E.REFERRAL_L1_PCT}" />
        </div>
        <div class="admin-econ-field">
          <label>L2 commission (0-1)</label>
          <input type="number" step="0.01" data-econ="REFERRAL_L2_PCT" value="${E.REFERRAL_L2_PCT}" />
        </div>
      </div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Withdrawal</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>Fee % (free)</label>
          <input type="number" step="0.01" data-econ="WITHDRAWAL_FEE_PCT" value="${E.WITHDRAWAL_FEE_PCT}" />
        </div>
        <div class="admin-econ-field">
          <label>Fee % (Pro)</label>
          <input type="number" step="0.01" data-econ="WITHDRAWAL_FEE_PRO_PCT" value="${E.WITHDRAWAL_FEE_PRO_PCT}" />
        </div>
        <div class="admin-econ-field">
          <label>Manual approval threshold (ORL)</label>
          <input type="number" step="1000" data-econ="MANUAL_APPROVAL_THRESHOLD_ORL" value="${E.MANUAL_APPROVAL_THRESHOLD_ORL}" />
        </div>
      </div>
      <div style="margin-top:10px"><label style="font-size:10.5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-faint)">Methods</label></div>
      <div class="admin-econ-grid" style="margin-top:6px">${methodsHtml}</div>
    </div>

    <div class="admin-section">
      <div class="admin-section-title">Pro</div>
      <div class="admin-econ-grid">
        <div class="admin-econ-field">
          <label>Pro price (Stars)</label>
          <input type="number" data-econ="PRO_PRICE_STARS" value="${E.PRO_PRICE_STARS}" />
        </div>
        <div class="admin-econ-field">
          <label>Pro duration (days)</label>
          <input type="number" data-econ="PRO_DURATION_DAYS" value="${E.PRO_DURATION_DAYS}" />
        </div>
      </div>
    </div>

    <div class="admin-save-bar">
      <button class="btn btn-danger btn-sm" id="econReset">Reset to defaults</button>
      <span class="spacer"></span>
      <button class="btn btn-ghost btn-sm" id="econReload">Reload</button>
      <button class="btn btn-primary" id="econSave">💾 Save changes</button>
    </div>
  `;

  $('adminBody').innerHTML = html;

  // Milestone add/remove
  $('msAdd')?.addEventListener('click', () => {
    const editor = $('msEditor');
    const idx = editor.children.length;
    const row = document.createElement('div');
    row.className = 'admin-rig-row';
    row.dataset.msIdx = idx;
    row.innerHTML = `
      <input class="admin-input" data-ms-key="ads" type="number" placeholder="ads" />
      <input class="admin-input" data-ms-key="bonus" type="number" placeholder="bonus ORL" />
      <button class="btn btn-ghost btn-sm" data-ms-del="${idx}">✕</button>`;
    editor.appendChild(row);
    row.querySelector('[data-ms-del]').addEventListener('click', () => row.remove());
  });
  document.querySelectorAll('[data-ms-del]').forEach(b => b.addEventListener('click', () => b.closest('[data-ms-idx]').remove()));

  $('econReload')?.addEventListener('click', () => { haptic('light'); tabState.economy.loaded = false; loadEconomy(); });

  $('econReset')?.addEventListener('click', async () => {
    if (!confirm('Reset ALL economy overrides to defaults? This affects every user immediately.')) return;
    haptic('light');
    try {
      await api('/api/admin/economy/reset', { method: 'POST' });
      toast({ title: 'Economy reset to defaults', variant: 'success' });
      tabState.economy.loaded = false;
      loadEconomy();
    } catch (e) { /* api() toasted */ }
  });

  $('econSave')?.addEventListener('click', saveEconomy);
}

async function saveEconomy() {
  const changes = {};

  // Scalar fields
  document.querySelectorAll('[data-econ]').forEach(el => {
    const k = el.dataset.econ;
    let v = el.value;
    if (el.type === 'number') v = parseFloat(v); else v = Number(v);
    if (!isNaN(v)) changes[k] = v;
  });

  // Array fields
  document.querySelectorAll('[data-econ-arr]').forEach(el => {
    const k = el.dataset.econArr;
    const arr = el.value.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v));
    changes[k] = arr;
  });

  // Tier multipliers
  const tiers = {};
  document.querySelectorAll('[data-tier]').forEach(el => {
    const t = el.dataset.tier;
    const v = parseFloat(el.value);
    if (!isNaN(v)) tiers[t] = v;
  });
  changes.TIER_MULTIPLIERS = tiers;

  // RIGS
  const rigs = [];
  document.querySelectorAll('#rigsEditor .admin-rig-row').forEach(row => {
    const r = {};
    row.querySelectorAll('input[data-rig-key]').forEach(inp => {
      const key = inp.dataset.rigKey;
      let v = inp.value;
      if (key === 'sessionMin' || key === 'cost') v = parseInt(v);
      r[key] = v;
    });
    if (r.name) rigs.push(r);
  });
  if (rigs.length) changes.RIGS = rigs;

  // AD_MILESTONES
  const milestones = [];
  document.querySelectorAll('#msEditor .admin-rig-row').forEach(row => {
    const m = {};
    row.querySelectorAll('input[data-ms-key]').forEach(inp => {
      m[inp.dataset.msKey] = parseInt(inp.value);
    });
    if (m.ads && m.bonus) milestones.push(m);
  });
  changes.AD_MILESTONES = milestones;

  // WITHDRAWAL_METHODS
  const methods = {};
  document.querySelectorAll('[data-method]').forEach(inp => {
    const k = inp.dataset.method;
    const mk = inp.dataset.mk;
    if (!methods[k]) methods[k] = { ...(tabState.economy.data.WITHDRAWAL_METHODS?.[k] || {}) };
    if (mk === 'minOrl') methods[k][mk] = parseInt(inp.value);
    else if (mk === 'countries') {
      const v = inp.value.trim();
      methods[k][mk] = v.toLowerCase() === 'all' ? 'all' : v.split(',').map(s => s.trim()).filter(Boolean);
    } else methods[k][mk] = inp.value;
  });
  if (Object.keys(methods).length) changes.WITHDRAWAL_METHODS = methods;

  haptic('light');
  const btn = $('econSave');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/api/admin/economy', { method: 'PUT', body: { economy: changes } });
    toast({ title: 'Economy saved', message: Object.keys(changes).length + ' fields updated', variant: 'success' });
    tabState.economy.loaded = false;
    loadEconomy();
  } catch (e) { /* api() toasted */ }
  btn.disabled = false; btn.textContent = '💾 Save changes';
}

/* ═══════════════════════════════════════════════════════════════
   TAB 6: PROMOS
   ═══════════════════════════════════════════════════════════════ */

async function loadPromos() {
  loading('Fetching promo codes…');
  let data;
  try {
    data = await api('/api/admin/promo-codes');
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load promo codes', e.message);
    return;
  }

  const codes = data.codes || [];

  const html = `
    <div class="admin-section">
      <div class="admin-h">
        <div><h3>Promo Codes</h3><div class="admin-h-sub">${codes.length} codes</div></div>
      </div>

      <div class="admin-form-card">
        <div class="admin-section-title">Create new code</div>
        <div class="admin-field-row">
          <div class="admin-field" style="flex:1.2">
            <label>Code</label>
            <input type="text" class="admin-input" id="pCode" placeholder="SUMMER50" />
          </div>
          <div class="admin-field">
            <label>Reward ORL</label>
            <input type="number" class="admin-input" id="pReward" placeholder="500" />
          </div>
          <div class="admin-field">
            <label>Max uses (0 = unlimited)</label>
            <input type="number" class="admin-input" id="pMax" placeholder="0" />
          </div>
        </div>
        <div class="admin-field">
          <label>Expires at (epoch seconds, optional)</label>
          <input type="number" class="admin-input" id="pExpires" placeholder="1735689600" />
        </div>
        <button class="btn btn-primary btn-sm" id="pCreate">+ Create code</button>
      </div>

      ${codes.length === 0 ? emptyState('No promo codes yet') : `
        <div class="admin-table-wrap">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr><th>Code</th><th>Reward</th><th>Uses / Max</th><th>Expires</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${codes.map(c => {
                  const exp = c.expires_at ? new Date(c.expires_at * 1000) : null;
                  const expired = exp && exp < new Date();
                  return `
                  <tr>
                    <td><b class="gold">${esc(c.code)}</b></td>
                    <td class="num gold">${fmtInt(c.reward_orl)}</td>
                    <td class="num">${fmtInt(c.uses || 0)} / ${c.max_uses ? fmtInt(c.max_uses) : '∞'}</td>
                    <td class="muted">${exp ? fmtDate(exp) : 'never'}</td>
                    <td>${c.active && !expired ? '<span class="admin-pill emerald">Active</span>' : '<span class="admin-pill ruby">Inactive</span>'}</td>
                    <td class="actions"><button class="btn btn-danger btn-sm" data-del="${esc(c.code)}">Delete</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}
    </div>
  `;

  $('adminBody').innerHTML = html;

  $('pCreate')?.addEventListener('click', async () => {
    const code = $('pCode').value.trim();
    const reward = parseFloat($('pReward').value);
    const maxUses = parseInt($('pMax').value) || 0;
    const expiresAt = $('pExpires').value ? parseInt($('pExpires').value) : null;
    if (!code || !reward) { toast({ title: 'Code and reward required', variant: 'error' }); return; }
    haptic('light');
    try {
      await api('/api/admin/promo-codes', { method: 'POST', body: { code, rewardOrl: reward, maxUses, expiresAt } });
      toast({ title: 'Promo code created', variant: 'success' });
      tabState.promos.loaded = false;
      loadPromos();
    } catch (e) { /* api() toasted */ }
  });

  document.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const code = b.dataset.del;
    if (!confirm(`Delete promo code "${code}"?`)) return;
    haptic('light');
    try {
      await api('/api/admin/promo-codes/' + encodeURIComponent(code), { method: 'DELETE' });
      toast({ title: 'Promo code deleted', variant: 'success' });
      tabState.promos.loaded = false;
      loadPromos();
    } catch (e) { /* api() toasted */ }
  }));
}

/* ═══════════════════════════════════════════════════════════════
   TAB 7: AUDIT
   ═══════════════════════════════════════════════════════════════ */

async function loadAudit(page) {
  if (page) tabState.audit.page = page;
  const { page: p, limit, action } = tabState.audit;
  loading('Fetching audit log…');

  let data;
  try {
    const qs = new URLSearchParams({ page: String(p), limit: String(limit) });
    if (action) qs.set('action', action);
    data = await api('/api/admin/audit-log?' + qs.toString());
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load audit log', e.message);
    return;
  }

  const { entries, pagination } = data;

  const knownActions = [
    '', 'withdrawal_rejected', 'withdrawal_approved_initiated', 'withdrawal_approved_airtime',
    'withdrawal_completed', 'bulk_withdrawal_process', 'manual_backup',
    'create_promo_code', 'deactivate_promo_code', 'economy_update', 'economy_reset',
    'flags_update', 'broadcast_start', 'broadcast_done',
  ];

  const html = `
    <div class="admin-section">
      <div class="admin-h">
        <div><h3>Audit Log</h3><div class="admin-h-sub">${fmtInt(pagination.total)} entries · page ${pagination.page}/${pagination.totalPages}</div></div>
      </div>

      <div class="admin-toolbar">
        <select class="admin-select" id="auditAction" style="max-width:280px">
          ${knownActions.map(a => `<option value="${esc(a)}" ${a === action ? 'selected' : ''}>${a || '— all actions —'}</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" id="auditFilter">Filter</button>
      </div>

      ${entries.length === 0 ? emptyState('No audit entries') : `
        <div class="admin-table-wrap">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr>
              </thead>
              <tbody>
                ${entries.map(e => `
                  <tr>
                    <td class="muted">${fmtDate(e.created_at)}</td>
                    <td><b>#${esc(e.actor_id)}</b> <span class="muted">(${esc(e.actor_role || '—')})</span></td>
                    <td><span class="admin-pill sapphire">${esc(e.action)}</span></td>
                    <td class="num">${e.target_user_id || '—'}</td>
                    <td>
                      ${e.details ? `<div class="admin-json">${esc(JSON.stringify(e.details, null, 2))}</div>` : '<span class="muted">—</span>'}
                    </td>
                    <td class="mono muted">${esc(e.ip || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ${paginationHtml(pagination.page, pagination.totalPages, pagination.total, '__PAGE__')}
      `}
    </div>
  `;

  $('adminBody').innerHTML = html.replace(/__PAGE__/g, '');

  $('auditFilter')?.addEventListener('click', () => {
    haptic('light');
    tabState.audit.action = $('auditAction').value;
    tabState.audit.page = 1;
    tabState.audit.loaded = false;
    loadAudit();
  });

  wirePagination($('adminBody'), (p) => loadAudit(p));
}

/* ═══════════════════════════════════════════════════════════════
   TAB 8: BROADCAST (super admin only)
   ═══════════════════════════════════════════════════════════════ */

async function loadBroadcast() {
  if (!_isSuperAdmin) {
    $('adminBody').innerHTML = `
      <div class="admin-empty">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <div><b>Super admin only</b></div>
        <div style="font-size:11.5px;margin-top:4px;color:var(--ink-faint)">Broadcasts are restricted to super admins.</div>
      </div>`;
    return;
  }

  // If a job is in progress, render its status instead of the form
  if (tabState.broadcast.jobId) {
    return renderBroadcastStatus();
  }

  const html = `
    <div class="admin-section">
      <div class="admin-h"><div><h3>Broadcast Message</h3><div class="admin-h-sub">Send a Telegram message to all non-banned users</div></div></div>

      <div class="admin-banner warn">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 11l15-6v14L3 13z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 11v2M9 14v3a2 2 0 0 0 4 0v-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
        <div><b>This sends a Telegram message to ALL non-banned users.</b> Use with caution. Telegram rate-limits to ~30 msg/sec; we pace at 20/sec.</div>
      </div>

      <div class="admin-form-card">
        <div class="admin-field">
          <label>Message (max 4000 chars)</label>
          <textarea class="admin-textarea" id="bcText" maxlength="4000" placeholder="Type your broadcast message here…"></textarea>
          <div class="admin-char-count"><span id="bcCount">0</span> / 4000</div>
        </div>
        <button class="btn btn-primary btn-block" id="bcSend">📣 Send to all users</button>
      </div>
    </div>
  `;

  $('adminBody').innerHTML = html;

  const ta = $('bcText');
  ta?.addEventListener('input', () => {
    const n = ta.value.length;
    $('bcCount').textContent = n;
    $('bcCount').parentElement.classList.toggle('over', n >= 4000);
  });

  $('bcSend')?.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { toast({ title: 'Message is empty', variant: 'error' }); return; }
    if (text.length > 4000) { toast({ title: 'Message too long', variant: 'error' }); return; }
    if (!confirm('Send this broadcast to ALL non-banned users? This cannot be undone.')) return;
    haptic('light');
    const btn = $('bcSend');
    btn.disabled = true; btn.textContent = 'Starting…';
    try {
      const res = await api('/api/admin/broadcast', { method: 'POST', body: { text } });
      tabState.broadcast.jobId = res.jobId;
      toast({ title: 'Broadcast started', message: `Job ${res.jobId} · ${res.total} recipients`, variant: 'success' });
      renderBroadcastStatus();
      startBroadcastPolling();
    } catch (e) { /* api() toasted */ }
    btn.disabled = false; btn.textContent = '📣 Send to all users';
  });
}

function renderBroadcastStatus() {
  const jobId = tabState.broadcast.jobId;
  $('adminBody').innerHTML = `
    <div class="admin-section">
      <div class="admin-h"><div><h3>Broadcast in progress</h3><div class="admin-h-sub">Job ${esc(jobId)}</div></div></div>
      <div class="admin-form-card">
        <div class="admin-progress"><div class="admin-progress-bar" id="bcBar" style="width:0%"></div></div>
        <div class="admin-progress-stats">
          <div>Sent: <b id="bcSent">0</b></div>
          <div>Failed: <b id="bcFailed">0</b></div>
          <div>Total: <b id="bcTotal">0</b></div>
        </div>
        <div style="text-align:center;font-size:12px;color:var(--ink-mute);margin-top:8px" id="bcStatus">Starting…</div>
        <button class="btn btn-ghost btn-block" id="bcDone" style="margin-top:14px;display:none">← Back to compose</button>
      </div>
    </div>
  `;
  $('bcDone')?.addEventListener('click', () => {
    stopBroadcastPolling();
    tabState.broadcast.jobId = null;
    loadBroadcast();
  });
}

function startBroadcastPolling() {
  stopBroadcastPolling();
  broadcastPollTimer = setInterval(async () => {
    if (!tabState.broadcast.jobId) { stopBroadcastPolling(); return; }
    try {
      const job = await api('/api/admin/broadcast/' + tabState.broadcast.jobId);
      const total = job.total || 1;
      const done = (job.sent || 0) + (job.failed || 0);
      const pct = Math.min(100, (done / total) * 100);
      const bar = $('bcBar');
      if (bar) bar.style.width = pct + '%';
      const sEl = $('bcSent'), fEl = $('bcFailed'), tEl = $('bcTotal'), stEl = $('bcStatus');
      if (sEl) sEl.textContent = job.sent || 0;
      if (fEl) fEl.textContent = job.failed || 0;
      if (tEl) tEl.textContent = job.total || 0;
      if (stEl) stEl.textContent = `Status: ${job.status} · ${pct.toFixed(0)}%`;
      if (job.status === 'done' || job.status === 'error') {
        stopBroadcastPolling();
        if (stEl) stEl.textContent = `Status: ${job.status === 'done' ? 'completed' : 'error'} · ${pct.toFixed(0)}%`;
        const doneBtn = $('bcDone');
        if (doneBtn) doneBtn.style.display = '';
        haptic(job.status === 'done' ? 'success' : 'light');
        toast({ title: job.status === 'done' ? 'Broadcast complete' : 'Broadcast failed', variant: job.status === 'done' ? 'success' : 'error' });
      }
    } catch (e) { /* api() toasted; stop polling */ stopBroadcastPolling(); }
  }, 1000);
}

function stopBroadcastPolling() {
  if (broadcastPollTimer) { clearInterval(broadcastPollTimer); broadcastPollTimer = null; }
}

/* ═══════════════════════════════════════════════════════════════
   TAB 9: SETTINGS
   ═══════════════════════════════════════════════════════════════ */

async function loadSettings() {
  loading('Fetching feature flags…');
  let data;
  try {
    data = await api('/api/admin/settings');
  } catch (e) {
    $('adminBody').innerHTML = emptyState('Failed to load settings', e.message);
    return;
  }

  const flags = data.flags || {};
  const defaults = data.defaults || {};

  const flagDefs = [
    { key: 'maintenance_mode', label: 'Maintenance mode', desc: 'Block all non-admin write actions for users' },
    { key: 'withdrawals_enabled', label: 'Withdrawals enabled', desc: 'Allow users to request cash-outs' },
    { key: 'games_enabled', label: 'Games enabled', desc: 'Spin / scratch / coinflip / chest / lottery' },
    { key: 'mining_enabled', label: 'Mining enabled', desc: 'Accrual + refuel (ads)' },
    { key: 'faucet_enabled', label: 'Faucet enabled', desc: 'Hourly bonus claim' },
    { key: 'broadcast_enabled', label: 'Broadcast enabled', desc: 'Allow sending broadcast messages' },
    { key: 'signups_enabled', label: 'Signups enabled', desc: 'Allow new user creation' },
  ];

  const html = `
    ${flags.maintenance_mode ? `
      <div class="admin-banner">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        <div><b>Maintenance mode is currently ON.</b> Regular users cannot perform any write action.</div>
      </div>
    ` : ''}

    <div class="admin-section">
      <div class="admin-h">
        <div><h3>Feature Flags</h3><div class="admin-h-sub">${_isSuperAdmin ? 'Toggle to enable/disable platform features' : 'View-only — super admin required to toggle'}</div></div>
      </div>

      <div class="admin-form-card">
        ${flagDefs.map(f => `
          <label class="admin-flag-chip" style="margin-bottom:8px">
            <span class="lbl">
              <b>${esc(f.label)}</b>
              <span>${esc(f.desc)}</span>
            </span>
            <span class="admin-toggle">
              <input type="checkbox" data-flag="${f.key}" ${flags[f.key] ? 'checked' : ''} ${!_isSuperAdmin ? 'disabled' : ''} />
              <span class="track"></span>
            </span>
          </label>
        `).join('')}
      </div>
    </div>
  `;

  $('adminBody').innerHTML = html;

  document.querySelectorAll('input[data-flag]').forEach(input => {
    input.addEventListener('change', async () => {
      if (!_isSuperAdmin) { input.checked = !input.checked; return; }
      const key = input.dataset.flag;
      const val = input.checked;
      haptic('light');
      try {
        await api('/api/admin/settings', { method: 'PUT', body: { flags: { [key]: val } } });
        toast({ title: `${key} ${val ? 'enabled' : 'disabled'}`, variant: 'success' });
        // If maintenance mode changed, reload to show/hide banner
        if (key === 'maintenance_mode') {
          tabState.settings.loaded = false;
          loadSettings();
        }
      } catch (e) { /* api() toasted */ }
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   SETUP — wires chip, close, tab switching
   ═══════════════════════════════════════════════════════════════ */

export function setupAdmin() {
  const chip = $('adminChip');
  const veil = $('adminVeil');
  const closeBtn = $('adminClose');
  const tabs = $('adminTabs');

  if (chip && veil) {
    chip.addEventListener('click', async (e) => {
      e.preventDefault();
      const S = getState();
      const isAdmin = S.role === 'admin' || S.role === 'mod' || (S.permissions && S.permissions.length > 0);
      if (!isAdmin) {
        toast({ title: 'Admin access required', variant: 'error' });
        return;
      }
      haptic('light');
      veil.classList.add('show');
      veil.setAttribute('aria-hidden', 'false');
      // Determine super admin status (cached) and update sub label
      const ai = adminInfo();
      const sub = $('adminSub');
      _isSuperAdmin = await isSuperAdmin();
      if (sub) {
        const roleLabel = _isSuperAdmin ? 'Super Admin' : (ai.role === 'admin' ? 'Admin' : 'Moderator');
        sub.innerHTML = `Signed in as <b>${esc(roleLabel)}</b>`;
      }
      // Reset all tab loaded flags so first open always refreshes
      for (const k of Object.keys(tabState)) {
        if (tabState[k]) tabState[k].loaded = false;
      }
      // Initial tab
      await switchTab(currentTab);
    });
  }

  if (closeBtn && veil) {
    closeBtn.addEventListener('click', () => {
      haptic('light');
      veil.classList.remove('show');
      veil.setAttribute('aria-hidden', 'true');
      // Stop any broadcast polling when closing
      stopBroadcastPolling();
    });
  }

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && veil && veil.classList.contains('show')) {
      veil.classList.remove('show');
      veil.setAttribute('aria-hidden', 'true');
      stopBroadcastPolling();
    }
  });

  // Tab switching
  if (tabs) {
    tabs.querySelectorAll('.admin-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        haptic('light');
        const tab = btn.dataset.tab;
        switchTab(tab);
      });
    });
  }
}
