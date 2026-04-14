/**
 * Indian Market Holiday Calendar
 *
 * Source: Dhan market holiday page + NSE India Holiday Master
 * https://dhan.co/market-holiday/
 * https://www.nseindia.com/services/holiday-master
 *
 * ── How market status is determined ─────────────────────────────────────────
 *   1. Weekend (Sat/Sun)  → CLOSED
 *   2. Date in holiday list → CLOSED
 *   3. Time within trading hours on a weekday → OPEN
 *
 * ── Trading hours (IST) ──────────────────────────────────────────────────────
 *   NSE/BSE:  09:15 – 15:30
 *   MCX:      09:00 – 23:30  (runs all day, not just evening)
 *
 * ── MCX vs NSE holidays ──────────────────────────────────────────────────────
 *   MCX follows a different (shorter) holiday list.
 *   Key difference: MCX does NOT close for state-level or minor national
 *   holidays (e.g. Maharashtra Day, Dr. Ambedkar Jayanti, Dussehra) that NSE
 *   observes. MCX only shuts for major national holidays + Diwali evening session.
 *
 * ── Important: NSE holiday ≠ MCX holiday ────────────────────────────────────
 *   When NSE is on holiday during 09:15–15:30, MCX may still be open.
 *   getMarketStatus() handles this: if NSE is on holiday but MCX is not,
 *   it returns { name: "MCX", isOpen: true } even during NSE hours.
 *
 * Update lists each year when NSE/MCX publish the new holiday master (Dec).
 */

// ── NSE / BSE Trading Holidays 2025 ─────────────────────────────────────────
const NSE_HOLIDAYS_2025: readonly string[] = [
  "2025-01-26", // Republic Day
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr (Ramzan Eid)
  "2025-04-14", // Dr. Babasaheb Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-20", // Diwali (Laxmi Pujan)
  "2025-10-21", // Diwali (Balipratipada)
  "2025-11-05", // Gurunanak Jayanti
  "2025-12-25", // Christmas
];

// ── NSE / BSE Trading Holidays 2026 ─────────────────────────────────────────
// Confirmed dates marked ✓; lunar-based holidays are approximate.
// Verify annually at: https://www.nseindia.com/services/holiday-master
const NSE_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26", // Republic Day ✓
  "2026-03-03", // Mahashivratri (approx — lunar)
  "2026-03-23", // Holi (approx — lunar)
  "2026-04-03", // Good Friday ✓
  "2026-04-14", // Dr. Babasaheb Ambedkar Jayanti ✓
  "2026-05-01", // Maharashtra Day ✓
  "2026-08-15", // Independence Day ✓
  "2026-10-02", // Gandhi Jayanti ✓
  "2026-10-19", // Dussehra (approx — lunar)
  "2026-11-08", // Diwali Laxmi Pujan (approx — lunar)
  "2026-11-09", // Diwali Balipratipada (approx — lunar)
  "2026-11-25", // Gurunanak Jayanti (approx — lunar)
  "2026-12-25", // Christmas ✓
];

// ── MCX Trading Holidays 2025 ────────────────────────────────────────────────
// MCX has fewer holidays than NSE. It stays open on many NSE-only closures
// (e.g. Dr. Ambedkar Jayanti, Maharashtra Day, Dussehra).
// Source: https://dhan.co/market-holiday/ (MCX tab)
const MCX_HOLIDAYS_2025: readonly string[] = [
  "2025-01-26", // Republic Day
  "2025-02-26", // Mahashivratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr
  "2025-04-18", // Good Friday
  "2025-08-15", // Independence Day
  "2025-10-02", // Gandhi Jayanti
  "2025-10-20", // Diwali Laxmi Pujan (evening session closed)
  "2025-12-25", // Christmas
  // NOTE: Dr. Ambedkar Jayanti (Apr 14), Maharashtra Day (May 1),
  //       Gurunanak Jayanti (Nov 5) are NSE holidays but MCX stays OPEN.
];

// ── MCX Trading Holidays 2026 ────────────────────────────────────────────────
const MCX_HOLIDAYS_2026: readonly string[] = [
  "2026-01-26", // Republic Day ✓
  "2026-03-03", // Mahashivratri (approx)
  "2026-03-23", // Holi (approx)
  "2026-04-03", // Good Friday ✓
  "2026-08-15", // Independence Day ✓
  "2026-10-02", // Gandhi Jayanti ✓
  "2026-11-08", // Diwali Laxmi Pujan (approx — evening session closed)
  "2026-12-25", // Christmas ✓
  // NOTE: Dr. Ambedkar Jayanti (Apr 14), Maharashtra Day (May 1),
  //       Gurunanak Jayanti (Nov 25) are NSE holidays but MCX stays OPEN.
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

function allNseHolidays(): readonly string[] {
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
  /** Individual exchange statuses for granular display */
  nseOpen: boolean;
  mcxOpen: boolean;
}

/**
 * Returns the current market status, correctly handling:
 *  - Weekends
 *  - NSE-only holidays (where MCX is still open — e.g. Dr. Ambedkar Jayanti)
 *  - MCX-only holidays
 *  - Full-market holidays (both NSE and MCX closed)
 *
 * Trading hours:
 *  NSE/BSE: 09:15 – 15:30 IST
 *  MCX:     09:00 – 23:30 IST  (NOT just the evening; MCX opens at 9 AM)
 *
 * When NSE is on holiday during NSE hours, MCX is checked next.
 * If MCX is open → returns { name: "MCX", isOpen: true }.
 */
export function getMarketStatus(): MarketStatus {
  const day = istDayOfWeek();
  const today = todayIST();
  const mins = istMinutes();

  // ── Weekend ─────────────────────────────────────────────────────────────
  if (day === 0 || day === 6) {
    return { name: "NSE", isOpen: false, closedReason: "weekend", nseOpen: false, mcxOpen: false };
  }

  // ── Holiday check ────────────────────────────────────────────────────────
  const nseHoliday = isHoliday(today, allNseHolidays());
  const mcxHoliday = isHoliday(today, allMcxHolidays());

  // Trading session boundaries
  const NSE_OPEN  = 9 * 60 + 15;  // 09:15 IST
  const NSE_CLOSE = 15 * 60 + 30; // 15:30 IST
  const MCX_OPEN  = 9 * 60;       // 09:00 IST
  const MCX_CLOSE = 23 * 60 + 30; // 23:30 IST

  const nseOpen = !nseHoliday && mins >= NSE_OPEN && mins < NSE_CLOSE;
  const mcxOpen = !mcxHoliday && mins >= MCX_OPEN && mins < MCX_CLOSE;

  // ── NSE primary window (09:15 – 15:30) ──────────────────────────────────
  if (mins >= NSE_OPEN && mins < NSE_CLOSE) {
    if (nseOpen) {
      return { name: "NSE", isOpen: true, nseOpen: true, mcxOpen };
    }
    // NSE is closed (holiday) — fall through to MCX
    if (mcxOpen) {
      return { name: "MCX", isOpen: true, nseOpen: false, mcxOpen: true };
    }
    return { name: "NSE", isOpen: false, closedReason: "holiday", nseOpen: false, mcxOpen: false };
  }

  // ── MCX-only window (15:30 – 23:30) — NSE has closed for the day ────────
  if (mins >= NSE_CLOSE && mins < MCX_CLOSE) {
    if (mcxOpen) {
      return { name: "MCX", isOpen: true, nseOpen: false, mcxOpen: true };
    }
    return { name: "MCX", isOpen: false, closedReason: "holiday", nseOpen: false, mcxOpen: false };
  }

  // ── Pre-market (before 09:00) or post-market (after 23:30) ──────────────
  const reason = mins < MCX_OPEN ? "pre-market" : "post-market";
  return { name: "NSE", isOpen: false, closedReason: reason, nseOpen: false, mcxOpen: false };
}
