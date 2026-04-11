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

## Architecture

### Frontend (artifacts/trading-platform)
- React + Vite web app with dark-mode fintech terminal theme
- Pages: Dashboard, Orders, Positions, Strategies, Backtesting, Paper Trading, Settings
- Uses Orval-generated React Query hooks for all API calls
- Recharts for equity curve, backtesting charts, and P&L visualizations

### Backend (artifacts/api-server)
- Express 5 API server proxying requests to Dhan broker API
- Dhan API client (`src/lib/dhan-client.ts`) handles all broker communication
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

### Settings
- Broker Connection card (existing functionality preserved)
- Risk Management card: Daily Loss Limit field + Emergency Kill Switch toggle
- Telegram Alerts card: Bot Token + Chat ID fields with mask/unmask toggle

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
- `GET /api/dashboard/equity-curve?days=7` — Daily P&L and cumulative for last N days
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
- `/api/strategies/pause-all` POST is a custom endpoint not in the OpenAPI spec — called directly via fetch
- Settings `PUT` endpoint handles `telegramBotToken`, `telegramChatId`, `killSwitchEnabled` directly from `req.body` (not via Zod UpdateSettingsBody which doesn't include these fields)
- Paper trading: only fetch real price for the currently selected symbol (1 quote request/5s); other symbols use simulated prices to avoid rate limiting
