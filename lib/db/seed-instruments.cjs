const xlsx = require("xlsx");
const { Pool } = require("pg");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FILES = [
  { file: "EQUITY_1776007657102.xlsx", instrument: "EQUITY" },
  { file: "FUTIDX_1776007657103.xlsx", instrument: "FUTIDX" },
  { file: "FUTSTK_1776007657103.xlsx", instrument: "FUTSTK" },
  { file: "INDEX_1776007657103.xlsx", instrument: "INDEX" },
  { file: "OPTFUT_1776007657103.xlsx", instrument: "OPTFUT" },
  { file: "OPTIDX_1776007657104.xlsx", instrument: "OPTIDX" },
  { file: "OPTSTK_1776007657104.xlsx", instrument: "OPTSTK" },
];

function parseNum(v) {
  if (v === null || v === undefined || v === "" || v === "NA" || v === "-") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function parseStr(v) {
  if (v === null || v === undefined || v === "" || v === "NA" || v === "-") return null;
  const s = String(v).trim();
  return s || null;
}

async function insertBatch(client, rows) {
  if (rows.length === 0) return;
  const values = [];
  const params = [];
  let idx = 1;
  for (const r of rows) {
    values.push(
      `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`
    );
    params.push(
      r.securityId, r.exchId, r.segment, r.instrument,
      r.symbolName, r.displayName, r.isin, r.series,
      r.lotSize, r.tickSize, r.underlyingSecurityId,
      r.underlyingSymbol, r.expiryDate, r.strikePrice,
      r.optionType, r.expiryFlag, r.upperLimit, r.lowerLimit
    );
  }
  const sql = `
    INSERT INTO instruments (
      security_id, exch_id, segment, instrument,
      symbol_name, display_name, isin, series,
      lot_size, tick_size, underlying_security_id,
      underlying_symbol, expiry_date, strike_price,
      option_type, expiry_flag, upper_limit, lower_limit
    ) VALUES ${values.join(",")}
    ON CONFLICT (security_id, exch_id) DO UPDATE SET
      symbol_name = EXCLUDED.symbol_name,
      display_name = EXCLUDED.display_name,
      lot_size = EXCLUDED.lot_size,
      tick_size = EXCLUDED.tick_size,
      expiry_date = EXCLUDED.expiry_date,
      strike_price = EXCLUDED.strike_price,
      option_type = EXCLUDED.option_type,
      expiry_flag = EXCLUDED.expiry_flag,
      upper_limit = EXCLUDED.upper_limit,
      lower_limit = EXCLUDED.lower_limit
  `;
  await client.query(sql, params);
}

async function main() {
  const client = await pool.connect();
  try {
    let grandTotal = 0;
    for (const { file, instrument } of FILES) {
      const filePath = path.join(ROOT, "attached_assets", file);
      console.log(`\nProcessing ${file}...`);
      const wb = xlsx.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
      const rows = data.slice(1);
      const BATCH = 500;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const mapped = batch
          .filter(r => r[2] != null)
          .map(r => ({
            securityId: Number(r[2]),
            exchId: parseStr(r[0]) || "NSE",
            segment: parseStr(r[1]) || "E",
            instrument,
            symbolName: parseStr(r[7]) || parseStr(r[6]) || String(r[2]),
            displayName: parseStr(r[8]),
            isin: parseStr(r[3]),
            series: parseStr(r[10]),
            lotSize: parseNum(r[11]) || 1,
            tickSize: parseNum(r[15]),
            underlyingSecurityId: parseNum(r[5]),
            underlyingSymbol: parseStr(r[6]),
            expiryDate: r[12] != null ? String(r[12]) : null,
            strikePrice: parseNum(r[13]),
            optionType: parseStr(r[14]),
            expiryFlag: parseStr(r[16]),
            upperLimit: parseNum(r[29]),
            lowerLimit: parseNum(r[30]),
          }));
        await insertBatch(client, mapped);
        inserted += mapped.length;
        if (i % 10000 === 0 || i + BATCH >= rows.length) {
          process.stdout.write(`  ${inserted}/${rows.length} rows\r`);
        }
      }
      console.log(`  ✓ ${instrument}: ${inserted} rows inserted          `);
      grandTotal += inserted;
    }
    console.log(`\n✅ Total instruments seeded: ${grandTotal}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
