import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, strategiesTable, tradeLogsTable, settingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  try {
    let availableBalance = 0;
    let usedMargin = 0;
    let openPositions = 0;
    let totalHoldings = 0;
    let pendingOrders = 0;
    let todayPnl = 0;
    let totalPnl = 0;
    let todayTrades = 0;

    try {
      const funds = (await dhanClient.getFundLimits()) as Record<string, unknown>;
      availableBalance = Number(funds.availabelBalance || funds.availableBalance || 0);
      usedMargin = Number(funds.utilizedAmount || 0);
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch fund limits");
    }

    try {
      const positions = (await dhanClient.getPositions()) as unknown[];
      if (Array.isArray(positions)) {
        openPositions = positions.length;
        todayPnl = positions.reduce(
          (sum: number, p: Record<string, unknown>) =>
            sum + Number(p.realizedProfit || 0) + Number(p.unrealizedProfit || 0),
          0,
        );
      }
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch positions");
    }

    try {
      const holdings = (await dhanClient.getHoldings()) as unknown[];
      if (Array.isArray(holdings)) {
        totalHoldings = holdings.length;
        totalPnl = holdings.reduce(
          (sum: number, h: Record<string, unknown>) => sum + Number(h.pnl || 0),
          0,
        );
      }
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch holdings");
    }

    try {
      const orders = (await dhanClient.getOrders()) as unknown[];
      if (Array.isArray(orders)) {
        pendingOrders = orders.filter(
          (o: Record<string, unknown>) => o.orderStatus === "PENDING",
        ).length;
      }
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch orders");
    }

    try {
      const trades = (await dhanClient.getTradeBook()) as unknown[];
      if (Array.isArray(trades)) {
        todayTrades = trades.length;
      }
    } catch (e) {
      req.log.warn({ err: e }, "Failed to fetch trades");
    }

    const activeStrategies = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(strategiesTable)
      .where(eq(strategiesTable.status, "active"));

    const tradeLogs = await db
      .select({
        total: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${tradeLogsTable.status} = 'success' and ${tradeLogsTable.pnl}::numeric > 0)::int`,
      })
      .from(tradeLogsTable);

    const totalTradesFromLogs = tradeLogs[0]?.total || 0;
    const wins = tradeLogs[0]?.wins || 0;
    const winRate = totalTradesFromLogs > 0 ? (wins / totalTradesFromLogs) * 100 : 0;

    const [settings] = await db.select().from(settingsTable);
    const killSwitchEnabled = settings?.killSwitchEnabled ?? false;
    const maxDailyLoss = settings?.maxDailyLoss ? Number(settings.maxDailyLoss) : null;

    let dailyLossAmount = 0;
    let killSwitchTriggered = false;
    if (maxDailyLoss !== null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const [lossRow] = await db
        .select({
          totalLoss: sql<number>`coalesce(abs(sum(case when ${tradeLogsTable.pnl}::numeric < 0 then ${tradeLogsTable.pnl}::numeric else 0 end)), 0)::float`,
        })
        .from(tradeLogsTable)
        .where(sql`${tradeLogsTable.executedAt} >= ${today.toISOString()}`);
      dailyLossAmount = lossRow?.totalLoss ?? 0;
      killSwitchTriggered = killSwitchEnabled || dailyLossAmount >= maxDailyLoss;
    }

    res.json({
      totalPnl: totalPnl + todayPnl,
      todayPnl,
      availableBalance,
      usedMargin,
      openPositions,
      totalHoldings,
      pendingOrders,
      activeStrategies: activeStrategies[0]?.count || 0,
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

router.get("/dashboard/equity-curve", async (req, res): Promise<void> => {
  try {
    const useDhan = req.query.source === "dhan";
    const points: Array<{ date: string; pnl: number; cumulative: number }> = [];

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

    if (useDhan) {
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
