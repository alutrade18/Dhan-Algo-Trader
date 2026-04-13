import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";

export const superOrdersTable = pgTable("super_orders", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  dhanOrderId: text("dhan_order_id"),
  securityId: text("security_id").notNull(),
  exchangeSegment: text("exchange_segment").notNull(),
  tradingSymbol: text("trading_symbol"),
  transactionType: text("transaction_type").notNull(),
  productType: text("product_type").notNull().default("INTRADAY"),
  orderType: text("order_type").notNull().default("LIMIT"),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }),
  targetPrice: numeric("target_price", { precision: 12, scale: 2 }),
  stopLossPrice: numeric("stop_loss_price", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("PENDING"),
  orderDate: text("order_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SuperOrder = typeof superOrdersTable.$inferSelect;
export type InsertSuperOrder = typeof superOrdersTable.$inferInsert;
