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

    // Dhan's /charts/intraday returns columnar arrays:
    // { open: [...], high: [...], low: [...], close: [...], volume: [...], timestamp: [...] }
    // The `timestamp` values are seconds since Jan 1, 1980 (not Unix/1970 epoch).
    // Field is "timestamp" per the official Dhan OpenAPI spec (ChartsResponse schema).
    const r = result as Record<string, unknown>;
    const times   = Array.isArray(r.timestamp) ? (r.timestamp as unknown[]) : [];
    const opens   = Array.isArray(r.open)      ? (r.open     as number[]) : [];
    const highs   = Array.isArray(r.high)      ? (r.high     as number[]) : [];
    const lows    = Array.isArray(r.low)       ? (r.low      as number[]) : [];
    const closes  = Array.isArray(r.close)     ? (r.close    as number[]) : [];
    const volumes = Array.isArray(r.volume)    ? (r.volume   as number[]) : [];

    // Jan 1, 1980 00:00:00 UTC expressed as Unix seconds (for epoch conversion)
    const DHAN_EPOCH_OFFSET = 315_532_800; // seconds between 1970-01-01 and 1980-01-01

    // Convert Dhan's 1980-epoch seconds → IST datetime string ("YYYY-MM-DD HH:MM:SS")
    function dhanTsToIST(dhanSec: unknown): string {
      const unixSec = Number(dhanSec) + DHAN_EPOCH_OFFSET;
      if (isNaN(unixSec) || unixSec <= 0) return "";
      const ms = (unixSec + 5.5 * 3600) * 1000; // shift to IST
      const d = new Date(ms);
      return [
        d.getUTCFullYear(),
        String(d.getUTCMonth() + 1).padStart(2, "0"),
        String(d.getUTCDate()).padStart(2, "0"),
      ].join("-") + " " + [
        String(d.getUTCHours()).padStart(2, "0"),
        String(d.getUTCMinutes()).padStart(2, "0"),
        "00",
      ].join(":");
    }

    req.log.info(
      { timesCount: times.length, firstTime: times[0], lastTime: times[times.length - 1], keys: Object.keys(r) },
      "Intraday candles fetched"
    );

    res.json({
      data: times
        .map((ts, i) => ({
          timestamp: dhanTsToIST(ts),
          open:   Number(opens[i]   ?? 0),
          high:   Number(highs[i]   ?? 0),
          low:    Number(lows[i]    ?? 0),
          close:  Number(closes[i]  ?? 0),
          volume: Number(volumes[i] ?? 0),
        }))
        .filter(c => c.timestamp !== ""),
    });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch intraday data");
    res.status(500).json({ error: "Failed to fetch intraday data" });
  }
});

// Per-key throttle: Dhan allows 1 unique request per 3 seconds for option chain
const optionChainLastFetch = new Map<string, number>();
const OPTION_CHAIN_MIN_INTERVAL_MS = 3_500; // slightly above 3s to be safe

/**
 * POST /api/market/ltp-batch
 * Batch-fetch LTP for multiple option security IDs using Dhan POST /marketfeed/ltp.
 * Rate limit: 10 req/s, 1000 instruments per request.
 * Returns: { ltps: { "<secId>": <ltp number>, ... } }
 */
router.post("/market/ltp-batch", async (req, res): Promise<void> => {
  if (!dhanClient.isConfigured()) {
    res.status(401).json({ error: "Broker not connected" });
    return;
  }
  const body = req.body as { securities?: Record<string, unknown> };
  if (!body.securities || typeof body.securities !== "object" || Array.isArray(body.securities)) {
    res.status(400).json({ error: "securities object required" });
    return;
  }

  // Validate and sanitise: segment → string[] of integer IDs
  const secStrings: Record<string, string[]> = {};
  let totalIds = 0;
  for (const [seg, raw] of Object.entries(body.securities)) {
    if (!Array.isArray(raw)) continue;
    const ids = (raw as unknown[]).map(Number).filter(n => !isNaN(n) && n > 0);
    if (ids.length > 0) {
      secStrings[seg] = ids.map(String);
      totalIds += ids.length;
    }
  }
  if (totalIds === 0) {
    res.json({ ltps: {} });
    return;
  }

  // Auto-chunk: Dhan allows max 1000 instruments per request.
  // Build flat list of [seg, secId] pairs then split into ≤1000 chunks.
  const CHUNK_SIZE = 1000;
  const allPairs: Array<[string, string]> = [];
  for (const [seg, ids] of Object.entries(secStrings)) {
    for (const id of ids) allPairs.push([seg, id]);
  }

  const chunks: Array<Record<string, string[]>> = [];
  for (let i = 0; i < allPairs.length; i += CHUNK_SIZE) {
    const chunkMap: Record<string, string[]> = {};
    for (const [seg, id] of allPairs.slice(i, i + CHUNK_SIZE)) {
      (chunkMap[seg] ??= []).push(id);
    }
    chunks.push(chunkMap);
  }

  try {
    const results = await Promise.all(
      chunks.map(chunkSecs =>
        (dhanClient.getMarketQuote(chunkSecs, "ltp") as Promise<Record<string, unknown>>)
      )
    );

    // Dhan v2 wraps: { data: { NSE_FNO: { "49081": { last_price: X } } }, status: "success" }
    const ltps: Record<string, number> = {};
    for (const raw of results) {
      const unwrapped = (raw.data && typeof raw.data === "object" ? raw.data : raw) as
        Record<string, Record<string, { last_price?: number }>>;
      for (const segData of Object.values(unwrapped)) {
        if (!segData || typeof segData !== "object") continue;
        for (const [secId, entry] of Object.entries(segData)) {
          const ltp = Number((entry as { last_price?: number }).last_price ?? 0);
          if (ltp > 0) ltps[secId] = ltp;
        }
      }
    }

    res.json({ ltps });
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch batch LTP");
    res.status(500).json({ error: "Failed to fetch batch LTP" });
  }
});

router.post("/market/option-chain", async (req, res): Promise<void> => {
  const parsed = GetOptionChainBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Rate gate: one unique request per 3.5 seconds
  const key = `${parsed.data.underSecurityId}:${parsed.data.underExchangeSegment}:${parsed.data.expiry}`;
  const last = optionChainLastFetch.get(key) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < OPTION_CHAIN_MIN_INTERVAL_MS) {
    const wait = OPTION_CHAIN_MIN_INTERVAL_MS - elapsed;
    await new Promise(r => setTimeout(r, wait));
  }
  optionChainLastFetch.set(key, Date.now());

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
