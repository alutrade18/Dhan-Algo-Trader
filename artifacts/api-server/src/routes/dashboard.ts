import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { cachedGetLedger, cachedGetAllLedger } from "../lib/ledger-cache";

let _recentActivityCache: { data: unknown; ts: number } | null = null;
let _recentActivityFetchInProgress = false;
const RECENT_ACTIVITY_TTL_MS = 30_000;

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    // All-time ledger: served from DB equity cache; fall back to cached Dhan call.
    // Positions/orders/trades are no longer fetched here — the frontend shares the
    // ["positions"] TanStack Query cache with the Positions page (no duplicate calls).
    const allTimeStart = new Date(now);
    allTimeStart.setFullYear(allTimeStart.getFullYear() - 3);
    const allTimeStartStr = allTimeStart.toISOString().split("T")[0];
    const todayStr = now.toISOString().split("T")[0];

    const [fundsResult, ledgerResult, settingsResult, killSwitchResult, positionsResult] =
      await Promise.allSettled([
        dhanClient.getFundLimits(),
        cachedGetAllLedger(allTimeStartStr, todayStr),
        db.select().from(settingsTable),
        dhanClient.getKillSwitchStatus(),
        dhanClient.getPositions(),
      ]);

    let availableBalance = 0, usedMargin = 0;
    if (fundsResult.status === "fulfilled") {
      const funds = fundsResult.value as Record<string, unknown>;
      availableBalance = Number(funds.availabelBalance || funds.availableBalance || 0);
      usedMargin = Number(funds.utilizedAmount || 0);
    }

    // All-Time P&L: from ledger (in-memory cached, or DB equity cache used by scheduler)
    let totalPnl = 0;
    if (ledgerResult.status === "fulfilled") {
      const entries = Array.isArray(ledgerResult.value) ? (ledgerResult.value as Record<string, unknown>[]) : [];
      for (const e of entries) {
        const narr = String(e.narration ?? e.particulars ?? "").toUpperCase().trim();
        if (narr === "OPENING BALANCE" || narr === "CLOSING BALANCE") continue;
        if (isNonTradingEntry(narr)) continue;
        const credit = parseFloat(String(e.credit ?? "0").replace(/,/g, ""));
        const debit  = parseFloat(String(e.debit  ?? "0").replace(/,/g, ""));
        const safeCredit = isNaN(credit) ? 0 : credit;
        const safeDebit  = isNaN(debit)  ? 0 : debit;
        if (safeCredit === 0 && safeDebit === 0) continue;
        totalPnl += safeCredit - safeDebit;
      }
      totalPnl = Math.round(totalPnl * 100) / 100;
    }

    const settings = settingsResult.status === "fulfilled"
      ? (settingsResult.value as { killSwitchEnabled?: boolean; maxDailyLoss?: string | null; id?: number }[])[0]
      : null;
    const rawMaxDailyLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;
    const maxDailyLoss = rawMaxDailyLoss !== null && rawMaxDailyLoss > 0 ? rawMaxDailyLoss : null;

    const ksData = killSwitchResult.status === "fulfilled"
      ? (killSwitchResult.value as Record<string, unknown>)
      : null;
    const dhanKsActive =
      ksData?.killSwitchStatus === "ACTIVATE" || ksData?.killSwitchStatus === "ACTIVE";

    const dbKsEnabled = settings?.killSwitchEnabled ?? false;
    if (dbKsEnabled && !dhanKsActive && settings?.id !== undefined) {
      db.update(settingsTable)
        .set({ killSwitchEnabled: false, updatedAt: new Date() })
        .where(eq(settingsTable.id, settings.id))
        .catch(() => {});
    }

    const killSwitchEnabled = dhanKsActive;

    const activeStrategies = 0;

    // Compute win rate from today's closed positions (netQty === 0, realizedProfit defined)
    let winRate = 0;
    if (positionsResult.status === "fulfilled") {
      const positions = Array.isArray(positionsResult.value) ? (positionsResult.value as Array<Record<string, unknown>>) : [];
      const closed = positions.filter(p => Number(p.netQty ?? 1) === 0 && Number(p.realizedProfit ?? 0) !== 0);
      const wins = closed.filter(p => Number(p.realizedProfit ?? 0) > 0).length;
      winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0;
    }

    res.json({
      totalPnl,
      availableBalance,
      usedMargin,
      activeStrategies,
      winRate,
      killSwitchEnabled,
      maxDailyLoss,
    });
  } catch (e) {
    req.log.error({ err: e }, "Dashboard summary error");
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
  }
});

/**
 * Returns true for ledger entries that represent fund flows (deposits/withdrawals)
 * or non-trading platform charges that should NOT be counted as trading P&L.
 *
 * Based on actual Dhan ledger narration strings observed from the API:
 *   "FUNDS DEPOSITED"      → bank deposit into trading account
 *   "FUNDS WITHDRAWAL"     → money sent back to bank
 *   "QUARTERLY SETTLEMENT" → SEBI-mandated periodic return of unused margin to client's bank
 *   "DATA API CHARGES"     → Dhan Data API subscription fee (not a trading cost)
 */
function isNonTradingEntry(narr: string): boolean {
  // === Fund deposits (money coming IN from bank) ===
  if (
    narr.includes("FUNDS DEPOSIT") || narr.includes("FUND DEPOSIT") ||
    narr.includes("DEPOSITED") ||
    narr.includes("FUNDS RECEIV")  || narr.includes("FUND RECEIV") ||
    narr.includes("FUNDS TRANSFER IN") || narr.includes("FUND CREDIT") ||
    narr.includes("FUNDS ADDED") || narr.includes("ONLINE TRANSFER") ||
    narr.includes("NEFT") || narr.includes("IMPS") || narr.includes("UPI") ||
    (narr.includes("FUND") && (narr.includes("RECEIV") || narr.includes("CREDIT") || narr.includes("ADDED") || narr.includes("DEPOSIT")))
  ) return true;

  // === Fund withdrawals (money going OUT to bank) ===
  if (
    narr.includes("FUNDS WITHDRAW") || narr.includes("FUND WITHDRAW") ||
    narr.includes("PAYOUT") || narr.includes("FUNDS PAYOUT") ||
    narr.includes("TRANSFER OUT") || narr.includes("FUND DEBIT") ||
    (narr.includes("WITHDRAW") && !narr.includes("DEPOSIT"))
  ) return true;

  // === SEBI-mandated quarterly unused-margin return to bank ===
  // This is NOT a trading loss — it's your own money returned temporarily.
  // Dhan debits the trading account and the broker re-deposits it later.
  if (narr.includes("QUARTERLY SETTLEMENT")) return true;

  // === Platform / subscription fees (not a trading P&L component) ===
  if (
    narr.includes("DATA API CHARGES") || narr.includes("DATA API") ||
    narr.includes("DATA SUBSCRIPTION") || narr.includes("SUBSCRIPTION CHARGES")
  ) return true;

  return false;
}

/**
 * Period P&L endpoint — uses Dhan ledger for the requested date window.
 * Sums (credit − debit) for genuine trading entries only:
 *   TRADES EXECUTED, brokerage, STT, exchange charges, margin interest, etc.
 * Excludes: deposits, withdrawals, quarterly settlements, and platform fees.
 * This value is NEVER stored in DB — always computed live from the Dhan ledger.
 */
router.get("/dashboard/period-pnl", async (req, res): Promise<void> => {
  try {
    const days = parseInt(String(req.query.days || "365"), 10);
    const now = new Date();
    const toStr = now.toISOString().split("T")[0];
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    const fromStr = from.toISOString().split("T")[0];

    const ledgerResult = await cachedGetLedger(fromStr, toStr).catch(() => null);
    if (!ledgerResult) {
      // Ledger API unavailable (e.g. outside market hours, rate limit, or token issue).
      // Return graceful 200 with null so the chart shows "unavailable" instead of error banner.
      res.json({ periodPnl: null, days, unavailable: true });
      return;
    }

    const entries = Array.isArray(ledgerResult)
      ? (ledgerResult as Record<string, unknown>[])
      : [];

    let periodPnl = 0;
    for (const e of entries) {
      const narr = String(e.narration ?? e.particulars ?? "").toUpperCase().trim();
      if (narr === "OPENING BALANCE" || narr === "CLOSING BALANCE") continue;
      if (isNonTradingEntry(narr)) continue;

      const credit = parseFloat(String(e.credit ?? "0").replace(/,/g, ""));
      const debit  = parseFloat(String(e.debit  ?? "0").replace(/,/g, ""));
      const safeCredit = isNaN(credit) ? 0 : credit;
      const safeDebit  = isNaN(debit)  ? 0 : debit;
      if (safeCredit === 0 && safeDebit === 0) continue;

      periodPnl += safeCredit - safeDebit;
    }

    periodPnl = Math.round(periodPnl * 100) / 100;
    res.json({ periodPnl, days });
  } catch (e) {
    req.log.error({ err: e }, "Period P&L error");
    res.status(500).json({ error: "Failed to compute period P&L" });
  }
});


router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  try {
    const limit = parseInt(String(req.query.limit || "10"), 10);

    if (_recentActivityCache && Date.now() - _recentActivityCache.ts < RECENT_ACTIVITY_TTL_MS) {
      const cached = _recentActivityCache.data as Array<Record<string, unknown>>;
      res.json(cached.slice(0, limit));
      return;
    }
    // Prevent thundering herd: if a fetch is already in progress, serve stale cache (or empty)
    if (_recentActivityFetchInProgress) {
      const stale = (_recentActivityCache?.data as Array<Record<string, unknown>>) ?? [];
      res.json(stale.slice(0, limit));
      return;
    }
    _recentActivityFetchInProgress = true;

    const activities: Array<{
      id: string;
      type: string;
      action: string;
      symbol: string;
      quantity: number;
      price: number;
      status: string;
      timestamp: string;
      details?: string;
    }> = [];

    try {
      const orders = (await dhanClient.getOrders()) as Array<Record<string, unknown>>;
      if (Array.isArray(orders)) {
        for (const o of orders) {
          activities.push({
            id: String(o.orderId || ""),
            type: "order",
            action: String(o.transactionType || ""),
            symbol: String(o.tradingSymbol || o.securityId || ""),
            quantity: Number(o.quantity || 0),
            price: Number(o.price || 0),
            status: String(o.orderStatus || ""),
            timestamp: String(o.createTime || new Date().toISOString()),
            details: `${o.orderType} ${o.productType}`,
          });
        }
      }
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch orders for activity");
    }

    activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    _recentActivityCache = { data: activities, ts: Date.now() };
    _recentActivityFetchInProgress = false;

    res.json(activities.slice(0, limit));
  } catch (e) {
    _recentActivityFetchInProgress = false;
    req.log.error({ err: e }, "Recent activity error");
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

export default router;
