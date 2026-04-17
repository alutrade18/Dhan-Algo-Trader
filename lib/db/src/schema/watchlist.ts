import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const watchlistTable = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    securityId: integer("security_id").notNull(),
    exchId: text("exch_id").notNull(),
    segment: text("segment").notNull(),
    symbolName: text("symbol_name").notNull(),
    displayName: text("display_name"),
    instrument: text("instrument"),
    lotSize: integer("lot_size").default(1),
    expiryDate: text("expiry_date"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("watchlist_security_exch_idx").on(t.securityId, t.exchId),
  ]
);

export type WatchlistItem = typeof watchlistTable.$inferSelect;
export type InsertWatchlistItem = typeof watchlistTable.$inferInsert;
