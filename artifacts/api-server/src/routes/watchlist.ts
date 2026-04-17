import { Router, type IRouter } from "express";
import { db, watchlistTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/watchlist", async (req, res): Promise<void> => {
  try {
    const items = await db
      .select()
      .from(watchlistTable)
      .orderBy(watchlistTable.addedAt);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch watchlist");
    res.status(500).json({ error: "Failed to fetch watchlist" });
  }
});

router.post("/watchlist", async (req, res): Promise<void> => {
  const { securityId, exchId, segment, symbolName, displayName, instrument, lotSize, expiryDate } = req.body ?? {};

  if (!securityId || typeof securityId !== "number" || !exchId || !segment || !symbolName) {
    res.status(400).json({ error: "securityId (number), exchId, segment, symbolName are required" });
    return;
  }

  try {
    const [item] = await db
      .insert(watchlistTable)
      .values({
        securityId,
        exchId: String(exchId),
        segment: String(segment),
        symbolName: String(symbolName),
        displayName: displayName ? String(displayName) : null,
        instrument: instrument ? String(instrument) : null,
        lotSize: lotSize != null ? Number(lotSize) : null,
        expiryDate: expiryDate ? String(expiryDate) : null,
      })
      .onConflictDoNothing()
      .returning();

    if (!item) {
      res.status(409).json({ error: "Instrument already in watchlist" });
      return;
    }
    res.status(201).json(item);
  } catch (err) {
    req.log.error({ err }, "Failed to add to watchlist");
    res.status(500).json({ error: "Failed to add to watchlist" });
  }
});

router.delete("/watchlist/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  try {
    await db.delete(watchlistTable).where(eq(watchlistTable.id, id));
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete from watchlist");
    res.status(500).json({ error: "Failed to delete from watchlist" });
  }
});

export default router;
