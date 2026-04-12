import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("custom"),
  status: text("status").notNull().default("paused"),
  securityId: text("security_id").notNull(),
  tradingSymbol: text("trading_symbol").notNull(),
  exchangeSegment: text("exchange_segment").notNull(),
  transactionType: text("transaction_type").notNull(),
  productType: text("product_type").notNull(),
  orderType: text("order_type").notNull(),
  quantity: integer("quantity").notNull(),
  entryPrice: numeric("entry_price", { precision: 12, scale: 2 }),
  stopLoss: numeric("stop_loss", { precision: 12, scale: 2 }),
  target: numeric("target", { precision: 12, scale: 2 }),
  trailingStopLoss: numeric("trailing_stop_loss", { precision: 12, scale: 2 }),
  maxPositions: integer("max_positions"),
  maxLossPerDay: numeric("max_loss_per_day", { precision: 12, scale: 2 }),
  maxProfitPerDay: numeric("max_profit_per_day", { precision: 12, scale: 2 }),
  timeframeMinutes: integer("timeframe_minutes").default(15),
  instrumentType: text("instrument_type").default("EQUITY"),
  entryConditions: text("entry_conditions"),
  exitConditions: text("exit_conditions"),
  totalTrades: integer("total_trades").notNull().default(0),
  winTrades: integer("win_trades").notNull().default(0),
  lossTrades: integer("loss_trades").notNull().default(0),
  totalPnl: numeric("total_pnl", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStrategySchema = createInsertSchema(strategiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  totalTrades: true,
  winTrades: true,
  lossTrades: true,
  totalPnl: true,
});
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategiesTable.$inferSelect;
