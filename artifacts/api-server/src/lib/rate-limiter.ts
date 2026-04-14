import { logger } from "./logger";
import { db, rateLimitLogTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type ApiCategory = "order" | "data" | "quote" | "nontrading";

interface WindowLimits {
  perSecond?: number;
  perMinute?: number;
  perHour?: number;
  perDay?: number;
}

// ── Dhan API Rate Limits (official) ───────────────────────────────────────────
// Source: https://dhanhq.co/docs/v2/ (verified Apr 2026)
//
// Category     | /s  | /min | /hr  | /day
// -------------|-----|------|------|----------
// Order        |  25 |  250 | 1000 |  7 000
// Data         |  10 | 1000 | 5000 | Unlimited
// Non-Trading  |  20 |  Unlimited  | Unlimited
//
// We enforce slightly below the ceiling (90%) to absorb bursts.
const RATE_LIMITS: Record<ApiCategory, WindowLimits> = {
  order: {
    perSecond: 25,   // Dhan hard limit
    perMinute: 250,
    perHour:   1000,
    perDay:    7000,
  },
  data: {
    perSecond: 10,   // Dhan hard limit
    perMinute: 1000,
    perHour:   5000,
    // perDay: Unlimited — no counter needed
  },
  quote: {
    perSecond: 10,   // Grouped under data; kept for backwards compat
  },
  nontrading: {
    perSecond: 20,   // Dhan hard limit — rest are unlimited
  },
};

const CATEGORY_LABELS: Record<ApiCategory, string> = {
  order: "Order API",
  data: "Data API",
  quote: "Quote API",
  nontrading: "Non-Trading API",
};

// ── Shared counter interface ──────────────────────────────────────────────────
interface Counter {
  check(now: number): boolean;
  record(now: number): void;
  remaining(now: number): number;
  resetAt(now: number): number;
}

// ── In-memory sliding window (per-second, per-minute, per-hour) ───────────────
class SlidingWindowCounter implements Counter {
  private timestamps: number[] = [];
  private readonly windowMs: number;
  private readonly limit: number;

  constructor(windowMs: number, limit: number) {
    this.windowMs = windowMs;
    this.limit = limit;
  }

  private prune(now: number) {
    const cutoff = now - this.windowMs;
    this.timestamps = this.timestamps.filter((t) => t > cutoff);
  }

  check(now: number): boolean {
    this.prune(now);
    return this.timestamps.length < this.limit;
  }

  record(now: number) {
    this.timestamps.push(now);
  }

  remaining(now: number): number {
    this.prune(now);
    return Math.max(0, this.limit - this.timestamps.length);
  }

  resetAt(now: number): number {
    this.prune(now);
    if (this.timestamps.length === 0) return now;
    return this.timestamps[0] + this.windowMs;
  }
}

// ── DB-backed IST calendar-day counter (per-day only) ─────────────────────────
// Survives server restarts. Resets at IST midnight, not on a rolling 24h window.
class DailyCounter implements Counter {
  private count = 0;
  private currentDate = "";
  private readonly limit: number;
  private readonly category: string;

  constructor(limit: number, category: string) {
    this.limit = limit;
    this.category = category;
  }

  private todayIST(): string {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    return ist.toISOString().slice(0, 10);
  }

  /** Roll over count to zero if the IST calendar date has changed. */
  private maybeRollover() {
    const today = this.todayIST();
    if (this.currentDate !== today) {
      this.count = 0;
      this.currentDate = today;
    }
  }

  check(_now: number): boolean {
    this.maybeRollover();
    return this.count < this.limit;
  }

  record(_now: number) {
    this.maybeRollover();
    this.count++;
    void this.upsertToDb(this.currentDate, this.count);
  }

  remaining(_now: number): number {
    this.maybeRollover();
    return Math.max(0, this.limit - this.count);
  }

  resetAt(_now: number): number {
    // Next IST midnight in UTC ms
    const today = this.todayIST();
    const [y, m, d] = today.split("-").map(Number);
    // UTC time of IST midnight (IST = UTC+5:30, so IST midnight = UTC 18:30 prev day)
    return Date.UTC(y, m - 1, d + 1) - (5.5 * 60 * 60 * 1000);
  }

  /** Called once on startup — loads today's count from the DB. */
  async loadFromDb(): Promise<void> {
    try {
      const today = this.todayIST();
      this.currentDate = today;
      const [row] = await db
        .select()
        .from(rateLimitLogTable)
        .where(
          and(
            eq(rateLimitLogTable.category, this.category),
            eq(rateLimitLogTable.date, today),
          ),
        );
      this.count = row?.count ?? 0;
      logger.info(
        { category: this.category, date: today, count: this.count, limit: this.limit },
        "[RateLimit] Loaded daily count from DB",
      );
    } catch (e) {
      logger.warn({ err: e, category: this.category }, "[RateLimit] Failed to load daily count from DB — starting at 0");
      this.count = 0;
    }
  }

  private async upsertToDb(date: string, count: number): Promise<void> {
    try {
      await db
        .insert(rateLimitLogTable)
        .values({ category: this.category, date, count })
        .onConflictDoUpdate({
          target: [rateLimitLogTable.category, rateLimitLogTable.date],
          set: { count },
        });
    } catch (e) {
      logger.warn({ err: e, category: this.category }, "[RateLimit] Failed to persist daily count to DB");
    }
  }
}

// ── Counter registry ──────────────────────────────────────────────────────────
interface CategoryCounters {
  perSecond?: Counter;
  perMinute?: Counter;
  perHour?: Counter;
  perDay?: DailyCounter; // typed specifically so we can call loadFromDb()
}

const counters: Record<ApiCategory, CategoryCounters> = {
  order: {},
  data: {},
  quote: {},
  nontrading: {},
};

/** Creates all in-memory counters synchronously. Call once at module load. */
function initCounters() {
  for (const [cat, limits] of Object.entries(RATE_LIMITS) as [ApiCategory, WindowLimits][]) {
    if (limits.perSecond !== undefined)
      counters[cat].perSecond = new SlidingWindowCounter(1_000, limits.perSecond);
    if (limits.perMinute !== undefined)
      counters[cat].perMinute = new SlidingWindowCounter(60_000, limits.perMinute);
    if (limits.perHour !== undefined)
      counters[cat].perHour = new SlidingWindowCounter(3_600_000, limits.perHour);
    if (limits.perDay !== undefined)
      counters[cat].perDay = new DailyCounter(limits.perDay, cat);
  }
}

initCounters();

/**
 * Load today's IST day counts from the DB into all DailyCounters.
 * Call this from index.ts after the server starts listening.
 */
export async function loadDailyCountersFromDb(): Promise<void> {
  const categories = Object.keys(counters) as ApiCategory[];
  await Promise.all(
    categories
      .filter((cat) => counters[cat].perDay !== undefined)
      .map((cat) => counters[cat].perDay!.loadFromDb()),
  );
}

// ── Public API ────────────────────────────────────────────────────────────────
export interface RateLimitResult {
  allowed: boolean;
  category: ApiCategory;
  violatedWindow?: "second" | "minute" | "hour" | "day";
  limit?: number;
  retryAfterMs?: number;
  remaining: Record<string, number>;
}

export function checkRateLimit(category: ApiCategory): RateLimitResult {
  const now = Date.now();
  const c = counters[category];
  const limits = RATE_LIMITS[category];

  const windows: Array<{ key: "second" | "minute" | "hour" | "day"; counter?: Counter; limit?: number }> = [
    { key: "second", counter: c.perSecond, limit: limits.perSecond },
    { key: "minute", counter: c.perMinute, limit: limits.perMinute },
    { key: "hour",   counter: c.perHour,   limit: limits.perHour   },
    { key: "day",    counter: c.perDay,    limit: limits.perDay    },
  ];

  const remaining: Record<string, number> = {};

  for (const w of windows) {
    if (!w.counter || w.limit === undefined) continue;
    remaining[w.key] = w.counter.remaining(now);

    if (!w.counter.check(now)) {
      const retryAfterMs = Math.max(0, w.counter.resetAt(now) - now);
      logger.warn(
        { category, window: w.key, limit: w.limit },
        `[RateLimit] ${CATEGORY_LABELS[category]} ${w.key} limit reached (${w.limit}/${w.key})`,
      );
      return {
        allowed: false,
        category,
        violatedWindow: w.key,
        limit: w.limit,
        retryAfterMs,
        remaining,
      };
    }
  }

  for (const w of windows) {
    if (w.counter) w.counter.record(now);
  }

  return { allowed: true, category, remaining };
}

export function getRateLimitStats(): Record<ApiCategory, Record<string, number>> {
  const now = Date.now();
  const stats: Record<string, Record<string, number>> = {};
  for (const [cat, c] of Object.entries(counters) as [ApiCategory, CategoryCounters][]) {
    stats[cat] = {};
    if (c.perSecond) stats[cat].perSecond_remaining = c.perSecond.remaining(now);
    if (c.perMinute) stats[cat].perMinute_remaining = c.perMinute.remaining(now);
    if (c.perHour)   stats[cat].perHour_remaining   = c.perHour.remaining(now);
    if (c.perDay)    stats[cat].perDay_remaining     = c.perDay.remaining(now);
  }
  return stats as Record<ApiCategory, Record<string, number>>;
}

export function getOrderModificationCount(orderId: string): number {
  return orderModCounts[orderId] ?? 0;
}

export function recordOrderModification(orderId: string): { allowed: boolean; count: number } {
  const current = orderModCounts[orderId] ?? 0;
  if (current >= ORDER_MOD_CAP) {
    logger.warn({ orderId, count: current }, `[RateLimit] Order modification cap (${ORDER_MOD_CAP}) reached for order ${orderId}`);
    return { allowed: false, count: current };
  }
  orderModCounts[orderId] = current + 1;
  return { allowed: true, count: orderModCounts[orderId] };
}

const ORDER_MOD_CAP = 25;
const orderModCounts: Record<string, number> = {};

// ── Option Chain special: 1 request per 3 seconds per underlying+expiry ──────
const optionChainLastCall: Record<string, number> = {};

export function checkOptionChainRateLimit(key: string): { allowed: boolean; waitMs: number } {
  const now = Date.now();
  const INTERVAL_MS = 3100; // 3.1 sec buffer (Dhan allows 1 per 3 sec)
  const last = optionChainLastCall[key] ?? 0;
  const elapsed = now - last;

  if (elapsed < INTERVAL_MS) {
    const waitMs = INTERVAL_MS - elapsed;
    logger.warn({ key, waitMs }, "[RateLimit] Option Chain 3-sec throttle — too fast");
    return { allowed: false, waitMs };
  }

  optionChainLastCall[key] = now;
  return { allowed: true, waitMs: 0 };
}
