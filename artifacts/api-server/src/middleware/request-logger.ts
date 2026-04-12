import { type Request, type Response, type NextFunction } from "express";
import { logEvent, type LogCategory } from "../lib/app-logger";

const CATEGORY_MAP: Record<string, LogCategory> = {
  broker: "broker",
  orders: "order",
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
  logs: "system",
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
    [/^\/broker\/refresh/, "Broker balance refresh"],
    [/^\/orders\/cancel/, "Cancel order"],
    [/^\/orders$/, method === "POST" ? "Place order" : "Orders"],
    [/^\/strategies\/pause-all/, "Pause all strategies"],
    [/^\/strategies\/[^/]+\/start/, "Start strategy"],
    [/^\/strategies\/[^/]+\/stop/, "Stop strategy"],
    [/^\/strategies\/[^/]+\/pause/, "Pause strategy"],
    [/^\/strategies\/[^/]+\/resume/, "Resume strategy"],
    [/^\/strategies$/, method === "POST" ? "Create strategy" : "Strategies"],
    [/^\/strategies\/[^/]+$/, method === "PUT" ? "Update strategy" : method === "DELETE" ? "Delete strategy" : "Strategy"],
    [/^\/settings$/, "Save settings"],
    [/^\/risk\/killswitch/, "Kill switch update"],
    [/^\/risk\/pnlExit/, "P&L Exit update"],
    [/^\/risk\/dailyLoss/, "Daily loss limit update"],
    [/^\/paper-trades/, method === "POST" ? "Place paper trade" : "Paper trades"],
  ];

  const cleanPath = path.replace(/^\/api/, "");
  for (const [pattern, label] of map) {
    if (pattern.test(cleanPath)) return label;
  }

  return `${method} /${parts.slice(0, 2).join("/")}`;
}

const SKIP_PATHS = ["/api/logs", "/api/health", "/api/market/quote", "/api/market/ltp"];
const SKIP_METHODS = ["GET", "HEAD", "OPTIONS"];

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_METHODS.includes(req.method)) { next(); return; }
  if (SKIP_PATHS.some(p => req.url.startsWith(p))) { next(); return; }

  const startedAt = Date.now();
  const category = getCategory(req.url);
  const action = getAction(req.method, req.url);

  const originalJson = res.json.bind(res);
  res.json = function (body: unknown) {
    const statusCode = res.statusCode;
    const duration = Date.now() - startedAt;
    const isError = statusCode >= 400;
    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    const status = isError ? "failed" : "success";

    const details: Record<string, unknown> = { duration: `${duration}ms` };
    if (isError && body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      if (b.errorMessage) details.error = b.errorMessage;
      else if (b.error) details.error = b.error;
    }
    if (req.body && typeof req.body === "object") {
      const safe = { ...req.body } as Record<string, unknown>;
      delete safe.accessToken;
      delete safe.password;
      delete safe.token;
      if (Object.keys(safe).length > 0) details.input = safe;
    }

    void logEvent({ level, category, action, details, status, statusCode });

    return originalJson(body);
  };

  next();
}
