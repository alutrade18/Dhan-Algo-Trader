# Threat Model

## Project Overview

Rajesh Algo is a TypeScript pnpm-monorepo trading application for a broker-linked Dhan account. The production surface is an Express 5 API server in `artifacts/api-server`, a React/Vite web client in `artifacts/trading-platform`, and shared database/API libraries in `lib/*` backed by PostgreSQL via Drizzle. The application stores broker connection state, exposes trading and reporting APIs, streams live market and order events over Socket.IO, and can place or cancel real orders against the user’s Dhan account.

Assumptions for repeated scans: production traffic is terminated over TLS by the platform; `NODE_ENV=production` in production; `artifacts/mockup-sandbox` is dev-only and should be ignored unless production reachability is demonstrated.

## Assets

- **Broker credentials and session state** — Dhan client ID, access token, token-generation flow inputs, kill-switch state, and IP-whitelisting state. Compromise lets an attacker trade on the connected brokerage account.
- **Trading operations** — order placement, modification, cancellation, position exits, kill-switch activation/deactivation, and broker IP updates. Unauthorized use has direct financial impact.
- **Financial and portfolio data** — balances, ledger history, positions, trades, P&L, and recent activity. Exposure reveals sensitive financial information.
- **Operator settings and alerting config** — Telegram bot/chat settings, trading guard thresholds, refresh settings, and kill-switch PIN hash. Tampering can disable safeguards or redirect alerts.
- **Application secrets** — database credentials, encryption key material, postback secret, and any broker/API secrets held in environment variables.

## Trust Boundaries

- **Browser to API** — all frontend requests cross from an untrusted client into the Express server. Every sensitive route must authenticate and authorize server-side.
- **Socket client to server** — Socket.IO clients connect directly to the API server and can receive broker-derived market/order events. Subscription and broadcast behavior must be scoped to authorized users.
- **API to Dhan** — the server sends authenticated requests to Dhan using stored broker credentials. Any server-side misuse or exposure of those credentials impacts the real brokerage account.
- **API to PostgreSQL** — settings, logs, cached equity data, and audit information are stored in Postgres. Unsafe queries or over-broad reads can expose sensitive state.
- **Dhan postback to API** — broker callbacks enter through `/api/postback` and must be authenticated as broker-originated events before affecting internal state or alerts.
- **Public internet to deployment** — the deployment is internet reachable. Surfaces that are intended for a single operator still need explicit access control; obscurity is not a control.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/*`, `artifacts/trading-platform/src/main.tsx`, `artifacts/trading-platform/src/App.tsx`
- **Highest-risk code areas:** broker connection and token flows in `routes/broker.ts`, trading routes in `routes/orders.ts` / `routes/positions.ts` / `routes/risk.ts`, live event handling in `src/index.ts`, credential handling in `src/lib/crypto-utils.ts`, settings storage in `routes/settings.ts`
- **Public vs authenticated surfaces:** no production authentication boundary should be assumed unless enforced in server middleware or route handlers; frontend-only navigation is not a control
- **Dev-only area:** `artifacts/mockup-sandbox`

## Threat Categories

### Spoofing

This project contains a dormant Clerk dependency and a `requireAuth` middleware, but the production system must not assume identity unless that middleware is actually enforced on sensitive HTTP and Socket.IO paths. All routes that expose balances, positions, trades, settings, or broker-control actions MUST require a valid authenticated identity, and broker postbacks MUST continue to require a shared secret or equivalent origin verification.

### Tampering

The API can place orders, cancel orders, toggle the kill switch, update alert destinations, and modify broker configuration. These operations MUST be protected by server-side authorization and input validation. Client-side UI restrictions are insufficient because direct HTTP or websocket access can bypass them.

### Information Disclosure

The app processes sensitive financial data, balances, ledger entries, positions, and operational logs. API responses, websocket broadcasts, and logs MUST be scoped to the authenticated operator and must not expose secrets, tokens, or unnecessary financial details to unauthenticated callers. Error responses and audit surfaces should avoid leaking internals.

### Denial of Service

Publicly reachable quote, history, websocket subscription, and broker-control endpoints can consume broker quotas or tie up server resources. The service MUST enforce rate limiting on internet-facing endpoints, bound expensive requests, and ensure unauthenticated users cannot drive broker API consumption or websocket fan-out.

### Elevation of Privilege

A compromise of access control on this system is equivalent to privilege escalation into the operator’s trading account. The server MUST enforce authorization on every order-management, broker-management, and settings-management action; all stored credentials must remain protected at rest; and cryptographic handling must prevent tampering with encrypted broker tokens.
