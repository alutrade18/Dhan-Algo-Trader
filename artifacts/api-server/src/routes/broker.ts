import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { dhanClient, DhanApiError } from "../lib/dhan-client";
import { marketFeedWS } from "../lib/market-feed-ws";
import { orderUpdateWS } from "../lib/order-update-ws";
import { getRateLimitStats } from "../lib/rate-limiter";
import { encryptToken, decryptToken } from "../lib/crypto-utils";
import { clearLedgerCache } from "../lib/ledger-cache";
import { getOrCreateSettings } from "./settings";

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
    marketFeedWS.reset();
    orderUpdateWS.reset();
    marketFeedWS.connect();
    orderUpdateWS.connect();

    const settings = await getOrCreateSettings();
    await db
      .update(settingsTable)
      .set({ brokerClientId: cid, brokerAccessToken: encryptToken(token), tokenGeneratedAt: new Date() })
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
  // 1. Disconnect all live connections and reset reconnect state
  dhanClient.disconnect();
  marketFeedWS.disconnect();
  orderUpdateWS.disconnect();
  marketFeedWS.reset();
  orderUpdateWS.reset();

  // 2. Clear in-memory ledger cache — prevents stale data bleeding into a new session
  clearLedgerCache();

  // 3. Clear broker credentials from DB and reset kill switch state
  try {
    const settings = await getOrCreateSettings();
    await db
      .update(settingsTable)
      .set({ brokerClientId: null, brokerAccessToken: null, killSwitchEnabled: false })
      .where(eq(settingsTable.id, settings.id));
    req.log.info("Broker credentials cleared from database");
  } catch (e) {
    req.log.error({ err: e }, "Failed to clear broker credentials from database");
  }

  res.json({ success: true, message: "Disconnected from broker" });
});

// POST /broker/generate-token — Generate a new Dhan access token via Client ID + PIN + TOTP
router.post("/broker/generate-token", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const pin = String(body.pin ?? "").trim();
  const totp = String(body.totp ?? "").trim();
  let clientId = String(body.clientId ?? "").trim();

  if (!pin || !/^\d{6}$/.test(pin)) {
    res.status(400).json({ success: false, error: "PIN must be exactly 6 digits" });
    return;
  }
  if (!totp || !/^\d{6}$/.test(totp)) {
    res.status(400).json({ success: false, error: "TOTP must be exactly 6 digits" });
    return;
  }

  // Fall back to stored client ID if not provided
  if (!clientId) {
    const settings = await getOrCreateSettings();
    clientId = settings.brokerClientId ?? "";
  }
  if (!clientId) {
    res.status(400).json({ success: false, error: "Client ID is required — enter it in the form or connect first" });
    return;
  }

  try {
    const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${encodeURIComponent(clientId)}&pin=${encodeURIComponent(pin)}&totp=${encodeURIComponent(totp)}`;
    const response = await fetch(url, { method: "POST", headers: { "Accept": "application/json" } });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok || !data.accessToken) {
      req.log.warn({ status: response.status, data }, "TOTP token generation failed");
      res.status(200).json({
        success: false,
        error: String(data.errorMessage ?? data.message ?? `Dhan returned HTTP ${response.status}`),
        raw: data,
      });
      return;
    }

    const accessToken = String(data.accessToken);
    const returnedClientId = String(data.dhanClientId ?? clientId);

    // Configure all clients with new credentials
    dhanClient.configure(returnedClientId, accessToken);
    marketFeedWS.configure(returnedClientId, accessToken);
    orderUpdateWS.configure(returnedClientId, accessToken);
    marketFeedWS.reset();
    orderUpdateWS.reset();
    marketFeedWS.connect();
    orderUpdateWS.connect();

    const settings = await getOrCreateSettings();
    await db
      .update(settingsTable)
      .set({
        brokerClientId: returnedClientId,
        brokerAccessToken: encryptToken(accessToken),
        tokenGeneratedAt: new Date(),
      })
      .where(eq(settingsTable.id, settings.id));

    req.log.info({ clientId: "****" + returnedClientId.slice(-4) }, "TOTP token generated and saved");

    // Fetch fund limits for a rich success response (same as /broker/connect)
    try {
      const funds = (await dhanClient.getFundLimits()) as Record<string, unknown>;
      res.json({
        success: true,
        dhanClientId: returnedClientId,
        dhanClientName: String(data.dhanClientName ?? ""),
        expiryTime: String(data.expiryTime ?? ""),
        availableBalance: Number(funds.availabelBalance ?? funds.availableBalance ?? 0),
        sodLimit: Number(funds.sodLimit ?? 0),
        utilizedAmount: Number(funds.utilizedAmount ?? 0),
        withdrawableBalance: Number(funds.withdrawableBalance ?? 0),
      });
    } catch {
      res.json({ success: true, dhanClientId: returnedClientId, dhanClientName: String(data.dhanClientName ?? ""), expiryTime: String(data.expiryTime ?? "") });
    }
  } catch (e) {
    req.log.error({ err: e }, "TOTP generate-token request failed");
    res.status(500).json({ success: false, error: "Network error — could not reach Dhan auth server" });
  }
});


// GET /broker/server-ip — Returns the server's outbound public IP (for Dhan whitelist)
let cachedServerIp: string | null = null;
let ipCachedAt = 0;
router.get("/broker/server-ip", async (_req, res): Promise<void> => {
  try {
    if (cachedServerIp && Date.now() - ipCachedAt < 5 * 60 * 1_000) {
      res.json({ ip: cachedServerIp });
      return;
    }
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4_000) });
    const { ip } = (await r.json()) as { ip: string };
    cachedServerIp = ip;
    ipCachedAt = Date.now();
    res.json({ ip });
  } catch {
    res.json({ ip: null, error: "Could not determine server IP" });
  }
});

// POST /broker/set-ip — Whitelist the server's own IP via Dhan API
router.post("/broker/set-ip", async (req, res): Promise<void> => {
  if (!dhanClient.isConnected()) {
    res.status(401).json({ success: false, error: "Broker not connected. Save your credentials first." });
    return;
  }

  const ipFlag = String((req.body as Record<string, unknown>).ipFlag ?? "PRIMARY");
  if (ipFlag !== "PRIMARY" && ipFlag !== "SECONDARY") {
    res.status(400).json({ success: false, error: "ipFlag must be PRIMARY or SECONDARY" });
    return;
  }

  try {
    // Resolve current server IP
    if (!cachedServerIp || Date.now() - ipCachedAt > 5 * 60_000) {
      const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4_000) });
      const { ip } = (await r.json()) as { ip: string };
      cachedServerIp = ip;
      ipCachedAt = Date.now();
    }
    const ip = cachedServerIp;
    if (!ip) {
      res.status(500).json({ success: false, error: "Could not determine server IP" });
      return;
    }

    const creds = dhanClient.getCredentials();
    const response = await fetch("https://api.dhan.co/v2/ip/setIP", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "access-token": creds.accessToken,
      },
      body: JSON.stringify({ dhanClientId: creds.clientId, ip, ipFlag }),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok || String(data.status).toUpperCase() !== "SUCCESS") {
      res.status(response.ok ? 400 : response.status).json({
        success: false,
        error: String(data.message ?? data.errorMessage ?? "Dhan API rejected the request"),
        raw: data,
      });
      return;
    }

    res.json({ success: true, ip, ipFlag, message: String(data.message ?? "IP saved successfully") });
  } catch (e) {
    res.status(500).json({ success: false, error: "Failed to contact Dhan API", detail: String(e) });
  }
});

router.get("/broker/status", async (_req, res): Promise<void> => {
  if (!dhanClient.isConnected()) {
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

// GET /rate-limits — Live rate limit counters for all API categories
router.get("/rate-limits", (_req, res): void => {
  res.json({
    limits: {
      order:       { perSecond: 10, perMinute: 250, perHour: 1000, perDay: 7000 },
      data:        { perSecond: 5, perDay: 100000 },
      quote:       { perSecond: 1 },
      nontrading:  { perSecond: 20 },
      optionChain: { special: "1 per 3 seconds per underlying" },
    },
    remaining: getRateLimitStats(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
