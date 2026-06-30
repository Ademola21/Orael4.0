/* ========================================================================
   admin.js — Orael Admin Panel
   ======================================================================== */

let currentUserId = null;
let currentUserPerms = [];

// ─── API helper ───────────────────────────────────────────────
async function api(path, options = {}) {
  const initData = window.Telegram?.WebApp?.initData || '';
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData,
    ...(options.headers || {}),
  };

  try {
    const res = await fetch(path, {
      ...options,
      headers,
      body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
    });

    if (res.status === 403) {
      const err = await res.json().catch(() => ({}));
      showGate(err.error || 'Access denied');
      throw new Error(err.error || 'Access denied');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      toast(err.error || `HTTP ${res.status}`);
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return await res.json();
  } catch (err) {
    if (err.message !== 'Access denied') {
      toast(err.message || 'Network error');
    }
    throw err;
  }
}

function showGate(msg) {
  const gate = document.getElementById('gate');
  const panel = document.getElementById('panel');
  if (msg) document.getElementById('gateMsg').textContent = msg;
  gate.style.display = 'flex';
  panel.style.display = 'none';
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

function fmt(n, d = 2) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtInt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return Math.floor(hr / 24) + 'd ago';
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  // Init Telegram SDK
  const tg = window.Telegram?.WebApp;
  if (tg) {
    try { tg.ready(); } catch (e) {}
    try { tg.expand(); } catch (e) {}
  }

  // Check if we have initData
  if (!tg?.initData) {
    showGate('Admin panel must be opened from inside the Orael Telegram bot. Open the bot, then tap the ADMIN chip in the top bar.');
    return;
  }

  // Load permissions
  try {
    const data = await api('/api/admin/permissions');
    if (!data.myPermissions || data.myPermissions.length === 0) {
      showGate('You do not have admin or mod permissions. Ask a super admin to grant you access.');
      return;
    }
    window.myPermissions = data.myPermissions;
    window.isSuperAdmin = data.isSuperAdmin;

    document.getElementById('panel').style.display = 'block';
    loadSection('dashboard');
  } catch (e) {
    // showGate already called
  }
}

// ─── Tabs ─────────────────────────────────────────────────────
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    loadSection(tab.dataset.section);
  });
});

function loadSection(section) {
  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + section).classList.add('active');

  if (section === 'dashboard') loadDashboard();
  else if (section === 'users') loadUsers(1);
  else if (section === 'withdrawals') loadWithdrawals(1);
  else if (section === 'transactions') loadTransactions(1);
}

// ─── Dashboard ────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const stats = await api('/api/admin/stats');
    document.getElementById('statsGrid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Total Users</div>
        <div class="stat-value">${fmtInt(stats.totalUsers)}</div>
        <div class="stat-sub">${stats.proUsers} Pro · ${stats.bannedUsers} banned</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Balance</div>
        <div class="stat-value gold">${fmtInt(stats.totalBalance)} ORL</div>
        <div class="stat-sub">$${fmt(stats.totalBalanceUsd)} · ₦${fmtInt(stats.totalBalance * 0.02)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Mined</div>
        <div class="stat-value emerald">${fmtInt(stats.totalMined)} ORL</div>
        <div class="stat-sub">$${fmt(stats.totalMinedUsd)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ad Rewards Paid</div>
        <div class="stat-value gold">${fmtInt(stats.totalAds)} ORL</div>
        <div class="stat-sub">$${fmt(stats.totalAdsUsd)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Withdrawals</div>
        <div class="stat-value">${fmtInt(stats.totalWithdrawals)} ORL</div>
        <div class="stat-sub">$${fmt(stats.totalWithdrawalsUsd)} processed</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pending</div>
        <div class="stat-value ruby">${stats.pendingWithdrawals}</div>
        <div class="stat-sub">awaiting review</div>
      </div>
    `;
    document.getElementById('pendingCount').textContent = stats.pendingWithdrawals;
  } catch (e) {}
}

// ─── Users ────────────────────────────────────────────────────
async function loadUsers(page) {
  const search = document.getElementById('userSearch')?.value || '';
  try {
    const data = await api(`/api/admin/users?page=${page}&limit=20${search ? `&search=${encodeURIComponent(search)}` : ''}`);
    const tbody = document.getElementById('usersTable');

    if (!data.users.length) {
      tbody.innerHTML = `<div class="empty-state">No users found.</div>`;
      document.getElementById('usersPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Telegram</th><th>Balance</th><th>Role</th><th>Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.users.map(u => `
            <tr>
              <td>${u.id}</td>
              <td>${u.first_name || '-'} ${u.last_name || ''}<br><small style="color:var(--ink-faint)">@${u.username || '-'}</small></td>
              <td><code>${u.telegram_id}</code></td>
              <td><b style="color:var(--gold-1)">${fmtInt(u.balance)}</b></td>
              <td><span class="role-badge ${u.role}">${u.role || 'user'}</span></td>
              <td>${u.banned ? '<span style="color:var(--ruby)">BANNED</span>' : '<span style="color:var(--emerald)">Active</span>'}</td>
              <td>
                <button class="btn btn-ghost" onclick="viewUser(${u.id})">View</button>
                ${hasPerm('ban_users') ? `<button class="btn ${u.banned ? 'btn-success' : 'btn-danger'}" onclick="toggleBan(${u.id}, ${u.banned ? 0 : 1})">${u.banned ? 'Unban' : 'Ban'}</button>` : ''}
                ${hasPerm('adjust_balance') ? `<button class="btn btn-ghost" onclick="openBalance(${u.id}, '${(u.first_name || 'user').replace(/'/g, "\\'")}')">±ORL</button>` : ''}
                ${hasPerm('manage_mods') ? `<button class="btn btn-ghost" onclick="openRole(${u.id}, '${(u.first_name || 'user').replace(/'/g, "\\'")}', '${u.role || 'user'}', '${u.permissions || ''}')">Role</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    renderPagination('usersPagination', data.pagination, loadUsers);
  } catch (e) {}
}

async function viewUser(userId) {
  try {
    const data = await api(`/api/admin/users/${userId}`);
    const u = data.user;
    document.getElementById('userModalTitle').textContent = `${u.first_name || 'User'} @${u.username || ''}`;
    document.getElementById('userModalBody').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
        <div><b>ID:</b> ${u.id}</div>
        <div><b>Telegram:</b> <code>${u.telegram_id}</code></div>
        <div><b>Balance:</b> <span style="color:var(--gold-1)">${fmtInt(u.balance)} ORL</span></div>
        <div><b>Tier:</b> ${u.tier}</div>
        <div><b>Role:</b> <span class="role-badge ${u.role}">${u.role}</span></div>
        <div><b>Country:</b> ${u.country || '-'}</div>
        <div><b>Pro until:</b> ${u.pro_until > Date.now() ? new Date(u.pro_until).toLocaleString() : 'Not Pro'}</div>
        <div><b>Joined:</b> ${new Date(u.created_at).toLocaleDateString()}</div>
        <div><b>Referrals:</b> ${u.ref_count} (${u.ref_earnings} ORL earned)</div>
        <div><b>Status:</b> ${u.banned ? '<span style="color:var(--ruby)">BANNED</span>' : 'Active'}</div>
      </div>
      <h4 style="margin-top:18px;margin-bottom:8px;color:var(--ink-soft)">Recent transactions</h4>
      <div style="max-height:200px;overflow-y:auto">
        ${data.transactions.slice(0, 10).map(t => `
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line);font-size:12px">
            <span>${t.description || t.type}</span>
            <span style="color:${t.amount >= 0 ? 'var(--emerald)' : 'var(--ruby)'};font-family:var(--font-mono)">${t.amount >= 0 ? '+' : ''}${fmtInt(t.amount)}</span>
          </div>
        `).join('') || '<div class="empty-state">No transactions</div>'}
      </div>
    `;
    document.getElementById('userModal').classList.add('show');
  } catch (e) {}
}

async function toggleBan(userId, banned) {
  if (!confirm(`${banned ? 'Ban' : 'Unban'} this user?`)) return;
  try {
    await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: { banned } });
    toast(`User ${banned ? 'banned' : 'unbanned'}`);
    loadUsers(document.querySelector('.pg-info')?.textContent?.split(' ')[0] || 1);
  } catch (e) {}
}

function openBalance(userId, name) {
  currentUserId = userId;
  document.getElementById('balUser').textContent = name;
  document.getElementById('balAmount').value = '';
  document.getElementById('balReason').value = '';
  document.getElementById('balanceModal').classList.add('show');
}

async function submitBalance() {
  const amount = parseFloat(document.getElementById('balAmount').value);
  const reason = document.getElementById('balReason').value;
  if (!amount || isNaN(amount)) { toast('Invalid amount'); return; }

  try {
    await api(`/api/admin/users/${currentUserId}/balance`, { method: 'POST', body: { amount, reason } });
    toast('Balance adjusted');
    closeModal('balanceModal');
    loadUsers(document.querySelector('.pg-info')?.textContent?.split(' ')[0] || 1);
  } catch (e) {}
}

const MOD_PERMS = [
  { id: 'view_users', label: 'View users' },
  { id: 'ban_users', label: 'Ban users' },
  { id: 'adjust_balance', label: 'Adjust balance' },
  { id: 'process_withdrawals', label: 'Process withdrawals' },
  { id: 'view_transactions', label: 'View transactions' },
  { id: 'manage_mods', label: 'Manage mods' },
];

function openRole(userId, name, role, perms) {
  currentUserId = userId;
  currentUserPerms = perms ? perms.split(',').filter(Boolean) : [];
  document.getElementById('roleUser').textContent = name;
  document.getElementById('roleSelect').value = role;

  document.getElementById('permsGrid').innerHTML = MOD_PERMS.map(p => `
    <div class="perm-check">
      <input type="checkbox" id="perm-${p.id}" ${currentUserPerms.includes(p.id) ? 'checked' : ''} />
      <label for="perm-${p.id}">${p.label}</label>
    </div>
  `).join('');

  document.getElementById('roleModal').classList.add('show');
}

async function submitRole() {
  const role = document.getElementById('roleSelect').value;
  const perms = MOD_PERMS
    .filter(p => document.getElementById('perm-' + p.id).checked)
    .map(p => p.id);

  try {
    await api(`/api/admin/users/${currentUserId}/role`, { method: 'POST', body: { role, permissions: perms } });
    toast('Role updated');
    closeModal('roleModal');
    loadUsers(document.querySelector('.pg-info')?.textContent?.split(' ')[0] || 1);
  } catch (e) {}
}

// ─── Withdrawals ──────────────────────────────────────────────
async function loadWithdrawals(page) {
  const status = document.getElementById('withdrawalStatus')?.value || 'pending';
  try {
    const data = await api(`/api/admin/withdrawals?page=${page}&limit=20&status=${status}`);
    const tbody = document.getElementById('withdrawalsTable');

    if (!data.withdrawals.length) {
      tbody.innerHTML = `<div class="empty-state">No ${status} withdrawals.</div>`;
      document.getElementById('withdrawalsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th><th>User</th><th>Method</th><th>Amount</th><th>Fee</th><th>Net</th><th>Wallet</th><th>Date</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.withdrawals.map(w => `
            <tr>
              <td>${w.id}</td>
              <td>${w.first_name || '-'}<br><small style="color:var(--ink-faint)">@${w.username || '-'}</small></td>
              <td><span style="text-transform:uppercase;color:var(--gold-1)">${w.method}</span></td>
              <td><b>${fmtInt(w.amount_orl)} ORL</b></td>
              <td>${fmtInt(w.fee_orl)}</td>
              <td style="color:var(--emerald)">${w.method === 'usdt' ? '$' + fmt(w.net_amount / 75000) : '₦' + fmt(w.net_amount * 0.02)}</td>
              <td><code style="font-size:11px">${w.wallet_info || '-'}</code></td>
              <td><small>${new Date(w.created_at).toLocaleDateString()}</small></td>
              <td>
                ${w.status === 'pending' && hasPerm('process_withdrawals') ? `
                  <button class="btn btn-success" onclick="processWithdrawal(${w.id}, 'completed')">Approve</button>
                  <button class="btn btn-danger" onclick="processWithdrawal(${w.id}, 'rejected')">Reject</button>
                ` : `<span class="role-badge ${w.status === 'completed' ? 'admin' : w.status === 'rejected' ? 'mod' : 'user'}">${w.status}</span>`}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    renderPagination('withdrawalsPagination', data.pagination, loadWithdrawals);
  } catch (e) {}
}

async function processWithdrawal(wid, status) {
  if (!confirm(`${status === 'completed' ? 'Approve' : 'Reject'} withdrawal #${wid}?`)) return;
  try {
    await api(`/api/admin/withdrawals/${wid}/process`, { method: 'POST', body: { status } });
    toast(`Withdrawal ${status}`);
    loadWithdrawals(document.querySelector('.pg-info')?.textContent?.split(' ')[0] || 1);
    loadDashboard();
  } catch (e) {}
}

// ─── Transactions ─────────────────────────────────────────────
async function loadTransactions(page) {
  try {
    const data = await api(`/api/admin/transactions?page=${page}&limit=50`);
    const tbody = document.getElementById('transactionsTable');

    if (!data.transactions.length) {
      tbody.innerHTML = `<div class="empty-state">No transactions yet.</div>`;
      document.getElementById('transactionsPagination').innerHTML = '';
      return;
    }

    tbody.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>ID</th><th>User</th><th>Type</th><th>Amount</th><th>Description</th><th>Date</th>
          </tr>
        </thead>
        <tbody>
          ${data.transactions.map(t => `
            <tr>
              <td>${t.id}</td>
              <td>${t.first_name || '-'}<br><small style="color:var(--ink-faint)">@${t.username || '-'}</small></td>
              <td><code style="color:var(--gold-1)">${t.type}</code></td>
              <td style="color:${t.amount >= 0 ? 'var(--emerald)' : 'var(--ruby)'};font-family:var(--font-mono)">${t.amount >= 0 ? '+' : ''}${fmtInt(t.amount)}</td>
              <td><small>${t.description || '-'}</small></td>
              <td><small>${new Date(t.created_at).toLocaleString()}</small></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    renderPagination('transactionsPagination', data.pagination, loadTransactions);
  } catch (e) {}
}

// ─── Helpers ──────────────────────────────────────────────────
function hasPerm(perm) {
  if (!window.myPermissions) return false;
  return window.myPermissions.includes('all') || window.myPermissions.includes(perm);
}

function renderPagination(elId, pg, loadFn) {
  const el = document.getElementById(elId);
  if (pg.totalPages <= 1) { el.innerHTML = ''; return; }
  const fnName = loadFn.name;
  el.innerHTML = `
    <button class="btn btn-ghost" ${pg.page <= 1 ? 'disabled' : ''} onclick="${fnName}(${pg.page - 1})">← Prev</button>
    <span class="pg-info">${pg.page} / ${pg.totalPages} (${pg.total} total)</span>
    <button class="btn btn-ghost" ${pg.page >= pg.totalPages ? 'disabled' : ''} onclick="${fnName}(${pg.page + 1})">Next →</button>
  `;
}

// Expose functions globally for inline onclick handlers
window.loadSection = loadSection;
window.loadDashboard = loadDashboard;
window.loadUsers = loadUsers;
window.loadWithdrawals = loadWithdrawals;
window.loadTransactions = loadTransactions;
window.viewUser = viewUser;
window.toggleBan = toggleBan;
window.openBalance = openBalance;
window.submitBalance = submitBalance;
window.openRole = openRole;
window.submitRole = submitRole;
window.processWithdrawal = processWithdrawal;
window.closeModal = closeModal;

// ─── Start ────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
