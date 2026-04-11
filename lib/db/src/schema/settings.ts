import { pgTable, text, serial, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  brokerClientId: text("broker_client_id"),
  brokerAccessToken: text("broker_access_token"),
  defaultProductType: text("default_product_type").notNull().default("INTRA"),
  defaultOrderType: text("default_order_type").notNull().default("MARKET"),
  defaultExchange: text("default_exchange").notNull().default("NSE_EQ"),
  maxOrderValue: numeric("max_order_value", { precision: 12, scale: 2 }),
  maxDailyLoss: numeric("max_daily_loss", { precision: 12, scale: 2 }).default("5000"),
  maxDailyProfit: numeric("max_daily_profit", { precision: 12, scale: 2 }),
  enableAutoTrading: boolean("enable_auto_trading").notNull().default(false),
  enableNotifications: boolean("enable_notifications").notNull().default(true),
  riskPerTrade: numeric("risk_per_trade", { precision: 5, scale: 2 }),
  theme: text("theme").notNull().default("dark"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
