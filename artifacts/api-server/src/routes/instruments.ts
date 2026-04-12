import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq, or, like, ilike, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/instruments/search", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const instrument = req.query.instrument as string | undefined;
  const exch = req.query.exch as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  if (!q || q.length < 1) {
    res.status(400).json({ error: "q param required (min 1 char)" });
    return;
  }

  try {
    const conditions = [
      or(
        ilike(instrumentsTable.symbolName, `${q}%`),
        ilike(instrumentsTable.displayName, `%${q}%`),
        ilike(instrumentsTable.isin, q),
        sql`${instrumentsTable.securityId}::text = ${q}`,
      ),
    ];

    if (instrument) {
      conditions.push(eq(instrumentsTable.instrument, instrument.toUpperCase()));
    }
    if (exch) {
      conditions.push(eq(instrumentsTable.exchId, exch.toUpperCase()));
    }

    const results = await db
      .select({
        securityId: instrumentsTable.securityId,
        exchId: instrumentsTable.exchId,
        segment: instrumentsTable.segment,
        instrument: instrumentsTable.instrument,
        symbolName: instrumentsTable.symbolName,
        displayName: instrumentsTable.displayName,
        isin: instrumentsTable.isin,
        series: instrumentsTable.series,
        lotSize: instrumentsTable.lotSize,
        tickSize: instrumentsTable.tickSize,
        underlyingSymbol: instrumentsTable.underlyingSymbol,
        expiryDate: instrumentsTable.expiryDate,
        strikePrice: instrumentsTable.strikePrice,
        optionType: instrumentsTable.optionType,
      })
      .from(instrumentsTable)
      .where(and(...conditions))
      .orderBy(
        sql`CASE WHEN upper(${instrumentsTable.symbolName}) = upper(${q}) THEN 0
                 WHEN upper(${instrumentsTable.symbolName}) LIKE upper(${q + "%"}) THEN 1
                 ELSE 2 END`,
        instrumentsTable.symbolName
      )
      .limit(limit);

    res.json(results);
  } catch (err) {
    req.log.error({ err }, "instruments search error");
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/instruments/:securityId", async (req, res): Promise<void> => {
  const securityId = Number(req.params.securityId);
  if (!securityId || isNaN(securityId)) {
    res.status(400).json({ error: "Invalid securityId" });
    return;
  }

  try {
    const results = await db
      .select()
      .from(instrumentsTable)
      .where(eq(instrumentsTable.securityId, securityId));

    if (results.length === 0) {
      res.status(404).json({ error: "Instrument not found" });
      return;
    }

    res.json(results.length === 1 ? results[0] : results);
  } catch (err) {
    req.log.error({ err }, "instrument lookup error");
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.get("/instruments", async (req, res): Promise<void> => {
  const instrument = req.query.instrument as string | undefined;
  const exch = req.query.exch as string | undefined;
  const underlying = req.query.underlying as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Number(req.query.offset ?? 0);

  try {
    const conditions = [];
    if (instrument) conditions.push(eq(instrumentsTable.instrument, instrument.toUpperCase()));
    if (exch) conditions.push(eq(instrumentsTable.exchId, exch.toUpperCase()));
    if (underlying) conditions.push(ilike(instrumentsTable.underlyingSymbol, underlying));

    const results = await db
      .select()
      .from(instrumentsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(instrumentsTable.symbolName)
      .limit(limit)
      .offset(offset);

    res.json(results);
  } catch (err) {
    req.log.error({ err }, "instruments list error");
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
