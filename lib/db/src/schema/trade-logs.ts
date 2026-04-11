import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { strategiesTable } from "./strategies";

export const tradeLogsTable = pgTable("trade_logs", {
  id: serial("id").primaryKey(),
  strategyId: integer("strategy_id").notNull().references(() => strategiesTable.id, { onDelete: "cascade" }),
  strategyName: text("strategy_name").notNull(),
  orderId: text("order_id"),
  securityId: text("security_id"),
  tradingSymbol: text("trading_symbol").notNull(),
  transactionType: text("transaction_type").notNull(),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  pnl: numeric("pnl", { precision: 12, scale: 2 }),
  message: text("message"),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeLogSchema = createInsertSchema(tradeLogsTable).omit({
  id: true,
  executedAt: true,
});
export type InsertTradeLog = z.infer<typeof insertTradeLogSchema>;
export type TradeLog = typeof tradeLogsTable.$inferSelect;
