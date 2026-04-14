/**
 * Indian Market Holiday Calendar
 *
 * Primary data source: market_holidays DB table (seeded from Dhan holiday page)
 * Fallback:            hardcoded lists below (for tests / DB unavailability)
 *
 * ── Trading hours (IST) ──────────────────────────────────────────────────────
 *   NSE/BSE:         09:15 – 15:30
 *   MCX Morning:     09:00 – 17:00
 *   MCX Evening:     17:00 – 23:30
 *
 * On many NSE holidays, MCX morning is CLOSED but the evening session is OPEN.
 * The DB schema captures this with separate mcx_morning_closed / mcx_evening_closed flags.
 *
 * ── Cache ────────────────────────────────────────────────────────────────────
 *   Holiday data is cached in-memory at startup and refreshed every 24 hours
 *   so individual health-check calls are never blocked on a DB round-trip.
 */

import { db, marketHolidaysTable } from "@workspace/db";
import { logger } from "./logger";

// ── In-memory cache ───────────────────────────────────────────────────────────

interface CachedHoliday {
  date: string;          // "YYYY-MM-DD"
  nseClosed: boolean;
  mcxMorningClosed: boolean;
  mcxEveningClosed: boolean;
}

let _cache: CachedHoliday[] = [];
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

/** Loads holidays from DB into the in-memory cache. Falls back silently. */
export async function loadHolidayCache(): Promise<void> {
  try {
    const rows = await db
      .select({
        date:             marketHolidaysTable.holidayDate,
        nseClosed:        marketHolidaysTable.nseClosed,
        mcxMorningClosed: marketHolidaysTable.mcxMorningClosed,
        mcxEveningClosed: marketHolidaysTable.mcxEveningClosed,
      })
      .from(marketHolidaysTable);

    _cache = rows.map((r) => ({
      date:             r.date,
      nseClosed:        r.nseClosed,
      mcxMorningClosed: r.mcxMorningClosed,
      mcxEveningClosed: r.mcxEveningClosed,
    }));
    _cacheLoadedAt = Date.now();
    logger.info({ count: _cache.length }, "[MarketCalendar] Loaded holidays from DB");
  } catch (err) {
    logger.warn({ err }, "[MarketCalendar] Could not load holidays from DB — using fallback");
  }
}

/** Refreshes cache if stale (called lazily from getMarketStatus). */
async function maybeRefreshCache(): Promise<void> {
  if (Date.now() - _cacheLoadedAt > CACHE_TTL_MS) {
    await loadHolidayCache();
  }
}

// ── Hardcoded fallback (if DB unavailable) ────────────────────────────────────
// Keep in sync with seed-market-holidays.ts

const FALLBACK_NSE: readonly string[] = [
  "2025-01-26","2025-02-26","2025-03-14","2025-03-31","2025-04-14",
  "2025-04-18","2025-05-01","2025-08-15","2025-10-02","2025-10-20",
  "2025-10-21","2025-11-05","2025-12-25",
  "2026-01-26","2026-03-03","2026-03-26","2026-03-31","2026-04-03",
  "2026-04-14","2026-05-01","2026-05-28","2026-06-26","2026-09-14",
  "2026-10-02","2026-10-20","2026-11-10","2026-11-24","2026-12-25",
];

// Days where MCX morning (09:00–17:00) is closed
const FALLBACK_MCX_MORNING_CLOSED: readonly string[] = [
  "2025-01-26","2025-02-26","2025-03-14","2025-03-31","2025-04-14",
  "2025-04-18","2025-05-01","2025-08-15","2025-10-02","2025-10-21",
  "2025-11-05","2025-12-25",
  "2026-01-26","2026-03-03","2026-03-26","2026-03-31","2026-04-03",
  "2026-04-14","2026-05-01","2026-05-28","2026-06-26","2026-09-14",
  "2026-10-02","2026-10-20","2026-11-10","2026-11-24","2026-12-25",
];

// Days where MCX evening (17:00–23:30) is closed
const FALLBACK_MCX_EVENING_CLOSED: readonly string[] = [
  "2025-01-26","2025-04-18","2025-08-15","2025-10-02","2025-10-20",
  "2025-12-25",
  "2026-01-01","2026-01-26","2026-04-03","2026-10-02","2026-12-25",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns today's date in IST as "YYYY-MM-DD". */
function todayIST(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return ist.toISOString().split("T")[0];
}

/** Returns the current IST time as total minutes from midnight. */
function istMinutes(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** Returns the day of week in IST (0=Sun, 6=Sat). */
function istDayOfWeek(): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return ist.getUTCDay();
}

function lookupFromCache(today: string): { nseClosed: boolean; mcxMorningClosed: boolean; mcxEveningClosed: boolean } | null {
  const row = _cache.find((r) => r.date === today);
  if (!row) return null;
  return { nseClosed: row.nseClosed, mcxMorningClosed: row.mcxMorningClosed, mcxEveningClosed: row.mcxEveningClosed };
}

function lookupFromFallback(today: string) {
  return {
    nseClosed:        FALLBACK_NSE.includes(today),
    mcxMorningClosed: FALLBACK_MCX_MORNING_CLOSED.includes(today),
    mcxEveningClosed: FALLBACK_MCX_EVENING_CLOSED.includes(today),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface MarketStatus {
  /** Primary exchange for the current time slot ("NSE" or "MCX") */
  name: string;
  isOpen: boolean;
  closedReason?: "weekend" | "holiday" | "pre-market" | "post-market";
  /** Granular per-exchange open status */
  nseOpen: boolean;
  mcxOpen: boolean;
  /** Which MCX session is currently active (for UI labelling) */
  mcxSession: "morning" | "evening" | "closed";
}

/**
 * Returns the current market status, correctly handling:
 *  - Weekends
 *  - NSE-only holidays (where MCX may still have an evening session open)
 *  - MCX morning-only vs evening-only closures
 *  - Full-market holidays (NSE + all MCX sessions closed)
 *
 * Reads from the in-memory holiday cache (DB-backed, refreshed every 24 h).
 * Falls back to hardcoded lists if the DB has not been loaded yet.
 *
 * Note: this function is synchronous for use in request handlers.
 * Call loadHolidayCache() at startup and maybeRefreshCache() elsewhere.
 */
export function getMarketStatus(): MarketStatus {
  const day   = istDayOfWeek();
  const today = todayIST();
  const mins  = istMinutes();

  // ── Weekend ──────────────────────────────────────────────────────────────
  if (day === 0 || day === 6) {
    return { name: "NSE", isOpen: false, closedReason: "weekend", nseOpen: false, mcxOpen: false, mcxSession: "closed" };
  }

  // ── Holiday lookup (DB cache, then fallback) ─────────────────────────────
  const h = _cache.length > 0 ? lookupFromCache(today) : null;
  const { nseClosed, mcxMorningClosed, mcxEveningClosed } = h ?? lookupFromFallback(today);

  // ── Session boundaries ────────────────────────────────────────────────────
  // NSE/BSE
  const NSE_OPEN   = 9 * 60 + 15;  // 09:15 IST
  const NSE_CLOSE  = 15 * 60 + 30; // 15:30 IST
  // MCX morning session
  const MCX_OPEN   = 9 * 60;       // 09:00 IST
  const MCX_MID    = 17 * 60;      // 17:00 IST  (morning → evening split)
  const MCX_CLOSE  = 23 * 60 + 30; // 23:30 IST

  // ── Compute open/closed for each session ──────────────────────────────────
  const nseOpen = !nseClosed && mins >= NSE_OPEN && mins < NSE_CLOSE;

  let mcxOpen = false;
  let mcxSession: MarketStatus["mcxSession"] = "closed";

  if (mins >= MCX_OPEN && mins < MCX_MID) {
    // We are in the MCX morning window (09:00–17:00)
    mcxSession = "morning";
    mcxOpen = !mcxMorningClosed;
  } else if (mins >= MCX_MID && mins < MCX_CLOSE) {
    // We are in the MCX evening window (17:00–23:30)
    mcxSession = "evening";
    mcxOpen = !mcxEveningClosed;
  }

  // ── Pick the primary exchange label for this time slot ────────────────────
  if (mins >= NSE_OPEN && mins < NSE_CLOSE) {
    // NSE primary window
    if (nseOpen) return { name: "NSE", isOpen: true,  nseOpen: true,  mcxOpen, mcxSession };
    if (mcxOpen) return { name: "MCX", isOpen: true,  nseOpen: false, mcxOpen: true,  mcxSession };
    return { name: "NSE", isOpen: false, closedReason: nseClosed ? "holiday" : "pre-market", nseOpen: false, mcxOpen: false, mcxSession: "closed" };
  }

  if (mins >= MCX_OPEN && mins < NSE_OPEN) {
    // MCX morning pre-NSE window (09:00–09:15): only MCX morning
    if (mcxOpen) return { name: "MCX", isOpen: true, nseOpen: false, mcxOpen: true, mcxSession };
    return { name: "NSE", isOpen: false, closedReason: "pre-market", nseOpen: false, mcxOpen: false, mcxSession: "closed" };
  }

  if (mins >= NSE_CLOSE && mins < MCX_CLOSE) {
    // MCX evening window — NSE has closed for the day
    if (mcxOpen) return { name: "MCX", isOpen: true, nseOpen: false, mcxOpen: true, mcxSession };
    return { name: "MCX", isOpen: false, closedReason: mcxEveningClosed ? "holiday" : "post-market", nseOpen: false, mcxOpen: false, mcxSession: "closed" };
  }

  // Pre-market (before 09:00) or post-market (after 23:30)
  const reason = mins < MCX_OPEN ? "pre-market" : "post-market";
  return { name: "NSE", isOpen: false, closedReason: reason, nseOpen: false, mcxOpen: false, mcxSession: "closed" };
}

/** Trigger cache refresh in the background (safe to call from request handler). */
export function refreshHolidayCacheIfStale(): void {
  void maybeRefreshCache();
}
