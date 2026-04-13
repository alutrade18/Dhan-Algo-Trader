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

/** Check if daily P&L limits (loss or profit target) have been reached */
export async function checkDailyPnlLimits(): Promise<OrderGuardResult> {
  const settings = await getSettings();
  const maxLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;
  const maxProfit = settings?.maxDailyProfit ? Number(settings.maxDailyProfit) : null;
  if (!maxLoss && !maxProfit) return { allowed: true };

  try {
    const positions = await dhanClient.getPositions() as Array<Record<string, unknown>>;
    const todayPnl = Array.isArray(positions)
      ? positions.reduce((s, p) => s + Number(p.realizedProfit || 0) + Number(p.unrealizedProfit || 0), 0)
      : 0;

    if (maxLoss && todayPnl <= -maxLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit of ₹${maxLoss.toLocaleString("en-IN")} reached. Today's P&L: ₹${todayPnl.toFixed(2)}`,
      };
    }
    if (maxProfit && todayPnl >= maxProfit) {
      return {
        allowed: false,
        reason: `Daily profit target of ₹${maxProfit.toLocaleString("en-IN")} reached. Today's P&L: ₹${todayPnl.toFixed(2)}`,
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
  const pnlCheck = await checkDailyPnlLimits();
  if (!pnlCheck.allowed) return pnlCheck;

  return { allowed: true };
}
