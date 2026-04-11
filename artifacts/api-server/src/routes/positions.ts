import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/positions", async (req, res): Promise<void> => {
  try {
    const positions = await dhanClient.getPositions();
    res.json(Array.isArray(positions) ? positions : []);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch positions");
    res.status(500).json({ error: "Failed to fetch positions" });
  }
});

export default router;
