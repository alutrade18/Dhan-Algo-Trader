import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { handleRouteError } from "../lib/route-error";
import { recordOrderModification } from "../lib/rate-limiter";
import { runOrderGuards } from "../lib/order-guards";
import { logger } from "../lib/logger";
import {
  PlaceOrderBody,
  ModifyOrderBody,
  CancelOrderParams,
  GetOrderByIdParams,
  ModifyOrderParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/orders", async (req, res): Promise<void> => {
  try {
    const orders = await dhanClient.getOrders();
    res.json(Array.isArray(orders) ? orders : []);
  } catch (e) {
    handleRouteError(res, e, "GET /orders");
  }
});

// GET /orders/history?from=YYYY-MM-DD&to=YYYY-MM-DD  — fetch trade history for a date range
// Legacy: ?date=YYYY-MM-DD still supported (treated as from=date&to=date)
// Must be declared BEFORE /orders/:orderId so "history" is not treated as an orderId
router.get("/orders/history", async (req, res): Promise<void> => {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const legacyDate = String(req.query.date ?? "").trim();
  const fromParam = legacyDate || String(req.query.from ?? "").trim();
  const toParam   = legacyDate || String(req.query.to   ?? "").trim();

  if (!fromParam || !dateRe.test(fromParam) || !toParam || !dateRe.test(toParam)) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: "Provide from=YYYY-MM-DD&to=YYYY-MM-DD (or legacy ?date=YYYY-MM-DD)." });
    return;
  }

  const from = new Date(fromParam + "T00:00:00Z");
  const to   = new Date(toParam   + "T00:00:00Z");
  if (from > to) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: "'from' date must be on or before 'to' date." });
    return;
  }

  // Dhan supports up to 90 days per /trades call; chunk if range > 90 days.
  // Add a 1.2s pause between chunks to stay within Dhan's per-second rate limit.
  const MS_PER_DAY  = 86_400_000;
  const CHUNK_DAYS  = 90;
  const CHUNK_DELAY = 1_200; // ms between consecutive Dhan API chunk calls
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const allTrades: unknown[] = [];

  try {
    let chunkStart = from;
    let firstChunk = true;
    while (chunkStart <= to) {
      if (!firstChunk) await sleep(CHUNK_DELAY);
      firstChunk = false;
      const chunkEnd = new Date(Math.min(chunkStart.getTime() + (CHUNK_DAYS - 1) * MS_PER_DAY, to.getTime()));
      const f = chunkStart.toISOString().split("T")[0];
      const t = chunkEnd.toISOString().split("T")[0];
      const trades = await dhanClient.getAllTradeHistory(f, t);
      if (Array.isArray(trades)) allTrades.push(...trades);
      chunkStart = new Date(chunkEnd.getTime() + MS_PER_DAY);
    }
    res.json(allTrades);
  } catch (e) {
    handleRouteError(res, e, "GET /orders/history");
  }
});

router.get("/orders/:orderId", async (req, res): Promise<void> => {
  const params = GetOrderByIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: params.error.message });
    return;
  }
  try {
    const order = await dhanClient.getOrderById(params.data.orderId);
    res.json(order);
  } catch (e) {
    handleRouteError(res, e, `GET /orders/${params.data.orderId}`);
  }
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = PlaceOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: parsed.error.message });
    return;
  }

  try {
    const guard = await runOrderGuards({
      tradingSymbol: parsed.data.tradingSymbol ?? String(parsed.data.securityId),
      price: parsed.data.price ?? 0,
      quantity: parsed.data.quantity,
    });
    if (!guard.allowed) {
      res.status(403).json({ errorCode: "DH-906", errorMessage: guard.reason ?? "Order blocked by trading guard", retryable: false });
      return;
    }

    // Translate our internal shorthand values to the real Dhan API values.
    // Dhan Python SDK source confirms: INTRA="INTRADAY", SL="STOP_LOSS", SLM="STOP_LOSS_MARKET"
    const PRODUCT_TYPE_MAP: Record<string, string> = {
      INTRA: "INTRADAY", CNC: "CNC", MARGIN: "MARGIN", MTF: "MTF", CO: "CO", BO: "BO",
    };
    const ORDER_TYPE_MAP: Record<string, string> = {
      MARKET: "MARKET", LIMIT: "LIMIT", SL: "STOP_LOSS", SLM: "STOP_LOSS_MARKET",
    };
    const dhanProductType = PRODUCT_TYPE_MAP[parsed.data.productType] ?? parsed.data.productType;
    const dhanOrderType   = ORDER_TYPE_MAP[parsed.data.orderType]    ?? parsed.data.orderType;

    // ── H4: Pre-trade margin check via Dhan's margin calculator ──────────────
    // Only checked for priced order types (LIMIT / STOP_LOSS) to avoid false
    // positives on MARKET orders where price is unknown. Fail-open: if the
    // margin API itself fails (rate limit, network) we log and proceed.
    if (
      parsed.data.orderType === "LIMIT" ||
      parsed.data.orderType === "SL"
    ) {
      try {
        const marginResult = await dhanClient.calculateMargin({
          dhanClientId: dhanClient.getCredentials().clientId,
          exchangeSegment: parsed.data.exchangeSegment,
          transactionType: parsed.data.transactionType,
          quantity: parsed.data.quantity,
          productType: dhanProductType,   // use mapped value (INTRADAY not INTRA)
          securityId: parsed.data.securityId,
          price: parsed.data.price ?? 0,
          triggerPrice: parsed.data.triggerPrice ?? 0,
        }) as Record<string, unknown>;

        if (marginResult.insufficientBalance === true) {
          const required = marginResult.totalMarginRequired;
          const available = marginResult.availableBalance;
          logger.warn(
            { securityId: parsed.data.securityId, required, available },
            "[H4] Pre-trade margin check failed — insufficient balance",
          );
          res.status(402).json({
            errorCode: "DH-907",
            errorMessage: `Insufficient margin: required ₹${Number(required ?? 0).toFixed(2)}, available ₹${Number(available ?? 0).toFixed(2)}`,
            retryable: false,
          });
          return;
        }
      } catch (marginErr) {
        logger.warn({ err: marginErr, securityId: parsed.data.securityId }, "[H4] Pre-trade margin check skipped — margin API error (fail open)");
      }
    }

    // Payload matches Dhan's official Python SDK structure exactly (src/dhanhq/_order.py).
    // dhanClientId is injected by placeOrder(); boProfitValue/boStopLossValue must be present.
    const result = await dhanClient.placeOrder({
      transactionType: parsed.data.transactionType,
      exchangeSegment: parsed.data.exchangeSegment,
      productType: dhanProductType,
      orderType: dhanOrderType,
      validity: parsed.data.validity || "DAY",
      securityId: parsed.data.securityId,
      quantity: parsed.data.quantity,
      disclosedQuantity: parsed.data.disclosedQuantity ?? 0,
      price: parsed.data.price ?? 0,
      afterMarketOrder: parsed.data.afterMarketOrder ?? false,
      boProfitValue: null,
      boStopLossValue: null,
      triggerPrice: parsed.data.triggerPrice ?? 0,
      ...(parsed.data.tag ? { correlationId: parsed.data.tag } : {}),
    });

    const r = result as Record<string, unknown>;
    res.status(201).json({
      orderId: String(r.orderId || r.order_id || ""),
      status: String(r.orderStatus || "PLACED"),
      message: "Order placed successfully",
    });
  } catch (e) {
    handleRouteError(res, e, "POST /orders");
  }
});

router.patch("/orders/:orderId", async (req, res): Promise<void> => {
  const params = ModifyOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: params.error.message });
    return;
  }
  const parsed = ModifyOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: parsed.error.message });
    return;
  }

  const orderId = params.data.orderId;
  const modResult = recordOrderModification(orderId);
  if (!modResult.allowed) {
    res.status(429).json({
      errorCode: "DH-904",
      errorMessage: `Order modification limit reached. Dhan caps modifications at 25 per order. This order has been modified ${modResult.count} times.`,
      retryable: false,
    });
    return;
  }

  try {
    const result = await dhanClient.modifyOrder(orderId, {
      orderType: parsed.data.orderType,
      quantity: parsed.data.quantity,
      price: parsed.data.price,
      triggerPrice: parsed.data.triggerPrice,
      disclosedQuantity: parsed.data.disclosedQuantity,
      validity: parsed.data.validity,
      legName: parsed.data.legName,
    });

    const r = result as Record<string, unknown>;
    res.json({
      orderId,
      status: String(r.orderStatus || "MODIFIED"),
      message: `Order modified successfully (modification ${modResult.count}/25)`,
      modificationsUsed: modResult.count,
      modificationsRemaining: 25 - modResult.count,
    });
  } catch (e) {
    handleRouteError(res, e, `PATCH /orders/${orderId}`);
  }
});

router.delete("/orders/:orderId", async (req, res): Promise<void> => {
  const params = CancelOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: params.error.message });
    return;
  }

  try {
    await dhanClient.cancelOrder(params.data.orderId);
    res.json({
      orderId: params.data.orderId,
      status: "CANCELLED",
      message: "Order cancelled successfully",
    });
  } catch (e) {
    handleRouteError(res, e, `DELETE /orders/${params.data.orderId}`);
  }
});

export default router;
