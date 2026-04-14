import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, superOrdersTable, settingsTable } from "@workspace/db";
import { dhanClient, DhanApiError } from "../lib/dhan-client";
import { runOrderGuards } from "../lib/order-guards";

const router: IRouter = Router();

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, "0");
  const dd = String(ist.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

interface DhanOrder {
  orderId?: string;
  orderNo?: string;
  orderStatus?: string;
  tradingSymbol?: string;
  transactionType?: string;
  orderType?: string;
  quantity?: number;
  price?: number;
  averageTradedPrice?: number;
  [key: string]: unknown;
}

router.get("/super-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const today = todayIST();
    const dbOrders = await db
      .select()
      .from(superOrdersTable)
      .where(eq(superOrdersTable.orderDate, today));

    if (dbOrders.length === 0) {
      res.json([]);
      return;
    }

    let dhanOrders: DhanOrder[] = [];
    try {
      const raw = await dhanClient.getOrders();
      dhanOrders = Array.isArray(raw) ? (raw as DhanOrder[]) : [];
    } catch {
      dhanOrders = [];
    }

    const dhanMap = new Map<string, DhanOrder>();
    for (const o of dhanOrders) {
      const id = o.orderId ?? o.orderNo;
      if (id) dhanMap.set(id, o);
    }

    const enriched = dbOrders.map((so) => {
      const live = so.dhanOrderId ? dhanMap.get(so.dhanOrderId) : undefined;
      return {
        orderId: String(so.id),
        dhanOrderId: so.dhanOrderId,
        securityId: so.securityId,
        exchangeSegment: so.exchangeSegment,
        tradingSymbol: live?.tradingSymbol ?? so.tradingSymbol ?? so.securityId,
        transactionType: so.transactionType,
        orderType: so.orderType,
        productType: so.productType,
        quantity: so.quantity,
        price: Number(so.price ?? 0),
        targetPrice: Number(so.targetPrice ?? 0),
        stopLossPrice: Number(so.stopLossPrice ?? 0),
        orderStatus: live?.orderStatus ?? so.status,
        averageTradedPrice: live?.averageTradedPrice,
        createdAt: so.createdAt,
      };
    });

    res.json(enriched);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to fetch super orders" });
    }
  }
});

router.post("/super-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }

  const bodyProductType = String((req.body as Record<string, unknown>).product_type ?? "INTRADAY");
  if (bodyProductType !== "INTRADAY") {
    res.status(400).json({ error: "Super Orders are INTRADAY only. Use product_type: INTRADAY." });
    return;
  }

  try {
    const {
      security_id,
      exchange_segment,
      transaction_type,
      order_type,
      product_type = "INTRADAY",
      quantity,
      price,
      target_price,
      stop_loss_price,
    } = req.body as {
      security_id: string;
      exchange_segment: string;
      transaction_type: string;
      order_type: string;
      product_type?: string;
      quantity: number;
      price: number;
      target_price: number;
      stop_loss_price: number;
    };

    if (!security_id || !exchange_segment || !transaction_type || !quantity) {
      res.status(400).json({ error: "Missing required fields: security_id, exchange_segment, transaction_type, quantity" });
      return;
    }

    const [settings] = await db.select().from(settingsTable);
    if (settings?.killSwitchEnabled) {
      res.status(403).json({ error: "Kill switch is active. All order placement is blocked." });
      return;
    }

    const tradingSymbol = req.body.trading_symbol ?? req.body.tradingSymbol ?? security_id;
    const guard = await runOrderGuards({
      tradingSymbol: String(tradingSymbol),
      price: price ?? 0,
      quantity,
    });
    if (!guard.allowed) {
      res.status(403).json({ error: guard.reason ?? "Order blocked by trading guard" });
      return;
    }

    // BUG FIX: Dhan API v2 requires snake_case field names. camelCase is silently ignored.
    // Also map "INTRADAY" → "INTRA" (Dhan's required enum value for intraday product type).
    const dhanPayload: Record<string, unknown> = {
      security_id,
      exchange_segment,
      transaction_type,
      order_type: order_type ?? "LIMIT",
      product_type: product_type === "INTRADAY" ? "INTRA" : product_type,
      quantity,
      price: order_type === "MARKET" ? 0 : price,
      validity: "DAY",
      disclosed_quantity: 0,
      after_market_order: false,
    };

    const dhanResp = await dhanClient.placeOrder(dhanPayload) as {
      orderId?: string;
      orderStatus?: string;
      [key: string]: unknown;
    };

    const dhanOrderId = dhanResp?.orderId ?? null;

    const today = todayIST();
    const [inserted] = await db.insert(superOrdersTable).values({
      dhanOrderId,
      securityId: security_id,
      exchangeSegment: exchange_segment,
      transactionType: transaction_type,
      orderType: order_type ?? "LIMIT",
      productType: product_type,
      quantity,
      price: String(price),
      targetPrice: String(target_price),
      stopLossPrice: String(stop_loss_price),
      status: dhanResp?.orderStatus ?? "PENDING",
      orderDate: today,
    }).returning();

    res.json({
      orderId: String(inserted.id),
      dhanOrderId,
      orderStatus: dhanResp?.orderStatus ?? "PENDING",
      ...dhanResp,
    });
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      const msg = e instanceof Error ? e.message : "Failed to place super order";
      res.status(500).json({ error: msg });
    }
  }
});

router.delete("/super-orders/:orderId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const { orderId } = req.params;
    const internalId = parseInt(orderId);

    const [dbRecord] = await db
      .select()
      .from(superOrdersTable)
      .where(eq(superOrdersTable.id, internalId));

    if (!dbRecord) {
      res.status(404).json({ error: "Super order not found" });
      return;
    }

    if (dbRecord.dhanOrderId) {
      try {
        await dhanClient.cancelOrder(dbRecord.dhanOrderId);
      } catch {
        // Best-effort: continue even if Dhan cancel fails (order may already be filled)
      }
    }

    await db
      .update(superOrdersTable)
      .set({ status: "CANCELLED" })
      .where(eq(superOrdersTable.id, internalId));

    res.json({ success: true, orderId });
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to cancel super order" });
    }
  }
});

export default router;
