/**
 * Seeds the market_holidays table with NSE/BSE/MCX holiday data.
 *
 * Source (2026): https://dhan.co/market-holiday/
 * Run: pnpm --filter @workspace/db tsx src/seed-market-holidays.ts
 *
 * MCX sessions:
 *   Morning: 09:00 – 17:00 IST
 *   Evening: 17:00 – 23:30 IST
 *
 * On many NSE holidays, MCX morning is CLOSED but evening is OPEN.
 * This is captured separately so getMarketStatus() can display the right status
 * at any given time of day.
 */

import { db } from "./index";
import { marketHolidaysTable } from "./schema/market-holidays";

type HolidayRow = typeof marketHolidaysTable.$inferInsert;

// ── 2025 Holidays ─────────────────────────────────────────────────────────────
// Source: NSE India holiday master 2025 (confirmed)
// MCX session data based on MCX official circular — approximate for morning/evening split.
const HOLIDAYS_2025: HolidayRow[] = [
  // Republic Day — all exchanges fully closed
  { holidayDate: "2025-01-26", holidayName: "Republic Day",             year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // Mahashivratri — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-02-26", holidayName: "Mahashivratri",            year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Holi — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-03-14", holidayName: "Holi",                     year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Id-Ul-Fitr — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-03-31", holidayName: "Id-Ul-Fitr (Ramzan Eid)", year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Dr. Ambedkar Jayanti — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-04-14", holidayName: "Dr. Babasaheb Ambedkar Jayanti", year: 2025, nseClosed: true, mcxMorningClosed: true, mcxEveningClosed: false },
  // Good Friday — all exchanges fully closed
  { holidayDate: "2025-04-18", holidayName: "Good Friday",              year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // Maharashtra Day — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-05-01", holidayName: "Maharashtra Day",          year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Independence Day — all exchanges fully closed
  { holidayDate: "2025-08-15", holidayName: "Independence Day",         year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // Gandhi Jayanti — all exchanges fully closed
  { holidayDate: "2025-10-02", holidayName: "Gandhi Jayanti",           year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // Diwali Laxmi Pujan — NSE closed; MCX evening session closed (muhurat)
  { holidayDate: "2025-10-20", holidayName: "Diwali - Laxmi Pujan",     year: 2025, nseClosed: true,  mcxMorningClosed: false, mcxEveningClosed: true  },
  // Diwali Balipratipada — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-10-21", holidayName: "Diwali - Balipratipada",   year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Gurunanak Jayanti — NSE closed; MCX morning closed, evening open
  { holidayDate: "2025-11-05", holidayName: "Gurunanak Jayanti",        year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // Christmas — all exchanges fully closed
  { holidayDate: "2025-12-25", holidayName: "Christmas",                year: 2025, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
];

// ── 2026 Holidays ─────────────────────────────────────────────────────────────
// Source: https://dhan.co/market-holiday/ (official 2026 list, verified)
// MCX session data taken directly from the MCX Trading Sessions table on the same page.
const HOLIDAYS_2026: HolidayRow[] = [
  // ── New Year Day: NSE OPEN; MCX morning open, evening CLOSED (special case)
  { holidayDate: "2026-01-01", holidayName: "New Year Day",             year: 2026, nseClosed: false, mcxMorningClosed: false, mcxEveningClosed: true  },
  // ── Republic Day: NSE, BSE & MCX fully closed
  { holidayDate: "2026-01-26", holidayName: "Republic Day",             year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // ── Holi: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-03-03", holidayName: "Holi",                     year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Shri Ram Navami: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-03-26", holidayName: "Shri Ram Navami",          year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Shri Mahavir Jayanti: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-03-31", holidayName: "Shri Mahavir Jayanti",     year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Good Friday: NSE, BSE & MCX fully closed
  { holidayDate: "2026-04-03", holidayName: "Good Friday",              year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // ── Dr. Ambedkar Jayanti: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-04-14", holidayName: "Dr. Baba Saheb Ambedkar Jayanti", year: 2026, nseClosed: true, mcxMorningClosed: true, mcxEveningClosed: false },
  // ── Maharashtra Day: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-05-01", holidayName: "Maharashtra Day",          year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Bakri Id: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-05-28", holidayName: "Bakri Id",                 year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Muharram: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-06-26", holidayName: "Muharram",                 year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Ganesh Chaturthi: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-09-14", holidayName: "Ganesh Chaturthi",         year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Gandhi Jayanti: NSE, BSE & MCX fully closed
  { holidayDate: "2026-10-02", holidayName: "Mahatma Gandhi Jayanti",   year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
  // ── Dussehra: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-10-20", holidayName: "Dussehra",                 year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Diwali Balipratipada: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-11-10", holidayName: "Diwali - Balipratipada",   year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: false },
  // ── Guru Nanak Jayanti: NSE, BSE closed; MCX morning CLOSED, evening OPEN
  { holidayDate: "2026-11-24", holidayName: "Prakash Gurpurb Sri Guru Nanak Dev", year: 2026, nseClosed: true, mcxMorningClosed: true, mcxEveningClosed: false },
  // ── Christmas: NSE, BSE & MCX fully closed
  { holidayDate: "2026-12-25", holidayName: "Christmas",                year: 2026, nseClosed: true,  mcxMorningClosed: true,  mcxEveningClosed: true  },
];

async function seed() {
  const allHolidays = [...HOLIDAYS_2025, ...HOLIDAYS_2026];

  console.log(`Seeding ${allHolidays.length} market holidays (2025 + 2026)…`);

  // Upsert on holidayDate — safe to re-run
  for (const row of allHolidays) {
    await db
      .insert(marketHolidaysTable)
      .values(row)
      .onConflictDoUpdate({
        target: marketHolidaysTable.holidayDate,
        set: {
          holidayName:       row.holidayName,
          year:              row.year,
          nseClosed:         row.nseClosed,
          mcxMorningClosed:  row.mcxMorningClosed,
          mcxEveningClosed:  row.mcxEveningClosed,
        },
      });
    console.log(`  ✓ ${row.holidayDate}  ${row.holidayName}`);
  }

  console.log("\nDone. Holiday table up to date.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
