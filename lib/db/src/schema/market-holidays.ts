import { pgTable, serial, date, varchar, boolean, integer } from "drizzle-orm/pg-core";

/**
 * Market holidays for NSE/BSE and MCX.
 *
 * MCX has two separate sessions that may have different closure status:
 *   - Morning session: 09:00 – 17:00 IST
 *   - Evening session: 17:00 – 23:30 IST
 *
 * Source: https://dhan.co/market-holiday/
 * Update annually when exchanges publish the new holiday master.
 */
export const marketHolidaysTable = pgTable("market_holidays", {
  id: serial("id").primaryKey(),
  holidayDate: date("holiday_date").notNull().unique(),
  holidayName: varchar("holiday_name", { length: 200 }).notNull(),
  /** Year for easy querying */
  year: integer("year").notNull(),
  /** NSE/BSE fully closed this day */
  nseClosed: boolean("nse_closed").notNull().default(false),
  /** MCX morning session (09:00 – 17:00 IST) closed */
  mcxMorningClosed: boolean("mcx_morning_closed").notNull().default(false),
  /** MCX evening session (17:00 – 23:30 IST) closed */
  mcxEveningClosed: boolean("mcx_evening_closed").notNull().default(false),
});
