import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";

const router: IRouter = Router();

router.post("/broker/connect", async (req, res): Promise<void> => {
  const { clientId, accessToken } = req.body as Record<string, unknown>;

  if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
    res.status(400).json({ success: false, error: "clientId is required" });
    return;
  }
  if (!accessToken || typeof accessToken !== "string" || accessToken.trim().length < 10) {
    res.status(400).json({ success: false, error: "accessToken is required and must be at least 10 characters" });
    return;
  }

  const cid = clientId.trim();
  const token = accessToken.trim();

  try {
    const funds = (await dhanClient.getFundLimits({ clientId: cid, accessToken: token })) as Record<string, unknown>;

    dhanClient.configure(cid, token);

    req.log.info({ clientId: "****" + cid.slice(-4) }, "Broker credentials updated and verified");

    res.json({
      success: true,
      dhanClientId: funds.dhanClientId || cid,
      availableBalance: Number(funds.availabelBalance ?? funds.availableBalance ?? 0),
      sodLimit: Number(funds.sodLimit ?? 0),
      collateralAmount: Number(funds.collateralAmount ?? 0),
      receiveableAmount: Number(funds.receiveableAmount ?? 0),
      utilizedAmount: Number(funds.utilizedAmount ?? 0),
      blockedPayoutAmount: Number(funds.blockedPayoutAmount ?? 0),
      withdrawableBalance: Number(funds.withdrawableBalance ?? 0),
      message: "Connected successfully",
    });
  } catch (err) {
    if (err instanceof DhanApiError) {
      const errData = err.data as Record<string, unknown> | null;
      res.status(200).json({
        success: false,
        errorCode: errData?.errorCode || "UNKNOWN",
        errorMessage: errData?.errorMessage || "Connection failed",
        httpStatus: err.status,
      });
    } else {
      res.status(200).json({
        success: false,
        errorCode: "NETWORK_ERROR",
        errorMessage: "Unable to reach Dhan API. Check your internet connection.",
      });
    }
  }
});

router.post("/broker/disconnect", (req, res): void => {
  dhanClient.disconnect();
  req.log.info("Broker credentials cleared — disconnected");
  res.json({ success: true, message: "Disconnected from broker" });
});

router.get("/broker/status", async (_req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.json({
      connected: false,
      availableBalance: null,
      maskedClientId: "",
    });
    return;
  }

  try {
    const funds = (await dhanClient.getFundLimits()) as Record<string, unknown>;
    const { clientId: maskedClientId } = dhanClient.getCredentialsMasked();
    res.json({
      connected: true,
      maskedClientId,
      dhanClientId: funds.dhanClientId || maskedClientId,
      availableBalance: Number(funds.availabelBalance ?? funds.availableBalance ?? 0),
      sodLimit: Number(funds.sodLimit ?? 0),
      collateralAmount: Number(funds.collateralAmount ?? 0),
      receiveableAmount: Number(funds.receiveableAmount ?? 0),
      utilizedAmount: Number(funds.utilizedAmount ?? 0),
      blockedPayoutAmount: Number(funds.blockedPayoutAmount ?? 0),
      withdrawableBalance: Number(funds.withdrawableBalance ?? 0),
    });
  } catch {
    const { clientId: maskedClientId } = dhanClient.getCredentialsMasked();
    res.json({
      connected: false,
      availableBalance: null,
      maskedClientId,
    });
  }
});

export default router;
