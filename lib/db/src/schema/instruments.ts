import { pgTable, text, serial, integer, numeric, index, uniqueIndex } from "drizzle-orm/pg-core";

export const instrumentsTable = pgTable(
  "instruments",
  {
    id: serial("id").primaryKey(),
    securityId: integer("security_id").notNull(),
    exchId: text("exch_id").notNull(),
    segment: text("segment").notNull(),
    instrument: text("instrument").notNull(),
    symbolName: text("symbol_name").notNull(),
    displayName: text("display_name"),
    isin: text("isin"),
    series: text("series"),
    lotSize: integer("lot_size").default(1),
    tickSize: numeric("tick_size", { precision: 10, scale: 4 }),
    underlyingSecurityId: integer("underlying_security_id"),
    underlyingSymbol: text("underlying_symbol"),
    expiryDate: text("expiry_date"),
    strikePrice: numeric("strike_price", { precision: 12, scale: 2 }),
    optionType: text("option_type"),
    expiryFlag: text("expiry_flag"),
    upperLimit: numeric("upper_limit", { precision: 12, scale: 2 }),
    lowerLimit: numeric("lower_limit", { precision: 12, scale: 2 }),
    category: text("category"),
  },
  (t) => [
    uniqueIndex("instruments_security_id_exch_idx").on(t.securityId, t.exchId),
    index("instruments_symbol_name_idx").on(t.symbolName),
    index("instruments_underlying_symbol_idx").on(t.underlyingSymbol),
    index("instruments_instrument_idx").on(t.instrument),
    index("instruments_exch_segment_idx").on(t.exchId, t.segment),
  ]
);

export type Instrument = typeof instrumentsTable.$inferSelect;
export type InsertInstrument = typeof instrumentsTable.$inferInsert;
