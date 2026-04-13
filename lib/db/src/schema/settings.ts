import { pgTable, text, serial, numeric, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  brokerClientId: text("broker_client_id"),
  brokerAccessToken: text("broker_access_token"),
  defaultProductType: text("default_product_type").notNull().default("INTRA"),
  defaultOrderType: text("default_order_type").notNull().default("MARKET"),
  defaultExchange: text("default_exchange").notNull().default("NSE_EQ"),
  defaultQuantity: integer("default_quantity"),
  maxOrderValue: numeric("max_order_value", { precision: 12, scale: 2 }),
  maxDailyLoss: numeric("max_daily_loss", { precision: 12, scale: 2 }).default("5000"),
  maxDailyProfit: numeric("max_daily_profit", { precision: 12, scale: 2 }),
  enableAutoTrading: boolean("enable_auto_trading").notNull().default(false),
  riskPerTrade: numeric("risk_per_trade", { precision: 5, scale: 2 }),
  theme: text("theme").notNull().default("dark"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
  killSwitchPin: text("kill_switch_pin"),
  tokenGeneratedAt: timestamp("token_generated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),

  autoSquareOffEnabled: boolean("auto_square_off_enabled").notNull().default(false),
  autoSquareOffTime: text("auto_square_off_time").notNull().default("15:14"),

  maxTradesPerDay: integer("max_trades_per_day"),
  maxPositionSizeValue: numeric("max_position_size_value", { precision: 12, scale: 2 }),
  maxPositionSizeType: text("max_position_size_type").notNull().default("FIXED"),

  instrumentBlacklist: jsonb("instrument_blacklist").$type<string[]>().default([]),

  dashboardWidgets: jsonb("dashboard_widgets").$type<{
    todayPnl: boolean;
    totalPnl: boolean;
    availableBalance: boolean;
    activeStrategies: boolean;
    equityCurve: boolean;
  }>().default({
    todayPnl: true,
    totalPnl: true,
    availableBalance: true,
    activeStrategies: true,
    equityCurve: true,
  }),

  refreshIntervalSeconds: integer("refresh_interval_seconds").notNull().default(15),

  tradingHoursStart: text("trading_hours_start").notNull().default("09:00"),
  tradingHoursEnd: text("trading_hours_end").notNull().default("15:30"),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
