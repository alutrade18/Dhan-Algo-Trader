# Dhan Algo Trading Platform

## Overview

Professional algorithmic trading platform powered by Dhan broker API for Indian markets. Built as a pnpm workspace monorepo with TypeScript, React frontend, and Express backend.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Broker API**: Dhan (https://dhanhq.co)

## Architecture

### Frontend (artifacts/trading-platform)
- React + Vite web app with dark-mode fintech terminal theme
- Pages: Dashboard, Orders, Positions, Holdings, Strategies, Trade Book, Trade Logs, Settings
- Uses Orval-generated React Query hooks for all API calls

### Backend (artifacts/api-server)
- Express 5 API server proxying requests to Dhan broker API
- Dhan API client (`src/lib/dhan-client.ts`) handles all broker communication
- Database-backed strategy management, trade logs, and settings

### Database Schema
- `strategies` — Trading strategy definitions with entry/exit rules, risk limits, performance tracking
- `trade_logs` — Execution logs from strategy runs (linked to strategies)
- `settings` — Application settings (order defaults, risk limits, auto-trading config)

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

## API Endpoints

### Dhan Proxy Routes
- `GET /api/orders` — List all orders from Dhan
- `POST /api/orders` — Place a new order
- `PATCH /api/orders/:orderId` — Modify an order
- `DELETE /api/orders/:orderId` — Cancel an order
- `GET /api/positions` — Current positions
- `GET /api/holdings` — Current holdings
- `GET /api/trades` — Today's trade book
- `GET /api/trades/history` — Historical trades
- `GET /api/funds` — Fund limits
- `POST /api/market/quote` — Market quotes (LTP/OHLC/Full)
- `POST /api/market/historical` — Historical candle data
- `POST /api/market/intraday` — Intraday minute data
- `POST /api/market/option-chain` — Option chain
- `POST /api/market/expiry-list` — Expiry dates
- `GET /api/market/securities` — Security list

### Strategy Management (Database-backed)
- `GET /api/strategies` — List strategies
- `POST /api/strategies` — Create strategy
- `GET /api/strategies/:id` — Get strategy
- `PATCH /api/strategies/:id` — Update strategy
- `DELETE /api/strategies/:id` — Delete strategy
- `POST /api/strategies/:id/toggle` — Toggle active/paused
- `POST /api/strategies/:id/execute` — Execute strategy (places order)
- `GET /api/strategies/performance` — Performance summary

### Dashboard & Logs
- `GET /api/dashboard/summary` — Portfolio summary
- `GET /api/dashboard/recent-activity` — Recent activity feed
- `GET /api/trade-logs` — Strategy execution logs
- `GET /api/settings` — App settings
- `PUT /api/settings` — Update settings

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
