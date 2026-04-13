const API_BASE = "/api";

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface AdminStats {
  totalUsers: number;
  totalSuperOrders: number;
  configuredBrokers: number;
  recentErrors: number;
}

export interface AdminUser {
  id: number;
  userId: string | null;
  brokerClientId: string | null;
  enableAutoTrading: boolean;
  killSwitchEnabled: boolean;
  autoSquareOffEnabled: boolean;
  theme: string;
  updatedAt: string;
  tokenGeneratedAt: string | null;
  superOrderCount: number;
}

export interface AdminOrder {
  id: number;
  userId: string | null;
  dhanOrderId: string | null;
  securityId: string;
  exchangeSegment: string;
  tradingSymbol: string | null;
  transactionType: string;
  productType: string;
  quantity: number;
  price: string | null;
  targetPrice: string | null;
  stopLossPrice: string | null;
  status: string;
  orderDate: string;
  createdAt: string;
}

export interface AppLog {
  id: number;
  level: string;
  category: string;
  action: string;
  details: string | null;
  status: string | null;
  statusCode: number | null;
  createdAt: string;
}
