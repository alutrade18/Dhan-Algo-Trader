import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, strategiesTable } from "@workspace/db";
import { dhanClient } from "../lib/dhan-client";
import { runOrderGuards } from "../lib/order-guards";
import { handleRouteError } from "../lib/route-error";
import crypto from "crypto";

const router: IRouter = Router();

// ── LIST ─────────────────────────────────────────────────────────────────────
router.get("/strategies", async (_req, res): Promise<void> => {
  try {
    const rows = await db.select().from(strategiesTable).orderBy(strategiesTable.createdAt);
    res.json(rows);
  } catch (e) {
    handleRouteError(res, e, "GET /strategies");
  }
});

// ── CREATE ────────────────────────────────────────────────────────────────────
router.post("/strategies", async (req, res): Promise<void> => {
  const {
    name,
    description,
    entryCondition,
    securityId,
    exchangeSegment,
    tradingSymbol,
    quantity,
    productType,
    transactionType,
    active,
  } = req.body as Record<string, unknown>;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "Strategy name is required" });
    return;
  }
  if (!quantity || isNaN(Number(quantity)) || Number(quantity) < 1) {
    res.status(400).json({ error: "Quantity must be a positive number" });
    return;
  }

  const webhookToken = crypto.randomBytes(24).toString("hex");

  try {
    const [created] = await db
      .insert(strategiesTable)
      .values({
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        entryCondition: String(entryCondition ?? "MANUAL"),
        securityId: securityId ? String(securityId) : null,
        exchangeSegment: exchangeSegment ? String(exchangeSegment) : null,
        tradingSymbol: tradingSymbol ? String(tradingSymbol) : null,
        quantity: Number(quantity),
        productType: String(productType ?? "INTRADAY"),
        transactionType: String(transactionType ?? "BUY"),
        active: active !== false && active !== "false",
        webhookToken,
      })
      .returning();
    res.status(201).json(created);
  } catch (e) {
    handleRouteError(res, e, "POST /strategies");
  }
});

// ── UPDATE ────────────────────────────────────────────────────────────────────
router.put("/strategies/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid strategy ID" });
    return;
  }

  const {
    name,
    description,
    entryCondition,
    securityId,
    exchangeSegment,
    tradingSymbol,
    quantity,
    productType,
    transactionType,
    active,
  } = req.body as Record<string, unknown>;

  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(400).json({ error: "Strategy name cannot be empty" });
    return;
  }

  try {
    const updates: Partial<typeof strategiesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updates.name = String(name).trim();
    if (description !== undefined) updates.description = description ? String(description).trim() : null;
    if (entryCondition !== undefined) updates.entryCondition = String(entryCondition);
    if (securityId !== undefined) updates.securityId = securityId ? String(securityId) : null;
    if (exchangeSegment !== undefined) updates.exchangeSegment = exchangeSegment ? String(exchangeSegment) : null;
    if (tradingSymbol !== undefined) updates.tradingSymbol = tradingSymbol ? String(tradingSymbol) : null;
    if (quantity !== undefined) updates.quantity = Number(quantity);
    if (productType !== undefined) updates.productType = String(productType);
    if (transactionType !== undefined) updates.transactionType = String(transactionType);
    if (active !== undefined) updates.active = active !== false && active !== "false";

    const [updated] = await db
      .update(strategiesTable)
      .set(updates)
      .where(eq(strategiesTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }
    res.json(updated);
  } catch (e) {
    handleRouteError(res, e, `PUT /strategies/${id}`);
  }
});

// ── DELETE ────────────────────────────────────────────────────────────────────
router.delete("/strategies/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid strategy ID" });
    return;
  }
  try {
    const [deleted] = await db
      .delete(strategiesTable)
      .where(eq(strategiesTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    handleRouteError(res, e, `DELETE /strategies/${id}`);
  }
});

// ── WEBHOOK TRIGGER: POST /strategy/:id/trigger ───────────────────────────────
router.post("/strategy/:id/trigger", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid strategy ID" });
    return;
  }

  // Token auth — header or query param
  const token =
    (req.headers["x-webhook-token"] as string | undefined) ??
    (req.query.token as string | undefined);

  try {
    const [strategy] = await db
      .select()
      .from(strategiesTable)
      .where(eq(strategiesTable.id, id));

    if (!strategy) {
      res.status(404).json({ error: "Strategy not found" });
      return;
    }
    if (!strategy.active) {
      res.status(403).json({ error: "Strategy is not active" });
      return;
    }
    if (strategy.webhookToken && token !== strategy.webhookToken) {
      res.status(401).json({ error: "Invalid webhook token" });
      return;
    }
    if (!strategy.securityId || !strategy.exchangeSegment) {
      res.status(422).json({ error: "Strategy has no security configured" });
      return;
    }
    if (!dhanClient.isConfigured()) {
      res.status(503).json({ error: "Broker not connected" });
      return;
    }

    const guard = await runOrderGuards({
      tradingSymbol: strategy.tradingSymbol ?? strategy.securityId,
      quantity: strategy.quantity,
    });
    if (!guard.allowed) {
      res.status(403).json({ error: guard.reason ?? "Order blocked by trading guard" });
      return;
    }

    const result = await dhanClient.placeOrder({
      security_id: strategy.securityId,
      exchange_segment: strategy.exchangeSegment,
      transaction_type: strategy.transactionType,
      quantity: strategy.quantity,
      order_type: "MARKET",
      product_type: strategy.productType,
      price: 0,
      validity: "DAY",
      tag: `strategy-${strategy.id}`,
    });

    // Record last triggered
    await db
      .update(strategiesTable)
      .set({ lastTriggeredAt: new Date() })
      .where(eq(strategiesTable.id, id));

    res.json({ success: true, order: result });
  } catch (e) {
    handleRouteError(res, e, `POST /strategy/${id}/trigger`);
  }
});

export default router;
