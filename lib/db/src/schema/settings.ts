import { pgTable, text, serial, numeric, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  brokerClientId: text("broker_client_id"),
  brokerAccessToken: text("broker_access_token"),
  maxDailyLoss: numeric("max_daily_loss", { precision: 12, scale: 2 }).default("0"),
  theme: text("theme").notNull().default("dark"),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
  killSwitchPin: text("kill_switch_pin"),
  tokenGeneratedAt: timestamp("token_generated_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),

  autoSquareOffEnabled: boolean("auto_square_off_enabled").notNull().default(false),
  autoSquareOffTime: text("auto_square_off_time").notNull().default("15:14"),
  autoSquareOffTimeNSE: text("auto_square_off_time_nse").notNull().default("15:14"),
  autoSquareOffTimeMCX: text("auto_square_off_time_mcx").notNull().default("23:25"),

  maxQtyPerSymbol: integer("max_qty_per_symbol"),
  maxOpenOrders: integer("max_open_orders"),

  dashboardWidgets: jsonb("dashboard_widgets").$type<{
    todayPnl: boolean;
    availableBalance: boolean;
    activeStrategies: boolean;
  }>().default({
    todayPnl: true,
    availableBalance: true,
    activeStrategies: true,
  }),

  refreshIntervalSeconds: integer("refresh_interval_seconds").notNull().default(15),

  telegramAlerts: jsonb("telegram_alerts").$type<{
    orderFills: boolean;
    killSwitch: boolean;
    autoSquareOff: boolean;
    criticalErrors: boolean;
  }>().default({
    orderFills: true,
    killSwitch: true,
    autoSquareOff: true,
    criticalErrors: true,
  }),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
