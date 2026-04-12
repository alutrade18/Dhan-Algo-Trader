import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { dhanClient, DhanApiError } from "../lib/dhan-client";
import { marketFeedWS } from "../lib/market-feed-ws";
import { orderUpdateWS } from "../lib/order-update-ws";

const router: IRouter = Router();

async function getOrCreateSettings() {
  let [settings] = await db.select().from(settingsTable);
  if (!settings) {
    [settings] = await db.insert(settingsTable).values({}).returning();
  }
  return settings;
}

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

    const returnedClientId = String(funds.dhanClientId || "").trim();
    if (returnedClientId && returnedClientId !== cid) {
      req.log.warn(
        { entered: "****" + cid.slice(-4), returned: "****" + returnedClientId.slice(-4) },
        "Client ID mismatch — entered ID does not match token owner",
      );
      res.json({
        success: false,
        errorCode: "CLIENT_ID_MISMATCH",
        errorMessage: `The Client ID you entered (${cid}) does not match the account linked to this Access Token (${returnedClientId}). Please enter the correct Client ID.`,
      });
      return;
    }

    dhanClient.configure(cid, token);
    marketFeedWS.configure(cid, token);
    orderUpdateWS.configure(cid, token);
    marketFeedWS.connect();
    orderUpdateWS.connect();

    const settings = await getOrCreateSettings();
    await db
      .update(settingsTable)
      .set({ brokerClientId: cid, brokerAccessToken: token })
      .where(eq(settingsTable.id, settings.id));

    req.log.info({ clientId: "****" + cid.slice(-4) }, "Broker credentials verified and saved to DB");

    res.json({
      success: true,
      dhanClientId: returnedClientId || cid,
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

router.post("/broker/disconnect", async (req, res): Promise<void> => {
  dhanClient.disconnect();
  marketFeedWS.disconnect();
  orderUpdateWS.disconnect();

  try {
    const settings = await getOrCreateSettings();
    await db
      .update(settingsTable)
      .set({ brokerClientId: null, brokerAccessToken: null })
      .where(eq(settingsTable.id, settings.id));
    req.log.info("Broker credentials cleared from memory and database");
  } catch (e) {
    req.log.error({ err: e }, "Failed to clear broker credentials from database");
  }

  res.json({ success: true, message: "Disconnected from broker" });
});

// POST /broker/renew-token — Renew Dhan access token
router.post("/broker/renew-token", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  try {
    const creds = dhanClient.getCredentials();
    const response = await fetch("https://api.dhan.co/v2/RenewToken", {
      method: "GET",
      headers: {
        "access-token": creds.accessToken,
        "dhanClientId": creds.clientId,
      },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      res.status(response.status).json({ error: "Token renewal failed", details: err });
      return;
    }
    const data = await response.json() as { accessToken?: string; expiryTime?: string };
    if (data.accessToken) {
      dhanClient.configure(creds.clientId, data.accessToken);
      const { eq: eqFn } = await import("drizzle-orm");
      const [settings] = await db.select().from(settingsTable).limit(1);
      if (settings) {
        await db.update(settingsTable).set({ brokerAccessToken: data.accessToken }).where(eqFn(settingsTable.id, settings.id));
      }
      marketFeedWS.configure(creds.clientId, data.accessToken);
      orderUpdateWS.configure(creds.clientId, data.accessToken);
    }
    res.json({ success: true, ...data });
  } catch (e) {
    res.status(500).json({ error: "Failed to renew token" });
  }
});

// GET /broker/token-info — Get token expiry info
router.get("/broker/token-info", async (_req, res): Promise<void> => {
  try {
    const [settings] = await db.select().from(settingsTable).limit(1);
    if (!settings?.brokerAccessToken) {
      res.json({ hasToken: false });
      return;
    }
    res.json({ hasToken: true, tokenUpdatedAt: settings.updatedAt });
  } catch {
    res.json({ hasToken: false });
  }
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
