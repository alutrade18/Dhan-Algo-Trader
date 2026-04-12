import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Download, TrendingUp, TrendingDown, BookOpen, ScrollText } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

interface Trade {
  orderId?: string;
  exchangeOrderId?: string;
  tradingSymbol?: string;
  transactionType?: string;
  quantity?: number;
  tradedPrice?: number;
  exchangeTime?: string;
  exchangeSegment?: string;
  productType?: string;
  brokerage?: number;
  [key: string]: unknown;
}

interface LedgerEntry {
  voucherdate?: string;
  narration?: string;
  exchange?: string;
  voucherno?: string;
  debit?: string;
  credit?: string;
  runbal?: string;
  [key: string]: unknown;
}

export default function TradeHistory() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [submitted, setSubmitted] = useState({ from: monthAgo(), to: today() });
  const [page, setPage] = useState(0);

  const { data: trades = [], isLoading: tradesLoading, refetch: refetchTrades, isFetching: tradesFetching } = useQuery<Trade[]>({
    queryKey: ["trade-history", submitted.from, submitted.to, page],
    queryFn: async () => {
      const url = `${BASE}api/trades/history?fromDate=${submitted.from}&toDate=${submitted.to}&page=${page}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { errorMessage?: string; error?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Failed");
      }
      return res.json() as Promise<Trade[]>;
    },
    staleTime: 60000,
  });

  const [ledgerFrom, setLedgerFrom] = useState(monthAgo());
  const [ledgerTo, setLedgerTo] = useState(today());
  const [ledgerData, setLedgerData] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);

  const fetchLedger = async () => {
    setLedgerLoading(true);
    setLedgerError(null);
    try {
      const res = await fetch(`${BASE}api/trades/ledger?from=${ledgerFrom}&to=${ledgerTo}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Failed to load ledger");
      }
      const data = await res.json() as LedgerEntry[] | { data?: LedgerEntry[] };
      setLedgerData(Array.isArray(data) ? data : (data.data ?? []));
    } catch (e: unknown) {
      setLedgerError(e instanceof Error ? e.message : "Unknown error");
      setLedgerData([]);
    } finally {
      setLedgerLoading(false);
    }
  };

  function handleSearch() {
    setSubmitted({ from, to });
    setPage(0);
  }

  function exportCSV(data: Record<string, unknown>[], filename: string) {
    if (!data.length) return;
    const keys = Object.keys(data[0]);
    const csv = [keys.join(","), ...data.map(row => keys.map(k => JSON.stringify(row[k] ?? "")).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalBuy = trades.filter(t => t.transactionType === "BUY").length;
  const totalSell = trades.filter(t => t.transactionType === "SELL").length;
  const totalCharges = trades.reduce((sum, t) => sum + Number(t.brokerage ?? 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-foreground">
        View executed trades and ledger entries from Dhan
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">From</div>
        <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36 text-xs font-mono" max={to} />
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">To</div>
        <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36 text-xs font-mono" max={today()} />
        <Button size="sm" className="gap-1.5" onClick={handleSearch} disabled={tradesLoading}>
          <Search className="w-3.5 h-3.5" /> Search
        </Button>
      </div>

      <Tabs defaultValue="trades">
        <TabsList className="h-8">
          <TabsTrigger value="trades" className="text-xs gap-1.5 px-3">
            <BookOpen className="w-3.5 h-3.5" /> Trade History
          </TabsTrigger>
          <TabsTrigger value="ledger" className="text-xs gap-1.5 px-3">
            <ScrollText className="w-3.5 h-3.5" /> Ledger
          </TabsTrigger>
        </TabsList>

        <TabsContent value="trades" className="space-y-3 mt-3">
          {trades.length > 0 && (
            <div className="flex items-center gap-4 flex-wrap text-xs">
              <span className="text-muted-foreground">Total Trades: <span className="text-foreground font-semibold">{trades.length}</span></span>
              <span className="text-emerald-400">BUY: {totalBuy}</span>
              <span className="text-red-400">SELL: {totalSell}</span>
              {totalCharges > 0 && <span className="text-muted-foreground">Total Charges: <span className="text-red-400 font-mono">₹{totalCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></span>}
              <Button
                variant="outline" size="sm" className="ml-auto gap-1.5 h-7 text-xs"
                onClick={() => exportCSV(trades as Record<string, unknown>[], `trades_${submitted.from}_${submitted.to}.csv`)}
              >
                <Download className="w-3 h-3" /> Export CSV
              </Button>
            </div>
          )}

          {tradesLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : trades.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No trades found for selected period.</CardContent></Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Time", "Symbol", "Exchange", "Side", "Product", "Qty", "Price", "Brokerage"].map(h => (
                        <th key={h} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${["Qty", "Price", "Brokerage"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, i) => {
                      const side = String(t.transactionType ?? "");
                      return (
                        <tr key={String(t.orderId ?? i)} className="border-b border-border/50 hover:bg-muted/20">
                          <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{String(t.exchangeTime ?? "—").slice(0, 19).replace("T", " ")}</td>
                          <td className="px-3 py-2 text-xs font-mono font-semibold">{t.tradingSymbol ?? "—"}</td>
                          <td className="px-3 py-2 text-xs">
                            <Badge variant="outline" className="text-[10px]">{t.exchangeSegment ?? "—"}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            {side === "BUY"
                              ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium"><TrendingUp className="w-3 h-3" />BUY</span>
                              : <span className="flex items-center gap-1 text-red-400 text-xs font-medium"><TrendingDown className="w-3 h-3" />SELL</span>}
                          </td>
                          <td className="px-3 py-2 text-xs">{t.productType ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">{t.quantity ?? "—"}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs">₹{Number(t.tradedPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                          <td className="px-3 py-2 text-right font-mono text-xs text-red-400/80">
                            {Number(t.brokerage ?? 0) > 0 ? `₹${Number(t.brokerage).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Prev</Button>
                <span className="text-xs text-muted-foreground">Page {page + 1}</span>
                <Button variant="outline" size="sm" className="h-7 text-xs" disabled={trades.length < 50} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="ledger" className="space-y-3 mt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">From</div>
            <Input type="date" value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} className="w-36 text-xs font-mono" max={ledgerTo} />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">To</div>
            <Input type="date" value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} className="w-36 text-xs font-mono" max={today()} />
            <Button size="sm" className="gap-1.5" onClick={fetchLedger} disabled={ledgerLoading}>
              <Search className="w-3.5 h-3.5" /> {ledgerLoading ? "Loading..." : "Fetch Ledger"}
            </Button>
            <Button
              variant="outline" size="sm" className="gap-1.5 h-8 text-xs ml-auto"
              onClick={() => exportCSV(ledgerData as Record<string, unknown>[], `ledger_${ledgerFrom}_${ledgerTo}.csv`)}
              disabled={ledgerData.length === 0}
            >
              <Download className="w-3 h-3" /> Export CSV
            </Button>
          </div>

          {ledgerError && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-4 text-center text-sm text-destructive">{ledgerError}</CardContent>
            </Card>
          )}

          {ledgerLoading ? (
            <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : ledgerData.length === 0 && !ledgerError ? (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Select a date range and click Fetch Ledger to view your account statement.
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full table-auto text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Date", "Narration", "Voucher", "Debit", "Credit", "Balance"].map(h => (
                      <th key={h} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${["Debit", "Credit", "Balance"].includes(h) ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerData.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 text-xs font-mono text-muted-foreground">{String(row.voucherdate ?? "—")}</td>
                      <td className="px-3 py-2 text-xs max-w-[200px] truncate">{String(row.narration ?? "—")}</td>
                      <td className="px-3 py-2 text-xs font-mono">{String(row.voucherno ?? "—")}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-red-400">
                        {Number(String(row.debit ?? "0").replace(/,/g, "")) > 0 ? `₹${Number(String(row.debit).replace(/,/g, "")).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400">
                        {Number(String(row.credit ?? "0").replace(/,/g, "")) > 0 ? `₹${Number(String(row.credit).replace(/,/g, "")).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{String(row.runbal ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
