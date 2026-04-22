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

  // Log exactly what we received and what we're sending so mismatches are visible in prod logs
  logger.info(
    {
      received: { securityId, exchangeSegment, productType, quantity, transactionType },
      sending: {
        security_id: securityId,
        exchange_segment: exchangeSegment,
        transaction_type: transactionType,
        product_type: orderProductType,
        order_type: "MARKET",
        validity: "DAY",
        quantity,
        price: 0,
        after_market_order: false,
      },
    },
    "[exit-single] placing exit order",
  );

  try {
    // Dhan API v2 requires snake_case field names.
    const result = await dhanClient.placeOrder({
      security_id: securityId,
      exchange_segment: exchangeSegment,
      transaction_type: transactionType,
      product_type: orderProductType,
      order_type: "MARKET",
      validity: "DAY",
      quantity,
      disclosed_quantity: 0,
      price: 0,
      trigger_price: 0,
      after_market_order: false,
    });
    res.json(result);
  } catch (e) {
    if (e instanceof DhanApiError) res.status(e.status).json(e.toClientResponse());
    else res.status(500).json({ error: "Failed to exit position" });
  }
});

export default router;
