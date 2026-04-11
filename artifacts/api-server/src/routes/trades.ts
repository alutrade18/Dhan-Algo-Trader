import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { handleRouteError } from "../lib/route-error";

const router: IRouter = Router();

router.get("/trades/history", async (req, res): Promise<void> => {
  const { fromDate, toDate, pageNumber = "0" } = req.query as {
    fromDate?: string;
    toDate?: string;
    pageNumber?: string;
  };
  if (!fromDate || !toDate) {
    res.status(400).json({ errorCode: "DH-905", errorMessage: "fromDate and toDate are required" });
    return;
  }
  try {
    const history = await dhanClient.getTradeHistory(fromDate, toDate, parseInt(pageNumber, 10));
    res.json(Array.isArray(history) ? history : []);
  } catch (e) {
    handleRouteError(res, e, "GET /trades/history");
  }
});

router.get("/trades/:orderId", async (req, res): Promise<void> => {
  try {
    const all = await dhanClient.getTradeBook();
    const arr = Array.isArray(all) ? (all as Record<string, unknown>[]) : [];
    const filtered = arr.filter((t) => String(t.orderId) === req.params.orderId);
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
