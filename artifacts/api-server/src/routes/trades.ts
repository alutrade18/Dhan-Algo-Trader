import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { GetTradeHistoryQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trades", async (req, res): Promise<void> => {
  try {
    const trades = await dhanClient.getTradeBook();
    res.json(Array.isArray(trades) ? trades : []);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch trade book");
    res.status(500).json({ error: "Failed to fetch trade book" });
  }
});

router.get("/trades/history", async (req, res): Promise<void> => {
  const parsed = GetTradeHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const trades = await dhanClient.getTradeHistory(
      parsed.data.fromDate,
      parsed.data.toDate,
      parsed.data.pageNumber || 0,
    );
    res.json(Array.isArray(trades) ? trades : []);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch trade history");
    res.status(500).json({ error: "Failed to fetch trade history" });
  }
});

export default router;
