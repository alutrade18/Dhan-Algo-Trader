import { pgTable, text, serial, integer, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paperTradesTable = pgTable("paper_trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  securityId: text("security_id").notNull(),
  exchange: text("exchange").notNull().default("NSE_EQ"),
  side: text("side").notNull(),
  qty: integer("qty").notNull(),
  entryPrice: numeric("entry_price", { precision: 12, scale: 2 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 12, scale: 2 }),
  pnl: numeric("pnl", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("OPEN"),
  entryTime: timestamp("entry_time", { withTimezone: true }).notNull().defaultNow(),
  exitTime: timestamp("exit_time", { withTimezone: true }),
});

export const insertPaperTradeSchema = createInsertSchema(paperTradesTable).omit({
  id: true,
  entryTime: true,
});
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type PaperTrade = typeof paperTradesTable.$inferSelect;
