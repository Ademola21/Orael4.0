# Orael — Frontend Only (Mock Data Mode)

AI mining faucet. Users trade attention (rewarded ads) for mining energy.
"Refuel-to-Mine" loop: a virtual engine mines ORL for 3 hours, then runs out
of fuel; one rewarded ad refuels it to 100%. Optional ad unlocks a 1.2× boost.

> **This fork has the backend removed.** All `/api/*` calls are intercepted
> by a mock layer (`src/api.js`) backed by `localStorage`. The Telegram WebApp
> SDK and Adsgram SDK are mocked by `src/devmock.js` so the app boots in any
> browser — no Telegram, no server, no database required.

## Live Demo

**https://ademola21.github.io/Orael-frontend/**

## What's Kept

- Full single-page UI shell (`index.html`) with all 4 screens:
  Miner · Play · Earn · Wallet
- All frontend logic in `src/` — state management, animations, toasts,
  tutorial onboarding, tier modal, profile/avatar picker, scratch canvas,
  coin flip 3D animation, etc.
- The "Engine Room" sapphire + gold design system in `src/styles/`
- 10 default avatar PNGs in `public/avatars/` + device upload support

## What's Removed

- `server/` — entire Express + SQLite backend
- `public/admin.{html,js}` — admin panel
- `src/admin.js` + `src/styles/admin.css` — admin frontend
- `Dockerfile`, `docker-compose*.yml`, `Caddyfile*`, `install.sh` — deployment
- `AUDIT.md`, `ECONOMY_CALCULATIONS.md`, `FINANCIAL_MODEL.md`, `SCALING.md` — backend docs
- `better-sqlite3`, `compression`, `cors`, `dotenv`, `express`, `multer`, `concurrently` — backend deps
- Vite `/api` proxy

## Mock Data Layer

`src/api.js` exports the same `api(path, options)` signature as the original,
so the rest of the frontend code is unchanged. Behavior:

- State persisted to `localStorage` under `orael_mock_state`
- Mining accrues passively between calls (mirrors the real server)
- Game outcomes (spin, scratch, chest, coinflip) randomized client-side
  using the same weighted arrays as the real server
- Returns the full `ECONOMY_CONFIG` so the frontend's economy-aware code
  (wheel prizes, coinflip payouts, lotto ticket price, etc.) works unmodified
- Mock user: `Ademola` (id `10042024`) — edit in `src/devmock.js`
- Mock banks list: 34 Nigerian banks returned by `/api/wallet/banks`
- Saved bank accounts persisted separately under `orael_mock_bank_accounts`
- Avatar uploads intercepted by `devmock.js` and stored as data URLs

To reset mock state, run in the browser console:

```js
localStorage.removeItem('orael_mock_state');
localStorage.removeItem('orael_mock_bank_accounts');
location.reload();
```

## Mock Telegram + Adsgram

`src/devmock.js` installs a mock `window.Telegram.WebApp` and `window.Adsgram`
so the app boots in any browser. The mock Adsgram resolves `show()` after 1.2s
with `{ done: true }` so all ad-gated actions work. If running inside real
Telegram with real initData, the mocks are skipped.

## Architecture (Frontend-Only)

```
Orael/
├── index.html              # Single-page app shell (4 screens + splash)
├── src/
│   ├── main.js             # Boot sequence + render loops
│   ├── api.js              # ⭐ Mock API layer (localStorage-backed)
│   ├── devmock.js          # ⭐ Telegram + Adsgram mock (always on)
│   ├── state.js            # State store + localStorage cache
│   ├── telegram.js         # Telegram SDK wrapper
│   ├── ui.js               # Master render() — runs every second
│   ├── ads.js              # Adsgram rewarded ad player
│   ├── animations.js       # Confetti, ripples, count-up, parallax
│   ├── mining.js           # Refuel / Boost / Rig upgrade
│   ├── play.js             # Spin / Scratch / Coin Flip / Chest / Lottery
│   ├── earn.js             # Tasks / Streak / Faucet / Referral
│   ├── wallet.js           # Withdraw / Pro / PIN / Bank selection
│   ├── profile.js          # Avatar picker + Pro subscription
│   ├── tutorial.js         # Onboarding flow
│   └── styles/             # 10 CSS files — sapphire + gold design
├── public/
│   ├── avatars/            # 10 default avatar PNGs
│   └── telegram-web-app.js # Local copy of Telegram SDK
└── vite.config.js          # Vite (no proxy, base path for GitHub Pages)
```

## Development

```bash
npm install
npm run dev      # Start Vite dev server at http://localhost:5173
npm run build    # Production build → dist/
npm run preview  # Preview the production build
```

No environment variables required for mock mode. The app boots straight
into the splash → Miner screen with a mock user (`Ademola`, 18,750 ORL
starting balance) and works end-to-end.
