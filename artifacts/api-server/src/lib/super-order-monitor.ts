import { db, superOrdersTable } from "@workspace/db";
import { not, inArray, eq } from "drizzle-orm";
import { dhanClient } from "./dhan-client";
import { sendTelegramAlertIfEnabled } from "./telegram";
import { logger } from "./logger";
import { getMarketStatus } from "./market-calendar";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

let monitorInterval: ReturnType<typeof setInterval> | null = null;

const TERMINAL_STATUSES = ["CANCELLED", "COMPLETED", "TARGET_HIT", "STOP_LOSS_HIT"];

/**
 * Returns true if at least one market (NSE or MCX) is currently open.
 * Covers: NSE 09:15–15:30, MCX 09:00–23:30 IST.
 * Holiday awareness is handled by getMarketStatus() via the DB-backed calendar.
 */
function isAnyMarketOpen(): boolean {
  const status = getMarketStatus();
  return status.nseOpen || status.mcxOpen;
}

interface DhanOrderSummary {
  orderId?: string;
  orderNo?: string;
  orderStatus?: string;
  [key: string]: unknown;
}

async function checkSuperOrders(): Promise<void> {
  if (!isAnyMarketOpen()) return;
  if (!dhanClient.isConfigured()) return;

  try {
    const openOrders = await db
      .select()
      .from(superOrdersTable)
      .where(not(inArray(superOrdersTable.status, TERMINAL_STATUSES)));

    if (openOrders.length === 0) return;

    const ordersWithPriceTargets = openOrders.filter(o => o.dhanOrderId && (o.targetPrice || o.stopLossPrice));
    if (ordersWithPriceTargets.length === 0) return;

    // ── Fetch live order statuses from Dhan to confirm entry is TRADED ────────
    let dhanOrderStatusMap: Map<string, string> = new Map();
    try {
      const dhanOrders = (await dhanClient.getOrders()) as DhanOrderSummary[];
      if (Array.isArray(dhanOrders)) {
        for (const o of dhanOrders) {
          const id = o.orderId ?? o.orderNo;
          if (id && o.orderStatus) dhanOrderStatusMap.set(String(id), String(o.orderStatus));
        }
      }
    } catch (err) {
      logger.warn({ err }, "SuperOrderMonitor: could not fetch Dhan orders — skipping fill-status check this cycle");
    }

    // Monitor orders where the entry is filled (TRADED) or partially filled (has some qty at risk)
    const filledOrders = ordersWithPriceTargets.filter(o => {
      if (!o.dhanOrderId) return false;
      const dhanStatus = dhanOrderStatusMap.get(o.dhanOrderId);
      // If we could not fetch Dhan orders, dhanOrderStatusMap is empty → skip all (safe)
      if (dhanOrderStatusMap.size === 0) return false;
      // Protect fully or partially filled orders — a partial fill still has capital at risk
      return dhanStatus === "TRADED" || dhanStatus === "PART_TRADED";
    });

    if (filledOrders.length === 0) return;

    const bySegment: Record<string, string[]> = {};
    for (const order of filledOrders) {
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

    for (const order of filledOrders) {
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

          void sendTelegramAlertIfEnabled("superOrders", alertMsg + `\n\n_${APP_NAME} — Super Order Monitor_`);
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
  logger.info("SuperOrderMonitor: started (checks every 5s during NSE 09:15–15:30 or MCX 09:00–23:30 IST)");
}

export function stopSuperOrderMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}
