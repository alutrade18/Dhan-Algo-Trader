import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

const router: IRouter = Router();

router.get("/funds", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.json({
      connected: false,
      availableBalance: null,
      sodLimit: null,
      collateralAmount: null,
      receiveableAmount: null,
      utilizedAmount: null,
      blockedPayoutAmount: null,
      withdrawableBalance: null,
    });
    return;
  }

  try {
    const funds = (await dhanClient.getFundLimits()) as Record<string, unknown>;
    res.json({
      connected: true,
      dhanClientId: funds.dhanClientId,
      availableBalance: Number(funds.availabelBalance ?? funds.availableBalance ?? 0),
      sodLimit: Number(funds.sodLimit ?? 0),
      collateralAmount: Number(funds.collateralAmount ?? 0),
      receiveableAmount: Number(funds.receiveableAmount ?? 0),
      utilizedAmount: Number(funds.utilizedAmount ?? 0),
      blockedPayoutAmount: Number(funds.blockedPayoutAmount ?? 0),
      withdrawableBalance: Number(funds.withdrawableBalance ?? 0),
    });
  } catch (e) {
    if (e instanceof DhanApiError && (e.status === 401 || e.status === 403)) {
      req.log.warn({ path: "/fundlimit" }, "Broker auth error — credentials may have expired");
      res.json({
        connected: false,
        availableBalance: null,
        error: "AUTH_FAILED",
      });
    } else {
      req.log.error({ err: e }, "Failed to fetch fund limits");
      res.json({
        connected: false,
        availableBalance: null,
        error: "FETCH_FAILED",
      });
    }
  }
});

// POST /funds/margin — Calculate margin for a single order
router.post("/funds/margin", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const { exchangeSegment, transactionType, quantity, productType, securityId, price, triggerPrice } = req.body as {
      exchangeSegment: string;
      transactionType: string;
      quantity: number;
      productType: string;
      securityId: string;
      price: number;
      triggerPrice?: number;
    };
    const result = await dhanClient.calculateMargin({
      dhanClientId: dhanClient.getCredentials().clientId,
      exchangeSegment,
      transactionType,
      quantity,
      productType,
      securityId,
      price,
      triggerPrice: triggerPrice ?? 0,
    });
    res.json(result);
  } catch (e) {
    if (e instanceof DhanApiError) res.status(e.status).json(e.toClientResponse());
    else res.status(500).json({ error: "Failed to calculate margin" });
  }
});

export default router;
