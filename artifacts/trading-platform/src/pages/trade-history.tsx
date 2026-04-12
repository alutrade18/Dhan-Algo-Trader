import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

function toYMD(date: Date) {
  return date.toISOString().slice(0, 10);
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function formatDisplayDate(raw: string): string {
  if (!raw || raw === "—") return "—";
  const d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  return raw;
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

export default function TradeHistory() {
  const [fromDate, setFromDate] = useState(toYMD(daysAgo(29)));
  const [toDate, setToDate] = useState(toYMD(new Date()));
  const [ledgerData, setLedgerData] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFetched(true);
    try {
      const res = await fetch(
        `${BASE}api/trades/ledger?fromDate=${fromDate}&toDate=${toDate}`
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Failed to load ledger");
      }
      const data = await res.json() as LedgerEntry[] | { data?: LedgerEntry[] };
      setLedgerData(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLedgerData([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  function exportCSV() {
    if (!ledgerData.length) return;
    const headers = ["Date", "Narration", "Exchange", "Voucher Desc", "Voucher No.", "Debit", "Credit", "Balance"];
    const rows = ledgerData.map(r => [
      formatDisplayDate(String(r.voucherdate ?? "")),
      String(r.narration ?? ""),
      String(r.exchange ?? ""),
      String(r.voucherdesc ?? ""),
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

  const totalDebit = ledgerData.reduce((s, r) => s + Number(String(r.debit ?? "0").replace(/,/g, "")), 0);
  const totalCredit = ledgerData.reduce((s, r) => s + Number(String(r.credit ?? "0").replace(/,/g, "")), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-foreground">
        Account credit and debit details fetched live from Dhan
      </p>

      {/* ── Controls ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">From</span>
        <Input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          max={toDate}
          className="w-36 text-xs font-mono h-9"
        />
        <span className="text-xs text-muted-foreground">To</span>
        <Input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          max={toYMD(new Date())}
          className="w-36 text-xs font-mono h-9"
        />
        <Button size="sm" className="gap-1.5 h-9" onClick={fetchLedger} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Fetch Ledger"}
        </Button>
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
                const debit = Number(String(row.debit ?? "0").replace(/,/g, ""));
                const credit = Number(String(row.credit ?? "0").replace(/,/g, ""));
                const balance = Number(String(row.runbal ?? "0").replace(/,/g, ""));
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
