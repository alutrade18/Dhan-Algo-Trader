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

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

/** Check if an instrument symbol/tradingSymbol is blacklisted */
export async function checkInstrumentBlacklist(tradingSymbol: string): Promise<OrderGuardResult> {
  const settings = await getSettings();
  if (!settings) return { allowed: true };
  const blacklist = (settings.instrumentBlacklist as string[] | null) ?? [];
  if (!blacklist.length) return { allowed: true };
  const sym = tradingSymbol.toUpperCase();
  const blocked = blacklist.some(b => sym.includes(b.toUpperCase()) || b.toUpperCase().includes(sym));
  if (blocked) return { allowed: false, reason: `Symbol "${tradingSymbol}" is in your instrument blacklist` };
  return { allowed: true };
}

/** Check if max trades per day limit has been reached */
export async function checkMaxTradesPerDay(): Promise<OrderGuardResult> {
  const settings = await getSettings();
  if (!settings?.maxTradesPerDay) return { allowed: true };

  try {
    const orders = await dhanClient.getOrders() as unknown[];
    const todayOrders = (orders as Array<{ updateTime?: string; orderStatus?: string }>).filter(o => {
      const t = o.updateTime ?? "";
      return t.startsWith(todayIST()) && ["TRADED", "PART_TRADED"].includes(o.orderStatus ?? "");
    });
    if (todayOrders.length >= settings.maxTradesPerDay) {
      return {
        allowed: false,
        reason: `Max trades per day limit reached (${settings.maxTradesPerDay}). You have placed ${todayOrders.length} trades today.`,
      };
    }
  } catch {
    return { allowed: true };
  }
  return { allowed: true };
}

/** Check if position size exceeds the configured maximum */
export async function checkMaxPositionSize(orderValue: number): Promise<OrderGuardResult> {
  const settings = await getSettings();
  if (!settings?.maxPositionSizeValue) return { allowed: true };

  const maxVal = Number(settings.maxPositionSizeValue);
  if (isNaN(maxVal) || maxVal <= 0) return { allowed: true };

  if (settings.maxPositionSizeType === "PERCENT") {
    try {
      const funds = await dhanClient.getFundLimits() as { availabelBalance?: number; availableBalance?: number };
      const balance = funds.availableBalance ?? funds.availabelBalance ?? 0;
      const maxAllowed = (balance * maxVal) / 100;
      if (orderValue > maxAllowed) {
        return {
          allowed: false,
          reason: `Order value ₹${orderValue.toLocaleString("en-IN")} exceeds max position size of ${maxVal}% of capital (₹${maxAllowed.toLocaleString("en-IN", { maximumFractionDigits: 0 })})`,
        };
      }
    } catch {
      return { allowed: true };
    }
  } else {
    if (orderValue > maxVal) {
      return {
        allowed: false,
        reason: `Order value ₹${orderValue.toLocaleString("en-IN")} exceeds max position size of ₹${maxVal.toLocaleString("en-IN")}`,
      };
    }
  }

  return { allowed: true };
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
export async function runOrderGuards(params: {
  tradingSymbol?: string;
  price?: number;
  quantity?: number;
}): Promise<OrderGuardResult> {
  if (params.tradingSymbol) {
    const r = await checkInstrumentBlacklist(params.tradingSymbol);
    if (!r.allowed) return r;
  }

  const tradesCheck = await checkMaxTradesPerDay();
  if (!tradesCheck.allowed) return tradesCheck;

  const pnlCheck = await checkDailyPnlLimits();
  if (!pnlCheck.allowed) return pnlCheck;

  if (params.price && params.quantity) {
    const orderValue = params.price * params.quantity;
    const sizeCheck = await checkMaxPositionSize(orderValue);
    if (!sizeCheck.allowed) return sizeCheck;
  }

  return { allowed: true };
}
