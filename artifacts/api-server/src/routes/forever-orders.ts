import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/forever-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.getForeverOrders();
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to fetch forever orders" });
    }
  }
});

router.post("/forever-orders", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.placeForeverOrder(req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to place forever order" });
    }
  }
});

router.put("/forever-orders/:orderId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.modifyForeverOrder(req.params.orderId, req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to modify forever order" });
    }
  }
});

router.delete("/forever-orders/:orderId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.cancelForeverOrder(req.params.orderId);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to cancel forever order" });
    }
  }
});

export default router;
