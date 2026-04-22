import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/positions", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected. Connect your Dhan account first." });
    return;
  }
  try {
    const positions = await dhanClient.getPositions();
    res.json(Array.isArray(positions) ? positions : []);
  } catch (e) {
    if (e instanceof DhanApiError) {
      res.status(e.status).json(e.toClientResponse());
    } else {
      req.log.error({ err: e }, "Failed to fetch positions");
      res.status(500).json({ error: "Failed to fetch positions" });
    }
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

  // Dhan's positions API returns "INTRADAY" but the orders API requires "INTRA".
  // Map all position product type names to the order API equivalents.
  const PRODUCT_TYPE_MAP: Record<string, string> = {
    INTRADAY: "INTRA",
    CNC: "CNC",
    MARGIN: "MARGIN",
    CO: "CO",
    BO: "BO",
    MTF: "MTF",
  };
  const orderProductType = PRODUCT_TYPE_MAP[productType] ?? productType;

  // Dhan v2 order API uses camelCase field names.
  const orderBody = {
    securityId,
    exchangeSegment,
    transactionType,
    productType: orderProductType,
    orderType: "MARKET",
    validity: "DAY",
    quantity,
    disclosedQuantity: 0,
    price: 0,
    triggerPrice: 0,
    afterMarketOrder: false,
  };

  logger.info(
    { received: { securityId, exchangeSegment, productType, quantity, transactionType }, sending: orderBody },
    "[exit-single] placing exit order",
  );

  try {
    const result = await dhanClient.placeOrder(orderBody);
    res.json(result);
  } catch (e) {
    if (e instanceof DhanApiError) res.status(e.status).json(e.toClientResponse());
    else res.status(500).json({ error: "Failed to exit position" });
  }
});

export default router;
