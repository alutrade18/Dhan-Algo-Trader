import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { marketSocket } from "@/lib/market-socket";
import { RefreshCw, LogOut, TrendingUp, TrendingDown, Minus, AlertCircle, ShieldX } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
const fmt  = (v?: number | null) => v == null ? "—" : INR.format(v);
const pct  = (p: number, base: number) =>
  base !== 0 ? `${p >= 0 ? "+" : ""}${((p / Math.abs(base)) * 100).toFixed(2)}%` : "";

interface DhanPosition {
  dhanClientId?: string;
  tradingSymbol?: string;
  securityId?: string;
  positionType?: "LONG" | "SHORT" | "CLOSED";
  exchangeSegment?: string;
  productType?: string;
  buyAvg?: number;
  buyQty?: number;
  costPrice?: number;
  sellAvg?: number;
  sellQty?: number;
  netQty?: number;
  realizedProfit?: number;
  unrealizedProfit?: number;
  multiplier?: number;
  carryForwardBuyQty?: number;
  carryForwardSellQty?: number;
  carryForwardBuyValue?: number;
  carryForwardSellValue?: number;
  dayBuyQty?: number;
  daySellQty?: number;
  dayBuyValue?: number;
  daySellValue?: number;
  drvExpiryDate?: string;
  drvOptionType?: "CALL" | "PUT" | null;
  drvStrikePrice?: number;
  crossCurrency?: boolean;
}

// Data API limit: 10/s, 1000/min, 5000/hr — poll every 5 s during market hours only
const REFETCH_MS         = 5_000;
const REFRESH_COOLDOWN   = 2_000;

const isClosed      = (p: DhanPosition) => (p.netQty ?? 0) === 0 || p.positionType === "CLOSED";
const isIntraday    = (p: DhanPosition) => !isClosed(p) && ["INTRADAY", "MARGIN", "MTF"].includes(p.productType ?? "");
const isCarryForward= (p: DhanPosition) => !isClosed(p) && (p.productType === "CNC" || (p.carryForwardBuyQty ?? 0) + (p.carryForwardSellQty ?? 0) > 0);

function expiryLabel(d?: string) {
  if (!d || d.startsWith("0001")) return null;
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

type TabKey = "open" | "intraday" | "carryforward" | "closed";

export default function Positions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ltpMap, setLtpMap] = useState<Record<string, number>>({});
  const [exiting, setExiting] = useState<Record<string, boolean>>({});
  const [exitingAll, setExitingAll] = useState(false);
  const [tab, setTab] = useState<TabKey>("open");
  const [cooling, setCooling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  // Shared health cache (same key as app-layout — no extra fetch)
  const { data: healthRaw } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 25_000 } });
  const _h = healthRaw as unknown as { nseOpen?: boolean; mcxOpen?: boolean } | undefined;
  const anyMarketOpen = (_h?.nseOpen ?? false) || (_h?.mcxOpen ?? false);

  const [brokerAuthError, setBrokerAuthError] = useState(false);
  const { data: positions = [], isLoading, isError, dataUpdatedAt } = useQuery<DhanPosition[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/positions`);
      if (res.status === 401) {
        setBrokerAuthError(true);
        return [];
      }
      setBrokerAuthError(false);
      if (!res.ok) throw new Error("Failed");
      const raw = await res.json();
      return Array.isArray(raw) ? raw : [];
    },
    // Gate auto-refresh on market status — no need to poll when market is closed
    refetchInterval: anyMarketOpen ? REFETCH_MS : false,
  });

  useEffect(() => { if (dataUpdatedAt) setLastUpdated(new Date(dataUpdatedAt)); }, [dataUpdatedAt]);

  // Live LTP websocket subscriptions for all open positions
  useEffect(() => {
    unsubsRef.current.forEach(u => u());
    unsubsRef.current = [];
    positions.filter(p => !isClosed(p)).forEach(pos => {
      if (!pos.securityId || !pos.exchangeSegment) return;
      const unsub = marketSocket.subscribe(pos.exchangeSegment, Number(pos.securityId), tick => {
        setLtpMap(prev => ({ ...prev, [pos.securityId!]: tick.ltp }));
      }, "ticker");
      unsubsRef.current.push(unsub);
    });
    return () => { unsubsRef.current.forEach(u => u()); unsubsRef.current = []; };
  }, [positions.length]);

  const handleRefresh = useCallback(() => {
    if (cooling) return;
    queryClient.invalidateQueries({ queryKey: ["positions"] });
    setCooling(true);
    setTimeout(() => setCooling(false), REFRESH_COOLDOWN);
  }, [cooling, queryClient]);

  const calcLivePnl = (pos: DhanPosition, ltp: number) => {
    const qty  = pos.netQty ?? 0;
    const mult = pos.multiplier ?? 1;
    if (qty > 0) return (ltp - (pos.buyAvg  ?? 0)) * qty          * mult;
    if (qty < 0) return ((pos.sellAvg ?? 0) - ltp) * Math.abs(qty)* mult;
    return 0;
  };

  const getLtp        = (pos: DhanPosition) => ltpMap[pos.securityId ?? ""] ?? null;
  const getUnrealized = (pos: DhanPosition) => {
    const ltp = getLtp(pos);
    return ltp != null ? calcLivePnl(pos, ltp) : (pos.unrealizedProfit ?? null);
  };
  const getAvg = (pos: DhanPosition) => (pos.netQty ?? 0) >= 0 ? (pos.buyAvg ?? 0) : (pos.sellAvg ?? 0);

  const exitSingle = async (pos: DhanPosition) => {
    const key = pos.securityId ?? "";
    setExiting(prev => ({ ...prev, [key]: true }));
    try {
      const res = await fetch(`${BASE}api/positions/exit-single`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: pos.securityId, exchangeSegment: pos.exchangeSegment,
          productType: pos.productType === "CNC" ? "CNC" : "INTRADAY",
          quantity: Math.abs(pos.netQty ?? 0),
          transactionType: (pos.netQty ?? 0) > 0 ? "SELL" : "BUY",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errorMessage ?? data.error ?? "Exit failed");
      toast({ title: "Exit order placed", description: `${pos.tradingSymbol} — Order #${data.orderId}` });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["positions"] }), 2500);
    } catch (e: unknown) {
      toast({ title: "Exit failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setExiting(prev => ({ ...prev, [key]: false }));
    }
  };

  const exitAll = async () => {
    setExitingAll(true);
    try {
      const res  = await fetch(`${BASE}api/positions`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ title: "Exit All sent", description: data.message ?? "Square-off orders placed for all intraday positions." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["positions"] }), 3000);
    } catch (e: unknown) {
      toast({ title: "Exit All failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setExitingAll(false);
    }
  };

  // Partition
  const openAll  = positions.filter(p => !isClosed(p));
  const intraday = positions.filter(isIntraday);
  const carryFwd = positions.filter(isCarryForward);
  const closed   = positions.filter(isClosed);

  const tabRows: Record<TabKey, DhanPosition[]> = { open: openAll, intraday, carryforward: carryFwd, closed };
  const rows = tabRows[tab];

  // Totals
  const totalUnrealized = openAll.reduce((s, p) => s + (getUnrealized(p) ?? 0), 0);
  const totalRealized   = positions.reduce((s, p) => s + (p.realizedProfit ?? 0), 0);
  const totalPnl        = totalUnrealized + totalRealized;

  const pnlColor = (v: number) => v >= 0 ? "text-success" : "text-destructive";

  return (
    <div className="flex flex-col gap-4">

      {/* ── Exit All Hero Banner (shown when any open position exists) ── */}
      {openAll.length > 0 && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-3.5">
          <div className="flex items-start gap-3 min-w-0">
            <ShieldX className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Exit All Positions</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Squares off all <span className="font-semibold text-foreground">{openAll.length}</span> open position{openAll.length !== 1 ? "s" : ""} for the current trading day. Does not cancel pending orders.
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="gap-1.5 shrink-0 h-9 px-4 font-semibold" disabled={exitingAll}>
                <LogOut className="h-4 w-4" />
                {exitingAll ? "Exiting All…" : "Exit All Positions"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2"><ShieldX className="w-5 h-5 text-destructive" />Exit All Positions?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will place MARKET orders to square off all <strong>{openAll.length}</strong> open position{openAll.length !== 1 ? "s" : ""} immediately.
                  Pending orders are <strong>not</strong> cancelled. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={exitAll} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Yes, Exit All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-4 divide-x divide-border rounded-lg border bg-card overflow-hidden">
        {[
          { label: "Unrealized P&L",     value: totalUnrealized, note: "Live · open positions" },
          { label: "Realized P&L",        value: totalRealized,   note: "Booked today" },
          { label: "Total P&L",           value: totalPnl,        note: "Unrealized + Realized" },
        ].map(({ label, value, note }) => (
          <div key={label} className="px-5 py-3">
            <p className="text-[11px] text-muted-foreground mb-1">{label}</p>
            <p className={cn("text-base font-mono font-bold tabular-nums", pnlColor(value))}>{fmt(value)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{note}</p>
          </div>
        ))}
        <div className="px-5 py-3">
          <p className="text-[11px] text-muted-foreground mb-1">Open Positions</p>
          <p className="text-base font-mono font-bold tabular-nums">{openAll.length}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {intraday.length} intraday · {carryFwd.length} carryforward
          </p>
        </div>
      </div>

      {/* ── Error banner ── */}
      {brokerAuthError && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-4 py-2 text-sm text-warning">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Broker not connected — enter your Dhan credentials in{" "}
          <a href="../settings" className="underline font-medium hover:no-underline">Settings</a>{" "}
          to view positions.
        </div>
      )}
      {isError && !brokerAuthError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to fetch positions from Dhan. Retrying in {REFETCH_MS / 1000}s…
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={v => setTab(v as TabKey)}>
          <TabsList className="h-8">
            <TabsTrigger value="open"        className="text-xs px-3 gap-1">All Open        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-sm">{openAll.length}</Badge></TabsTrigger>
            <TabsTrigger value="intraday"    className="text-xs px-3 gap-1">Intraday        <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-sm">{intraday.length}</Badge></TabsTrigger>
            <TabsTrigger value="carryforward"className="text-xs px-3 gap-1">Carryforward    <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-sm">{carryFwd.length}</Badge></TabsTrigger>
            <TabsTrigger value="closed"      className="text-xs px-3 gap-1">Closed          <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-sm">{closed.length}</Badge></TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground hidden md:inline">
              Updated {lastUpdated.toLocaleTimeString("en-IN")}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={handleRefresh} disabled={cooling || isLoading}>
            <RefreshCw className={cn("h-3.5 w-3.5", (isLoading || cooling) && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border hover:bg-transparent">
              <TableHead className="text-xs font-semibold whitespace-nowrap pl-4">Symbol</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Exchange</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap">Product</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-center">Side</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">Net Qty</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">Avg Price</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">LTP</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">Day Qty</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">Unrealized P&L</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right">Realized P&L</TableHead>
              <TableHead className="text-xs font-semibold whitespace-nowrap text-right pr-4">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((_, j) => (
                    <TableCell key={j} className={j === 0 ? "pl-4" : j === 10 ? "pr-4" : ""}>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-14 text-muted-foreground text-sm">
                  No {tab === "closed" ? "closed" : "open"} positions
                </TableCell>
              </TableRow>
            ) : (
              rows.map((pos, idx) => {
                const key      = `${pos.securityId}-${idx}`;
                const ltp      = getLtp(pos);
                const unreal   = getUnrealized(pos);
                const qty      = pos.netQty ?? 0;
                const avg      = getAvg(pos);
                const isLong   = qty >= 0;
                const closed_  = isClosed(pos);
                const canExit  = !closed_;
                const exiting_ = exiting[pos.securityId ?? ""];
                const expiry   = expiryLabel(pos.drvExpiryDate);
                const strike   = (pos.drvStrikePrice ?? 0) > 0 ? pos.drvStrikePrice : null;
                const optType  = pos.drvOptionType;
                const dayQty   = (pos.dayBuyQty ?? 0) > 0 || (pos.daySellQty ?? 0) > 0
                  ? `B:${pos.dayBuyQty ?? 0} / S:${pos.daySellQty ?? 0}` : "—";

                return (
                  <TableRow key={key} className={cn("text-xs border-b border-border/50 last:border-0", closed_ && "opacity-40")}>

                    {/* Symbol */}
                    <TableCell className="pl-4 font-mono font-semibold whitespace-nowrap">
                      <div className="leading-tight">{pos.tradingSymbol ?? "—"}</div>
                      {(expiry || strike || optType) && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {optType && (
                            <span className={cn("text-[9px] font-bold px-1 rounded border", optType === "CALL" ? "border-success/40 text-success" : "border-destructive/40 text-destructive")}>
                              {optType === "CALL" ? "CE" : "PE"}
                            </span>
                          )}
                          {strike && <span className="text-[10px] text-muted-foreground">₹{strike.toLocaleString("en-IN")}</span>}
                          {expiry && <span className="text-[10px] text-muted-foreground">{expiry}</span>}
                        </div>
                      )}
                    </TableCell>

                    {/* Exchange */}
                    <TableCell className="whitespace-nowrap">
                      <span className="text-[10px] text-muted-foreground font-mono tracking-tight">
                        {pos.exchangeSegment?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </TableCell>

                    {/* Product */}
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono h-4">
                        {pos.productType ?? "—"}
                      </Badge>
                    </TableCell>

                    {/* Side */}
                    <TableCell className="text-center whitespace-nowrap">
                      {closed_ ? (
                        <span className="inline-flex items-center gap-0.5 text-muted-foreground">
                          <Minus className="h-3 w-3" /> CLOSED
                        </span>
                      ) : isLong ? (
                        <span className="inline-flex items-center gap-0.5 text-success font-semibold">
                          <TrendingUp className="h-3 w-3" /> LONG
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-destructive font-semibold">
                          <TrendingDown className="h-3 w-3" /> SHORT
                        </span>
                      )}
                    </TableCell>

                    {/* Net Qty */}
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {Math.abs(qty)}
                    </TableCell>

                    {/* Avg Price */}
                    <TableCell className="text-right font-mono whitespace-nowrap">{fmt(avg)}</TableCell>

                    {/* LTP */}
                    <TableCell className="text-right font-mono whitespace-nowrap">
                      {closed_ ? (
                        <span className="text-muted-foreground">—</span>
                      ) : ltp != null ? (
                        <span className={cn(ltp > avg ? "text-success" : ltp < avg ? "text-destructive" : "")}>{fmt(ltp)}</span>
                      ) : (
                        <span className="text-muted-foreground animate-pulse text-[10px]">live…</span>
                      )}
                    </TableCell>

                    {/* Day Qty */}
                    <TableCell className="text-right font-mono whitespace-nowrap text-muted-foreground">
                      {dayQty}
                    </TableCell>

                    {/* Unrealized P&L */}
                    <TableCell className="text-right whitespace-nowrap">
                      {closed_ ? (
                        <span className="text-muted-foreground">—</span>
                      ) : unreal == null ? (
                        <span className="text-muted-foreground animate-pulse text-[10px]">live…</span>
                      ) : (
                        <div className={cn("font-mono font-medium", pnlColor(unreal))}>
                          {fmt(unreal)}
                          {avg !== 0 && qty !== 0 && (
                            <div className="text-[9px] opacity-70">{pct(unreal, avg * Math.abs(qty))}</div>
                          )}
                        </div>
                      )}
                    </TableCell>

                    {/* Realized P&L */}
                    <TableCell className="text-right whitespace-nowrap">
                      <span className={cn("font-mono font-medium", pnlColor(pos.realizedProfit ?? 0))}>
                        {fmt(pos.realizedProfit ?? 0)}
                      </span>
                    </TableCell>

                    {/* Action */}
                    <TableCell className="text-right pr-4 whitespace-nowrap">
                      {canExit ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" size="sm" disabled={exiting_}
                              className="h-6 text-[10px] px-2.5 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground hover:border-destructive gap-1">
                              <LogOut className="h-3 w-3" />
                              {exiting_ ? "…" : "Exit"}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="max-w-sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="flex items-center gap-2">
                                <LogOut className="w-4 h-4 text-destructive" />Exit {pos.tradingSymbol}?
                              </AlertDialogTitle>
                              <AlertDialogDescription asChild>
                                <div className="space-y-2 text-sm text-muted-foreground">
                                  <p>Places a <strong className="text-foreground">MARKET {isLong ? "SELL" : "BUY"}</strong> order for{" "}
                                    <strong className="text-foreground">{Math.abs(qty)} qty</strong> of{" "}
                                    <strong className="text-foreground">{pos.tradingSymbol}</strong> at market price.</p>
                                  <div className="flex gap-3 text-xs border border-border/50 rounded-lg px-3 py-2 bg-muted/20">
                                    <span>Product: <strong>{pos.productType}</strong></span>
                                    <span>Side: <strong className={isLong ? "text-success" : "text-destructive"}>{isLong ? "LONG → SELL" : "SHORT → BUY"}</strong></span>
                                    {ltp != null && <span>LTP: <strong>₹{ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</strong></span>}
                                  </div>
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => exitSingle(pos)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                Yes, Exit Position
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Carryforward detail ── */}
      {(tab === "open" || tab === "carryforward") && carryFwd.length > 0 && (
        <div className="rounded-lg border bg-card/50 p-4">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
            Carryforward Detail
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  {["Symbol", "CF Buy Qty", "CF Buy Value", "CF Sell Qty", "CF Sell Value"].map((h, i) => (
                    <th key={h} className={cn("py-1.5 font-medium", i === 0 ? "text-left pr-6" : "text-right pr-4 last:pr-0")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carryFwd.map((p, i) => (
                  <tr key={i} className="border-b border-border/30 last:border-0">
                    <td className="py-1.5 pr-6 font-mono font-semibold">{p.tradingSymbol}</td>
                    <td className="text-right pr-4 font-mono">{p.carryForwardBuyQty ?? 0}</td>
                    <td className="text-right pr-4 font-mono">{fmt(p.carryForwardBuyValue)}</td>
                    <td className="text-right pr-4 font-mono">{p.carryForwardSellQty ?? 0}</td>
                    <td className="text-right font-mono">{fmt(p.carryForwardSellValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
