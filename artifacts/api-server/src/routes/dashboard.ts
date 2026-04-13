import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    // Fetch 3 years of ledger history to capture all deposits/withdrawals since account opening
    const allTimeStart = new Date(now);
    allTimeStart.setFullYear(allTimeStart.getFullYear() - 3);
    const allTimeStartStr = allTimeStart.toISOString().split("T")[0];
    const todayStr = now.toISOString().split("T")[0];

    // Fire all Dhan + DB calls in parallel
    const [
      fundsResult, positionsResult, holdingsResult, ledgerResult, ordersResult, tradesResult,
      settingsResult, killSwitchResult,
    ] = await Promise.allSettled([
      dhanClient.getFundLimits(),
      dhanClient.getPositions(),
      dhanClient.getHoldings(),
      dhanClient.getAllLedger(allTimeStartStr, todayStr),
      dhanClient.getOrders(),
      dhanClient.getTradeBook(),
      db.select().from(settingsTable),
      // Fetch REAL-TIME kill switch status from Dhan API — not from DB
      dhanClient.getKillSwitchStatus(),
    ]);

    let availableBalance = 0, usedMargin = 0;
    if (fundsResult.status === "fulfilled") {
      const funds = fundsResult.value as Record<string, unknown>;
      availableBalance = Number(funds.availabelBalance || funds.availableBalance || 0);
      usedMargin = Number(funds.utilizedAmount || 0);
    }

    let openPositions = 0, todayPnl = 0;
    if (positionsResult.status === "fulfilled") {
      const positions = positionsResult.value as Record<string, unknown>[];
      if (Array.isArray(positions)) {
        openPositions = positions.length;
        todayPnl = positions.reduce((s, p) => s + Number(p.realizedProfit || 0) + Number(p.unrealizedProfit || 0), 0);
      }
    }

    const totalHoldings = holdingsResult.status === "fulfilled" && Array.isArray(holdingsResult.value)
      ? (holdingsResult.value as unknown[]).length : 0;

    // All-Time P&L: sum (credit − debit) for genuine trading entries in the full ledger.
    // Uses isNonTradingEntry() to exclude deposits, withdrawals, quarterly settlements,
    // and platform fees — same logic as the period-pnl endpoint.
    // NOTE: isNonTradingEntry is defined later in this file but hoisted at runtime.
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
    } else {
      req.log.warn({ err: (ledgerResult as PromiseRejectedResult).reason }, "Ledger fetch failed");
    }

    let pendingOrders = 0;
    if (ordersResult.status === "fulfilled" && Array.isArray(ordersResult.value)) {
      pendingOrders = (ordersResult.value as Record<string, unknown>[]).filter(o => o.orderStatus === "PENDING").length;
    }

    const todayTrades = tradesResult.status === "fulfilled" && Array.isArray(tradesResult.value)
      ? (tradesResult.value as unknown[]).length : 0;

    const settings = settingsResult.status === "fulfilled" ? (settingsResult.value as { killSwitchEnabled?: boolean; maxDailyLoss?: string | null; id?: number }[])[0] : null;
    // maxDailyLoss = 0 means "not configured" — treat as null so it never false-triggers
    const rawMaxDailyLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;
    const maxDailyLoss = rawMaxDailyLoss !== null && rawMaxDailyLoss > 0 ? rawMaxDailyLoss : null;

    // Use REAL-TIME kill switch status from Dhan API
    const ksData = killSwitchResult.status === "fulfilled"
      ? (killSwitchResult.value as Record<string, unknown>)
      : null;
    const dhanKsActive =
      ksData?.killSwitchStatus === "ACTIVATE" ||
      ksData?.killSwitchStatus === "ACTIVE";

    // If Dhan says KS is off but our DB still shows it on, sync the DB silently
    const dbKsEnabled = settings?.killSwitchEnabled ?? false;
    if (dbKsEnabled && !dhanKsActive && settings?.id !== undefined) {
      db.update(settingsTable)
        .set({ killSwitchEnabled: false, updatedAt: new Date() })
        .where(eq(settingsTable.id, settings.id))
        .catch(() => {/* silent sync */});
    }

    const killSwitchEnabled = dhanKsActive;
    // Daily loss = abs of negative today P&L from live positions (real-time)
    const dailyLossAmount = Math.abs(Math.min(0, todayPnl));
    const killSwitchTriggered = killSwitchEnabled || (maxDailyLoss !== null && dailyLossAmount >= maxDailyLoss);

    res.json({
      totalPnl,
      todayPnl,
      availableBalance,
      usedMargin,
      openPositions,
      totalHoldings,
      pendingOrders,
      activeStrategies: 0,
      todayTrades,
      winRate: 0,
      killSwitchTriggered,
      killSwitchEnabled,
      dailyLossAmount,
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

    const ledgerResult = await dhanClient.getLedger(fromStr, toStr).catch(() => null);
    if (!ledgerResult) {
      res.status(500).json({ error: "Ledger fetch failed" });
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

/** Classify a ledger entry narration as DEPOSIT, WITHDRAWAL, or PNL. */
function classifyLedgerEntry(narration: string): "DEPOSIT" | "WITHDRAWAL" | "PNL" {
  const n = narration.toUpperCase();
  if (
    (n.includes("FUND") && (n.includes("DEPOSIT") || n.includes("RECEIV") || n.includes("CREDIT") || n.includes("ADDED") || n.includes("TRANSFER IN"))) ||
    n === "FUNDS DEPOSITED"
  ) return "DEPOSIT";
  if (
    n.includes("WITHDRAW") || n.includes("PAYOUT") || n.includes("TRANSFER OUT") ||
    (n.includes("FUND") && n.includes("DEBIT"))
  ) return "WITHDRAWAL";
  return "PNL";
}

/**
 * Converts raw Dhan ledger entries into equity curve data points.
 *
 * Key behaviours:
 *  1. OPENING BALANCE and CLOSING BALANCE rows are skipped — they are synthetic
 *     Dhan API entries with runbal=0 that would corrupt the running-balance delta.
 *  2. The Dhan ledger API returns entries in REVERSE chronological order.
 *     For each calendar date we keep only the FIRST runbal we encounter (= the
 *     latest/end-of-day balance for that date) and never overwrite it with older
 *     intra-day entries.
 *  3. Entries dated at the Unix epoch ("Jan 01, 1970") are ignored — they are
 *     another Dhan artefact for the OPENING BALANCE sentinel.
 *  4. pnl = runbal delta vs. previous trading day.
 *  5. cumulative is accumulated only for PNL-type days (deposits/withdrawals are
 *     charted separately and excluded from the cumulative P&L line).
 */
function buildEquityCurvePoints(
  raw: unknown,
): Array<{ date: string; pnl: number; cumulative: number; runbal?: number; type?: string; label?: string }> {
  const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

  type DayInfo = { runbal: number; types: string[]; narration: string };
  const dailyMap = new Map<string, DayInfo>();

  for (const e of entries) {
    const narration = String(e.narration ?? e.particulars ?? "").trim();
    const narrUpper = narration.toUpperCase();

    // Skip synthetic Dhan balance rows — they have runbal=0 and corrupt the chart
    if (narrUpper === "OPENING BALANCE" || narrUpper === "CLOSING BALANCE") continue;

    const voucher = String(e.voucherdate ?? "");
    if (!voucher) continue;
    const parsed = new Date(voucher);
    if (isNaN(parsed.getTime())) continue;

    // Skip the Unix-epoch sentinel sometimes emitted as OPENING BALANCE date
    const dateKey = parsed.toISOString().split("T")[0];
    if (dateKey === "1970-01-01") continue;

    const bal = parseFloat(String(e.runbal ?? "0").replace(/,/g, ""));
    if (isNaN(bal) || bal === 0) continue;

    const type = classifyLedgerEntry(narration);

    if (!dailyMap.has(dateKey)) {
      // First entry for this date = most recent intraday entry (reverse-order data)
      // = correct end-of-day balance. Do NOT overwrite with older entries.
      dailyMap.set(dateKey, { runbal: bal, types: [type], narration });
    } else {
      // Accumulate event types for colour coding but preserve the first runbal
      const existing = dailyMap.get(dateKey)!;
      existing.types.push(type);
    }
  }

  const sortedDates = Array.from(dailyMap.keys()).sort();
  const points: Array<{ date: string; pnl: number; cumulative: number; runbal?: number; type?: string; label?: string }> = [];

  let prevBal = 0;
  let tradingCumulative = 0;

  for (const d of sortedDates) {
    const info = dailyMap.get(d)!;
    const pnl = Math.round((info.runbal - prevBal) * 100) / 100;
    const dominantType = info.types.includes("DEPOSIT") ? "DEPOSIT"
      : info.types.includes("WITHDRAWAL") ? "WITHDRAWAL" : "PNL";

    if (dominantType === "PNL") tradingCumulative += pnl;
    points.push({
      date: d,
      pnl,
      cumulative: Math.round(tradingCumulative * 100) / 100,
      runbal: info.runbal,
      type: dominantType,
      label: info.narration,
    });
    prevBal = info.runbal;
  }

  return points;
}

router.get("/dashboard/equity-curve", async (req, res): Promise<void> => {
  try {
    const source = String(req.query.source ?? "local");
    const useDhan = source === "dhan";
    const useLedger = source === "ledger";
    const points: Array<{ date: string; pnl: number; cumulative: number; runbal?: number; type?: string; label?: string }> = [];

    let startDate: Date;
    let endDate: Date;

    if (req.query.fromDate && req.query.toDate) {
      startDate = new Date(String(req.query.fromDate) + "T00:00:00Z");
      endDate = new Date(String(req.query.toDate) + "T00:00:00Z");
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) {
        res.status(400).json({ error: "Invalid date range" });
        return;
      }
    } else if (req.query.allTime === "true") {
      if (useLedger) {
        // For all-time ledger: use getAllLedger with 3-year window (same as summary endpoint)
        const now = new Date();
        const allTimeStart = new Date(now);
        allTimeStart.setFullYear(allTimeStart.getFullYear() - 3);
        const allTimeStartStr = allTimeStart.toISOString().split("T")[0];
        const todayStr = now.toISOString().split("T")[0];

        try {
          const raw = await dhanClient.getAllLedger(allTimeStartStr, todayStr);
          const pts = buildEquityCurvePoints(raw);
          res.json(pts);
          return;
        } catch (err) {
          req.log.error({ err }, "equity-curve allTime ledger error");
          res.json([]);
          return;
        }
      }
      // No local trade log source — use ledger or dhan for all-time equity
      if (!useDhan) { res.json([]); return; }
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      endDate = new Date();
      endDate.setHours(0, 0, 0, 0);
    } else {
      const days = parseInt(String(req.query.days || "7"), 10);
      endDate = new Date();
      endDate.setHours(0, 0, 0, 0);
      startDate = new Date(endDate);
      startDate.setDate(startDate.getDate() - (days - 1));
    }

    const fromStr = startDate.toISOString().split("T")[0];
    const toStr = endDate.toISOString().split("T")[0];

    if (useLedger) {
      try {
        const raw = await dhanClient.getLedger(fromStr, toStr);
        res.json(buildEquityCurvePoints(raw));
        return;
      } catch (err) {
        req.log.error({ err }, "equity-curve ledger error");
        res.json([]);
        return;
      }
    } else if (useDhan) {
      try {
        const trades = await dhanClient.getAllTradeHistory(fromStr, toStr);
        const dailyMap = new Map<string, number>();

        for (const t of trades as Record<string, unknown>[]) {
          const timeStr = String(t.exchangeTradeTime ?? t.createTime ?? "");
          const dateKey = timeStr.split(" ")[0] ?? timeStr.split("T")[0];
          if (!dateKey || dateKey.length < 10) continue;
          const profit = parseFloat(String(t.realizedProfit ?? t.profit ?? 0));
          if (!isNaN(profit)) {
            dailyMap.set(dateKey, (dailyMap.get(dateKey) ?? 0) + profit);
          }
        }

        const cur = new Date(startDate);
        while (cur <= endDate) {
          const key = cur.toISOString().split("T")[0];
          points.push({ date: key, pnl: Math.round((dailyMap.get(key) ?? 0) * 100) / 100, cumulative: 0 });
          cur.setDate(cur.getDate() + 1);
        }
      } catch {
        res.json([]);
        return;
      }
    } else {
      // No local trade log source — return empty; use source=ledger or source=dhan
      res.json([]);
      return;
    }

    let cumulative = 0;
    for (const p of points) {
      cumulative += p.pnl;
      p.cumulative = Math.round(cumulative * 100) / 100;
    }

    res.json(points);
  } catch (e) {
    req.log.error({ err: e }, "Equity curve error");
    res.status(500).json({ error: "Failed to fetch equity curve" });
  }
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  try {
    const limit = parseInt(String(req.query.limit || "10"), 10);
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
        for (const o of orders.slice(0, limit)) {
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

    res.json(activities.slice(0, limit));
  } catch (e) {
    req.log.error({ err: e }, "Recent activity error");
    res.status(500).json({ error: "Failed to fetch recent activity" });
  }
});

export default router;
