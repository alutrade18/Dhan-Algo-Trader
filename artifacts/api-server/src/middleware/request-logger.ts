import { type Request, type Response, type NextFunction } from "express";
import { logEvent, type LogCategory } from "../lib/app-logger";

const CATEGORY_MAP: Record<string, LogCategory> = {
  broker: "broker",
  orders: "order",
  "super-orders": "order",
  "forever-orders": "order",
  conditional: "order",
  strategies: "strategy",
  settings: "settings",
  risk: "risk",
  funds: "api",
  positions: "api",
  trades: "api",
  dashboard: "api",
  health: "system",
  "paper-trades": "api",
  market: "api",
  instruments: "api",
  logs: "system",
  postback: "order",
};

function getCategory(url: string): LogCategory {
  const segment = url.replace(/^\/api\//, "").split("/")[0];
  return CATEGORY_MAP[segment] ?? "api";
}

function getAction(method: string, url: string): string {
  const path = url.replace(/^\/api/, "").split("?")[0];
  const parts = path.split("/").filter(Boolean);

  const map: Array<[RegExp, string]> = [
    [/^\/broker\/connect/, "Broker connect"],
    [/^\/broker\/disconnect/, "Broker disconnect"],
    [/^\/broker\/renew-token/, "Renew token"],
    [/^\/broker\/token-info/, "Token info"],
    [/^\/broker\/refresh/, "Broker balance refresh"],
    [/^\/orders\/cancel/, "Cancel order"],
    [/^\/orders$/, method === "POST" ? "Place order" : "Fetch orders"],
    [/^\/orders\/[^/]+$/, method === "GET" ? "Fetch order by ID" : method === "PATCH" ? "Modify order" : method === "DELETE" ? "Cancel order" : "Order"],
    [/^\/super-orders\/[^/]+$/, method === "PUT" ? "Update super order" : method === "DELETE" ? "Delete super order" : "Super order"],
    [/^\/super-orders$/, method === "POST" ? "Create super order" : "Fetch super orders"],
    [/^\/forever-orders\/[^/]+\/cancel/, "Cancel forever order"],
    [/^\/forever-orders\/[^/]+$/, method === "PUT" ? "Update forever order" : method === "DELETE" ? "Delete forever order" : "Forever order"],
    [/^\/forever-orders$/, method === "POST" ? "Create forever order" : "Fetch forever orders"],
    [/^\/conditional\/[^/]+\/toggle/, "Toggle conditional trigger"],
    [/^\/conditional\/[^/]+$/, method === "PUT" ? "Update conditional trigger" : method === "DELETE" ? "Delete conditional trigger" : "Conditional trigger"],
    [/^\/conditional$/, method === "POST" ? "Create conditional trigger" : "Fetch conditional triggers"],
    [/^\/strategies\/pause-all/, "Pause all strategies"],
    [/^\/strategies\/activate-all/, "Activate all strategies"],
    [/^\/strategies\/[^/]+\/execute/, "Execute strategy"],
    [/^\/strategies\/[^/]+\/toggle/, "Toggle strategy"],
    [/^\/strategies\/[^/]+\/start/, "Start strategy engine"],
    [/^\/strategies\/[^/]+\/stop/, "Stop strategy engine"],
    [/^\/strategies$/, method === "POST" ? "Create strategy" : "Fetch strategies"],
    [/^\/strategies\/[^/]+$/, method === "GET" ? "Fetch strategy" : method === "PATCH" ? "Update strategy" : method === "DELETE" ? "Delete strategy" : "Strategy"],
    [/^\/settings\/verify-pin/, "Verify kill switch PIN"],
    [/^\/settings\/audit-log/, "Fetch audit log"],
    [/^\/settings$/, method === "PUT" ? "Save settings" : "Fetch settings"],
    [/^\/risk\/killswitch/, "Kill switch toggle"],
    [/^\/risk\/pnl-exit/, "P&L exit limit update"],
    [/^\/risk\/dailyLoss/, "Daily loss limit update"],
    [/^\/positions$/, method === "GET" ? "Fetch positions" : method === "DELETE" ? "Exit all positions" : "Positions"],
    [/^\/positions\/exit-single/, "Exit single position"],
    [/^\/funds/, "Fetch funds"],
    [/^\/paper-trades\/[^/]+\/close/, "Close paper trade"],
    [/^\/paper-trades\/[^/]+$/, method === "DELETE" ? "Delete paper trade" : "Paper trade"],
    [/^\/paper-trades$/, method === "POST" ? "Place paper trade" : "Fetch paper trades"],
    [/^\/postback/, "Dhan order postback"],
    [/^\/dashboard/, "Dashboard summary"],
    [/^\/instruments/, "Instruments search"],
    [/^\/trades/, "Fetch trades / ledger"],
    [/^\/market\/expiry-list/, "Fetch expiry list"],
    [/^\/market\/option-chain/, "Fetch option chain"],
  ];

  const cleanPath = path.replace(/^\/api/, "");
  for (const [pattern, label] of map) {
    if (pattern.test(cleanPath)) return label;
  }

  return `${method} /${parts.slice(0, 2).join("/")}`;
}

// Always skip polling + read-only data endpoints that fire every few seconds
// (option chain, quotes, LTP) — they'd flood the logs.
const ALWAYS_SKIP = [
  "/api/logs",
  "/api/health",
  "/api/rate-limits",
  "/api/market/quote",
  "/api/market/ltp",
  "/api/market/option-chain",
  "/api/dashboard/summary",   // polled every 30s — too noisy
  "/api/funds",               // polled constantly
  "/api/risk/killswitch",     // polled every 15s
];

// For GET requests: only log if the response is an error (4xx/5xx).
// For all mutating methods (POST/PUT/PATCH/DELETE): always log.
const MUTE_SUCCESS_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (ALWAYS_SKIP.some(p => req.url.startsWith(p))) { next(); return; }

  const startedAt = Date.now();
  const category = getCategory(req.url);
  const action = getAction(req.method, req.url);
  const isReadOnly = MUTE_SUCCESS_METHODS.has(req.method);

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const statusCode = res.statusCode;
    const duration = Date.now() - startedAt;
    const isError = statusCode >= 400;

    // For GET requests: only write a log entry when it fails
    if (isReadOnly && !isError) {
      return originalJson(body);
    }

    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    const status = isError ? "failed" : "success";

    const details: Record<string, unknown> = { duration: `${duration}ms` };

    // Capture error details from the response body (Dhan error format + generic)
    if (isError && body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (b.errorCode)    details.errorCode    = b.errorCode;
      if (b.errorMessage) details.errorMessage  = b.errorMessage;
      if (b.error)        details.error         = b.error;
      if (b.message)      details.message       = b.message;
    }

    // Capture request payload for mutating calls (strip sensitive fields)
    if (!isReadOnly && req.body && typeof req.body === "object") {
      const safe = { ...req.body } as Record<string, unknown>;
      delete safe.accessToken;
      delete safe.password;
      delete safe.token;
      delete safe.killSwitchPin;
      if (Object.keys(safe).length > 0) details.input = safe;
    }

    // For successful reads that aren't skipped, include the endpoint path
    if (isReadOnly && isError) {
      details.endpoint = `${req.method} ${req.url.split("?")[0]}`;
    }

    void logEvent({ level, category, action, details, status, statusCode });

    return originalJson(body);
  };

  next();
}
