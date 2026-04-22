import { Router, type IRouter } from "express";
import { db, instrumentsTable } from "@workspace/db";
import { eq, or, like, ilike, and, sql, inArray } from "drizzle-orm";

const router: IRouter = Router();

router.get("/instruments/option-underlyings", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim().toUpperCase();
  if (!q || q.length < 1) {
    res.status(400).json({ error: "q param required" });
    return;
  }

  try {
    const rows = await db
      .selectDistinct({
        underlyingSymbol: instrumentsTable.underlyingSymbol,
        underlyingSecurityId: instrumentsTable.underlyingSecurityId,
        exchId: instrumentsTable.exchId,
      })
      .from(instrumentsTable)
      .where(
        and(
          eq(instrumentsTable.instrument, "OPTSTK"),
          ilike(instrumentsTable.underlyingSymbol, `${q}%`)
        )
      )
      .orderBy(instrumentsTable.underlyingSymbol)
      .limit(15);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "option underlyings search error");
    res.status(500).json({ error: "Search failed" });
  }
});

router.get("/instruments/search", async (req, res): Promise<void> => {
  const q = String(req.query.q ?? "").trim();
  const instrument = req.query.instrument as string | undefined;
  const instrumentsParam = req.query.instruments as string | undefined;
  const exch = req.query.exch as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  if (!q || q.length < 1) {
    res.status(400).json({ error: "q param required (min 1 char)" });
    return;
  }

  try {
    // Split query into tokens (by spaces/dashes/underscores) so that
    // "nifty 25500 ce" matches "FINNIFTY-Apr2026-25500-CE"
    const tokens = q.toUpperCase().split(/[\s\-_]+/).filter(Boolean);

    let symbolCondition: ReturnType<typeof and>;
    if (tokens.length > 1) {
      // Multi-token: every token must appear somewhere in symbolName (AND logic)
      symbolCondition = and(
        ...tokens.map(token => ilike(instrumentsTable.symbolName, `%${token}%`))
      )!;
    } else {
      // Single token: starts-with OR contains OR securityId OR isin
      symbolCondition = or(
        ilike(instrumentsTable.symbolName, `${q}%`),
        ilike(instrumentsTable.symbolName, `%${q}%`),
        ilike(instrumentsTable.displayName, `%${q}%`),
        ilike(instrumentsTable.isin, q),
        sql`${instrumentsTable.securityId}::text = ${q}`,
      )!;
    }

    const conditions = [symbolCondition];

    if (instrumentsParam) {
      const types = instrumentsParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      if (types.length === 1) {
        conditions.push(eq(instrumentsTable.instrument, types[0]));
      } else if (types.length > 1) {
        conditions.push(inArray(instrumentsTable.instrument, types));
      }
    } else if (instrument) {
      conditions.push(eq(instrumentsTable.instrument, instrument.toUpperCase()));
    }
    if (exch) {
      conditions.push(eq(instrumentsTable.exchId, exch.toUpperCase()));
    }

    // For ordering: prefer exact match, then starts-with, then rest
    const firstToken = tokens[0] ?? q;
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
                 WHEN upper(${instrumentsTable.symbolName}) LIKE upper(${firstToken + "%"}) THEN 1
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
