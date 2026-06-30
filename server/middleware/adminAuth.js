// ─────────────────────────────────────────────────────────────
//  adminAuth.js — Admin & Mod permission middleware
// ─────────────────────────────────────────────────────────────
//
//  Roles:
//    - admin: full access (defined by ADMIN_IDS in .env)
//    - mod:   limited access (set by admin, granular permissions)
//    - user:  no admin access
//
//  Mod permissions (stored as comma-separated string in users.permissions):
//    - view_users      : view user list
//    - ban_users       : ban/unban users
//    - adjust_balance  : credit/debit user balance
//    - process_withdrawals : approve/reject withdrawals
//    - view_transactions   : view all transactions
//    - manage_mods     : promote/demote mods (admin-only in practice)
// ─────────────────────────────────────────────────────────────

import { getUser } from '../db.js';

/**
 * Parse ADMIN_IDS from env (comma-separated Telegram IDs)
 */
function getAdminIds() {
  const raw = process.env.ADMIN_IDS || '';
  return raw.split(',').map(s => parseInt(s.trim())).filter(Boolean);
}

/**
 * Check if a Telegram user ID is a super admin (defined in .env)
 */
export function isSuperAdmin(telegramId) {
  const adminIds = getAdminIds();
  return adminIds.includes(Number(telegramId));
}

/**
 * Get the list of mod permissions for a user.
 * @param {object} user - DB user row
 * @returns {string[]} array of permission strings
 */
export function getPermissions(user) {
  if (!user) return [];
  if (user.role === 'admin' || isSuperAdmin(user.telegram_id)) {
    return ['all'];
  }
  if (!user.permissions) return [];
  return user.permissions.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Check if user has a specific permission.
 * @param {object} user - DB user row
 * @param {string} perm - permission string
 * @returns {boolean}
 */
export function hasPermission(user, perm) {
  const perms = getPermissions(user);
  if (perms.includes('all')) return true;
  return perms.includes(perm);
}

/**
 * Middleware: require admin (super admin or mod with any permission).
 * Reads Telegram initData + checks DB user role.
 */
export async function requireAdmin(req, res, next) {
  const telegramUser = req.telegramUser;
  if (!telegramUser) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Super admin check (from .env)
  if (isSuperAdmin(telegramUser.id)) {
    req.adminUser = { ...getUser(telegramUser.id), role: 'admin' };
    req.isAdmin = true;
    req.permissions = ['all'];
    return next();
  }

  // Mod check (from DB)
  const dbUser = getUser(telegramUser.id);
  if (!dbUser) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (dbUser.banned === 1) {
    return res.status(403).json({ error: 'User is banned' });
  }

  if (dbUser.role !== 'admin' && dbUser.role !== 'mod') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.adminUser = dbUser;
  req.isAdmin = dbUser.role === 'admin';
  req.permissions = getPermissions(dbUser);
  next();
}

/**
 * Middleware: require a specific permission.
 * @param {string} perm
 */
export function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.permissions || !req.permissions.includes('all') && !req.permissions.includes(perm)) {
      return res.status(403).json({ error: `Missing permission: ${perm}` });
    }
    next();
  };
}

/**
 * All mod permissions with labels for the admin UI.
 */
export const MOD_PERMISSIONS = [
  { id: 'view_users',           label: 'View users',          desc: 'See user list and details' },
  { id: 'ban_users',            label: 'Ban users',           desc: 'Ban or unban users' },
  { id: 'adjust_balance',       label: 'Adjust balance',      desc: 'Credit or debit ORL balances' },
  { id: 'process_withdrawals',  label: 'Process withdrawals', desc: 'Approve or reject withdrawal requests' },
  { id: 'view_transactions',    label: 'View transactions',   desc: 'View all platform transactions' },
  { id: 'manage_mods',          label: 'Manage mods',         desc: 'Promote/demote moderators (admin-only)' },
];
