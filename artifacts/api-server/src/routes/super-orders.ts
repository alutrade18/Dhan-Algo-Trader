import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/super-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.getSuperOrders();
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to fetch super orders" });
    }
  }
});

router.post("/super-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.placeSuperOrder(req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to place super order" });
    }
  }
});

router.put("/super-orders/:orderId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.modifySuperOrder(req.params.orderId, req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to modify super order" });
    }
  }
});

router.delete("/super-orders/:orderId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const { leg } = req.query as { leg?: string };
    const data = await dhanClient.cancelSuperOrder(req.params.orderId, (leg as "ENTRY_LEG" | "TARGET_LEG" | "STOP_LOSS_LEG") ?? "ENTRY_LEG");
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to cancel super order" });
    }
  }
});

export default router;
