import { useState, useCallback, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, Wallet, CalendarIcon } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

/** Today's date in IST (UTC+5:30) formatted as YYYY-MM-DD */
function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function toYMD(date: Date) {
  return date.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** YYYY-MM-DD → DD-MM-YYYY */
function ymdToDisplay(ymd: string): string {
  if (!ymd || ymd.length !== 10) return ymd;
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}

/** DD-MM-YYYY → YYYY-MM-DD, returns "" if invalid */
function displayToYmd(display: string): string {
  const parts = display.trim().replace(/\//g, "-").split("-");
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  if (y.length !== 4) return "";
  const ymd = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isNaN(new Date(ymd).getTime()) ? "" : ymd;
}

/** Controlled date input: shows DD-MM-YYYY text + calendar icon opens native picker */
function DateField({
  value, onChange, min, max,
}: { value: string; onChange: (ymd: string) => void; min?: string; max?: string }) {
  const [text, setText] = useState(() => ymdToDisplay(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // Sync text when parent value changes (e.g. midnight auto-update)
  useEffect(() => {
    setText(ymdToDisplay(value));
  }, [value]);

  function commit(raw: string) {
    const ymd = displayToYmd(raw);
    if (!ymd) { setText(ymdToDisplay(value)); return; }
    if (min && ymd < min) { setText(ymdToDisplay(value)); return; }
    if (max && ymd > max) { setText(ymdToDisplay(value)); return; }
    onChange(ymd);
    setText(ymdToDisplay(ymd));
  }

  return (
    <div className="relative flex items-center">
      <Input
        type="text"
        value={text}
        placeholder="DD-MM-YYYY"
        maxLength={10}
        className="w-36 text-xs font-mono h-9 pr-8"
        onChange={e => setText(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      />
      {/* Calendar icon triggers the hidden native date picker */}
      <button
        type="button"
        className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => pickerRef.current?.showPicker()}
        tabIndex={-1}
      >
        <CalendarIcon className="w-3.5 h-3.5" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => { onChange(e.target.value); setText(ymdToDisplay(e.target.value)); }}
        className="sr-only absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
        tabIndex={-1}
      />
    </div>
  );
}

function formatDisplayDate(raw: string): string {
  if (!raw || raw === "—") return "—";
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  return "—";
}

function parseAmount(val: string | undefined): number {
  return Number(String(val ?? "0").replace(/,/g, ""));
}

interface LedgerEntry {
  dhanClientId?: string;
  narration?: string;
  voucherdate?: string;
  exchange?: string;
  voucherdesc?: string;
  vouchernumber?: string;
  debit?: string;
  credit?: string;
  runbal?: string;
  [key: string]: unknown;
}

function isSummaryRow(row: LedgerEntry): boolean {
  const narr = String(row.narration ?? "").toUpperCase();
  return narr.includes("OPENING BALANCE") || narr.includes("CLOSING BALANCE");
}

function isClosingBalance(row: LedgerEntry): boolean {
  return String(row.narration ?? "").toUpperCase().includes("CLOSING BALANCE");
}

export default function TradeHistory() {
  const [today, setToday] = useState<string>(getTodayIST);
  const [fromDate, setFromDate] = useState(toYMD(daysAgo(29)));
  const [toDate, setToDate] = useState<string>(getTodayIST);
  const [ledgerData, setLedgerData] = useState<LedgerEntry[]>([]);
  const [closingBalance, setClosingBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  // Auto-update today every minute; when the date rolls over at midnight,
  // also advance toDate if the user hadn't changed it from yesterday's today.
  useEffect(() => {
    const id = setInterval(() => {
      const newToday = getTodayIST();
      setToday(prev => {
        if (prev !== newToday) {
          setToDate(prevTo => (prevTo === prev ? newToday : prevTo));
          return newToday;
        }
        return prev;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFetched(true);
    setClosingBalance(null);
    try {
      const res = await fetch(
        `${BASE}api/trades/ledger?fromDate=${fromDate}&toDate=${toDate}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Failed to load ledger");
      }
      const data = await res.json() as LedgerEntry[] | { data?: LedgerEntry[] };
      const all: LedgerEntry[] = Array.isArray(data) ? data : (data.data ?? []);

      const closingRow = all.find(isClosingBalance);
      if (closingRow) {
        const cb = parseAmount(closingRow.credit) || parseAmount(closingRow.runbal);
        setClosingBalance(cb);
      }

      setLedgerData(all.filter(r => !isSummaryRow(r)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLedgerData([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  function exportCSV() {
    if (!ledgerData.length) return;
    const headers = ["Date", "Narration", "Exchange", "Voucher No.", "Debit", "Credit", "Balance"];
    const rows = ledgerData.map(r => [
      formatDisplayDate(String(r.voucherdate ?? "")),
      String(r.narration ?? ""),
      String(r.exchange ?? ""),
      String(r.vouchernumber ?? ""),
      String(r.debit ?? "0"),
      String(r.credit ?? "0"),
      String(r.runbal ?? ""),
    ]);
    const csv = [headers, ...rows].map(row => row.map(v => JSON.stringify(v)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ledger_${fromDate}_to_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const totalDebit = ledgerData.reduce((s, r) => s + parseAmount(r.debit), 0);
  const totalCredit = ledgerData.reduce((s, r) => s + parseAmount(r.credit), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-foreground">
        Account credit and debit details fetched live from Dhan
      </p>

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">From</span>
        <DateField value={fromDate} onChange={setFromDate} max={toDate} />
        <span className="text-xs text-muted-foreground">To</span>
        <DateField value={toDate} onChange={setToDate} min={fromDate} max={today} />
        <Button size="sm" className="gap-1.5 h-9" onClick={fetchLedger} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Fetch Ledger"}
        </Button>

        {/* Closing balance pill — appears after fetch */}
        {closingBalance !== null && (
          <div className="flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 h-9 text-xs">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-muted-foreground">Closing Balance:</span>
            <span className="font-mono font-semibold text-emerald-400">
              ₹{closingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-9 ml-auto"
          onClick={exportCSV}
          disabled={ledgerData.length === 0}
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </Button>
      </div>

      {/* ── Summary row ── */}
      {ledgerData.length > 0 && (
        <div className="flex items-center gap-6 text-xs flex-wrap">
          <span className="text-muted-foreground">
            Entries: <span className="text-foreground font-semibold">{ledgerData.length}</span>
          </span>
          <span>
            Total Credit:{" "}
            <span className="text-emerald-400 font-mono font-semibold">
              ₹{totalCredit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span>
            Total Debit:{" "}
            <span className="text-red-400 font-mono font-semibold">
              ₹{totalDebit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
            </span>
          </span>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-center text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : ledgerData.length === 0 && !error ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {fetched
              ? "No ledger entries found for the selected period."
              : "Select a date range and click Fetch Ledger to view your account statement."}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full table-auto text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  { label: "Date", right: false },
                  { label: "Narration", right: false },
                  { label: "Exchange", right: false },
                  { label: "Voucher No.", right: false },
                  { label: "Debit", right: true },
                  { label: "Credit", right: true },
                  { label: "Balance", right: true },
                ].map(h => (
                  <th
                    key={h.label}
                    className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${h.right ? "text-right" : "text-left"}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledgerData.map((row, i) => {
                const debit = parseAmount(row.debit);
                const credit = parseAmount(row.credit);
                const balance = parseAmount(row.runbal);
                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {formatDisplayDate(String(row.voucherdate ?? ""))}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[220px] truncate" title={String(row.narration ?? "")}>
                      {String(row.narration ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {String(row.exchange ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                      {String(row.vouchernumber ?? "—")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-red-400 whitespace-nowrap">
                      {debit > 0
                        ? `₹${debit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400 whitespace-nowrap">
                      {credit > 0
                        ? `₹${credit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
                        : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-xs whitespace-nowrap ${balance >= 0 ? "text-foreground" : "text-red-400"}`}>
                      ₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
