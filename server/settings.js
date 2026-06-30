// ─────────────────────────────────────────────────────────────
//  settings.js — Live, admin-editable config (economy + flags)
//
//  The economy constants in economy.js are the DEFAULTS. Admins can override
//  any subset of them from the admin panel; overrides are stored in the
//  `settings` table and merged on top of the defaults here. getEconomyConfig()
//  caches the merged result and is invalidated when an admin saves changes.
//
//  Feature flags (maintenance mode, withdrawals disabled, etc.) work the same
//  way — stored under the `feature_flags` settings key.
// ─────────────────────────────────────────────────────────────

import { getSetting } from './db.js';
import * as ECON from './economy.js';

let _economyCache = null;
let _flagsCache = null;

/**
 * Return the full economy config: defaults merged with admin overrides.
 * Cached; call invalidateEconomyCache() after an admin saves new overrides.
 */
export function getEconomyConfig() {
  if (_economyCache) return _economyCache;
  const overrides = getSetting('economy_overrides', {}) || {};
  _economyCache = { ...ECON.ECONOMY_CONFIG, ...overrides };
  return _economyCache;
}

/** Invalidate the cached economy config so the next read picks up DB changes. */
export function invalidateEconomyCache() {
  _economyCache = null;
}

/**
 * Default feature flags. Admins can flip these from the panel.
 */
export const DEFAULT_FLAGS = {
  maintenance_mode: false,       // when true, all non-admin write actions are blocked
  withdrawals_enabled: true,     // when false, new withdrawal requests are blocked
  games_enabled: true,           // when false, spin/scratch/coinflip/chest/lottery blocked
  mining_enabled: true,          // when false, accrual pauses (refuel blocked)
  faucet_enabled: true,          // when false, faucet claims blocked
  broadcast_enabled: true,       // when false, broadcast sending blocked
  signups_enabled: true,         // when false, new user creation blocked (maintenance)
};

/**
 * Return the current feature flags merged with defaults.
 */
export function getFeatureFlags() {
  if (_flagsCache) return _flagsCache;
  const stored = getSetting('feature_flags', {}) || {};
  _flagsCache = { ...DEFAULT_FLAGS, ...stored };
  return _flagsCache;
}

export function invalidateFlagsCache() {
  _flagsCache = null;
}

/**
 * Check a single feature flag.
 */
export function isFeatureEnabled(flag) {
  const flags = getFeatureFlags();
  return flags[flag] !== false;
}
