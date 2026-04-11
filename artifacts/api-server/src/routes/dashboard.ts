import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, strategiesTable, tradeLogsTable } from "@workspace/db";
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
    });
  } catch (e) {
    req.log.error({ err: e }, "Dashboard summary error");
    res.status(500).json({ error: "Failed to fetch dashboard summary" });
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
