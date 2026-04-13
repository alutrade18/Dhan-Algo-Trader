import { logger } from "./logger";
import { resolveDhanError, type DhanErrorInfo } from "./dhan-errors";

const DHAN_BASE_URL = "https://api.dhan.co/v2";

const credentials = {
  clientId: process.env.DHAN_CLIENT_ID || "",
  accessToken: process.env.DHAN_ACCESS_TOKEN || "",
};

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

  logger.info({ method, path }, "Dhan API request");

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

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
      { status: response.status, path, data, errorCode: errorInfo?.code },
      `Dhan API error: ${errorInfo?.code ?? response.status} — ${errorInfo?.message ?? "Unknown error"}`,
    );
    throw new DhanApiError(response.status, data, errorInfo ?? undefined);
  }

  return data;
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
        raw: this.data,
      };
    }
    return {
      errorCode: `HTTP-${this.status}`,
      errorMessage: rawMessage ?? "An unexpected error occurred with the broker API.",
      retryable: false,
      raw: this.data,
    };
  }
}

export const dhanClient = {
  configure(clientId: string, accessToken: string) {
    credentials.clientId = clientId;
    credentials.accessToken = accessToken;
  },

  disconnect() {
    credentials.clientId = "";
    credentials.accessToken = "";
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
    return dhanRequest("POST", "/orders", {
      dhanClientId: credentials.clientId,
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

  async getPnlExit() {
    return dhanRequest("GET", "/pnlExit");
  },

  async setPnlExit(data: {
    profitValue: number;
    lossValue: number;
    productType: string[];
    enableKillSwitch: boolean;
  }) {
    const body = {
      dhanClientId: credentials.clientId,
      profitValue: String(data.profitValue),
      lossValue: String(data.lossValue),
      productType: data.productType,
      enableKillSwitch: data.enableKillSwitch,
    };
    logger.info({ pnlBody: body }, "setPnlExit body");
    return dhanRequest("POST", "/pnlExit", body);
  },

  async stopPnlExit() {
    return dhanRequest("DELETE", "/pnlExit");
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
