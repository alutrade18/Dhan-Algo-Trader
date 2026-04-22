import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const appLogsTable = pgTable("app_logs", {
  id: serial("id").primaryKey(),
  level: text("level").notNull().default("info"),
  category: text("category").notNull().default("api"),
  action: text("action").notNull(),
  details: text("details"),
  status: text("status"),
  statusCode: integer("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AppLog = typeof appLogsTable.$inferSelect;
export type InsertAppLog = typeof appLogsTable.$inferInsert;
