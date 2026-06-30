/* ========================================================================
   state.js — Client state management
   Holds the latest server response + local-only UI state.
   The client NEVER computes game outcomes. It only renders server data.
   ======================================================================== */

/**
 * The master state object.
 * Server-sourced fields are merged in via updateState().
 * Local-only fields (prefixed with underscore convention or explicit) track
 * UI-only concerns like which screen is active.
 */
let S = {
  /* ---- Server-sourced fields (authoritative) ---- */
  balance: 0,
  tier: 1,
  rigLevel: 0,
  tankMined: 0,
  lastAccrue: Date.now(),
  boostUntil: 0,
  proUntil: 0,
  faucetLast: 0,
  streakDay: 0,
  streakAmounts: [60, 90, 140, 210, 290, 390, 770],
  spinFreeUsed: false,
  scratchLeft: 999,
  chestProgress: 0,
  lottoTickets: 0,

  // Ad challenge
  adChallenge: { count: 0, milestones: [], nextMilestone: null },

  // Pro free chest
  proChestReady: false,
  proChestLast: 0,

  // User identity
  photoUrl: null,
  tutorialSeen: false,
  role: 'user',
  permissions: '',
  firstName: '',

  // Referral stats
  ref: { count: 0, earned: 0, active: 0 },
  refCode: '',

  // Rig definition from server
  rig: { name: 'Rig I', sessionMin: 240, cost: 0 },
  rigs: [],      // all rig tiers
  nextRig: null, // next upgrade tier

  // Tasks, completed
  tasks: [],
  featuredTasks: [],
  completedTasks: {},

  // Transactions / history
  transactions: [],



  // Leaderboard
  leaderboard: [],

  // Lottery
  lottoPool: 0,
  lottoPlayers: 0,

  /* ---- Local-only state (not sent to / from server) ---- */
  _loaded: false,
  _screen: 'mine',
  _selectedMethod: { id: 'bank', name: 'Bank (NGN)', min: 75000 },
  _earnTab: 'tasks',
  _tutorialSeen: false,
  _historyPage: 1,
};

/**
 * Merge server response data into the state object.
 * Only overwrites keys that exist in the response — local-only keys (prefixed
 * with `_`) are never touched by server data.
 *
 * @param {object} serverResponse — JSON from any /api/* endpoint
 */
export function updateState(serverResponse) {
  if (!serverResponse || typeof serverResponse !== 'object') return;

  let data = serverResponse;
  if (serverResponse.user && typeof serverResponse.user === 'object') {
    data = serverResponse.user;
  }

  for (const key of Object.keys(data)) {
    // Protect local-only keys from being overwritten by server
    if (key.startsWith('_')) continue;

    const val = data[key];

    // Deep-merge plain objects (one level), replace everything else
    if (
      val !== null &&
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof S[key] === 'object' &&
      S[key] !== null &&
      !Array.isArray(S[key])
    ) {
      S[key] = { ...S[key], ...val };
    } else {
      S[key] = val;
    }
  }

  // Save cache to localStorage keyed by user ID
  try {
    const userId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    if (userId) {
      const toCache = {};
      const keysToCache = [
        'balance', 'tier', 'rigLevel', 'tankMined', 'lastAccrue',
        'boostUntil', 'proUntil', 'faucetLast', 'streakDay',
        'spinFreeUsed', 'scratchLeft', 'chestProgress', 'lottoTickets',
        'ref', 'refCode', 'rig'
      ];
      for (const key of keysToCache) {
        if (S[key] !== undefined) {
          toCache[key] = S[key];
        }
      }
      localStorage.setItem(`orael_state_${userId}`, JSON.stringify(toCache));
    }
  } catch (e) {
    console.error('Failed to save state cache:', e);
  }
}

/**
 * Load cached state from localStorage for a specific user ID.
 * @param {number|string} userId
 */
export function loadCachedState(userId) {
  if (!userId) return;
  try {
    const cached = localStorage.getItem(`orael_state_${userId}`);
    if (cached) {
      const parsed = JSON.parse(cached);
      for (const key of Object.keys(parsed)) {
        if (!key.startsWith('_')) {
          S[key] = parsed[key];
        }
      }
      S._loaded = true;
    }
  } catch (e) {
    console.error('Failed to load cached state:', e);
  }
}

/**
 * Get the current state object (read-only reference).
 * @returns {object}
 */
export function getState() {
  return S;
}

/**
 * Set a local-only state key.
 * @param {string} key
 * @param {any} value
 */
export function setLocal(key, value) {
  S[key] = value;
}

/**
 * Reset state to initial defaults.
 * Used mainly for testing / logout.
 */
export function resetState() {
  const localKeys = Object.keys(S).filter(k => k.startsWith('_'));
  const localSnap = {};
  localKeys.forEach(k => { localSnap[k] = S[k]; });
  S = { ...S, balance: 0, rigLevel: 0, tankMined: 0 };
  Object.assign(S, localSnap);
}
