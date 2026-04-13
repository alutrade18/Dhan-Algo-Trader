import { db, superOrdersTable } from "@workspace/db";
import { not, inArray, eq } from "drizzle-orm";
import { dhanClient } from "./dhan-client";
import { sendTelegramAlert } from "./telegram";
import { logger } from "./logger";

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

function isMarketHours(): boolean {
  const { hours, minutes, dateStr } = nowIST();
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const totalMinutes = hours * 60 + minutes;
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 25;
  return totalMinutes >= open && totalMinutes <= close;
}

async function checkSuperOrders(): Promise<void> {
  if (!isMarketHours()) return;
  if (!dhanClient.isConfigured()) return;

  try {
    const openOrders = await db
      .select()
      .from(superOrdersTable)
      .where(not(inArray(superOrdersTable.status, TERMINAL_STATUSES)));

    for (const order of openOrders) {
      if (!order.dhanOrderId) continue;

      const targetPrice = order.targetPrice ? Number(order.targetPrice) : null;
      const stopLossPrice = order.stopLossPrice ? Number(order.stopLossPrice) : null;
      if (!targetPrice && !stopLossPrice) continue;

      try {
        const ltp = await dhanClient.getLtp(order.exchangeSegment, order.securityId);
        if (!ltp || ltp <= 0) continue;

        const isBuy = order.transactionType === "BUY";
        const exitType = isBuy ? "SELL" : "BUY";
        let triggered: "TARGET_HIT" | "STOP_LOSS_HIT" | null = null;
        let alertMsg = "";

        if (targetPrice && ltp >= targetPrice) {
          triggered = "TARGET_HIT";
          alertMsg = `🎯 *Target Hit!*\n\nSuper Order #${order.id}\nSymbol: ${order.tradingSymbol ?? order.securityId}\nTarget: ₹${targetPrice.toFixed(2)}\nLTP: ₹${ltp.toFixed(2)}\n\nPlacing exit order...`;
        } else if (stopLossPrice) {
          const slTriggered = isBuy ? ltp <= stopLossPrice : ltp >= stopLossPrice;
          if (slTriggered) {
            triggered = "STOP_LOSS_HIT";
            alertMsg = `🛑 *Stop Loss Hit!*\n\nSuper Order #${order.id}\nSymbol: ${order.tradingSymbol ?? order.securityId}\nStop Loss: ₹${stopLossPrice.toFixed(2)}\nLTP: ₹${ltp.toFixed(2)}\n\nPlacing exit order...`;
          }
        }

        if (triggered) {
          await db
            .update(superOrdersTable)
            .set({ status: triggered })
            .where(eq(superOrdersTable.id, order.id));

          try {
            await dhanClient.placeOrder({
              securityId: order.securityId,
              exchangeSegment: order.exchangeSegment,
              transactionType: exitType,
              orderType: "MARKET",
              productType: order.productType,
              quantity: order.quantity,
              price: 0,
              validity: "DAY",
              disclosedQuantity: 0,
              afterMarketOrder: false,
            });
          } catch (exitErr) {
            logger.error({ err: exitErr, orderId: order.id }, "SuperOrderMonitor: failed to place exit order");
          }

          void sendTelegramAlert(alertMsg + `\n\n_Rajesh Algo — Super Order Monitor_`);
          logger.info({ orderId: order.id, triggered, ltp }, "SuperOrderMonitor: exit triggered");
        }
      } catch (ltpErr) {
        logger.warn({ err: ltpErr, orderId: order.id }, "SuperOrderMonitor: failed to get LTP");
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
