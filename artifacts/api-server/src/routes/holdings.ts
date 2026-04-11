import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/holdings", async (req, res): Promise<void> => {
  try {
    const holdings = await dhanClient.getHoldings();
    res.json(Array.isArray(holdings) ? holdings : []);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch holdings");
    res.status(500).json({ error: "Failed to fetch holdings" });
  }
});

export default router;
