import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { handleRouteError } from "../lib/route-error";
import { recordOrderModification } from "../lib/rate-limiter";
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
