# Rajesh Algo — Dhan Algo Trading Platform

## Overview

Professional algorithmic trading platform powered by Dhan broker API for Indian markets. Built as a pnpm workspace monorepo with TypeScript, React frontend, and Express backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui + Recharts
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild
- **Broker API**: Dhan (https://dhanhq.co)

## Instrument Master Database
- **209,543 instruments** seeded from Dhan Excel files (EQUITY, FUTIDX, FUTSTK, INDEX, OPTFUT, OPTIDX, OPTSTK)
- Seed script: `lib/db/seed-instruments.cjs` — run with `cd lib/db && NODE_PATH=./node_modules:../../node_modules node seed-instruments.cjs`
- Re-run anytime new master files are uploaded to `attached_assets/`
- Table: `instruments` — columns: securityId, exchId, segment, instrument, symbolName, displayName, isin, lotSize, tickSize, expiryDate, strikePrice, optionType

## Architecture

### Frontend (artifacts/trading-platform)
- React + Vite web app with dark-mode fintech terminal theme
- Pages: Dashboard, Orders, Positions, Strategies (Coming Soon), Settings, Logs, Super Orders, Option Chain, Trade History (Ledger)
- All pages lazy-loaded via React.lazy() with Suspense
- Sidebar organized into sections: TRADING, AUTOMATION, SYSTEM
- Uses TanStack React Query for all API calls; all pages lazy-loaded
- Socket.io client (lib/market-socket.ts) for real-time market ticks and order updates
- Recharts for charts (named imports, chunked via vite manualChunks)
- Removed: Backtesting page, MCX tab in Option Chain, equity curve/diary in Trade History, market index cards on Dashboard, failed/success log tabs
- Removed 5 unused radix UI packages: aspect-ratio, context-menu, hover-card, menubar, navigation-menu

### Backend (artifacts/api-server)
- Express 5 API server proxying requests to Dhan broker API
- Dhan API client (`src/lib/dhan-client.ts`) handles all broker communication
- **Instruments API**: `/api/instruments/search?q=NIFTY&limit=20` — full-text search across 223k instruments
- Rate limiting (sliding-window per category): Order 25/sec, Data 10/sec, Non-Trading 20/sec — daily counters persisted to DB
- All Dhan error codes mapped with retryable flags; 15s timeout on all Dhan calls; 3-attempt exponential backoff on 5xx
- Kill-switch cache: 2s TTL; Positions cache: 3s TTL
- Order guards: kill switch + daily loss limit + max qty/symbol + max open orders + pre-trade margin check
- Super-order monitor: DB row inserted before Dhan call (atomic); PART_TRADED handled; WS LTP with REST fallback; pauses on token expiry
- Auto square-off: separate NSE (15:14) and MCX (23:25) times; midnight kill-switch auto-reset
- Removed: /market/indices route, /logs/counts, DELETE /logs/success, strategiesTable reference in dashboard
- Telegram alerts via `src/lib/telegram.ts` (uses fetch, no external dependency)

### Database Schema
- `strategies` — Trading strategy definitions with JSON conditions, entry/exit rules, risk limits, performance tracking
- `trade_logs` — Execution logs from strategy runs (linked to strategies)
- `settings` — App settings including broker credentials, risk limits, Telegram config, kill switch, `dashboardWidgets` (todayPnl, availableBalance, activeStrategies)
- `paper_trades` — Paper trading positions (open/closed) stored in DB

### Security & Safety
- **Kill switch**: Enforced server-side in `order-guards.ts` before every order placement; reset to `false` on broker disconnect
- **Postback endpoint**: Rejects all requests if `POSTBACK_SECRET` env var is not set (fail-closed)
- **PIN hashing**: Falls back to `ENCRYPTION_KEY` slice if `PIN_SALT` is not set
- **Super Orders**: INTRADAY-only enforced at route level (400 if `product_type !== INTRADAY`)

### WebSocket Reliability
- Both `OrderUpdateWS` and `MarketFeedWS` use exponential backoff (5s → 120s max) with `destroyed` flag to stop reconnects after explicit disconnect
- Binary/protocol frames from Dhan are skipped safely (first-byte check for `{` or `[`)
- `ping/pong` heartbeat handled in both WS classes
- `subscribe()` accumulates securityIds in a `Set` — multiple calls don't overwrite each other
- `reset()` method clears `destroyed` flag before new broker connect

### Performance Caches
- Kill switch: 2-second in-memory cache in `order-guards.ts` (reduced from 10s — H1 fix)
- Positions: 3-second in-memory cache in `order-guards.ts` (reduced from 15s for tighter P&L guard — H2 fix)
- Recent-activity: 30-second in-memory cache in `dashboard.ts`
- NSE holidays: per-day in-memory cache in `equity-scheduler.ts`
- Equity curve: skips refresh on weekends AND NSE market holidays

### Algo-Trading Safety (Audit Fixes A–D)
- **C1 — Correlation IDs**: Every Dhan order call tagged with `x-correlation-id` UUID header to prevent duplicates
- **C3 — Atomic super-orders**: DB row (`PLACING` state) inserted before Dhan API call; transitions to `FAILED` on error
- **C4 — Partial fill monitor**: `PART_TRADED` status handled in `super-order-monitor.ts` alongside `TRADED`
- **C5 — Separate NSE/MCX square-off**: `autoSquareOffTimeNSE` (default 15:14) and `autoSquareOffTimeMCX` (default 23:25) stored in DB and fired independently
- **C6 — 15s AbortSignal timeout**: All Dhan fetch calls wrapped with 15-second `AbortController` timeout
- **C7 — DB-backed rate counter**: `DailyCounter` class loads today's order count from DB on startup (survives process restarts)
- **H3 — maxQtyPerSymbol + maxOpenOrders**: New settings columns enforced in `runOrderGuards()` before every order
- **H4 — Pre-trade margin check**: Available margin fetched from Dhan and compared against estimated order cost before placement
- **H5 — WS LTP for monitors**: Super-order monitor uses live WebSocket LTP with REST fallback (no extra REST call per tick)
- **H8 — Exponential backoff**: Dhan GET and 5xx responses retried with 1s/2s/4s backoff (max 3 attempts)
- **H9 — Kill-switch midnight reset**: Error in nightly reset is now logged + Telegram-alerted instead of silently swallowed
- **H10 — Token expiry monitor pause**: Both monitors check `dhanClient.isTokenExpired()` and skip iterations when expired
- **M2 — Margin disclaimer**: Super-orders form shows explicit ⚠ SPAN+Exposure disclaimer next to estimated margin
- **M3 — Modify confirm step**: Order modify modal has a 2-step review (confirm dialog before submitting to Dhan)

## Features

### Strategy Builder
- Visual condition builder: indicator (RSI, EMA, Price, Volume, MACD, BB, VWAP), period, comparator, value
- Conditions saved as JSON in `entry_conditions` / `exit_conditions` columns
- "Execute Now" (⚡) button on each strategy card
- Performance summary cards (overall P&L, win rate, total trades, avg P&L/trade)

### Backtesting
- Calls `POST /api/market/historical` for real Dhan candle data (falls back to simulated if not connected)
- RSI Reversal strategy simulation with configurable period, oversold/overbought levels
- Result charts: equity curve (AreaChart), P&L distribution (BarChart with Cell coloring)
- Metrics: Total Trades, Win Rate, Max Drawdown, Sharpe Ratio, Profit Factor, Avg Win/Loss
- Trade-by-trade log table with timestamps and cumulative P&L

### Paper Trading
- Live prices: selected symbol fetched from `POST /api/market/quote` every 5 seconds; others simulated
- DB-backed paper trades (paperTradesTable) — persist across sessions
- Open positions with real-time P&L calculated from live price vs entry price
- Close position with X button — calculates actual P&L, saves to DB
- Closed trades history with final P&L

### Risk Management (Kill Switch)
- Daily loss limit stored in settings (default ₹5000)
- Before every `POST /api/strategies/:id/execute`, checks today's cumulative loss from trade_logs
- If loss ≥ maxDailyLoss, order is rejected with HTTP 403
- Manual kill switch in settings — blocks all order placement when active
- Kill switch status shown as red banner on Dashboard when triggered

### Telegram Alerts
- `src/lib/telegram.ts` — sends alerts via Telegram Bot API (no extra npm package)
- Triggers: order placed, order failed, strategy toggled, kill switch toggled, daily loss limit hit
- Bot token and chat ID configurable in Settings > Telegram Alerts

### Dashboard
- 7-day equity curve chart using Recharts AreaChart (data from /api/dashboard/equity-curve)
- Kill switch red banner when triggered (shows reason: manual vs daily loss limit)
- "Pause All Strategies" quick action → calls POST /api/strategies/pause-all
- "Emergency Stop" button → pauses all strategies AND enables kill switch
- Recent Alerts panel with last 5 activity entries
- **Market Index Cards** — 5 live index cards: NIFTY 50, BANK NIFTY, GOLD, SILVER, CRUDE OIL with live WebSocket LTP, OHLC change from open, high/low. MCX commodity security IDs resolved dynamically from nearest-expiry OPTFUT options via `/api/market/indices`
- **Watchlist Panel** — Star button in header opens sliding drawer (max-w-2xl, right-side overlay). Left half: saved instruments with live LTP ticker. Right half: symbol search + instrument detail view. Backend: `watchlist` table, CRUD via GET/POST/DELETE `/api/watchlist`

### Settings (Major Expansion)
- **Broker Connection** — credentials, balance display, refresh, disconnect
- **Risk Management** — Daily Loss Limit field (blocks orders if exceeded)
- **Telegram Alerts** — Bot Token + Chat ID with mask/reveal toggle, test ping on save, reset button
- **Emergency Kill Switch** — Toggle on Dhan (1 reset/day, auto-resets 8:30 AM IST). Optional 4-digit PIN protection (stored in DB, verified via `POST /api/settings/verify-pin` before toggle). PIN dialog shown in-page.
- **P&L Based Exit** — Set Dhan profit/loss thresholds; product type checkboxes; optional kill switch on trigger
- **Auto Square-Off Timer** — Toggle + IST time picker (default 15:14); backend scheduler checks every 30s, fires on weekdays only; logs to audit log + Telegram alert
- **Trading Guards** — Max trades per day, Max position size (fixed ₹ or % capital), Trading hours override (IST start/end); all wired through `runOrderGuards()` called before every `POST /api/orders`
- **Instrument Blacklist** — Add/remove symbols; all blacklisted symbols blocked at order placement
- **Notification Preferences** — Per-event Telegram toggle (Order Filled, Target Hit, SL Hit, Kill Switch, Token Expiry, Strategy Change, Auto Square-Off, Daily P&L Summary)
- **Browser Push Notifications** — Native Notification API; enable button requests browser permission; test notification button
- **Trading Defaults** — Default Product Type, Order Type, Default Quantity pre-fills across order forms
- **Dashboard Widgets** — Toggle visibility of each stat card and equity curve (persisted in DB, read on dashboard mount)
- **Refresh Interval** — Select 5/10/15/30/60s (persisted in DB settings)
- **Kill Switch PIN** — Set/change/remove 4-digit PIN; required before kill switch activate/deactivate
- **Audit Log** — Last 50 settings changes with timestamps, action, field, old/new value (IST formatted)

## API Endpoints

### Broker / Auth
- `POST /api/broker/connect` — Connect broker (validates and saves credentials)
- `POST /api/broker/disconnect` — Disconnect broker
- `GET /api/broker/status` — Live balance from Dhan
- `GET /api/rate-limits` — Current rate limit counters

### Strategy Management
- `GET /api/strategies` — List strategies
- `GET /api/strategies/performance` — Performance summary (must be registered BEFORE /:id)
- `POST /api/strategies` — Create strategy
- `GET /api/strategies/:id` — Get strategy
- `PATCH /api/strategies/:id` — Update strategy
- `DELETE /api/strategies/:id` — Delete strategy
- `POST /api/strategies/:id/toggle` — Toggle active/paused (sends Telegram alert)
- `POST /api/strategies/:id/execute` — Execute (checks kill switch + daily loss before placing order)
- `POST /api/strategies/pause-all` — Pause all active strategies

### Dashboard
- `GET /api/dashboard/summary` — Portfolio summary (funds + all-time P&L from ledger cache + killswitch/settings). No positions/orders/trades calls.
- `GET /api/dashboard/equity-curve?days=N` — Equity curve for preset mode (DB cache first → cached ledger fallback; no live Dhan calls)
- `GET /api/dashboard/equity-curve?allTime=true` — All-time equity curve (DB cache first → cached ledger fallback)
- `GET /api/dashboard/equity-curve?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` — Custom date range (cached ledger)
- `GET /api/dashboard/period-pnl?days=N` — Period P&L using formula: currentBalance − openingBalance + periodWithdrawals − periodDeposits
- `GET /api/dashboard/recent-activity` — Recent activity feed

### Paper Trades
- `GET /api/paper-trades` — List all paper trades
- `POST /api/paper-trades` — Open new paper position
- `POST /api/paper-trades/:id/close` — Close position with exit price
- `DELETE /api/paper-trades/:id` — Delete a paper trade
- `DELETE /api/paper-trades` — Clear all paper trades

### Market Data
- `POST /api/market/quote` — Live LTP/OHLC/Full quotes
- `POST /api/market/historical` — Historical candle data
- `POST /api/market/intraday` — Intraday data
- `POST /api/market/option-chain` — Option chain
- `POST /api/market/expiry-list` — Expiry dates
- `GET /api/market/securities` — Security list

### Settings
- `GET /api/settings` — App settings (includes telegramBotToken, telegramChatId, killSwitchEnabled)
- `PUT /api/settings` — Update settings (handles new telegram/killswitch fields directly from body)

## Environment Variables

- `DHAN_CLIENT_ID` — Dhan broker client ID (secret)
- `DHAN_ACCESS_TOKEN` — Dhan broker access token (secret)
- `DATABASE_URL` — PostgreSQL connection string (auto-provisioned)
- `SESSION_SECRET` — Session encryption key

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Important Implementation Notes

- `zod` is NOT in api-server dependencies — never import zod directly in route files; use `@workspace/api-zod`
- Telegram alerts are fire-and-forget (`void sendTelegramAlert(...)`) — never await in request handlers
- `/api/strategies/performance` route MUST be registered BEFORE `/api/strategies/:id` in Express (otherwise "performance" matches `:id`)
- `/api/strategies/engine/status|start|stop` routes MUST be registered BEFORE `/api/strategies/:id` for the same reason
- `/api/strategies/pause-all` POST is a custom endpoint not in the OpenAPI spec — called directly via fetch
- Settings `PUT` endpoint handles `telegramBotToken`, `telegramChatId`, `killSwitchEnabled` directly from `req.body` (not via Zod UpdateSettingsBody which doesn't include these fields)
- Paper trading: only fetch real price for the currently selected symbol (1 quote request/5s); other symbols use simulated prices to avoid rate limiting
- `Position` and `Strategy` types in frontend are derived via `NonNullable<GetPositionsQueryResult>[number]` / `NonNullable<GetStrategiesQueryResult>[number]` — do NOT import from `@workspace/api-zod` which is not in trading-platform deps
- TanStack Query v5 / Orval v8: when passing `{ query: { ... } }` options to generated hooks, always include `queryKey: getXyzQueryKey()` to satisfy `UseQueryOptions` type

## Recent Changes

### Phase 3 — Frontend UI Upgrades
- **positions.tsx**: Full rewrite — live LTP via Socket.io WebSocket, real-time unrealized P&L per row, summary boxes (Unrealized / Realized / Total), "Exit Single" and "Exit All" buttons with AlertDialog confirmation, INTRADAY-only filter
- **strategies.tsx**: Added `EngineStatusWidget` (shows auto-trading engine status with Start/Stop), `STRATEGY_TEMPLATES` quick-select dropdown, `timeframeMinutes` field in create/edit form
- **trade-history.tsx**: Fixed ledger tab to call `GET /api/trades/ledger` directly; `credit`/`debit` parsed as floats; all-time P&L computed as `availableBalance + totalWithdrawals − totalDeposits`, skipping OPENING/CLOSING BALANCE narrations
- **settings.tsx**: Added `TokenExpiryWarning` banner (warns when Dhan token generated >23h ago)
- **app-layout.tsx**: Added `DH-911` static-IP banner (dispatched by `api-error-handler.ts`); `getHealthCheckQueryKey()` and `getGetFundLimitsQueryKey()` passed to fix TanStack Query v5 types
- **src/lib/api-error-handler.ts**: Created — `checkForDH911(res)` helper that dispatches `dhan:staticip-error` custom event on HTTP 900

### Phase 4 — Schema Changes
- **strategies schema**: Added `timeframeMinutes integer default 15` and `instrumentType varchar(20)` columns; `pnpm --filter @workspace/db run push` applied
- **settings schema**: Added `tokenGeneratedAt timestamp` column to track when Dhan access token was last set

### Phase 5 — TypeScript Cleanup
- **api-zod/src/index.ts**: Removed re-export of `./generated/types` to fix Zod/TS interface name collisions
- **market.ts**: Fixed `Date→string` conversion for `fromDate`/`toDate`/`expiry` fields
- **positions.tsx / strategies.tsx**: Changed imports from `@workspace/api-zod/src/generated/types` (not in dep tree) to inline type aliases derived from `GetPositionsQueryResult` / `GetStrategiesQueryResult` exported by `@workspace/api-client-react`
- **app-layout.tsx / dashboard.tsx**: Added `queryKey` to Orval hook options to satisfy TanStack Query v5 `UseQueryOptions` type requirement
- Full `pnpm run typecheck` passes with zero errors across all packages

### Phase 7 — TOTP Token Generation
- **Backend** (`broker.ts`): `POST /broker/generate-token` endpoint — takes `{ pin, totp, clientId? }`, calls Dhan's `https://auth.dhan.co/app/generateAccessToken?dhanClientId=...&pin=...&totp=...`, saves the returned token (encrypted) + `tokenGeneratedAt`, reconfigures `dhanClient`/`marketFeedWS`/`orderUpdateWS`, returns fund limits
- **Backend** (`broker.ts`): Fixed missing `equityCurveCacheTable` import (used in `/broker/disconnect` but was not imported)
- **Frontend** (`settings.tsx`): "Or Generate via TOTP" section added inside Broker Connection card — PIN field (masked/numeric), TOTP field (6-digit), "Generate Token & Connect" button auto-enables when both fields are 6 digits, shows success/error inline
- **Flow**: TOTP → backend calls Dhan auth → token saved + all clients reconfigured + WS reconnected → frontend cache invalidated → broker shown as connected with balance
- **Security**: PIN and TOTP are never stored — used once to call Dhan auth, discarded immediately

### Phase 8 — Live Market Cards, Watchlist & Reliability
- **MarketIndexCards**: Dashboard shows live LTP for NIFTY, BANKNIFTY, GOLD, SILVER, CRUDEOIL via Socket.io quote-mode subscription
- **WatchlistPanel**: React Portal drawer with two-column saved+search layout; live LTP per row; backed by `watchlistTable`
- **market-socket.ts**: Fixed quote-mode subscribe regression — `subscribe()` now uses `isSubscribedInMode()` registry check (previously skipped WS subscribe if any tick listener already existed). `subscribeBatch()` cleanup now only unsubscribes IDs whose listener count reaches zero AND have no quote listeners (previously dropped all IDs unconditionally, breaking other components when option-chain unmounted)
- **api-server reliability**: Added graceful SIGTERM/SIGINT handler + `httpServer.on("error")` handler in `index.ts`; `prestart` runs `scripts/free-port.mjs` (parses `/proc/net/tcp` to find PID holding `$PORT` and SIGKILLs only that process — safe vs the previous `pkill -f` which killed the prestart shell itself)
- **lib/db & lib/api-zod**: Rebuilt stale `dist/*.d.ts` after deleting `dist/` + `tsconfig.tsbuildinfo` — fixed missing `watchlistTable`, `marketHolidaysTable`, `equityCurveCacheTable`, `rateLimitLogTable` exports and `tradingSymbol` field on `PlaceOrderBody`
- **Security audit**: 0 critical/high/moderate dep vulns; 0 HoundDog issues; 2 SAST findings reviewed and confirmed false positives (GCM auth tag length is 16 bytes; "SQL injection" was a template literal inside a log message — all DB access goes through Drizzle parameterized queries)

### Phase 9 — Audit Fixes A–D + Mobile Friendliness

**Backend reliability (api-server):**
- **H8 retry backoff**: `dhanClient`'s internal `dhanRequest` retries GET requests on Dhan 5xx errors with 1s/2s/4s exponential backoff (up to 3 attempts). POST/PUT/DELETE order endpoints are never retried to prevent duplicate fills. Network-level errors (timeout, DNS) also retry for safe GET paths.
- **H4 pre-trade margin**: `POST /orders` now calls Dhan's `/margincalculator` before placing LIMIT/SL orders. If Dhan returns `insufficientBalance: true`, the route returns HTTP 402 with the margin shortfall. Fail-open: if the margin API itself fails, the order proceeds.
- **C7 rate-limiter persistence**: `DailyCounter` saves to the `rate_limit_log` DB table on every increment and loads today's count on startup via `loadDailyCountersFromDb()` called in `index.ts`. Survives server restarts within the same IST calendar day.
- **H10 token-expiry monitor pause**: Both super-order monitor and auto-square-off guard on `dhanClient.isConfigured()` which returns `false` when `tokenExpired=true`. Already in place.
- **H1–H2–H3–H6–H9**: Kill-switch 2s cache, positions 3s cache, maxQtyPerSymbol/maxOpenOrders guards, orders poll 2s, logged midnight KS reset.

**Frontend fixes:**
- **M2 margin disclaimer**: Super-orders form now labels margin field as "Margin Est." with `(price×qty, actual may differ)` note. Insufficient-funds warning says "Est. Required" to clarify it's an approximation, not SPAN margin.
- **M3 modify confirm step**: `ModifyOrderModal` now has a two-step flow — "Review Changes" shows a summary card of all new values with a warning banner; "Confirm Modify" executes the PATCH. "Back" returns to the edit form.
- **M5 segment map fix**: `handleInstrumentSelect` in `super-orders.tsx` had incorrect mapping `D → _CURR` (currency). Fixed to `D → _FNO` (derivatives/F&O), consistent with watchlist-panel.tsx. Added `M` and `I` → `IDX_I` mapping.
- **useRefreshInterval hook**: Replaced `useQuery({ enabled: false })` (React Query v5 warning) with `useQueryClient().getQueryData()` — reads the settings cache directly without triggering network requests or console warnings.

**Mobile responsive fixes (390px viewport):**
- **Positions tabs**: `TabsList` now has `w-max` inside an `overflow-x-auto` wrapper, allowing "Carryforward" and "Closed" tabs to be scrolled into view.
- **Positions table**: `Table` rendered with `min-w-[900px]` forcing horizontal scroll on the existing `overflow-x-auto` container.
- **Logs tabs**: `TabsList` wrapped in `overflow-x-auto flex-1` div with `w-max`. "Delete All" button uses `self-start` on mobile to render below tabs.
- **Logs table**: `min-w-[560px]` on the `<table>` element so all columns (TIME, LEVEL, CATEGORY, ACTION, MESSAGE) scroll within their fixed-height container.

**Dead code / quality:**
- Removed duplicate positions imports, sidebar Login button, dashboard empty useEffect, strategies fake deploy toast, orders history tab + 6 functions.
- Bundle: lazy-loaded all pages, added `manualChunks` for React/Recharts/RadixUI vendor, removed 4 unused dependencies.

### Phase 6 — Frontend Bug Fixes & Theme Standardization
- **App.tsx**: `AppInitializer` now shows an error state with retry button when `/api/settings` fetch fails (previously showed infinite spinner)
- **market-socket.ts**: Added `socket.on("connect", resubscribeAll)` — on socket.io reconnect, all subscriptions are replayed to the server so live ticks resume automatically
- **super-orders.tsx**: `TERMINAL_STATUSES` set added; cancel button hidden for terminal-status orders (`TARGET_HIT`, `STOP_LOSS_HIT`, `COMPLETED`, `CANCELLED`); `statusColor()` maps all super-order statuses to semantic tokens; `parseInt` radix fixed
- **positions.tsx**: 401 from broker API now shows "Broker not connected" warning (not a generic error); pnlColor uses `text-success`/`text-destructive`; LONG/SHORT/LTP/Exit button all use semantic tokens
- **app-layout.tsx**: Removed dead `PAGE_TITLES` entries (`/forever-orders`, `/conditional`); added fallback title; broker-not-connected and rate-limit banners now use `text-warning`/`bg-warning` instead of hardcoded `yellow-*`
- **orders.tsx**: `StatusBadge` uses `text-success`/`text-warning`/`text-destructive`/`text-primary`; `SideBadge` uses `text-success`/`text-destructive`; Modify/Cancel buttons use `text-primary`/`text-destructive`; stat cards use semantic colors
- **trade-history.tsx**: `currentFYYear()` uses IST via UTC+5:30 offset; all P&L, credit/debit, equity curve tooltip colors standardized to `text-success`/`text-destructive`/`text-warning`
- **symbol-search.tsx**: CE/PE badge and instrument type badges (INDEX, FUT) now use semantic tokens
- **sidebar.tsx**: Broker status dot uses `bg-success`/`bg-warning` instead of `bg-green-500`/`bg-yellow-400`
- **Color system invariant**: `text-success` (green profit), `text-destructive` (red loss/danger), `text-warning` (amber alerts) throughout all pages. Domain-specific colors kept: option-chain call/put (`emerald`/`red`) as trading convention, exchange badges (blue=EQUITY, purple=OPT) for segment identification
