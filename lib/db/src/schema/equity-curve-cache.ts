import { pgTable, serial, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const equityCurveCacheTable = pgTable("equity_curve_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(),
  points: jsonb("points").notNull(),
  fetchedDate: text("fetched_date").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
