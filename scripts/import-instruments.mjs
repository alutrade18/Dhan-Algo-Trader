import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const xlsx = require('xlsx');
const { Pool } = require(path.resolve(__dirname, '../node_modules/.pnpm/pg@8.20.0/node_modules/pg'));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FILES = [
  { file: 'attached_assets/NSE_EQUITY_1776077193698.xlsx',          category: 'NSE_EQUITY' },
  { file: 'attached_assets/NSE_FUTURE_INDEX_1776077272937.xlsx',     category: 'NSE_FUTURE_INDEX' },
  { file: 'attached_assets/NSE_OPTION_CHAIN_INDEX_1776077413557.xlsx', category: 'NSE_OPTION_CHAIN_INDEX' },
  { file: 'attached_assets/NSE_INDEX_1776077939767.xlsx',            category: 'NSE_INDEX' },
  { file: 'attached_assets/NSE_FUTURE_STOCK_1776078145255.xlsx',     category: 'NSE_FUTURE_STOCK' },
  { file: 'attached_assets/NSE_STOCK_OPTION__1776078289971.xlsx',    category: 'NSE_STOCK_OPTION' },
  { file: 'attached_assets/MCX_OPTION_FUTURE_1776078595043.xlsx',    category: 'MCX_OPTION_FUTURE' },
];

// Excel column indices (0-based) matching the header row
const COL = {
  EXCH_ID:                0,
  SEGMENT:                1,
  SECURITY_ID:            2,
  ISIN:                   3,
  INSTRUMENT:             4,
  UNDERLYING_SECURITY_ID: 5,
  UNDERLYING_SYMBOL:      6,
  SYMBOL_NAME:            7,
  DISPLAY_NAME:           8,
  INSTRUMENT_TYPE:        9,  // mapped to "series" field
  SERIES:                10,
  LOT_SIZE:              11,
  SM_EXPIRY_DATE:        12,
  STRIKE_PRICE:          13,
  OPTION_TYPE:           14,
  TICK_SIZE:             15,
  EXPIRY_FLAG:           16,
  SM_UPPER_LIMIT:        29,
  SM_LOWER_LIMIT:        30,
};

function toNum(v) {
  if (v === null || v === undefined || v === '' || v === 'NA') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toStr(v) {
  if (v === null || v === undefined || v === 'NA') return null;
  return String(v).trim() || null;
}

function toDate(v) {
  if (!v || v === 'NA' || v === '0001-01-01') return null;
  if (typeof v === 'number') {
    // Excel serial date
    const d = xlsx.SSF.parse_date_code(v);
    if (!d) return null;
    const month = String(d.m).padStart(2, '0');
    const day   = String(d.d).padStart(2, '0');
    return `${d.y}-${month}-${day}`;
  }
  return String(v).trim() || null;
}

function rowToRecord(row, category) {
  const expiryRaw = row[COL.SM_EXPIRY_DATE];
  return {
    exch_id:                String(row[COL.EXCH_ID] ?? '').trim(),
    segment:                String(row[COL.SEGMENT] ?? '').trim(),
    security_id:            Number(row[COL.SECURITY_ID]),
    isin:                   toStr(row[COL.ISIN]),
    instrument:             String(row[COL.INSTRUMENT] ?? '').trim(),
    underlying_security_id: toNum(row[COL.UNDERLYING_SECURITY_ID]),
    underlying_symbol:      toStr(row[COL.UNDERLYING_SYMBOL]),
    symbol_name:            String(row[COL.SYMBOL_NAME] ?? '').trim(),
    display_name:           toStr(row[COL.DISPLAY_NAME]),
    series:                 toStr(row[COL.SERIES]) ?? toStr(row[COL.INSTRUMENT_TYPE]),
    lot_size:               toNum(row[COL.LOT_SIZE]) ?? 1,
    expiry_date:            toDate(expiryRaw),
    strike_price:           toNum(row[COL.STRIKE_PRICE]),
    option_type:            toStr(row[COL.OPTION_TYPE]),
    tick_size:              toNum(row[COL.TICK_SIZE]),
    expiry_flag:            toStr(row[COL.EXPIRY_FLAG]),
    upper_limit:            toNum(row[COL.SM_UPPER_LIMIT]),
    lower_limit:            toNum(row[COL.SM_LOWER_LIMIT]),
    category,
  };
}

const BATCH = 500;

async function insertBatch(client, records) {
  if (records.length === 0) return;

  const cols = [
    'exch_id','segment','security_id','isin','instrument',
    'underlying_security_id','underlying_symbol','symbol_name','display_name',
    'series','lot_size','expiry_date','strike_price','option_type',
    'tick_size','expiry_flag','upper_limit','lower_limit','category',
  ];

  const placeholders = [];
  const values = [];
  let idx = 1;
  for (const r of records) {
    const rowPlaceholders = cols.map(() => `$${idx++}`);
    placeholders.push(`(${rowPlaceholders.join(',')})`);
    for (const col of cols) values.push(r[col] ?? null);
  }

  const sql = `
    INSERT INTO instruments (${cols.join(',')})
    VALUES ${placeholders.join(',')}
    ON CONFLICT (security_id, exch_id) DO UPDATE SET
      instrument = EXCLUDED.instrument,
      category = EXCLUDED.category,
      display_name = EXCLUDED.display_name,
      symbol_name = EXCLUDED.symbol_name,
      lot_size = EXCLUDED.lot_size,
      expiry_date = EXCLUDED.expiry_date,
      upper_limit = EXCLUDED.upper_limit,
      lower_limit = EXCLUDED.lower_limit,
      expiry_flag = EXCLUDED.expiry_flag
  `;
  await client.query(sql, values);
}

async function main() {
  const client = await pool.connect();
  let grandTotal = 0;
  try {
    for (const { file, category } of FILES) {
      console.log(`\nImporting ${category} from ${file}...`);
      const wb = xlsx.readFile(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true });
      const rows = data.slice(1); // skip header
      const records = rows
        .filter(r => r[COL.SECURITY_ID] && r[COL.EXCH_ID])
        .map(r => rowToRecord(r, category));

      let inserted = 0;
      for (let i = 0; i < records.length; i += BATCH) {
        await insertBatch(client, records.slice(i, i + BATCH));
        inserted += Math.min(BATCH, records.length - i);
        process.stdout.write(`\r  ${inserted}/${records.length} rows...`);
      }
      console.log(`\n  ✓ ${category}: ${records.length} rows`);
      grandTotal += records.length;
    }
    console.log(`\n✓ Total imported: ${grandTotal} rows`);

    // Verify counts by category
    const result = await client.query(
      `SELECT category, COUNT(*) as cnt FROM instruments GROUP BY category ORDER BY category`
    );
    console.log('\nDB verification:');
    result.rows.forEach(r => console.log(`  ${r.category}: ${r.cnt}`));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
