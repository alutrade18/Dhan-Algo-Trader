import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { db, instrumentsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import {
  GetMarketQuoteBody,
  GetHistoricalDataBody,
  GetIntradayDataBody,
  GetOptionChainBody,
  GetExpiryListBody,
} from "@workspace/api-zod";

function excelSerialToISO(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return date.toISOString().slice(0, 10);
}

function isExcelSerial(v: unknown): v is number {
  return typeof v === "number" && v > 40000 && v < 60000;
}

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

// GET /market/ltp?exchSeg=NSE_EQ&secId=1333
// Fast single-instrument LTP — used by Super Orders entry price auto-fill
router.get("/market/ltp", async (req, res): Promise<void> => {
  const exchSeg = String(req.query.exchSeg ?? "");
  const secId   = String(req.query.secId   ?? "");

  if (!exchSeg || !secId || isNaN(parseInt(secId, 10))) {
    res.status(400).json({ error: "exchSeg and secId are required" });
    return;
  }

  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }

  try {
    const ltp = await dhanClient.getLtp(exchSeg, secId);
    res.json({ ltp, exchSeg, secId });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch LTP");
    res.status(500).json({ error: "Failed to fetch LTP" });
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
      fromDate: parsed.data.fromDate instanceof Date ? parsed.data.fromDate.toISOString().slice(0, 10) : String(parsed.data.fromDate),
      toDate: parsed.data.toDate instanceof Date ? parsed.data.toDate.toISOString().slice(0, 10) : String(parsed.data.toDate),
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
    const raw = await dhanClient.getOptionChain({
      underSecurityId: parsed.data.underSecurityId,
      underExchangeSegment: parsed.data.underExchangeSegment,
      expiry: parsed.data.expiry instanceof Date ? parsed.data.expiry.toISOString().slice(0, 10) : String(parsed.data.expiry),
    });
    // Dhan response: { data: { last_price: X, oc: { "25650.000000": { ce: {...}, pe: {...} } } }, status: "..." }
    const r = raw as Record<string, unknown>;
    const inner = (r.data ?? r) as Record<string, unknown>;
    const ltp = Number(inner.last_price ?? 0);
    // Expose oc directly as data so frontend can iterate strike keys
    const oc = (inner.oc ?? inner) as Record<string, unknown>;
    res.json({ data: oc, ltp });
  } catch (e: unknown) {
    req.log.error({ err: e }, "Failed to fetch option chain");
    const dhanErr = e as { data?: { data?: Record<string, string> } };
    const errData = dhanErr?.data?.data ?? {};
    const dhanMsg = Object.values(errData)[0];
    const message = dhanMsg
      ? `Dhan: ${dhanMsg}`
      : "Failed to fetch option chain";
    res.status(500).json({ error: message });
  }
});

router.get("/market/expiry-list", async (req, res): Promise<void> => {
  const underlyingSecId = Number(req.query.underlyingSecId);
  const instrument = String(req.query.instrument ?? "OPTIDX");

  if (!underlyingSecId || isNaN(underlyingSecId)) {
    res.status(400).json({ error: "underlyingSecId required" });
    return;
  }

  try {
    const rows = await db
      .selectDistinct({ expiryDate: instrumentsTable.expiryDate })
      .from(instrumentsTable)
      .where(
        and(
          eq(instrumentsTable.underlyingSecurityId, underlyingSecId),
          eq(instrumentsTable.instrument, instrument),
          sql`${instrumentsTable.expiryDate} IS NOT NULL`
        )
      )
      .orderBy(instrumentsTable.expiryDate);

    const today = new Date().toISOString().slice(0, 10);
    const expiries = rows
      .map(r => {
        const raw = r.expiryDate!;
        const serial = Number(raw);
        return isExcelSerial(serial) ? excelSerialToISO(serial) : raw;
      })
      .filter(d => d >= today);

    res.json({ data: expiries });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch expiry list from DB");
    res.status(500).json({ error: "Failed to fetch expiry list" });
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

router.get("/market/option-strikes", async (req, res): Promise<void> => {
  const underlyingSecId = Number(req.query.underlyingSecId);
  const expiry = String(req.query.expiry ?? "");
  const instrument = String(req.query.instrument ?? "OPTIDX");

  if (!underlyingSecId || !expiry) {
    res.status(400).json({ error: "underlyingSecId and expiry required" });
    return;
  }

  try {
    const expirySerial = String(Math.round(new Date(expiry).getTime() / 86400000 + 25569));

    const rows = await db
      .select({
        securityId: instrumentsTable.securityId,
        exchId: instrumentsTable.exchId,
        segment: instrumentsTable.segment,
        symbolName: instrumentsTable.symbolName,
        strikePrice: instrumentsTable.strikePrice,
        optionType: instrumentsTable.optionType,
        lotSize: instrumentsTable.lotSize,
        expiryDate: instrumentsTable.expiryDate,
      })
      .from(instrumentsTable)
      .where(
        and(
          eq(instrumentsTable.underlyingSecurityId, underlyingSecId),
          eq(instrumentsTable.instrument, instrument),
          sql`${instrumentsTable.expiryDate}::text = ${expirySerial}`
        )
      )
      .orderBy(instrumentsTable.strikePrice);

    res.json({ data: rows });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch option strikes");
    res.status(500).json({ error: "Failed" });
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
