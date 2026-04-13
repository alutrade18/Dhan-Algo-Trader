import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  entryCondition: text("entry_condition").notNull().default("MANUAL"),
  securityId: text("security_id"),
  exchangeSegment: text("exchange_segment"),
  tradingSymbol: text("trading_symbol"),
  quantity: integer("quantity").notNull().default(1),
  productType: text("product_type").notNull().default("INTRADAY"),
  transactionType: text("transaction_type").notNull().default("BUY"),
  active: boolean("active").notNull().default(true),
  webhookToken: text("webhook_token"),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Strategy = typeof strategiesTable.$inferSelect;
export type InsertStrategy = typeof strategiesTable.$inferInsert;
