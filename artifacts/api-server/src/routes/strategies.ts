import { Router, type IRouter } from "express";
import { eq, sql, desc, gte, and } from "drizzle-orm";
import { db, strategiesTable, tradeLogsTable, settingsTable } from "@workspace/db";
import { dhanClient } from "../lib/dhan-client";
import { sendTelegramAlert } from "../lib/telegram";
import { strategyEngine } from "../lib/strategy-engine";
import {
  CreateStrategyBody,
  UpdateStrategyBody,
  GetStrategyParams,
  UpdateStrategyParams,
  DeleteStrategyParams,
  ToggleStrategyParams,
  ExecuteStrategyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function serializeStrategy(s: typeof strategiesTable.$inferSelect) {
  return {
    ...s,
    entryPrice: s.entryPrice ? Number(s.entryPrice) : null,
    stopLoss: s.stopLoss ? Number(s.stopLoss) : null,
    target: s.target ? Number(s.target) : null,
    trailingStopLoss: s.trailingStopLoss ? Number(s.trailingStopLoss) : null,
    maxLossPerDay: s.maxLossPerDay ? Number(s.maxLossPerDay) : null,
    maxProfitPerDay: s.maxProfitPerDay ? Number(s.maxProfitPerDay) : null,
    totalPnl: Number(s.totalPnl),
  };
}

router.get("/strategies", async (req, res): Promise<void> => {
  try {
    const strategies = await db.select().from(strategiesTable).orderBy(desc(strategiesTable.createdAt));
    res.json(strategies.map(serializeStrategy));
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch strategies");
    res.status(500).json({ error: "Failed to fetch strategies" });
  }
});

router.get("/strategies/performance", async (req, res): Promise<void> => {
  try {
    const strategies = await db.select().from(strategiesTable);
    const totalStrategies = strategies.length;
    const activeStrategies = strategies.filter((s) => s.status === "active").length;
    const totalTrades = strategies.reduce((sum, s) => sum + s.totalTrades, 0);
    const totalPnl = strategies.reduce((sum, s) => sum + Number(s.totalPnl), 0);
    const totalWins = strategies.reduce((sum, s) => sum + s.winTrades, 0);
    const overallWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const avgPnlPerTrade = totalTrades > 0 ? totalPnl / totalTrades : 0;
    let bestStrategy = "", worstStrategy = "";
    let bestPnl = -Infinity, worstPnl = Infinity;
    for (const s of strategies) {
      const pnl = Number(s.totalPnl);
      if (pnl > bestPnl) { bestPnl = pnl; bestStrategy = s.name; }
      if (pnl < worstPnl) { worstPnl = pnl; worstStrategy = s.name; }
    }
    res.json({ totalStrategies, activeStrategies, totalTrades, totalPnl,
      overallWinRate: Math.round(overallWinRate * 100) / 100,
      bestStrategy: bestStrategy || "N/A", worstStrategy: worstStrategy || "N/A",
      avgPnlPerTrade: Math.round(avgPnlPerTrade * 100) / 100,
    });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch strategy performance");
    res.status(500).json({ error: "Failed to fetch strategy performance" });
  }
});

router.get("/strategies/engine/status", (_req, res): void => {
  res.json(strategyEngine.getStatus());
});

router.post("/strategies/engine/start", (_req, res): void => {
  strategyEngine.start();
  res.json({ success: true, message: "Engine started" });
});

router.post("/strategies/engine/stop", (_req, res): void => {
  strategyEngine.stop();
  res.json({ success: true, message: "Engine stopped" });
});

router.get("/strategies/trade-logs", async (req, res): Promise<void> => {
  try {
    const { fromTimestamp, status } = req.query as Record<string, string>;
    const conditions = [];
    if (fromTimestamp) conditions.push(gte(tradeLogsTable.executedAt, new Date(fromTimestamp)));
    if (status && status !== "all") conditions.push(eq(tradeLogsTable.status, status));
    const logs = await db
      .select()
      .from(tradeLogsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(tradeLogsTable.executedAt))
      .limit(500);
    res.json(logs);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch trade logs" });
  }
});

router.get("/strategies/:id", async (req, res): Promise<void> => {
  const params = GetStrategyParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, params.data.id));
    if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }
    res.json(serializeStrategy(strategy));
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch strategy");
    res.status(500).json({ error: "Failed to fetch strategy" });
  }
});

router.post("/strategies", async (req, res): Promise<void> => {
  const parsed = CreateStrategyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [strategy] = await db
      .insert(strategiesTable)
      .values({
        name: parsed.data.name, description: parsed.data.description, type: parsed.data.type,
        securityId: parsed.data.securityId, tradingSymbol: parsed.data.tradingSymbol,
        exchangeSegment: parsed.data.exchangeSegment, transactionType: parsed.data.transactionType,
        productType: parsed.data.productType, orderType: parsed.data.orderType,
        quantity: parsed.data.quantity, entryPrice: parsed.data.entryPrice?.toString(),
        stopLoss: parsed.data.stopLoss?.toString(), target: parsed.data.target?.toString(),
        trailingStopLoss: parsed.data.trailingStopLoss?.toString(),
        maxPositions: parsed.data.maxPositions, maxLossPerDay: parsed.data.maxLossPerDay?.toString(),
        maxProfitPerDay: parsed.data.maxProfitPerDay?.toString(),
        timeframeMinutes: parsed.data.timeframeMinutes,
        entryConditions: parsed.data.entryConditions, exitConditions: parsed.data.exitConditions,
      })
      .returning();
    res.status(201).json(serializeStrategy(strategy));
  } catch (e) {
    req.log.error({ err: e }, "Failed to create strategy");
    res.status(500).json({ error: "Failed to create strategy" });
  }
});

router.patch("/strategies/:id", async (req, res): Promise<void> => {
  const params = UpdateStrategyParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateStrategyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.securityId !== undefined) updateData.securityId = parsed.data.securityId;
  if (parsed.data.tradingSymbol !== undefined) updateData.tradingSymbol = parsed.data.tradingSymbol;
  if (parsed.data.exchangeSegment !== undefined) updateData.exchangeSegment = parsed.data.exchangeSegment;
  if (parsed.data.transactionType !== undefined) updateData.transactionType = parsed.data.transactionType;
  if (parsed.data.productType !== undefined) updateData.productType = parsed.data.productType;
  if (parsed.data.orderType !== undefined) updateData.orderType = parsed.data.orderType;
  if (parsed.data.quantity !== undefined) updateData.quantity = parsed.data.quantity;
  if (parsed.data.entryPrice !== undefined) updateData.entryPrice = parsed.data.entryPrice?.toString();
  if (parsed.data.stopLoss !== undefined) updateData.stopLoss = parsed.data.stopLoss?.toString();
  if (parsed.data.target !== undefined) updateData.target = parsed.data.target?.toString();
  if (parsed.data.trailingStopLoss !== undefined) updateData.trailingStopLoss = parsed.data.trailingStopLoss?.toString();
  if (parsed.data.maxPositions !== undefined) updateData.maxPositions = parsed.data.maxPositions;
  if (parsed.data.maxLossPerDay !== undefined) updateData.maxLossPerDay = parsed.data.maxLossPerDay?.toString();
  if (parsed.data.maxProfitPerDay !== undefined) updateData.maxProfitPerDay = parsed.data.maxProfitPerDay?.toString();
  if (parsed.data.timeframeMinutes !== undefined) updateData.timeframeMinutes = parsed.data.timeframeMinutes;
  if (parsed.data.entryConditions !== undefined) updateData.entryConditions = parsed.data.entryConditions;
  if (parsed.data.exitConditions !== undefined) updateData.exitConditions = parsed.data.exitConditions;
  try {
    const [strategy] = await db.update(strategiesTable).set(updateData).where(eq(strategiesTable.id, params.data.id)).returning();
    if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }
    res.json(serializeStrategy(strategy));
  } catch (e) {
    req.log.error({ err: e }, "Failed to update strategy");
    res.status(500).json({ error: "Failed to update strategy" });
  }
});

router.delete("/strategies/:id", async (req, res): Promise<void> => {
  const params = DeleteStrategyParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [deleted] = await db.delete(strategiesTable).where(eq(strategiesTable.id, params.data.id)).returning();
    if (!deleted) { res.status(404).json({ error: "Strategy not found" }); return; }
    res.sendStatus(204);
  } catch (e) {
    req.log.error({ err: e }, "Failed to delete strategy");
    res.status(500).json({ error: "Failed to delete strategy" });
  }
});

router.post("/strategies/:id/toggle", async (req, res): Promise<void> => {
  const params = ToggleStrategyParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [existing] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, params.data.id));
    if (!existing) { res.status(404).json({ error: "Strategy not found" }); return; }
    const newStatus = existing.status === "active" ? "paused" : "active";
    const [strategy] = await db.update(strategiesTable).set({ status: newStatus }).where(eq(strategiesTable.id, params.data.id)).returning();
    void sendTelegramAlert(`Strategy *${strategy.name}* ${newStatus === "active" ? "▶️ activated" : "⏸ paused"}`);
    res.json(serializeStrategy(strategy));
  } catch (e) {
    req.log.error({ err: e }, "Failed to toggle strategy");
    res.status(500).json({ error: "Failed to toggle strategy" });
  }
});

router.post("/strategies/pause-all", async (req, res): Promise<void> => {
  try {
    await db.update(strategiesTable).set({ status: "paused" }).where(eq(strategiesTable.status, "active"));
    void sendTelegramAlert("⏸ *All strategies paused* by user action");
    res.json({ success: true, message: "All strategies paused" });
  } catch (e) {
    req.log.error({ err: e }, "Failed to pause all strategies");
    res.status(500).json({ error: "Failed to pause all strategies" });
  }
});

router.post("/strategies/activate-all", async (req, res): Promise<void> => {
  try {
    await db.update(strategiesTable).set({ status: "active" }).where(eq(strategiesTable.status, "paused"));
    void sendTelegramAlert("▶️ *All strategies activated* by user action");
    res.json({ success: true, message: "All strategies activated" });
  } catch (e) {
    req.log.error({ err: e }, "Failed to activate all strategies");
    res.status(500).json({ error: "Failed to activate all strategies" });
  }
});

router.post("/strategies/:id/execute", async (req, res): Promise<void> => {
  const params = ExecuteStrategyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.id, params.data.id));
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found" });
    return;
  }

  const [settings] = await db.select().from(settingsTable);
  if (settings?.killSwitchEnabled) {
    void sendTelegramAlert(`🚫 Order rejected for *${strategy.tradingSymbol}*: Kill switch is active`);
    res.status(403).json({
      error: "Kill switch is active. Disable it in Settings to place orders.",
    });
    return;
  }

  if (settings?.maxDailyLoss) {
    const maxLoss = Number(settings.maxDailyLoss);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [lossRow] = await db
      .select({
        totalLoss: sql<number>`coalesce(sum(case when ${tradeLogsTable.pnl}::numeric < 0 then ${tradeLogsTable.pnl}::numeric else 0 end), 0)::float`,
      })
      .from(tradeLogsTable)
      .where(sql`${tradeLogsTable.executedAt} >= ${today.toISOString()}`);

    const todayLoss = Math.abs(lossRow?.totalLoss ?? 0);
    if (todayLoss >= maxLoss) {
      void sendTelegramAlert(
        `🚫 Daily loss limit ₹${maxLoss} reached (today's loss: ₹${todayLoss.toFixed(2)}). Order rejected for *${strategy.tradingSymbol}*`
      );
      res.status(403).json({
        error: `Daily loss limit of ₹${maxLoss} reached. Trading halted for today.`,
        limitReached: true,
      });
      return;
    }
  }

  try {
    const result = await dhanClient.placeOrder({
      security_id: strategy.securityId,
      exchange_segment: strategy.exchangeSegment,
      transaction_type: strategy.transactionType,
      quantity: strategy.quantity,
      order_type: strategy.orderType,
      product_type: strategy.productType,
      price: strategy.entryPrice ? Number(strategy.entryPrice) : 0,
    });

    const r = result as Record<string, unknown>;
    const orderId = String(r.orderId || r.order_id || "");

    await db.insert(tradeLogsTable).values({
      strategyId: strategy.id,
      strategyName: strategy.name,
      orderId,
      securityId: strategy.securityId,
      tradingSymbol: strategy.tradingSymbol,
      transactionType: strategy.transactionType,
      quantity: strategy.quantity,
      price: strategy.entryPrice || "0",
      status: "success",
      message: `Order placed: ${orderId}`,
    });

    await db
      .update(strategiesTable)
      .set({ totalTrades: sql`${strategiesTable.totalTrades} + 1` })
      .where(eq(strategiesTable.id, strategy.id));

    void sendTelegramAlert(
      `✅ Order placed\nSymbol: *${strategy.tradingSymbol}*\nSide: ${strategy.transactionType}\nQty: ${strategy.quantity}\nOrder ID: ${orderId}`
    );

    res.json({
      strategyId: strategy.id,
      orderId,
      status: "success",
      message: `Order placed successfully for ${strategy.tradingSymbol}`,
      executedAt: new Date().toISOString(),
    });
  } catch (e) {
    await db.insert(tradeLogsTable).values({
      strategyId: strategy.id,
      strategyName: strategy.name,
      securityId: strategy.securityId,
      tradingSymbol: strategy.tradingSymbol,
      transactionType: strategy.transactionType,
      quantity: strategy.quantity,
      price: strategy.entryPrice || "0",
      status: "failed",
      message: String(e),
    });

    await db
      .update(strategiesTable)
      .set({
        totalTrades: sql`${strategiesTable.totalTrades} + 1`,
        lossTrades: sql`${strategiesTable.lossTrades} + 1`,
      })
      .where(eq(strategiesTable.id, strategy.id));

    void sendTelegramAlert(
      `❌ Order failed\nSymbol: *${strategy.tradingSymbol}*\nError: ${String(e)}`
    );

    req.log.error({ err: e }, "Strategy execution failed");
    res.json({
      strategyId: strategy.id,
      orderId: "",
      status: "failed",
      message: `Execution failed: ${String(e)}`,
      executedAt: new Date().toISOString(),
    });
  }
});

export default router;
