import { db, superOrdersTable } from "@workspace/db";
import { not, inArray, eq } from "drizzle-orm";
import { dhanClient } from "./dhan-client";
import { sendTelegramAlert } from "./telegram";
import { logger } from "./logger";
import { isNseHolidayToday } from "./equity-scheduler";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

let monitorInterval: ReturnType<typeof setInterval> | null = null;

const TERMINAL_STATUSES = ["CANCELLED", "COMPLETED", "TARGET_HIT", "STOP_LOSS_HIT"];

function nowIST(): { hours: number; minutes: number; dateStr: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    dateStr: ist.toISOString().slice(0, 10),
  };
}

async function isMarketHours(): Promise<boolean> {
  const { hours, minutes, dateStr } = nowIST();
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  if (await isNseHolidayToday()) return false;
  const totalMinutes = hours * 60 + minutes;
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 25;
  return totalMinutes >= open && totalMinutes <= close;
}

async function checkSuperOrders(): Promise<void> {
  if (!await isMarketHours()) return;
  if (!dhanClient.isConfigured()) return;

  try {
    const openOrders = await db
      .select()
      .from(superOrdersTable)
      .where(not(inArray(superOrdersTable.status, TERMINAL_STATUSES)));

    if (openOrders.length === 0) return;

    const ordersWithPriceTargets = openOrders.filter(o => o.dhanOrderId && (o.targetPrice || o.stopLossPrice));
    if (ordersWithPriceTargets.length === 0) return;

    const bySegment: Record<string, string[]> = {};
    for (const order of ordersWithPriceTargets) {
      if (!bySegment[order.exchangeSegment]) bySegment[order.exchangeSegment] = [];
      bySegment[order.exchangeSegment].push(order.securityId);
    }

    let ltpMap: Record<string, number> = {};
    try {
      const securities: Record<string, string[]> = {};
      for (const [seg, ids] of Object.entries(bySegment)) {
        securities[seg] = [...new Set(ids)];
      }
      const raw = await dhanClient.getMarketQuote(securities, "ltp") as Record<string, unknown>;
      const data = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, Record<string, { last_price?: number }>>;
      for (const [seg, entries] of Object.entries(data)) {
        for (const [secId, val] of Object.entries(entries ?? {})) {
          const key = `${seg}:${secId}`;
          ltpMap[key] = Number((val as { last_price?: number }).last_price ?? 0);
        }
      }
    } catch (ltpErr) {
      logger.warn({ err: ltpErr }, "SuperOrderMonitor: failed to batch fetch LTPs — will retry next cycle");
      return;
    }

    for (const order of ordersWithPriceTargets) {
      const ltpKey = `${order.exchangeSegment}:${order.securityId}`;
      const ltp = ltpMap[ltpKey] ?? 0;
      if (!ltp || ltp <= 0) continue;

      const targetPrice = order.targetPrice ? Number(order.targetPrice) : null;
      const stopLossPrice = order.stopLossPrice ? Number(order.stopLossPrice) : null;

      const isBuy = order.transactionType === "BUY";
      const exitType = isBuy ? "SELL" : "BUY";
      let triggered: "TARGET_HIT" | "STOP_LOSS_HIT" | null = null;
      let alertMsg = "";

      if (targetPrice) {
        const targetHit = isBuy ? ltp >= targetPrice : ltp <= targetPrice;
        if (targetHit) {
          triggered = "TARGET_HIT";
          alertMsg = `🎯 *Target Hit!*\n\nSuper Order #${order.id}\nSymbol: ${order.tradingSymbol ?? order.securityId}\nTarget: ₹${targetPrice.toFixed(2)}\nLTP: ₹${ltp.toFixed(2)}\n\nPlacing exit order...`;
        }
      }

      if (!triggered && stopLossPrice) {
        const slTriggered = isBuy ? ltp <= stopLossPrice : ltp >= stopLossPrice;
        if (slTriggered) {
          triggered = "STOP_LOSS_HIT";
          alertMsg = `🛑 *Stop Loss Hit!*\n\nSuper Order #${order.id}\nSymbol: ${order.tradingSymbol ?? order.securityId}\nStop Loss: ₹${stopLossPrice.toFixed(2)}\nLTP: ₹${ltp.toFixed(2)}\n\nPlacing exit order...`;
        }
      }

      if (triggered) {
        const dhanProductType = order.productType === "INTRADAY" ? "INTRA" : order.productType;

        try {
          await dhanClient.placeOrder({
            security_id: order.securityId,
            exchange_segment: order.exchangeSegment,
            transaction_type: exitType,
            order_type: "MARKET",
            product_type: dhanProductType,
            quantity: order.quantity,
            price: 0,
            validity: "DAY",
            disclosed_quantity: 0,
            after_market_order: false,
          });

          await db
            .update(superOrdersTable)
            .set({ status: triggered })
            .where(eq(superOrdersTable.id, order.id));

          void sendTelegramAlert(alertMsg + `\n\n_${APP_NAME} — Super Order Monitor_`);
          logger.info({ orderId: order.id, triggered, ltp }, "SuperOrderMonitor: exit triggered");
        } catch (exitErr) {
          logger.error({ err: exitErr, orderId: order.id }, "SuperOrderMonitor: failed to place exit order — will retry next cycle");
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, "SuperOrderMonitor: check failed");
  }
}

export function startSuperOrderMonitor(): void {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => void checkSuperOrders(), 5_000);
  logger.info("SuperOrderMonitor: started (checks every 5s during market hours 09:15–15:25 IST)");
}

export function stopSuperOrderMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
