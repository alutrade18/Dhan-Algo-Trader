import { db, strategiesTable, tradeLogsTable, settingsTable } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { dhanClient } from "./dhan-client";
import { evaluateAllConditions, type Condition } from "./condition-evaluator";
import { type Candle } from "./indicators";
import { sendTelegramAlert } from "./telegram";
import { logger } from "./logger";

function isNSEMarketHours(): boolean {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function todayIST(): Date {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  ist.setHours(0, 0, 0, 0);
  return ist;
}

class StrategyEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastCheck: Date | null = null;
  private activeCount = 0;

  start(intervalMs = 5 * 60 * 1000) {
    if (this.running) return;
    this.running = true;
    logger.info("Strategy engine started");
    void this.runCycle();
    this.intervalId = setInterval(() => void this.runCycle(), intervalMs);
  }

  stop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.running = false;
    logger.info("Strategy engine stopped");
  }

  getStatus() {
    return {
      running: this.running,
      activeStrategies: this.activeCount,
      lastCheck: this.lastCheck?.toISOString() ?? null,
    };
  }

  private async runCycle() {
    if (!isNSEMarketHours()) {
      logger.debug("Strategy engine: outside market hours, skipping");
      return;
    }
    this.lastCheck = new Date();
    try {
      const [settings] = await db.select().from(settingsTable).limit(1);
      if (!settings?.enableAutoTrading) {
        logger.debug("Auto trading disabled");
        return;
      }
      if (settings.killSwitchEnabled) {
        logger.info("Kill switch active — engine idle");
        return;
      }

      const strategies = await db.select().from(strategiesTable)
        .where(eq(strategiesTable.status, "active"));
      this.activeCount = strategies.length;

      for (const strategy of strategies) {
        try {
          await this.checkStrategy(strategy, settings);
        } catch (err) {
          logger.error({ err, strategyId: strategy.id }, "Error in strategy check");
        }
      }
    } catch (err) {
      logger.error({ err }, "Strategy engine cycle error");
    }
  }

  private async checkStrategy(strategy: typeof strategiesTable.$inferSelect, settings: typeof settingsTable.$inferSelect) {
    let entryConditions: Condition[] = [];
    try {
      entryConditions = strategy.entryConditions ? JSON.parse(strategy.entryConditions) : [];
    } catch { return; }
    if (!entryConditions.length) return;

    // Check daily loss limit
    if (settings.maxDailyLoss) {
      const today = todayIST();
      const logs = await db.select().from(tradeLogsTable)
        .where(and(eq(tradeLogsTable.strategyId, strategy.id), gte(tradeLogsTable.executedAt, today)));
      const todayPnl = logs.reduce((s, l) => s + Number(l.pnl || 0), 0);
      if (todayPnl <= -Number(settings.maxDailyLoss)) {
        logger.warn({ strategyId: strategy.id }, "Daily loss limit hit — skipping");
        return;
      }
    }

    // Fetch intraday candles from Dhan
    const interval = [1, 5, 15, 25, 60].includes(strategy.timeframeMinutes ?? 0)
      ? String(strategy.timeframeMinutes) : "15";

    let candles: Candle[];
    try {
      const raw = await dhanClient.getIntradayData({
        securityId: strategy.securityId,
        exchangeSegment: strategy.exchangeSegment,
        instrumentType: strategy.type || "EQUITY",
        interval,
      }) as { open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[]; timestamp?: number[] };

      if (!raw?.close?.length) return;
      candles = raw.timestamp!.map((ts, i) => ({
        open: raw.open![i], high: raw.high![i], low: raw.low![i],
        close: raw.close![i], volume: raw.volume![i],
        timestamp: new Date(ts * 1000).toISOString(),
      }));
    } catch { return; }

    if (candles.length < 30) return;

    const shouldEnter = evaluateAllConditions(entryConditions, candles);
    if (!shouldEnter) return;

    logger.info({ strategyId: strategy.id, symbol: strategy.tradingSymbol }, "ENTRY SIGNAL FIRED");

    // Place order
    try {
      const creds = dhanClient.getCredentials();
      const result = await dhanClient.placeOrder({
        dhanClientId: creds.clientId,
        transactionType: strategy.transactionType,
        exchangeSegment: strategy.exchangeSegment,
        productType: "INTRADAY",
        orderType: strategy.orderType,
        validity: "DAY",
        securityId: strategy.securityId,
        quantity: strategy.quantity,
        price: strategy.orderType === "LIMIT" ? Number(strategy.entryPrice || 0) : 0,
        afterMarketOrder: false,
      }) as { orderId?: string; orderStatus?: string };

      const ltp = candles[candles.length - 1].close;

      await db.insert(tradeLogsTable).values({
        strategyId: strategy.id,
        strategyName: strategy.name,
        orderId: result?.orderId ?? null,
        securityId: strategy.securityId,
        tradingSymbol: strategy.tradingSymbol,
        transactionType: strategy.transactionType,
        quantity: strategy.quantity,
        price: String(ltp),
        status: "pending",
        message: `Auto-fired by engine. Order: ${result?.orderId ?? "unknown"}`,
      });

      await db.update(strategiesTable)
        .set({ totalTrades: sql`${strategiesTable.totalTrades} + 1`, status: "paused" })
        .where(eq(strategiesTable.id, strategy.id));

      void sendTelegramAlert(
        `🎯 *Strategy Fired*\n` +
        `Strategy: ${strategy.name}\n` +
        `Symbol: ${strategy.tradingSymbol}\n` +
        `Side: ${strategy.transactionType} | Qty: ${strategy.quantity}\n` +
        `Price: ₹${ltp.toFixed(2)}\n` +
        `Order ID: ${result?.orderId ?? "pending"}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await db.insert(tradeLogsTable).values({
        strategyId: strategy.id,
        strategyName: strategy.name,
        tradingSymbol: strategy.tradingSymbol,
        transactionType: strategy.transactionType,
        quantity: strategy.quantity,
        price: "0",
        status: "failed",
        message: msg,
      });
    }
  }
}

export const strategyEngine = new StrategyEngine();
