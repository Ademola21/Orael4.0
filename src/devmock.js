/* ========================================================================
   devmock.js — Browser mock layer (ALWAYS ON in frontend-only mode)
   ------------------------------------------------------------------------
   Installs a mock `window.Telegram.WebApp` and a mock `window.Adsgram` so
   the entire app boots in any browser with no backend, no Telegram, and no
   real Adsgram SDK. The mock API in `src/api.js` intercepts every /api/*
   call and returns realistic localStorage-backed data.

   If running inside REAL Telegram with real initData, the mocks are skipped
   so production behavior is preserved.
   ======================================================================== */

const DEV_USER_ID = 10042024;

// Only install mocks if we're NOT inside a real Telegram WebApp
const existing = window.Telegram?.WebApp;
const hasRealInitData = typeof existing?.initData === 'string' && existing.initData.length > 0;

export const isDevMode = !hasRealInitData;

if (!hasRealInitData) {
  const mockUser = {
    id: DEV_USER_ID,
    first_name: 'Ademola',
    last_name: 'O.',
    username: 'ademola21',
    photo_url: '',
    language_code: 'en',
  };

  const noop = () => {};
  const mockInitData = `dev=1&user=${encodeURIComponent(JSON.stringify(mockUser))}`;

  const mock = {
    initData: mockInitData,
    initDataUnsafe: { user: mockUser, start_param: '' },
    version: '8.0',
    platform: 'web',
    colorScheme: 'dark',
    themeParams: {},
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    isExpanded: true,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    headerColor: '#0b0f1a',
    backgroundColor: '#0b0f1a',
    ready: noop,
    expand: noop,
    close: noop,
    enableClosingConfirmation: noop,
    disableClosingConfirmation: noop,
    setHeaderColor: noop,
    setBackgroundColor: noop,
    disableVerticalSwipes: noop,
    enableVerticalSwipes: noop,
    openInvoice: (url, cb) => {
      // Simulate a successful Telegram Stars payment
      console.log('[devmock] openInvoice simulated success:', url);
      setTimeout(() => cb && cb('paid'), 900);
    },
    openTelegramLink: (u) => window.open(u, '_blank'),
    openLink: (u) => window.open(u, '_blank'),
    HapticFeedback: {
      impactOccurred: noop,
      notificationOccurred: noop,
      selectionChanged: noop,
    },
    BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
    MainButton: {
      show: noop, hide: noop, setText: noop, enable: noop, disable: noop,
      onClick: noop, offClick: noop, setParams: noop,
    },
    SettingsButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
    showAlert: (msg) => window.alert(msg),
    showConfirm: (msg, cb) => cb && cb(window.confirm(msg)),
    showPopup: (p, cb) => cb && cb('ok'),
  };

  window.Telegram = window.Telegram || {};
  window.Telegram.WebApp = mock;
  window.__ORAEL_DEV__ = true;
  console.info('[devmock] Telegram WebApp mock installed (frontend-only mode).');

  // AdsGram mock: simulate a rewarded video that resolves as "watched" after
  // ~1.2s so all ad-gated actions (refuel, faucet, spin, scratch, ...) work
  // without a real Adsgram block.
  window.Adsgram = {
    init: ({ blockId }) => {
      const listeners = {};
      const controller = {
        show: () => new Promise((resolve) => {
          setTimeout(() => resolve({ done: true, description: 'dev mock ad', state: 'destroy', error: false }), 1200);
        }),
        addEventListener: (ev, cb) => { listeners[ev] = cb; },
        removeEventListener: noop,
        destroy: noop,
      };
      controller._listeners = listeners;
      return controller;
    },
  };
  console.info('[devmock] Adsgram mock installed (resolves show() after 1.2s).');

  // Intercept fetch() for /api/profile/avatar/upload so the multipart upload
  // (which bypasses the api() wrapper) is handled by the mock layer.
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (url === '/api/profile/avatar/upload' && init?.method === 'POST') {
      // Read the uploaded file from the FormData body
      const form = init.body;
      let file = null;
      if (form instanceof FormData) {
        for (const [key, value] of form.entries()) {
          if (key === 'avatar' && value instanceof Blob) {
            file = value;
            break;
          }
        }
      }
      // Convert the blob to a data URL and persist via the mock state
      if (file) {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        // Update mock state directly
        try {
          const raw = localStorage.getItem('orael_mock_state');
          const state = raw ? JSON.parse(raw) : {};
          state.avatarUrl = dataUrl;
          state.photoUrl = dataUrl;
          localStorage.setItem('orael_mock_state', JSON.stringify(state));
        } catch (e) { /* ignore */ }
      }
      // Return a mock JSON response
      return new Response(JSON.stringify({ ok: true, avatarUrl: 'uploaded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch.apply(this, arguments);
  };
  console.info('[devmock] fetch() interceptor installed for avatar upload.');
}
