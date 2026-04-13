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
- Pages: Dashboard, Orders, Positions, Strategies, Backtesting, Paper Trading, Settings, Logs, Super Orders, Forever Orders, Conditional Triggers, Option Chain, Trade History
- Sidebar organized into sections: OVERVIEW, TRADING, PORTFOLIO, MARKET DATA, AUTOMATION, REPORTS, SYSTEM
- Uses Orval-generated React Query hooks for all API calls
- Socket.io client (lib/market-socket.ts) for real-time market ticks and order updates
- Recharts for equity curve, backtesting charts, and P&L visualizations

### Backend (artifacts/api-server)
- Express 5 API server proxying requests to Dhan broker API
- Dhan API client (`src/lib/dhan-client.ts`) handles all broker communication
- **Instruments API**: `/api/instruments/search?q=NIFTY&limit=20` — full-text search across 223k instruments
- Rate limiting (sliding-window per category): Order 10/sec, Quote 1/sec, Data 5/sec, Non-Trading 20/sec
- All Dhan error codes mapped (DH-901–DH-911) with retryable flags
- Telegram alerts via `src/lib/telegram.ts` (uses fetch, no external dependency)

### Database Schema
- `strategies` — Trading strategy definitions with JSON conditions, entry/exit rules, risk limits, performance tracking
- `trade_logs` — Execution logs from strategy runs (linked to strategies)
- `settings` — App settings including broker credentials, risk limits, Telegram config, kill switch
- `paper_trades` — Paper trading positions (open/closed) stored in DB

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
- `GET /api/dashboard/summary` — Portfolio summary (now includes killSwitchTriggered, dailyLossAmount)
- `GET /api/dashboard/equity-curve?days=N` — Daily P&L and cumulative for last N days (ledger source)
- `GET /api/dashboard/equity-curve?source=ledger&allTime=true` — All-time equity curve via parallel 3-year getAllLedger fetch
- `GET /api/dashboard/equity-curve?source=ledger&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` — Custom date range
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

## SaaS Architecture (Active)

### Clerk Auth
- `@clerk/react` v6 + `@clerk/express` — multi-tenant authentication
- Trading platform: ClerkProvider wraps app; landing page at `/` for signed-out users, `/dashboard` for signed-in
- Proxy middleware at `/__clerk` routes (dev) — `CLERK_PROXY_PATH = /api/__clerk`
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `VITE_CLERK_PUBLISHABLE_KEY` — auto-provisioned by Replit auth pane

### Multi-Tenancy
- `settings.userId` — Clerk userId stored in settings table; each user gets own row
- `super_orders.userId` — orders tagged by Clerk userId; GET/POST/DELETE all filter by userId
- `getOrCreateSettings(userId)` — creates per-user settings row on first access
- `getAuth(req)` from `@clerk/express` extracts userId in every route

### Admin App (artifacts/admin — /admin/)
- Port 23744 / externalPort 5000
- No auth (internal use only — restrict via network/IP in production)
- Pages: Dashboard (platform stats), Users (all Clerk users from DB), Super Orders (cross-user), System Logs
- API at `/api/admin/*` — stats, users, recent-orders, logs

### Admin API Routes
- `GET /api/admin/stats` — totalUsers, totalSuperOrders, configuredBrokers, recentErrors
- `GET /api/admin/users` — all settings rows with superOrderCount
- `GET /api/admin/recent-orders` — last 50 super orders across all users
- `GET /api/admin/logs?limit=N` — app_logs table (max 500)

### Pricing Plans
- Monthly: ₹2,999 | 3-Month: ₹6,999 | Annual: ₹26,999
- Plans displayed on landing page; Razorpay integration placeholder (not yet wired)

### Vite React Singleton Fix
- Added `resolve.alias` for react/react-dom in `artifacts/trading-platform/vite.config.ts`
- Forces single React copy when `@clerk/react` and other packages share react peer dep
- Also added `optimizeDeps.include: ["react", "react-dom", "@clerk/react"]`

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
