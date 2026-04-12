import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, strategiesTable, tradeLogsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    const now = new Date();
    const ytdStart = `${now.getFullYear()}-01-01`;
    const ytdEnd = now.toISOString().split("T")[0];
    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Fire all Dhan + DB calls in parallel
    const [
      fundsResult, positionsResult, holdingsResult, ledgerResult, ordersResult, tradesResult,
      activeStrategiesResult, tradeLogsResult, settingsResult, lossResult,
    ] = await Promise.allSettled([
      dhanClient.getFundLimits(),
      dhanClient.getPositions(),
      dhanClient.getHoldings(),
      dhanClient.getLedger(ytdStart, ytdEnd),
      dhanClient.getOrders(),
      dhanClient.getTradeBook(),
      db.select({ count: sql<number>`count(*)::int` }).from(strategiesTable).where(eq(strategiesTable.status, "active")),
      db.select({
        total: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${tradeLogsTable.status} = 'success' and ${tradeLogsTable.pnl}::numeric > 0)::int`,
      }).from(tradeLogsTable),
      db.select().from(settingsTable),
      db.select({
        totalLoss: sql<number>`coalesce(abs(sum(case when ${tradeLogsTable.pnl}::numeric < 0 then ${tradeLogsTable.pnl}::numeric else 0 end)), 0)::float`,
      }).from(tradeLogsTable).where(sql`${tradeLogsTable.executedAt} >= ${today.toISOString()}`),
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
        let prevBal = 0;
        let deposits = 0;
        let withdrawals = 0;
        for (const e of entries) {
          const narr = String(e.narration ?? e.particulars ?? "").toUpperCase();
          const bal = parseFloat(String(e.runbal ?? "0").replace(/,/g, ""));
          if (isNaN(bal)) continue;
          const delta = bal - prevBal;
          // Use amount field if available (more accurate than runbal diff)
          const amt = parseFloat(String(e.amount ?? "0").replace(/,/g, ""));
          const txnAmt = !isNaN(amt) && amt !== 0 ? Math.abs(amt) : Math.abs(delta);
          if (
            narr.includes("FUNDS DEPOSIT") || narr.includes("FUNDS RECEIV") ||
            (narr.includes("FUND") && (narr.includes("RECEIV") || narr.includes("CREDIT") || narr.includes("ADDED") || narr.includes("DEPOSIT") || narr.includes("TRANSFER IN")))
          ) {
            if (delta > 0) deposits += txnAmt;
          } else if (
            narr.includes("FUNDS WITHDRAW") || narr.includes("PAYOUT") || narr.includes("TRANSFER OUT") ||
            (narr.includes("WITHDRAW") && !narr.includes("DEPOSIT"))
          ) {
            if (delta < 0) withdrawals += txnAmt;
          }
          prevBal = bal;
        }
        // Use live availableBalance (from fund limits) as the ground-truth current balance.
        // This prevents the ledger's stale "closing balance" entry from corrupting the calc.
        totalPnl = Math.round((availableBalance + withdrawals - deposits) * 100) / 100;
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

    const activeStrategies = activeStrategiesResult.status === "fulfilled"
      ? (activeStrategiesResult.value as { count: number }[])[0]?.count ?? 0 : 0;

    const tradeLogsRow = tradeLogsResult.status === "fulfilled"
      ? (tradeLogsResult.value as { total: number; wins: number }[])[0] : null;
    const totalTradesFromLogs = tradeLogsRow?.total || 0;
    const wins = tradeLogsRow?.wins || 0;
    const winRate = totalTradesFromLogs > 0 ? (wins / totalTradesFromLogs) * 100 : 0;

    const settings = settingsResult.status === "fulfilled" ? (settingsResult.value as { killSwitchEnabled?: boolean; maxDailyLoss?: string | null }[])[0] : null;
    const killSwitchEnabled = settings?.killSwitchEnabled ?? false;
    const maxDailyLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;

    const dailyLossAmount = lossResult.status === "fulfilled"
      ? ((lossResult.value as { totalLoss: number }[])[0]?.totalLoss ?? 0) : 0;
    const killSwitchTriggered = killSwitchEnabled || (maxDailyLoss !== null && dailyLossAmount >= maxDailyLoss);

    res.json({
      totalPnl,
      todayPnl,
      availableBalance,
      usedMargin,
      openPositions,
      totalHoldings,
      pendingOrders,
      activeStrategies,
      todayTrades,
      winRate: Math.round(winRate * 100) / 100,
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
      const [firstRow] = await db
        .select({ minDate: sql<string>`min(${tradeLogsTable.executedAt})::date::text` })
        .from(tradeLogsTable)
        .where(sql`${tradeLogsTable.status} = 'success'`);
      const minDate = firstRow?.minDate;
      if (!minDate && !useDhan) { res.json([]); return; }
      startDate = minDate ? new Date(minDate + "T00:00:00Z") : new Date();
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
      const cur = new Date(startDate);
      while (cur <= endDate) {
        const nextDay = new Date(cur);
        nextDay.setDate(nextDay.getDate() + 1);

        const [row] = await db
          .select({
            dailyPnl: sql<number>`coalesce(sum(${tradeLogsTable.pnl}::numeric), 0)::float`,
          })
          .from(tradeLogsTable)
          .where(
            sql`${tradeLogsTable.executedAt} >= ${cur.toISOString()} AND ${tradeLogsTable.executedAt} < ${nextDay.toISOString()} AND ${tradeLogsTable.status} = 'success'`
          );

        points.push({ date: cur.toISOString().split("T")[0], pnl: row?.dailyPnl ?? 0, cumulative: 0 });
        cur.setDate(cur.getDate() + 1);
      }
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

    const logs = await db
      .select()
      .from(tradeLogsTable)
      .orderBy(sql`${tradeLogsTable.executedAt} DESC`)
      .limit(limit);

    for (const log of logs) {
      activities.push({
        id: String(log.id),
        type: "strategy_execution",
        action: log.transactionType,
        symbol: log.tradingSymbol,
        quantity: log.quantity,
        price: Number(log.price),
        status: log.status,
        timestamp: log.executedAt.toISOString(),
        details: `Strategy: ${log.strategyName}`,
      });
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
