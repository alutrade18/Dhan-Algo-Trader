import { pgTable, text, integer, primaryKey } from "drizzle-orm/pg-core";

export const rateLimitLogTable = pgTable(
  "rate_limit_log",
  {
    category: text("category").notNull(),
    date: text("date").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.category, table.date] })],
);

export type RateLimitLog = typeof rateLimitLogTable.$inferSelect;
