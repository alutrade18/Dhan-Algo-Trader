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
          productType: parsed.data.productType,
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

    const result = await dhanClient.placeOrder({
      security_id: parsed.data.securityId,
      exchange_segment: parsed.data.exchangeSegment,
      transaction_type: parsed.data.transactionType,
      quantity: parsed.data.quantity,
      order_type: parsed.data.orderType,
      product_type: parsed.data.productType,
      price: parsed.data.price,
      trigger_price: parsed.data.triggerPrice,
      disclosed_quantity: parsed.data.disclosedQuantity,
      after_market_order: parsed.data.afterMarketOrder,
      validity: parsed.data.validity || "DAY",
      tag: parsed.data.tag,
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
      order_type: parsed.data.orderType,
      quantity: parsed.data.quantity,
      price: parsed.data.price,
      trigger_price: parsed.data.triggerPrice,
      disclosed_quantity: parsed.data.disclosedQuantity,
      validity: parsed.data.validity,
      leg_name: parsed.data.legName,
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
