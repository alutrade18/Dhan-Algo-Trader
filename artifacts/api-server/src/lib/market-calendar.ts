/**
 * Indian Market Holiday Calendar
 *
 * Source: NSE India Holiday Master (published annually)
 * https://www.nseindia.com/services/holiday-master
 *
 * ── How market status is determined ─────────────────────────────────────────
 *   1. Weekend (Sat/Sun)  → CLOSED
 *   2. Date in holiday list → CLOSED
 *   3. Time within trading hours on a weekday → OPEN
 *
 * ── Dhan API does not expose a market-status endpoint ───────────────────────
 *   This calendar is the most reliable offline approach.
 *   Update NSE_HOLIDAYS and MCX_HOLIDAYS lists each year when NSE publishes
 *   the new holiday master (usually in December for the following year).
 *
 * ── MCX vs NSE holidays ──────────────────────────────────────────────────────
 *   MCX follows a different (shorter) holiday list. On days NSE is closed,
 *   MCX may still run its evening session (5 PM – 11:30 PM IST), and vice versa.
 *   Both lists are maintained separately below.
 */

// ── NSE / BSE Trading Holidays 2025 ─────────────────────────────────────────
const NSE_HOLIDAYS_2025: readonly string[] = [
  "2025-01-26", // Republic Day
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr (Ramzan Eid) — subject to moon sighting
  "2025-04-14", // Dr. Babasaheb Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-02", // Mahatma Gandhi Jayanti
  "2025-10-20", // Diwali (Laxmi Pujan)
  "2025-10-21", // Diwali (Balipratipada)
  "2025-11-05", // Gurunanak Jayanti
  "2025-12-25", // Christmas
];

// ── NSE / BSE Trading Holidays 2026 ─────────────────────────────────────────
// Confirmed dates are marked ✓; lunar-based holidays are approximate
// and should be verified against the official NSE holiday master.
const NSE_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26", // Republic Day ✓
  "2026-03-03", // Mahashivratri (approx — lunar)
  "2026-03-23", // Holi (approx — lunar)
  "2026-04-03", // Good Friday ✓ (Easter 2026 = Apr 5)
  "2026-04-14", // Dr. Babasaheb Ambedkar Jayanti ✓
  "2026-05-01", // Maharashtra Day ✓
  "2026-08-15", // Independence Day ✓
  "2026-10-02", // Gandhi Jayanti ✓
  "2026-10-19", // Dussehra (approx — lunar)
  "2026-11-08", // Diwali Laxmi Pujan (approx — lunar; Amavasya)
  "2026-11-09", // Diwali Balipratipada (approx — lunar)
  "2026-11-25", // Gurunanak Jayanti (approx — lunar)
  "2026-12-25", // Christmas ✓
];

// ── MCX Trading Holidays 2025 ────────────────────────────────────────────────
// MCX is often open when NSE is closed for morning-session-only NSE holidays.
// It typically closes for national/major religious holidays.
const MCX_HOLIDAYS_2025: readonly string[] = [
  "2025-01-26", // Republic Day
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr
  "2025-04-14", // Dr. Babasaheb Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-20", // Diwali Laxmi Pujan (evening session closed)
  "2025-11-05", // Gurunanak Jayanti
  "2025-12-25", // Christmas
];

// ── MCX Trading Holidays 2026 ────────────────────────────────────────────────
const MCX_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26", // Republic Day ✓
  "2026-03-03", // Mahashivratri (approx)
  "2026-03-23", // Holi (approx)
  "2026-04-03", // Good Friday ✓
  "2026-04-14", // Dr. Babasaheb Ambedkar Jayanti ✓
  "2026-05-01", // Maharashtra Day ✓
  "2026-08-15", // Independence Day ✓
  "2026-10-02", // Gandhi Jayanti ✓
  "2026-11-08", // Diwali Laxmi Pujan (approx — evening session closed)
  "2026-11-25", // Gurunanak Jayanti (approx)
  "2026-12-25", // Christmas ✓
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function isHoliday(dateStr: string, holidayList: readonly string[]): boolean {
  return holidayList.includes(dateStr);
}

function allHolidays(): readonly string[] {
  return [...NSE_HOLIDAYS_2025, ...NSE_HOLIDAYS_2026];
}

function allMcxHolidays(): readonly string[] {
  return [...MCX_HOLIDAYS_2025, ...MCX_HOLIDAYS_2026];
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface MarketStatus {
  /** Exchange label shown in the UI, e.g. "NSE" or "MCX" */
  name: string;
  isOpen: boolean;
  /** Human-readable reason why the market is closed (when isOpen=false) */
  closedReason?: "weekend" | "holiday" | "pre-market" | "post-market";
}

/**
 * Returns the current NSE/MCX market status, taking weekends AND public
 * holidays into account.
 *
 * Logic:
 *   • 09:15 – 15:30 IST (weekday, non-holiday) → NSE OPEN
 *   • 15:30 – 23:30 IST (weekday, non-holiday) → MCX OPEN
 *   • Otherwise → CLOSED (NSE label shown before pre-open; MCX label after)
 */
export function getMarketStatus(): MarketStatus {
  const day = istDayOfWeek();
  const today = todayIST();
  const mins = istMinutes();

  // ── Weekend ─────────────────────────────────────────────────────────────
  if (day === 0 || day === 6) {
    return { name: "NSE", isOpen: false, closedReason: "weekend" };
  }

  // ── Public holiday check ─────────────────────────────────────────────────
  const nseHoliday = isHoliday(today, allHolidays());
  const mcxHoliday = isHoliday(today, allMcxHolidays());

  // NSE session: 09:15 – 15:30 IST
  const NSE_OPEN  = 9 * 60 + 15;  // 09:15
  const NSE_CLOSE = 15 * 60 + 30; // 15:30

  // MCX session: 09:00 – 23:30 IST (commodities trade almost all day)
  // In practice the relevant "evening" session is 15:30 – 23:30
  const MCX_CLOSE = 23 * 60 + 30; // 23:30

  if (mins >= NSE_OPEN && mins < NSE_CLOSE) {
    if (nseHoliday) return { name: "NSE", isOpen: false, closedReason: "holiday" };
    return { name: "NSE", isOpen: true };
  }

  if (mins >= NSE_CLOSE && mins < MCX_CLOSE) {
    if (mcxHoliday) return { name: "MCX", isOpen: false, closedReason: "holiday" };
    return { name: "MCX", isOpen: true };
  }

  // Pre-market (before 09:15) or post-market (after 23:30)
  const reason = mins < NSE_OPEN ? "pre-market" : "post-market";
  return { name: "NSE", isOpen: false, closedReason: reason };
}
