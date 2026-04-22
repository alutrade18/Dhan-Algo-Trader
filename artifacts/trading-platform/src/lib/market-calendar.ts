/**
 * Client-side market holiday calendar.
 * Mirror of the server-side list in api-server/src/lib/market-calendar.ts.
 * Update annually when NSE/MCX publish the new holiday master (usually in December).
 *
 * Key rule: NSE holiday ≠ MCX holiday.
 * MCX stays open on many NSE-only closures (Dr. Ambedkar Jayanti, Maharashtra Day, etc.)
 * Source: https://dhan.co/market-holiday/
 */

// ── NSE / BSE holidays ────────────────────────────────────────────────────
const NSE_HOLIDAYS: readonly string[] = [
  // 2025
  "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31",
  "2025-04-14", "2025-04-18", "2025-05-01", "2025-08-15",
  "2025-10-02", "2025-10-20", "2025-10-21", "2025-11-05", "2025-12-25",
  // 2026
  "2026-01-26", "2026-03-03", "2026-03-23", "2026-04-03",
  "2026-04-14", "2026-05-01", "2026-08-15", "2026-10-02",
  "2026-10-19", "2026-11-08", "2026-11-09", "2026-11-25", "2026-12-25",
];

// ── MCX holidays — shorter list; MCX stays OPEN on many NSE-only closures ──
// Dr. Ambedkar Jayanti (Apr 14), Maharashtra Day (May 1), Gurunanak Jayanti
// are NSE holidays but MCX trades normally on those days.
const MCX_HOLIDAYS: readonly string[] = [
  // 2025
  "2025-01-26", "2025-02-26", "2025-03-14", "2025-03-31",
  "2025-04-18", "2025-08-15",
  "2025-10-02", "2025-10-20", "2025-12-25",
  // 2026
  "2026-01-26", "2026-03-03", "2026-03-23", "2026-04-03",
  "2026-08-15", "2026-10-02",
  "2026-11-08", "2026-12-25",
];

/** Returns today's date in IST as "YYYY-MM-DD". */
function todayIST(): string {
  const utcMs = Date.now() + new Date().getTimezoneOffset() * 60_000;
  return new Date(utcMs + 5.5 * 3_600_000).toISOString().split("T")[0];
}

/** True if today is a recognised holiday for the given exchange. */
export function isHolidayToday(exchange: "NSE" | "MCX" = "NSE"): boolean {
  const today = todayIST();
  return (exchange === "MCX" ? MCX_HOLIDAYS : NSE_HOLIDAYS).includes(today);
}

/**
 * Returns true when NSE/BSE equity markets are open for trading.
 * Session: Mon–Fri, 09:15–15:30 IST, excluding NSE holidays.
 */
export function isMarketOpen(): boolean {
  if (isHolidayToday("NSE")) return false;
  const nowIST = new Date(Date.now() + 5.5 * 3_600_000);
  const day = nowIST.getUTCDay(); // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false;
  const h = nowIST.getUTCHours();
  const m = nowIST.getUTCMinutes();
  const minuteOfDay = h * 60 + m;
  return minuteOfDay >= 9 * 60 + 15 && minuteOfDay < 15 * 60 + 30;
}
