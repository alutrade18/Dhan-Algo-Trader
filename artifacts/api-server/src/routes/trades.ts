import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { handleRouteError } from "../lib/route-error";

const router: IRouter = Router();

router.get("/trades/history", async (req, res): Promise<void> => {
  const { fromDate, toDate, page } = req.query as {
    fromDate?: string;
    toDate?: string;
    page?: string;
  };
  if (!fromDate || !toDate) {
    res.status(400).json({
      errorCode: "DH-905",
      errorMessage: "fromDate and toDate are required (YYYY-MM-DD)",
    });
    return;
  }

  try {
    if (page !== undefined) {
      const data = await dhanClient.getTradeHistory(
        fromDate,
        toDate,
        parseInt(page, 10) || 0,
      );
      res.json(Array.isArray(data) ? data : []);
    } else {
      const data = await dhanClient.getAllTradeHistory(fromDate, toDate);
      res.json(data);
    }
  } catch (e) {
    handleRouteError(res, e, "GET /trades/history");
  }
});

// GET /trades/ledger — Ledger report from Dhan
router.get("/trades/ledger", async (req, res): Promise<void> => {
  const { fromDate, toDate } = req.query as { fromDate?: string; toDate?: string };
  if (!fromDate || !toDate) {
    res.status(400).json({ error: "fromDate and toDate required (YYYY-MM-DD)" });
    return;
  }
  try {
    const data = await dhanClient.getLedger(fromDate, toDate);
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    handleRouteError(res, e, "GET /trades/ledger");
  }
});

router.get("/trades/:orderId", async (req, res): Promise<void> => {
  try {
    const all = await dhanClient.getTradeBook();
    const arr = Array.isArray(all) ? (all as Record<string, unknown>[]) : [];
    const filtered = arr.filter(
      (t) => String(t.orderId) === req.params.orderId,
    );
    res.json(filtered);
  } catch (e) {
    handleRouteError(res, e, `GET /trades/${req.params.orderId}`);
  }
});

router.get("/trades", async (req, res): Promise<void> => {
  try {
    const trades = await dhanClient.getTradeBook();
    res.json(Array.isArray(trades) ? trades : []);
  } catch (e) {
    handleRouteError(res, e, "GET /trades");
  }
});

export default router;
