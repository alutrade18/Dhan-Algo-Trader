import { logger } from "./logger";

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
    logger.error(
      { status: response.status, path, data },
      "Dhan API error",
    );
    throw new DhanApiError(response.status, data);
  }

  return data;
}

export class DhanApiError extends Error {
  status: number;
  data: unknown;
  constructor(status: number, data: unknown) {
    super(`Dhan API error: ${status}`);
    this.name = "DhanApiError";
    this.status = status;
    this.data = data;
  }
}

export const dhanClient = {
  configure(clientId: string, accessToken: string) {
    credentials.clientId = clientId;
    credentials.accessToken = accessToken;
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

  async placeOrder(orderData: {
    security_id: string;
    exchange_segment: string;
    transaction_type: string;
    quantity: number;
    order_type: string;
    product_type: string;
    price: number;
    trigger_price?: number;
    disclosed_quantity?: number;
    after_market_order?: boolean;
    validity?: string;
    bo_profit_value?: number;
    bo_stoploss_value?: number;
    tag?: string;
  }) {
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
    return dhanRequest("POST", "/trades/history", {
      from_date: fromDate,
      to_date: toDate,
      page_number: pageNumber,
    });
  },

  async getFundLimits(overrideCredentials?: { clientId: string; accessToken: string }) {
    return dhanRequest("GET", "/fundlimit", undefined, overrideCredentials);
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
    return dhanRequest("POST", endpoint, {
      [Object.keys(securities)[0]]: Object.values(securities)[0],
    });
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
  }) {
    return dhanRequest("POST", "/charts/intraday", {
      security_id: data.securityId,
      exchange_segment: data.exchangeSegment,
      instrument: data.instrumentType,
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

  isConfigured(): boolean {
    return !!credentials.clientId && !!credentials.accessToken;
  },
};
