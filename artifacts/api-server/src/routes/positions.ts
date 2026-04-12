import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

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

// DELETE /positions — Exit ALL intraday positions (Dhan native)
router.delete("/positions", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const result = await dhanClient.exitAllPositions();
    res.json(result);
  } catch (e) {
    if (e instanceof DhanApiError) res.status(e.status).json(e.toClientResponse());
    else res.status(500).json({ error: "Failed to exit all positions" });
  }
});

// POST /positions/exit-single — Place a closing order for one position
router.post("/positions/exit-single", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  const { securityId, exchangeSegment, productType, quantity, transactionType } = req.body as {
    securityId: string;
    exchangeSegment: string;
    productType: string;
    quantity: number;
    transactionType: "BUY" | "SELL";
  };
  try {
    const result = await dhanClient.placeOrder({
      dhanClientId: dhanClient.getCredentials().clientId,
      transactionType,
      exchangeSegment,
      productType,
      orderType: "MARKET",
      validity: "DAY",
      securityId,
      quantity,
      price: 0,
      afterMarketOrder: false,
    });
    res.json(result);
  } catch (e) {
    if (e instanceof DhanApiError) res.status(e.status).json(e.toClientResponse());
    else res.status(500).json({ error: "Failed to exit position" });
  }
});

export default router;
