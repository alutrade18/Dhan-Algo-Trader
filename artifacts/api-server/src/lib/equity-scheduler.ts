/**
 * Equity Curve Cache Scheduler
 *
 * Fetches ledger data from Dhan and stores equity curve points in DB.
 * Runs at:
 *   • Server startup (if no valid cache for today)
 *   • 15:30 IST  (after NSE/BSE market close)
 *   • 23:30 IST  (after MCX close — final pass of the day)
 *
 * All dashboard equity-curve requests are served from this DB cache.
 * The Dhan ledger API is NEVER called outside of these scheduled windows.
 */

import { db, equityCurveCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { dhanClient } from "./dhan-client";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────
export interface EquityCurvePoint {
  date: string;
  pnl: number;
  cumulative: number;
  runbal?: number;
  type?: string;
  label?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function todayIST(): string {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return ist.toISOString().split("T")[0];
}

function istHHMM(): { h: number; m: number } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return { h: ist.getHours(), m: ist.getMinutes() };
}

/** Returns true on IST Saturday (6) or Sunday (0) — equity curve doesn't change on weekends. */
function isWeekendIST(): boolean {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  const day = ist.getDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
}

let _holidayCache: Set<string> | null = null;
let _holidayCacheDate = "";

async function isNseHolidayToday(): Promise<boolean> {
  const today = todayIST();
  if (_holidayCacheDate === today && _holidayCache !== null) {
    return _holidayCache.has(today);
  }
  try {
    const { db, marketHolidaysTable } = await import("@workspace/db");
    const rows = await db
      .select({ date: marketHolidaysTable.holidayDate, nseClosed: marketHolidaysTable.nseClosed })
      .from(marketHolidaysTable);
    _holidayCache = new Set(rows.filter(r => r.nseClosed).map(r => r.date));
    _holidayCacheDate = today;
    return _holidayCache.has(today);
  } catch {
    return false;
  }
}

/** Milliseconds until the next occurrence of HH:MM IST. */
function msUntilISTTime(targetH: number, targetM: number): number {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);

  const todayTarget = new Date(ist);
  todayTarget.setHours(targetH, targetM, 0, 0);

  if (ist < todayTarget) return todayTarget.getTime() - ist.getTime();
  todayTarget.setDate(todayTarget.getDate() + 1);
  return todayTarget.getTime() - ist.getTime();
}

function classifyLedgerEntry(narration: string): "DEPOSIT" | "WITHDRAWAL" | "PNL" {
  const n = narration.toUpperCase();
  if (
    (n.includes("FUND") && (n.includes("DEPOSIT") || n.includes("RECEIV") || n.includes("CREDIT") || n.includes("ADDED") || n.includes("TRANSFER IN"))) ||
    n === "FUNDS DEPOSITED"
  ) return "DEPOSIT";
  if (n.includes("WITHDRAW") || n.includes("PAYOUT") || n.includes("TRANSFER OUT") || (n.includes("FUND") && n.includes("DEBIT"))) return "WITHDRAWAL";
  return "PNL";
}

function buildEquityCurvePoints(raw: unknown): EquityCurvePoint[] {
  const entries = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];

  type DayInfo = { runbal: number; types: string[]; narration: string };
  const dailyMap = new Map<string, DayInfo>();

  for (const e of entries) {
    const narration = String(e.narration ?? e.particulars ?? "").trim();
    const narrUpper = narration.toUpperCase();
    if (narrUpper === "OPENING BALANCE" || narrUpper === "CLOSING BALANCE") continue;

    const voucher = String(e.voucherdate ?? "");
    if (!voucher) continue;
    const parsed = new Date(voucher);
    if (isNaN(parsed.getTime())) continue;
    const dateKey = parsed.toISOString().split("T")[0];
    if (dateKey === "1970-01-01") continue;

    const bal = parseFloat(String(e.runbal ?? "0").replace(/,/g, ""));
    if (isNaN(bal) || bal === 0) continue;

    const type = classifyLedgerEntry(narration);

    if (!dailyMap.has(dateKey)) {
      dailyMap.set(dateKey, { runbal: bal, types: [type], narration });
    } else {
      dailyMap.get(dateKey)!.types.push(type);
    }
  }

  const sortedDates = Array.from(dailyMap.keys()).sort();
  const points: EquityCurvePoint[] = [];
  let prevBal = 0;
  let tradingCumulative = 0;

  for (const d of sortedDates) {
    const info = dailyMap.get(d)!;
    const pnl = Math.round((info.runbal - prevBal) * 100) / 100;
    const dominantType = info.types.includes("DEPOSIT") ? "DEPOSIT"
      : info.types.includes("WITHDRAWAL") ? "WITHDRAWAL" : "PNL";
    if (dominantType === "PNL") tradingCumulative += pnl;
    points.push({
      date: d,
      pnl,
      cumulative: Math.round(tradingCumulative * 100) / 100,
      runbal: info.runbal,
      type: dominantType,
      label: info.narration,
    });
    prevBal = info.runbal;
  }
  return points;
}

// ── Public export for dashboard route ─────────────────────────────────────
export { buildEquityCurvePoints as buildEquityCurvePointsPublic };

// ── Cache Read / Write ──────────────────────────────────────────────────────
export async function getCachedEquityCurve(cacheKey: string): Promise<EquityCurvePoint[] | null> {
  try {
    const today = todayIST();
    const [row] = await db
      .select()
      .from(equityCurveCacheTable)
      .where(eq(equityCurveCacheTable.cacheKey, cacheKey))
      .limit(1);
    if (row && row.fetchedDate === today) {
      return row.points as EquityCurvePoint[];
    }
    return null;
  } catch {
    return null;
  }
}

async function storeCachedEquityCurve(cacheKey: string, points: EquityCurvePoint[]): Promise<void> {
  const today = todayIST();
  try {
    await db
      .insert(equityCurveCacheTable)
      .values({ cacheKey, points: points as object[], fetchedDate: today, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: equityCurveCacheTable.cacheKey,
        set: { points: points as object[], fetchedDate: today, updatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err }, "[EquityScheduler] Failed to store cache in DB");
  }
}

// ── Fetch & Cache a specific mode ─────────────────────────────────────────
async function fetchAndCacheMode(cacheKey: string, fromStr: string, toStr: string): Promise<void> {
  logger.info({ cacheKey, fromStr, toStr }, "[EquityScheduler] Fetching equity curve");
  try {
    const raw = await dhanClient.getAllLedger(fromStr, toStr);
    const points = buildEquityCurvePoints(raw);
    await storeCachedEquityCurve(cacheKey, points);
    logger.info({ cacheKey, points: points.length }, "[EquityScheduler] Cache updated");
  } catch (err) {
    logger.warn({ err, cacheKey }, "[EquityScheduler] Fetch failed — cache not updated");
  }
}

// ── Full refresh: all standard modes ──────────────────────────────────────
export async function refreshAllEquityCache(): Promise<void> {
  if (!dhanClient.isConfigured()) {
    logger.info("[EquityScheduler] Broker not connected — skipping refresh");
    return;
  }

  if (isWeekendIST()) {
    logger.info("[EquityScheduler] Weekend — equity curve doesn't change, skipping refresh");
    return;
  }

  if (await isNseHolidayToday()) {
    logger.info("[EquityScheduler] NSE market holiday — skipping equity refresh");
    return;
  }

  const today = todayIST();
  const now = new Date();

  // All-time: 3 years
  const allTimeFrom = new Date(now);
  allTimeFrom.setFullYear(allTimeFrom.getFullYear() - 3);
  await fetchAndCacheMode("alltime", allTimeFrom.toISOString().split("T")[0], today);

  // Small delay between batch calls to avoid simultaneous rate spikes
  await new Promise(r => setTimeout(r, 1_000));

  // 365d
  const y365From = new Date(now);
  y365From.setDate(y365From.getDate() - 364);
  await fetchAndCacheMode("365d", y365From.toISOString().split("T")[0], today);

  await new Promise(r => setTimeout(r, 1_000));

  // 30d
  const d30From = new Date(now);
  d30From.setDate(d30From.getDate() - 29);
  await fetchAndCacheMode("30d", d30From.toISOString().split("T")[0], today);

  await new Promise(r => setTimeout(r, 1_000));

  // 7d
  const d7From = new Date(now);
  d7From.setDate(d7From.getDate() - 6);
  await fetchAndCacheMode("7d", d7From.toISOString().split("T")[0], today);
}

// ── Startup: refresh only if cache is stale ─────────────────────────────
async function startupRefresh(): Promise<void> {
  const today = todayIST();
  try {
    const [row] = await db
      .select()
      .from(equityCurveCacheTable)
      .where(eq(equityCurveCacheTable.cacheKey, "alltime"))
      .limit(1);
    if (row?.fetchedDate === today) {
      logger.info("[EquityScheduler] Startup: cache is fresh for today — skipping");
      return;
    }
  } catch {
    /* DB error → proceed to refresh */
  }
  logger.info("[EquityScheduler] Startup: cache is stale — refreshing now");
  await refreshAllEquityCache();
}

// ── Schedule helper: run fn at target IST time, repeat daily ─────────────
function scheduleDaily(targetH: number, targetM: number, fn: () => void): void {
  const delay = msUntilISTTime(targetH, targetM);
  const label = `${String(targetH).padStart(2, "0")}:${String(targetM).padStart(2, "0")} IST`;
  logger.info({ nextRunMs: delay, label }, "[EquityScheduler] Scheduling daily run");

  setTimeout(() => {
    fn();
    // After first run, repeat every 24 hours
    setInterval(fn, 24 * 60 * 60 * 1_000);
  }, delay);
}

// ── Public: start the scheduler ───────────────────────────────────────────
export function startEquityScheduler(): void {
  // Startup refresh (delayed 10s to let the server fully boot)
  setTimeout(() => startupRefresh(), 10_000);

  // 15:30 IST — after NSE/BSE market close
  scheduleDaily(15, 30, () => {
    const { h, m } = istHHMM();
    logger.info({ ist: `${h}:${m}` }, "[EquityScheduler] 15:30 IST trigger — refreshing");
    void refreshAllEquityCache();
  });

  // 23:30 IST — after MCX close, final pass of the trading day
  scheduleDaily(23, 30, () => {
    const { h, m } = istHHMM();
    logger.info({ ist: `${h}:${m}` }, "[EquityScheduler] 23:30 IST trigger — refreshing");
    void refreshAllEquityCache();
  });

  logger.info("[EquityScheduler] Started (startup + 15:30 IST + 23:30 IST)");
}
