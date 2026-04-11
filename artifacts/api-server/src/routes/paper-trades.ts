import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, paperTradesTable } from "@workspace/db";

const router: IRouter = Router();

function serialize(t: typeof paperTradesTable.$inferSelect) {
  return {
    ...t,
    entryPrice: Number(t.entryPrice),
    exitPrice: t.exitPrice ? Number(t.exitPrice) : null,
    pnl: t.pnl ? Number(t.pnl) : null,
    entryTime: t.entryTime.toISOString(),
    exitTime: t.exitTime ? t.exitTime.toISOString() : null,
  };
}

router.get("/paper-trades", async (_req, res): Promise<void> => {
  const trades = await db
    .select()
    .from(paperTradesTable)
    .orderBy(desc(paperTradesTable.entryTime));
  res.json(trades.map(serialize));
});

router.post("/paper-trades", async (req, res): Promise<void> => {
  const { symbol, securityId, exchange, side, qty, entryPrice } = req.body as {
    symbol: string;
    securityId: string;
    exchange?: string;
    side: "BUY" | "SELL";
    qty: number;
    entryPrice: number;
  };

  if (!symbol || !securityId || !side || !qty || !entryPrice) {
    res.status(400).json({ error: "symbol, securityId, side, qty, entryPrice are required" });
    return;
  }

  const [trade] = await db
    .insert(paperTradesTable)
    .values({
      symbol,
      securityId,
      exchange: exchange || "NSE_EQ",
      side,
      qty,
      entryPrice: entryPrice.toString(),
      status: "OPEN",
    })
    .returning();

  res.status(201).json(serialize(trade));
});

router.post("/paper-trades/:id/close", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { exitPrice } = req.body as { exitPrice: number };
  if (!exitPrice) {
    res.status(400).json({ error: "exitPrice is required" });
    return;
  }

  const [existing] = await db
    .select()
    .from(paperTradesTable)
    .where(eq(paperTradesTable.id, id));

  if (!existing || existing.status !== "OPEN") {
    res.status(404).json({ error: "Open paper trade not found" });
    return;
  }

  const entry = Number(existing.entryPrice);
  const rawPnl =
    existing.side === "BUY"
      ? (exitPrice - entry) * existing.qty
      : (entry - exitPrice) * existing.qty;

  const [trade] = await db
    .update(paperTradesTable)
    .set({
      exitPrice: exitPrice.toString(),
      pnl: rawPnl.toFixed(2),
      status: "CLOSED",
      exitTime: new Date(),
    })
    .where(eq(paperTradesTable.id, id))
    .returning();

  res.json(serialize(trade));
});

router.delete("/paper-trades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  await db.delete(paperTradesTable).where(eq(paperTradesTable.id, id));
  res.sendStatus(204);
});

router.delete("/paper-trades", async (_req, res): Promise<void> => {
  await db.delete(paperTradesTable).where(sql`1=1`);
  res.sendStatus(204);
});

export default router;
