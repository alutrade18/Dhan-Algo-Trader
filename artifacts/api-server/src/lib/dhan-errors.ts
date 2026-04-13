export interface DhanErrorInfo {
  code: string;
  httpStatus: number;
  message: string;
  retryable: boolean;
}

export const TRADING_API_ERRORS: Record<string, DhanErrorInfo> = {
  "DH-901": {
    code: "DH-901",
    httpStatus: 401,
    message: "Client ID or access token is invalid or expired. Please reconnect your broker account.",
    retryable: false,
  },
  "DH-902": {
    code: "DH-902",
    httpStatus: 403,
    message: "You have not subscribed to Data APIs or do not have access to Trading APIs. Please subscribe to Data APIs on Dhan.",
    retryable: false,
  },
  "DH-903": {
    code: "DH-903",
    httpStatus: 403,
    message: "Account error. Check if required trading segments are activated in your Dhan account.",
    retryable: false,
  },
  "DH-904": {
    code: "DH-904",
    httpStatus: 429,
    message: "Rate limit exceeded. Too many requests from your account. Please slow down and try again.",
    retryable: true,
  },
  "DH-905": {
    code: "DH-905",
    httpStatus: 400,
    message: "IP not whitelisted or invalid request. Go to Dhan Portal → My Profile → Manage App → whitelist your server IP, then retry.",
    retryable: false,
  },
  "DH-906": {
    code: "DH-906",
    httpStatus: 422,
    message: "Order error. The order request is invalid and cannot be processed.",
    retryable: false,
  },
  "DH-907": {
    code: "DH-907",
    httpStatus: 404,
    message: "Data error. Unable to fetch data — incorrect parameters or no data available.",
    retryable: false,
  },
  "DH-908": {
    code: "DH-908",
    httpStatus: 500,
    message: "Dhan internal server error. This is rare. Please try again in a moment.",
    retryable: true,
  },
  "DH-909": {
    code: "DH-909",
    httpStatus: 502,
    message: "Network error. The API could not reach Dhan backend. Please try again.",
    retryable: true,
  },
  "DH-910": {
    code: "DH-910",
    httpStatus: 500,
    message: "An unexpected error occurred. Please try again.",
    retryable: true,
  },
  "DH-911": {
    code: "DH-911",
    httpStatus: 403,
    message: "Invalid IP address. Your IP is not whitelisted in Dhan settings.",
    retryable: false,
  },
};

export const DATA_API_ERRORS: Record<number, DhanErrorInfo> = {
  800: {
    code: "DATA-800",
    httpStatus: 500,
    message: "Dhan Data API internal server error. Please try again.",
    retryable: true,
  },
  804: {
    code: "DATA-804",
    httpStatus: 400,
    message: "Requested number of instruments exceeds limit.",
    retryable: false,
  },
  805: {
    code: "DATA-805",
    httpStatus: 429,
    message: "Too many data requests or connections. You may be temporarily blocked. Please wait before retrying.",
    retryable: true,
  },
  806: {
    code: "DATA-806",
    httpStatus: 403,
    message: "Data APIs not subscribed. Please subscribe to Dhan Data APIs.",
    retryable: false,
  },
  807: {
    code: "DATA-807",
    httpStatus: 401,
    message: "Access token is expired. Please reconnect your broker account.",
    retryable: false,
  },
  808: {
    code: "DATA-808",
    httpStatus: 401,
    message: "Authentication failed. Client ID or Access Token is invalid.",
    retryable: false,
  },
  809: {
    code: "DATA-809",
    httpStatus: 401,
    message: "Access token is invalid. Please reconnect your broker account.",
    retryable: false,
  },
  810: {
    code: "DATA-810",
    httpStatus: 401,
    message: "Client ID is invalid. Please reconnect your broker account.",
    retryable: false,
  },
  811: {
    code: "DATA-811",
    httpStatus: 400,
    message: "Invalid expiry date provided.",
    retryable: false,
  },
  812: {
    code: "DATA-812",
    httpStatus: 400,
    message: "Invalid date format. Use the correct date format (YYYY-MM-DD).",
    retryable: false,
  },
  813: {
    code: "DATA-813",
    httpStatus: 400,
    message: "Invalid Security ID provided.",
    retryable: false,
  },
  814: {
    code: "DATA-814",
    httpStatus: 400,
    message: "Invalid request parameters.",
    retryable: false,
  },
};

export const RATE_LIMITS_REFERENCE = {
  order:      { perSecond: 10,  perMinute: 250,       perHour: 1000,      perDay: 7000,   modificationCapPerOrder: 25 },
  data:       { perSecond: 5,   perMinute: null,       perHour: null,      perDay: 100000 },
  quote:      { perSecond: 1,   perMinute: "Unlimited", perHour: "Unlimited", perDay: "Unlimited" },
  nontrading: { perSecond: 20,  perMinute: "Unlimited", perHour: "Unlimited", perDay: "Unlimited" },
} as const;

export function resolveDhanError(rawData: unknown): DhanErrorInfo | null {
  if (!rawData || typeof rawData !== "object") return null;
  const data = rawData as Record<string, unknown>;

  const errorCode = data["errorCode"] as string | undefined;
  if (errorCode && TRADING_API_ERRORS[errorCode]) {
    return TRADING_API_ERRORS[errorCode];
  }

  const statusCode = data["status"] as number | undefined;
  if (statusCode && DATA_API_ERRORS[statusCode]) {
    return DATA_API_ERRORS[statusCode];
  }

  const remarks = data["remarks"] as string | undefined;
  if (remarks) {
    for (const [key, info] of Object.entries(TRADING_API_ERRORS)) {
      if (remarks.includes(key)) return info;
    }
  }

  return null;
}
