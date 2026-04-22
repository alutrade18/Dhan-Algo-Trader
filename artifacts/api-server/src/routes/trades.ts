import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { handleRouteError } from "../lib/route-error";

const router: IRouter = Router();

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

export default router;
