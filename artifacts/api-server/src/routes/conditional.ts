import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/conditional", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.getAllConditionalTriggers();
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to fetch conditional triggers" });
    }
  }
});

router.post("/conditional", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.placeConditionalTrigger(req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to place conditional trigger" });
    }
  }
});

router.put("/conditional/:alertId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.modifyConditionalTrigger(req.params.alertId, req.body as Record<string, unknown>);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to modify conditional trigger" });
    }
  }
});

router.delete("/conditional/:alertId", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const data = await dhanClient.deleteConditionalTrigger(req.params.alertId);
    res.json(data);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to delete conditional trigger" });
    }
  }
});

export default router;
