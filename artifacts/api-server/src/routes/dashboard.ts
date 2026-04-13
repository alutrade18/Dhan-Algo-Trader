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

    let totalPnl = 0;
    if (ledgerResult.status === "fulfilled") {
      const entries = Array.isArray(ledgerResult.value) ? (ledgerResult.value as Record<string, unknown>[]) : [];
      if (entries.length > 0) {
        // Classify each raw ledger entry individually.
        // Formula: Net P&L = currentBalance + totalWithdrawn - totalDeposited
        // (Excludes deposits & withdrawals — only actual trading P&L)
        let totalDeposits = 0;
        let totalWithdrawals = 0;

        for (const e of entries) {
          const narr = String(e.narration ?? e.particulars ?? "").toUpperCase().trim();
          // Skip synthetic entries added by Dhan API (not real transactions)
          if (narr === "OPENING BALANCE" || narr === "CLOSING BALANCE") continue;

          // Dhan ledger uses separate `credit` and `debit` fields (not `amount`/`drcr`)
          const credit = parseFloat(String(e.credit ?? "0").replace(/,/g, ""));
          const debit  = parseFloat(String(e.debit  ?? "0").replace(/,/g, ""));
          const isCredit = !isNaN(credit) && credit > 0;
          const isDebit  = !isNaN(debit)  && debit  > 0;
          if (!isCredit && !isDebit) continue; // skip zero/empty entries

          // Identify fund transfers (deposits into account) by narration
          const isDeposit =
            narr.includes("FUNDS DEPOSIT") || narr.includes("FUND DEPOSIT") ||
            narr.includes("FUNDS RECEIV")  || narr.includes("FUND RECEIV") ||
            narr.includes("FUNDS TRANSFER IN") || narr.includes("FUND CREDIT") ||
            narr.includes("FUNDS ADDED") ||
            (narr.includes("FUND") && (narr.includes("RECEIV") || narr.includes("CREDIT") || narr.includes("ADDED") || narr.includes("DEPOSIT")));

          // Identify fund withdrawals (money taken out of account) by narration
          const isWithdrawal =
            narr.includes("FUNDS WITHDRAW") || narr.includes("FUND WITHDRAW") ||
            narr.includes("PAYOUT") || narr.includes("FUNDS PAYOUT") ||
            narr.includes("TRANSFER OUT") || narr.includes("FUND DEBIT") ||
            (narr.includes("WITHDRAW") && !narr.includes("DEPOSIT"));

          if (isDeposit && isCredit) {
            totalDeposits += credit;
          } else if (isWithdrawal && isDebit) {
            totalWithdrawals += debit;
          }
          // All other entries (trades, brokerage, STT, margin interest, etc.) are trading P&L
          // — they are captured automatically via the formula: balance + withdrawn - deposited
        }

        // Net P&L = currentBalance + totalWithdrawn - totalDeposited
        // This gives pure trading performance regardless of how much was deposited/withdrawn.
        totalPnl = Math.round((availableBalance + totalWithdrawals - totalDeposits) * 100) / 100;
      }
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

function classifyLedgerEntry(narration: string): "DEPOSIT" | "WITHDRAWAL" | "PNL" {
  const n = narration.toUpperCase();
  if (n.includes("FUND") && (n.includes("RECEIV") || n.includes("CREDIT") || n.includes("ADDED") || n.includes("DEPOSIT") || n.includes("TRANSFER IN"))) return "DEPOSIT";
  if (n.includes("WITHDRAW") || n.includes("PAYOUT") || n.includes("TRANSFER OUT") || (n.includes("FUND") && n.includes("DEBIT"))) return "WITHDRAWAL";
  return "PNL";
}

/**
 * Period P&L endpoint.
 * Uses direct sum of trade/settlement entries — deposits and withdrawals are
 * excluded so fund flows never inflate the P&L figure.
 * This value is NEVER stored in DB — always computed live from Dhan API.
 */
function isFundFlow(narr: string): boolean {
  // Deposits — any "FUNDS DEPOSITED", "FUNDS RECEIVED", "ONLINE TRANSFER", etc.
  const isDeposit =
    narr.includes("DEPOSITED") ||
    narr.includes("FUNDS DEPOSIT") || narr.includes("FUND DEPOSIT") ||
    narr.includes("FUNDS RECEIV")  || narr.includes("FUND RECEIV") ||
    narr.includes("FUNDS TRANSFER IN") || narr.includes("FUND CREDIT") ||
    narr.includes("FUNDS ADDED") || narr.includes("ONLINE TRANSFER") ||
    narr.includes("NEFT") || narr.includes("IMPS") || narr.includes("UPI") ||
    (narr.includes("FUND") && (narr.includes("RECEIV") || narr.includes("CREDIT") || narr.includes("ADDED") || narr.includes("DEPOSIT")));

  // Withdrawals — any "FUNDS WITHDRAW", "PAYOUT", etc.
  const isWithdrawal =
    narr.includes("FUNDS WITHDRAW") || narr.includes("FUND WITHDRAW") ||
    narr.includes("PAYOUT") || narr.includes("FUNDS PAYOUT") ||
    narr.includes("TRANSFER OUT") || narr.includes("FUND DEBIT") ||
    (narr.includes("WITHDRAW") && !narr.includes("DEPOSIT"));

  return isDeposit || isWithdrawal;
}

router.get("/dashboard/period-pnl", async (req, res): Promise<void> => {
  try {
    const days = parseInt(String(req.query.days || "365"), 10);
    const now = new Date();
    const toStr = now.toISOString().split("T")[0];
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    const fromStr = from.toISOString().split("T")[0];

    // Use trade history (realizedProfit per executed trade) for pure trading P&L.
    // This completely excludes brokerage charges, STT, exchange fees,
    // Data API subscription costs, or any other non-trade debits from the ledger.
    const tradesResult = await dhanClient.getAllTradeHistory(fromStr, toStr)
      .catch(() => null);

    if (!tradesResult) {
      res.status(500).json({ error: "Trade history fetch failed" });
      return;
    }

    const trades = Array.isArray(tradesResult)
      ? (tradesResult as Record<string, unknown>[])
      : [];

    let periodPnl = 0;
    for (const t of trades) {
      const profit = parseFloat(String(t.realizedProfit ?? t.profit ?? "0"));
      if (!isNaN(profit)) periodPnl += profit;
    }

    periodPnl = Math.round(periodPnl * 100) / 100;

    res.json({ periodPnl, days, tradeCount: trades.length });
  } catch (e) {
    req.log.error({ err: e }, "Period P&L error");
    res.status(500).json({ error: "Failed to compute period P&L" });
  }
});

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
          const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

          type DayInfo = { runbal: number; types: string[]; narration: string };
          const dailyMap = new Map<string, DayInfo>();

          for (const e of entries) {
            const voucher = String(e.voucherdate ?? "");
            if (!voucher) continue;
            const parsed = new Date(voucher);
            if (isNaN(parsed.getTime())) continue;
            const dateKey = parsed.toISOString().split("T")[0];
            const bal = parseFloat(String(e.runbal ?? "0").replace(/,/g, ""));
            if (isNaN(bal)) continue;
            const narration = String(e.narration ?? e.particulars ?? "").trim();
            const type = classifyLedgerEntry(narration);

            if (!dailyMap.has(dateKey)) {
              dailyMap.set(dateKey, { runbal: bal, types: [type], narration });
            } else {
              const existing = dailyMap.get(dateKey)!;
              existing.runbal = bal;
              existing.types.push(type);
              existing.narration = narration;
            }
          }

          const sortedDates = Array.from(dailyMap.keys()).sort();
          const pts: typeof points = [];
          let prevBal = 0;
          for (const d of sortedDates) {
            const info = dailyMap.get(d)!;
            const pnl = Math.round((info.runbal - prevBal) * 100) / 100;
            const types = info.types;
            const dominantType = types.includes("DEPOSIT") ? "DEPOSIT"
              : types.includes("WITHDRAWAL") ? "WITHDRAWAL" : "PNL";
            pts.push({ date: d, pnl, cumulative: 0, runbal: info.runbal, type: dominantType, label: info.narration });
            prevBal = info.runbal;
          }
          let tradingCumulative = 0;
          for (const p of pts) {
            if (p.type === "PNL") tradingCumulative += p.pnl;
            p.cumulative = Math.round(tradingCumulative * 100) / 100;
          }
          res.json(pts);
          return;
        } catch {
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
        const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

        type DayInfo = { runbal: number; types: string[]; narration: string };
        const dailyMap = new Map<string, DayInfo>();

        for (const e of entries) {
          const voucher = String(e.voucherdate ?? "");
          if (!voucher) continue;
          const parsed = new Date(voucher);
          if (isNaN(parsed.getTime())) continue;
          const dateKey = parsed.toISOString().split("T")[0];
          const bal = parseFloat(String(e.runbal ?? "0").replace(/,/g, ""));
          if (isNaN(bal)) continue;
          const narration = String(e.narration ?? e.particulars ?? "").trim();
          const type = classifyLedgerEntry(narration);

          if (!dailyMap.has(dateKey)) {
            dailyMap.set(dateKey, { runbal: bal, types: [type], narration });
          } else {
            const existing = dailyMap.get(dateKey)!;
            existing.runbal = bal;
            existing.types.push(type);
            existing.narration = narration;
          }
        }

        const sortedDates = Array.from(dailyMap.keys()).sort();
        if (sortedDates.length === 0) { res.json([]); return; }

        let prevBal = 0;
        for (const d of sortedDates) {
          const info = dailyMap.get(d)!;
          const pnl = Math.round((info.runbal - prevBal) * 100) / 100;
          const types = info.types;
          const dominantType = types.includes("DEPOSIT") ? "DEPOSIT"
            : types.includes("WITHDRAWAL") ? "WITHDRAWAL" : "PNL";
          points.push({
            date: d,
            pnl,
            cumulative: 0,
            runbal: info.runbal,
            type: dominantType,
            label: info.narration,
          });
          prevBal = info.runbal;
        }

        let tradingCumulative = 0;
        for (const p of points) {
          if (p.type === "PNL") tradingCumulative += p.pnl;
          p.cumulative = Math.round(tradingCumulative * 100) / 100;
        }
        res.json(points);
        return;
      } catch {
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
