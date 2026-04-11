import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/funds", async (req, res): Promise<void> => {
  try {
    const funds = await dhanClient.getFundLimits();
    res.json(funds);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch fund limits");
    res.status(500).json({ error: "Failed to fetch fund limits" });
  }
});

export default router;
