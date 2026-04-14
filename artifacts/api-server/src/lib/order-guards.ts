import { db, settingsTable } from "@workspace/db";
import { dhanClient } from "./dhan-client";

export interface OrderGuardResult {
  allowed: boolean;
  reason?: string;
}

async function getSettings() {
  const [s] = await db.select().from(settingsTable);
  return s ?? null;
}

let _positionsCache: { data: Array<Record<string, unknown>>; ts: number } | null = null;
const POSITIONS_CACHE_TTL_MS = 15_000;

async function getCachedPositions(): Promise<Array<Record<string, unknown>>> {
  if (_positionsCache && Date.now() - _positionsCache.ts < POSITIONS_CACHE_TTL_MS) {
    return _positionsCache.data;
  }
  const positions = await dhanClient.getPositions() as Array<Record<string, unknown>>;
  const data = Array.isArray(positions) ? positions : [];
  _positionsCache = { data, ts: Date.now() };
  return data;
}

/** Check if the kill switch is active — blocks all new orders */
export async function checkKillSwitch(settings: Awaited<ReturnType<typeof getSettings>>): Promise<OrderGuardResult> {
  if (settings?.killSwitchEnabled) {
    return { allowed: false, reason: "Kill switch is active. Deactivate it in Risk Manager before placing orders." };
  }
  return { allowed: true };
}

/** Check if the daily loss limit has been reached */
export async function checkDailyLossLimit(settings: Awaited<ReturnType<typeof getSettings>>): Promise<OrderGuardResult> {
  const maxLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;
  if (!maxLoss) return { allowed: true };

  try {
    const positions = await getCachedPositions();
    const todayPnl = positions.reduce((s, p) => s + Number(p.realizedProfit || 0) + Number(p.unrealizedProfit || 0), 0);

    if (todayPnl <= -maxLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit of ₹${maxLoss.toLocaleString("en-IN")} reached. Today's P&L: ₹${todayPnl.toFixed(2)}`,
      };
    }
  } catch {
    return { allowed: true };
  }
  return { allowed: true };
}

/** Run all order guards. Returns first failure or allowed:true */
export async function runOrderGuards(_params: {
  tradingSymbol?: string;
  price?: number;
  quantity?: number;
}): Promise<OrderGuardResult> {
  const settings = await getSettings();

  const ksCheck = await checkKillSwitch(settings);
  if (!ksCheck.allowed) return ksCheck;

  const lossCheck = await checkDailyLossLimit(settings);
  if (!lossCheck.allowed) return lossCheck;

  return { allowed: true };
}
