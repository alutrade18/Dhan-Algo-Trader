import { logger } from "./logger";
import { resolveDhanError, type DhanErrorInfo } from "./dhan-errors";
import { checkRateLimit, type ApiCategory } from "./rate-limiter";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

// ── Map every Dhan endpoint to an API category ────────────────────────────────
// Order API  : POST/PUT/DELETE on order-placement endpoints
// Data API   : all read (GET) + market data + historical/charting
// Non-Trading: killswitch, instruments, margin calculator, alerts
function getApiCategory(method: string, path: string): ApiCategory {
  const m = method.toUpperCase();
  const p = path.toLowerCase();

  // Order mutations (POST/PUT/DELETE on trading endpoints)
  if (m !== "GET") {
    if (p.startsWith("/orders") || p.startsWith("/superorder") || p.startsWith("/forever")) {
      return "order";
    }
  }

  // Non-trading endpoints (independent of method)
  if (
    p.startsWith("/killswitch") ||
    p.startsWith("/compact/instruments") ||
    p.startsWith("/margincalculator") ||
    p.startsWith("/alerts")
  ) {
    return "nontrading";
  }

  // Everything else: data reads (positions, holdings, orders-read, trades, ledger,
  // market feed, charts, option chain, fund limits, super-order reads)
  return "data";
}

const credentials = {
  clientId: process.env.DHAN_CLIENT_ID || "",
  accessToken: process.env.DHAN_ACCESS_TOKEN || "",
  tokenExpired: false,
};

// ── H8: Retry configuration — safe for idempotent (GET) requests only ────────
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/**
 * Returns true if the request method is safe to retry.
 * We never retry POST/PUT on order endpoints to avoid duplicate fills.
 */
function isRetryable(method: string, path: string): boolean {
  if (method.toUpperCase() !== "GET") return false;
  // Belt-and-suspenders: don't retry order mutations even if method is GET
  const p = path.toLowerCase();
  if (p.startsWith("/orders") || p.startsWith("/superorder") || p.startsWith("/forever")) return false;
  return true;
}

async function dhanRequest(
  method: string,
  path: string,
  body?: unknown,
  overrideCredentials?: { clientId: string; accessToken: string },
): Promise<unknown> {
  const creds = overrideCredentials || credentials;
  const url = `${DHAN_BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "access-token": creds.accessToken,
    "client-id": creds.clientId,
  };

  // ── Enforce rate limit before hitting Dhan ────────────────────────────────
  const category = getApiCategory(method, path);
  const rl = checkRateLimit(category);
  if (!rl.allowed) {
    const retryMs = rl.retryAfterMs ?? 1000;
    logger.warn(
      { category, window: rl.violatedWindow, retryAfterMs: retryMs, path },
      `[RateLimit] ${category} ${rl.violatedWindow} limit — blocking Dhan call`,
    );
    // Surface as a 429 so routes can propagate it to the frontend
    throw new DhanApiError(429, {
      errorCode: "DH-904",
      errorMessage: `Rate limit exceeded (${category} ${rl.violatedWindow}). Retry in ${Math.ceil(retryMs / 1000)}s.`,
    }, {
      code: "DH-904",
      message: `Rate limit: retry in ${Math.ceil(retryMs / 1000)}s`,
      httpStatus: 429,
      retryable: true,
      retryAfterMs: retryMs,
    });
  }

  const retryable = isRetryable(method, path);
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1];
      logger.warn({ method, path, attempt, delayMs }, `[Retry] Dhan 5xx — retrying in ${delayMs}ms (attempt ${attempt}/${RETRY_DELAYS_MS.length})`);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }

    logger.info({ method, path, attempt }, "Dhan API request");

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (fetchErr) {
      // Network-level error (timeout, DNS, etc.) — retry if safe
      lastError = fetchErr;
      if (retryable && attempt < RETRY_DELAYS_MS.length) continue;
      throw fetchErr;
    }

    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!response.ok) {
      const errorInfo = resolveDhanError(data);
      logger.error(
        { status: response.status, path, data, errorCode: errorInfo?.code, attempt },
        `Dhan API error: ${errorInfo?.code ?? response.status} — ${errorInfo?.message ?? "Unknown error"}`,
      );
      // Mark token as expired on auth failures (only for the main credentials, not override calls)
      if (response.status === 401 && !overrideCredentials) {
        credentials.tokenExpired = true;
        logger.warn({ path }, "Dhan 401 — marking token as expired, broker will show as disconnected");
      }
      const err = new DhanApiError(response.status, data, errorInfo ?? undefined);
      // Retry on 5xx if this is a safe GET request
      if (retryable && response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
        lastError = err;
        continue;
      }
      throw err;
    }

    return data;
  }

  throw lastError;
}

export class DhanApiError extends Error {
  status: number;
  data: unknown;
  errorInfo?: DhanErrorInfo;

  constructor(status: number, data: unknown, errorInfo?: DhanErrorInfo) {
    const msg = errorInfo
      ? `${errorInfo.code}: ${errorInfo.message}`
      : `Dhan API error: ${status}`;
    super(msg);
    this.name = "DhanApiError";
    this.status = errorInfo?.httpStatus ?? status;
    this.data = data;
    this.errorInfo = errorInfo;
  }

  toClientResponse() {
    const rawData = this.data as Record<string, unknown> | null;
    const rawMessage = typeof rawData?.errorMessage === "string" ? rawData.errorMessage : null;
    if (this.errorInfo) {
      return {
        errorCode: this.errorInfo.code,
        errorMessage: rawMessage && rawMessage !== this.errorInfo.message
          ? `${this.errorInfo.message} (${rawMessage})`
          : this.errorInfo.message,
        retryable: this.errorInfo.retryable,
        retryAfterMs: this.errorInfo.retryAfterMs,
        raw: this.data,
      };
    }
    return {
      errorCode: `HTTP-${this.status}`,
      errorMessage: rawMessage ?? "An unexpected error occurred with the broker API.",
      retryable: false,
      retryAfterMs: undefined,
      raw: this.data,
    };
  }
}

export const dhanClient = {
  configure(clientId: string, accessToken: string) {
    credentials.clientId = clientId;
    credentials.accessToken = accessToken;
    credentials.tokenExpired = false;
  },

  disconnect() {
    credentials.clientId = "";
    credentials.accessToken = "";
    credentials.tokenExpired = false;
  },

  isConnected(): boolean {
    return !!credentials.clientId && !!credentials.accessToken && !credentials.tokenExpired;
  },

  isTokenExpired(): boolean {
    return credentials.tokenExpired;
  },

  getCredentialsMasked() {
    return {
      clientId: credentials.clientId
        ? "****" + credentials.clientId.slice(-4)
        : "",
      hasAccessToken: !!credentials.accessToken,
    };
  },

  async getOrders() {
    return dhanRequest("GET", "/orders");
  },

  async getOrderById(orderId: string) {
    return dhanRequest("GET", `/orders/${orderId}`);
  },

  async placeOrder(orderData: Record<string, unknown>) {
    // Generate a correlation ID for idempotency (max 48 chars per Dhan API spec).
    // This lets us detect duplicate orders if the same correlationId is seen twice.
    const correlationId = (orderData.correlation_id as string | undefined) ??
      crypto.randomUUID().replace(/-/g, "").slice(0, 48);
    return dhanRequest("POST", "/orders", {
      dhanClientId: credentials.clientId,
      correlation_id: correlationId,
      ...orderData,
    });
  },

  async modifyOrder(
    orderId: string,
    data: {
      order_type?: string;
      quantity?: number;
      price?: number;
      trigger_price?: number;
      disclosed_quantity?: number;
      validity?: string;
      leg_name?: string;
    },
  ) {
    return dhanRequest("PUT", `/orders/${orderId}`, {
      dhanClientId: credentials.clientId,
      order_id: orderId,
      ...data,
    });
  },

  async cancelOrder(orderId: string) {
    return dhanRequest("DELETE", `/orders/${orderId}`);
  },

  async getPositions() {
    return dhanRequest("GET", "/positions");
  },

  async exitAllPositions() {
    return dhanRequest("DELETE", "/positions");
  },

  async getHoldings() {
    return dhanRequest("GET", "/holdings");
  },

  async getTradeBook() {
    return dhanRequest("GET", "/trades");
  },

  async getTradeHistory(
    fromDate: string,
    toDate: string,
    pageNumber = 0,
  ) {
    return dhanRequest("GET", `/trades/${fromDate}/${toDate}/${pageNumber}`);
  },

  async getAllTradeHistory(fromDate: string, toDate: string) {
    const allTrades: unknown[] = [];
    let page = 0;
    while (page < 100) {
      const data = await dhanRequest("GET", `/trades/${fromDate}/${toDate}/${page}`);
      const arr = Array.isArray(data) ? data : [];
      if (arr.length === 0) break;
      allTrades.push(...arr);
      page++;
    }
    return allTrades;
  },

  async getLedger(fromDate: string, toDate: string) {
    return dhanRequest("GET", `/ledger?from-date=${fromDate}&to-date=${toDate}`);
  },

  /** Fetch ledger for any date range, chunking in 365-day blocks fired in parallel. */
  async getAllLedger(fromDate: string, toDate: string): Promise<Record<string, unknown>[]> {
    const start = new Date(fromDate + "T00:00:00Z");
    const end = new Date(toDate + "T00:00:00Z");
    const CHUNK_DAYS = 365;

    // Build chunk date pairs
    const chunks: { from: string; to: string }[] = [];
    let cur = new Date(start);
    while (cur <= end) {
      const chunkEnd = new Date(cur);
      chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
      if (chunkEnd > end) chunkEnd.setTime(end.getTime());
      chunks.push({ from: cur.toISOString().split("T")[0], to: chunkEnd.toISOString().split("T")[0] });
      cur.setDate(cur.getDate() + CHUNK_DAYS);
    }

    // Fire all chunks in parallel
    const results = await Promise.allSettled(
      chunks.map(c => dhanRequest("GET", `/ledger?from-date=${c.from}&to-date=${c.to}`))
    );

    const allEntries: Record<string, unknown>[] = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        allEntries.push(...(r.value as Record<string, unknown>[]));
      }
    }
    return allEntries;
  },

  async getFundLimits(overrideCredentials?: { clientId: string; accessToken: string }) {
    return dhanRequest("GET", "/fundlimit", undefined, overrideCredentials);
  },

  async calculateMargin(body: Record<string, unknown>) {
    return dhanRequest("POST", "/margincalculator", body);
  },

  async getMarketQuote(
    securities: Record<string, string[]>,
    quoteType: string,
  ) {
    const endpoints: Record<string, string> = {
      ltp: "/marketfeed/ltp",
      ohlc: "/marketfeed/ohlc",
      full: "/marketfeed/quote",
    };
    const endpoint = endpoints[quoteType] || "/marketfeed/ltp";
    // Dhan API requires integer security IDs — convert all string IDs to numbers
    const body: Record<string, number[]> = {};
    for (const [seg, ids] of Object.entries(securities)) {
      body[seg] = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    }
    return dhanRequest("POST", endpoint, body);
  },

  async getLtp(exchangeSegment: string, securityId: string): Promise<number> {
    const body: Record<string, number[]> = {
      [exchangeSegment]: [parseInt(securityId, 10)],
    };
    const raw = await dhanRequest("POST", "/marketfeed/ltp", body) as Record<string, unknown>;
    // Dhan v2 wraps response: { data: { NSE_EQ: { "1333": { last_price: ... } } }, status: "success" }
    const unwrapped = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, Record<string, { last_price?: number }>>;
    const segData = unwrapped[exchangeSegment] ?? unwrapped[Object.keys(unwrapped)[0]];
    const entry   = segData?.[securityId] ?? segData?.[Object.keys(segData ?? {})[0]];
    return Number(entry?.last_price ?? 0);
  },

  async getHistoricalData(data: {
    securityId: string;
    exchangeSegment: string;
    instrumentType: string;
    expiryCode?: string;
    fromDate: string;
    toDate: string;
  }) {
    return dhanRequest("POST", "/charts/historical", {
      security_id: data.securityId,
      exchange_segment: data.exchangeSegment,
      instrument: data.instrumentType,
      expiry_code: data.expiryCode || 0,
      from_date: data.fromDate,
      to_date: data.toDate,
    });
  },

  async getIntradayData(data: {
    securityId: string;
    exchangeSegment: string;
    instrumentType: string;
    interval?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const now = new Date();
    const from = data.fromDate ?? (() => {
      const d = new Date(now); d.setDate(d.getDate() - 60);
      return `${d.toISOString().split("T")[0]} 09:15:00`;
    })();
    const to = data.toDate ?? `${now.toISOString().split("T")[0]} 15:30:00`;
    return dhanRequest("POST", "/charts/intraday", {
      securityId: data.securityId,
      exchangeSegment: data.exchangeSegment,
      instrument: data.instrumentType,
      interval: data.interval ?? "15",
      oi: false,
      fromDate: from,
      toDate: to,
    });
  },

  async getOptionChain(data: {
    underSecurityId: string;
    underExchangeSegment: string;
    expiry: string;
  }) {
    return dhanRequest("POST", "/optionchain", {
      UnderlyingScrip: parseInt(data.underSecurityId),
      UnderlyingSeg: data.underExchangeSegment,
      Expiry: data.expiry,
    });
  },

  async getExpiryList(data: {
    underSecurityId: string;
    underExchangeSegment: string;
  }) {
    return dhanRequest("POST", "/optionchain/expirylist", {
      UnderlyingScrip: parseInt(data.underSecurityId),
      UnderlyingSeg: data.underExchangeSegment,
    });
  },

  async getSecurityList() {
    return dhanRequest("GET", "/compact/instruments");
  },

  async getKillSwitchStatus() {
    return dhanRequest("GET", "/killswitch");
  },

  async setKillSwitch(status: "ACTIVATE" | "DEACTIVATE") {
    return dhanRequest("POST", `/killswitch?killSwitchStatus=${status}`);
  },

  async getSuperOrders() {
    return dhanRequest("GET", "/superorder");
  },

  async placeSuperOrder(body: Record<string, unknown>) {
    return dhanRequest("POST", "/superorder", { dhanClientId: credentials.clientId, ...body });
  },

  async modifySuperOrder(orderId: string, body: Record<string, unknown>) {
    return dhanRequest("PUT", `/superorder/${orderId}`, { dhanClientId: credentials.clientId, order_id: orderId, ...body });
  },

  async cancelSuperOrder(orderId: string, leg: "ENTRY_LEG" | "TARGET_LEG" | "STOP_LOSS_LEG") {
    return dhanRequest("DELETE", `/superorder/${orderId}?leg_name=${leg}`);
  },

  async getForeverOrders() {
    return dhanRequest("GET", "/forever/orders");
  },

  async placeForeverOrder(body: Record<string, unknown>) {
    return dhanRequest("POST", "/forever/orders", { dhanClientId: credentials.clientId, ...body });
  },

  async modifyForeverOrder(orderId: string, body: Record<string, unknown>) {
    return dhanRequest("PUT", `/forever/orders/${orderId}`, { dhanClientId: credentials.clientId, order_id: orderId, ...body });
  },

  async cancelForeverOrder(orderId: string) {
    return dhanRequest("DELETE", `/forever/orders/${orderId}`);
  },

  async getAllConditionalTriggers() {
    return dhanRequest("GET", "/alerts/pending");
  },

  async placeConditionalTrigger(body: Record<string, unknown>) {
    return dhanRequest("POST", "/alerts", { dhanClientId: credentials.clientId, ...body });
  },

  async modifyConditionalTrigger(alertId: string, body: Record<string, unknown>) {
    return dhanRequest("PUT", `/alerts/${alertId}`, { dhanClientId: credentials.clientId, ...body });
  },

  async deleteConditionalTrigger(alertId: string) {
    return dhanRequest("DELETE", `/alerts/${alertId}`);
  },

  getCredentials() {
    return { clientId: credentials.clientId, accessToken: credentials.accessToken };
  },

  isConfigured(): boolean {
    return !!credentials.clientId && !!credentials.accessToken;
  },
};
