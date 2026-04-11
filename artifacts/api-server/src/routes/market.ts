import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import {
  GetMarketQuoteBody,
  GetHistoricalDataBody,
  GetIntradayDataBody,
  GetOptionChainBody,
  GetExpiryListBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/market/quote", async (req, res): Promise<void> => {
  const parsed = GetMarketQuoteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const data = await dhanClient.getMarketQuote(
      parsed.data.securities,
      parsed.data.quoteType,
    );
    res.json({ data });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch market quote");
    res.status(500).json({ error: "Failed to fetch market quote" });
  }
});

router.post("/market/historical", async (req, res): Promise<void> => {
  const parsed = GetHistoricalDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await dhanClient.getHistoricalData({
      securityId: parsed.data.securityId,
      exchangeSegment: parsed.data.exchangeSegment,
      instrumentType: parsed.data.instrumentType,
      expiryCode: parsed.data.expiryCode,
      fromDate: parsed.data.fromDate,
      toDate: parsed.data.toDate,
    });
    const r = result as Record<string, unknown>;
    const candles = Array.isArray(r.data) ? r.data : [];
    res.json({
      data: candles.map((c: unknown[]) => ({
        timestamp: String(c[0] || ""),
        open: Number(c[1] || 0),
        high: Number(c[2] || 0),
        low: Number(c[3] || 0),
        close: Number(c[4] || 0),
        volume: Number(c[5] || 0),
      })),
    });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch historical data");
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

router.post("/market/intraday", async (req, res): Promise<void> => {
  const parsed = GetIntradayDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await dhanClient.getIntradayData({
      securityId: parsed.data.securityId,
      exchangeSegment: parsed.data.exchangeSegment,
      instrumentType: parsed.data.instrumentType,
    });
    const r = result as Record<string, unknown>;
    const candles = Array.isArray(r.data) ? r.data : [];
    res.json({
      data: candles.map((c: unknown[]) => ({
        timestamp: String(c[0] || ""),
        open: Number(c[1] || 0),
        high: Number(c[2] || 0),
        low: Number(c[3] || 0),
        close: Number(c[4] || 0),
        volume: Number(c[5] || 0),
      })),
    });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch intraday data");
    res.status(500).json({ error: "Failed to fetch intraday data" });
  }
});

router.post("/market/option-chain", async (req, res): Promise<void> => {
  const parsed = GetOptionChainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const data = await dhanClient.getOptionChain({
      underSecurityId: parsed.data.underSecurityId,
      underExchangeSegment: parsed.data.underExchangeSegment,
      expiry: parsed.data.expiry,
    });
    res.json({ data });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch option chain");
    res.status(500).json({ error: "Failed to fetch option chain" });
  }
});

router.post("/market/expiry-list", async (req, res): Promise<void> => {
  const parsed = GetExpiryListBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const result = await dhanClient.getExpiryList({
      underSecurityId: parsed.data.underSecurityId,
      underExchangeSegment: parsed.data.underExchangeSegment,
    });
    const r = result as Record<string, unknown>;
    res.json({ data: Array.isArray(r.data) ? r.data : [] });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch expiry list");
    res.status(500).json({ error: "Failed to fetch expiry list" });
  }
});

router.get("/market/securities", async (req, res): Promise<void> => {
  try {
    const result = await dhanClient.getSecurityList();
    const r = result as Record<string, unknown>;
    res.json({ data: Array.isArray(r.data) ? r.data : [] });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch security list");
    res.status(500).json({ error: "Failed to fetch security list" });
  }
});

export default router;
