import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { marketSocket } from "@/lib/market-socket";
import {
  RefreshCw,
  LogOut,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
});
const fmt = (v?: number | null) => (v == null ? "—" : INR.format(v));
const fmtNum = (v?: number | null) =>
  v == null ? "—" : v.toLocaleString("en-IN");
const pct = (p: number, base: number) =>
  base !== 0
    ? ` (${p >= 0 ? "+" : ""}${((p / Math.abs(base)) * 100).toFixed(2)}%)`
    : "";

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
  rbiReferenceRate?: number;
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

const REFETCH_MS = 5_000;
const REFRESH_COOLDOWN_MS = 2_000;

const isClosed = (p: DhanPosition) =>
  (p.netQty ?? 0) === 0 || p.positionType === "CLOSED";
const isIntraday = (p: DhanPosition) =>
  !isClosed(p) &&
  (p.productType === "INTRADAY" ||
    p.productType === "MARGIN" ||
    p.productType === "MTF");
const isCarryForward = (p: DhanPosition) =>
  !isClosed(p) &&
  (p.productType === "CNC" ||
    (p.carryForwardBuyQty ?? 0) + (p.carryForwardSellQty ?? 0) > 0);
const isFnO = (p: DhanPosition) =>
  p.exchangeSegment?.includes("FNO") ||
  p.exchangeSegment?.includes("MCX") ||
  p.exchangeSegment?.includes("CURRENCY");

function expiryLabel(d?: string) {
  if (!d || d.startsWith("0001")) return null;
  const dt = new Date(d);
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

type TabKey = "open" | "intraday" | "carryforward" | "closed";

export default function Positions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [ltpMap, setLtpMap] = useState<Record<string, number>>({});
  const [exiting, setExiting] = useState<Record<string, boolean>>({});
  const [exitingAll, setExitingAll] = useState(false);
  const [tab, setTab] = useState<TabKey>("open");
  const [refreshCooling, setRefreshCooling] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const {
    data: positions = [],
    isLoading,
    isError,
    dataUpdatedAt,
  } = useQuery<DhanPosition[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/positions`);
      if (!res.ok) throw new Error("Failed to fetch positions");
      const raw = await res.json();
      return Array.isArray(raw) ? raw : [];
    },
    refetchInterval: REFETCH_MS,
  });

  useEffect(() => {
    if (dataUpdatedAt) setLastUpdated(new Date(dataUpdatedAt));
  }, [dataUpdatedAt]);

  // Subscribe to live LTP for all open positions
  useEffect(() => {
    unsubsRef.current.forEach((u) => u());
    unsubsRef.current = [];

    const open = positions.filter((p) => !isClosed(p));
    open.forEach((pos) => {
      if (!pos.securityId || !pos.exchangeSegment) return;
      const secId = Number(pos.securityId);
      const unsub = marketSocket.subscribe(
        pos.exchangeSegment,
        secId,
        (tick) => {
          setLtpMap((prev) => ({ ...prev, [pos.securityId!]: tick.ltp }));
        },
        "ticker",
      );
      unsubsRef.current.push(unsub);
    });

    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current = [];
    };
  }, [positions.length]);

  const handleRefresh = useCallback(() => {
    if (refreshCooling) return;
    queryClient.invalidateQueries({ queryKey: ["positions"] });
    setRefreshCooling(true);
    setTimeout(() => setRefreshCooling(false), REFRESH_COOLDOWN_MS);
  }, [refreshCooling, queryClient]);

  const calcLivePnl = (pos: DhanPosition, ltp: number) => {
    const qty = pos.netQty ?? 0;
    const mult = pos.multiplier ?? 1;
    if (qty > 0) return (ltp - (pos.buyAvg ?? 0)) * qty * mult;
    if (qty < 0) return ((pos.sellAvg ?? 0) - ltp) * Math.abs(qty) * mult;
    return 0;
  };

  const getLtp = (pos: DhanPosition) => ltpMap[pos.securityId ?? ""] ?? null;
  const getUnrealized = (pos: DhanPosition) => {
    const ltp = getLtp(pos);
    return ltp != null ? calcLivePnl(pos, ltp) : (pos.unrealizedProfit ?? null);
  };
  const getAvg = (pos: DhanPosition) =>
    (pos.netQty ?? 0) >= 0 ? (pos.buyAvg ?? 0) : (pos.sellAvg ?? 0);

  const exitSingle = async (pos: DhanPosition) => {
    const key = pos.securityId ?? "";
    setExiting((prev) => ({ ...prev, [key]: true }));
    try {
      const qty = Math.abs(pos.netQty ?? 0);
      const side = (pos.netQty ?? 0) > 0 ? "SELL" : "BUY";
      const res = await fetch(`${BASE}api/positions/exit-single`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: pos.securityId,
          exchangeSegment: pos.exchangeSegment,
          productType: pos.productType === "CNC" ? "CNC" : "INTRADAY",
          quantity: qty,
          transactionType: side,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.errorMessage ?? data.error ?? "Exit failed");
      toast({
        title: "Exit order placed",
        description: `${pos.tradingSymbol} — Order #${data.orderId}`,
      });
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
        2500,
      );
    } catch (e: unknown) {
      toast({
        title: "Exit failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExiting((prev) => ({ ...prev, [key]: false }));
    }
  };

  const exitAll = async () => {
    setExitingAll(true);
    try {
      const res = await fetch(`${BASE}api/positions`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Exit All failed");
      toast({
        title: "Exit All sent",
        description:
          data.message ??
          "Square-off orders placed for all intraday positions.",
      });
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ["positions"] }),
        3000,
      );
    } catch (e: unknown) {
      toast({
        title: "Exit All failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExitingAll(false);
    }
  };

  // Partition positions
  const openAll = positions.filter((p) => !isClosed(p));
  const intraday = positions.filter(isIntraday);
  const carryFwd = positions.filter(isCarryForward);
  const closed = positions.filter(isClosed);

  const tabRows: Record<TabKey, DhanPosition[]> = {
    open: openAll,
    intraday,
    carryforward: carryFwd,
    closed,
  };
  const rows = tabRows[tab];

  // Totals from ALL open positions
  const totalUnrealized = openAll.reduce(
    (s, p) => s + (getUnrealized(p) ?? 0),
    0,
  );
  const totalRealized = positions.reduce(
    (s, p) => s + (p.realizedProfit ?? 0),
    0,
  );
  const totalPnl = totalUnrealized + totalRealized;

  const PnlCell = ({ v, base }: { v: number | null; base?: number }) => {
    if (v == null)
      return <span className="text-muted-foreground text-xs">Live…</span>;
    return (
      <span
        className={cn("font-mono", v >= 0 ? "text-green-400" : "text-red-400")}
      >
        {fmt(v)}
        {base != null ? (
          <span className="text-[10px] opacity-70">{pct(v, base)}</span>
        ) : null}
      </span>
    );
  };

  const SummaryCard = ({
    label,
    value,
    sub,
  }: {
    label: string;
    value: number;
    sub?: string;
  }) => (
    <div className="bg-card border rounded-md px-3 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-sm font-mono font-bold",
          value >= 0 ? "text-green-400" : "text-red-400",
        )}
      >
        {fmt(value)}
      </div>
      {sub && <div className="text-[9px] text-muted-foreground">{sub}</div>}
    </div>
  );

  const showAction = tab !== "closed";

  return (
    <div className="space-y-4">
      {/* ── Summary row ── */}
      <div className="flex flex-wrap items-stretch gap-3">
        <SummaryCard
          label="Unrealized P&L"
          value={totalUnrealized}
          sub="Open positions, live"
        />
        <SummaryCard
          label="Realized P&L"
          value={totalRealized}
          sub="Booked today"
        />
        <SummaryCard
          label="Total P&L"
          value={totalPnl}
          sub="Unrealized + Realized"
        />
        <div className="bg-card border rounded-md px-3 py-1.5">
          <div className="text-[10px] text-muted-foreground">Open Positions</div>
          <div className="text-sm font-mono font-bold">{openAll.length}</div>
          <div className="text-[9px] text-muted-foreground">
            {intraday.length} intraday · {carryFwd.length} carryforward
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="h-8">
            <TabsTrigger value="open" className="text-xs px-3">
              All Open{" "}
              <span className="ml-1 opacity-60">({openAll.length})</span>
            </TabsTrigger>
            <TabsTrigger value="intraday" className="text-xs px-3">
              Intraday{" "}
              <span className="ml-1 opacity-60">({intraday.length})</span>
            </TabsTrigger>
            <TabsTrigger value="carryforward" className="text-xs px-3">
              Carryforward{" "}
              <span className="ml-1 opacity-60">({carryFwd.length})</span>
            </TabsTrigger>
            <TabsTrigger value="closed" className="text-xs px-3">
              Closed <span className="ml-1 opacity-60">({closed.length})</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Updated {lastUpdated.toLocaleTimeString("en-IN")}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleRefresh}
            disabled={refreshCooling || isLoading}
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                (isLoading || refreshCooling) && "animate-spin",
              )}
            />
            Refresh
          </Button>
          {intraday.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  disabled={exitingAll}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {exitingAll ? "Exiting…" : "Exit All Intraday"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-sm">
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Exit All Intraday Positions?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This will place MARKET orders to square off all{" "}
                    <strong>{intraday.length}</strong> open intraday positions
                    immediately. Pending orders are not cancelled.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={exitAll}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, Exit All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {/* ── Error ── */}
      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Failed to fetch positions from Dhan. Retrying automatically…
        </div>
      )}

      {/* ── Positions table ── */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead>Symbol</TableHead>
              <TableHead>Exchange</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-center">Side</TableHead>
              <TableHead className="text-right">Net Qty</TableHead>
              <TableHead className="text-right">Avg Price</TableHead>
              <TableHead className="text-right">LTP</TableHead>
              <TableHead className="text-right">Day Qty</TableHead>
              <TableHead className="text-right">Unrealized P&L</TableHead>
              <TableHead className="text-right">Realized P&L</TableHead>
              {showAction && (
                <TableHead className="text-right">Action</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: showAction ? 11 : 10 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-16" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={showAction ? 11 : 10}
                  className="text-center py-10 text-muted-foreground text-sm"
                >
                  No {tab === "closed" ? "closed" : "open"} positions
                </TableCell>
              </TableRow>
            ) : (
              rows.map((pos, idx) => {
                const key = `${pos.securityId}-${idx}`;
                const ltp = getLtp(pos);
                const unrealized = getUnrealized(pos);
                const qty = pos.netQty ?? 0;
                const avg = getAvg(pos);
                const isLong = qty >= 0;
                const closed_ = isClosed(pos);
                const canExit = !closed_ && isIntraday(pos);
                const exiting_ = exiting[pos.securityId ?? ""];
                const expiry = expiryLabel(pos.drvExpiryDate);
                const optType = pos.drvOptionType;
                const strike =
                  (pos.drvStrikePrice ?? 0) > 0 ? pos.drvStrikePrice : null;

                const dayQty =
                  (pos.dayBuyQty ?? 0) > 0 || (pos.daySellQty ?? 0) > 0
                    ? `B:${pos.dayBuyQty ?? 0} / S:${pos.daySellQty ?? 0}`
                    : "—";

                return (
                  <TableRow
                    key={key}
                    className={cn("text-xs", closed_ && "opacity-50")}
                  >
                    {/* Symbol */}
                    <TableCell className="font-mono font-semibold">
                      <div>{pos.tradingSymbol}</div>
                      {(expiry || strike || optType) && (
                        <div className="text-[10px] text-muted-foreground flex gap-1 mt-0.5">
                          {optType && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px] px-1 py-0",
                                optType === "CALL"
                                  ? "border-green-500/40 text-green-400"
                                  : "border-red-500/40 text-red-400",
                              )}
                            >
                              {optType === "CALL" ? "CE" : "PE"}
                            </Badge>
                          )}
                          {strike && (
                            <span>₹{strike.toLocaleString("en-IN")}</span>
                          )}
                          {expiry && <span>{expiry}</span>}
                        </div>
                      )}
                    </TableCell>

                    {/* Exchange */}
                    <TableCell>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {pos.exchangeSegment?.replace("_", " ") ?? "—"}
                      </span>
                    </TableCell>

                    {/* Product */}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="text-[9px] px-1.5 py-0 font-mono"
                      >
                        {pos.productType ?? "—"}
                      </Badge>
                    </TableCell>

                    {/* Side */}
                    <TableCell className="text-center">
                      {closed_ ? (
                        <span className="text-muted-foreground flex items-center justify-center gap-1">
                          <Minus className="h-3 w-3" /> CLOSED
                        </span>
                      ) : isLong ? (
                        <span className="flex items-center justify-center gap-1 text-green-400">
                          <TrendingUp className="h-3 w-3" /> LONG
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-1 text-red-400">
                          <TrendingDown className="h-3 w-3" /> SHORT
                        </span>
                      )}
                    </TableCell>

                    {/* Net Qty */}
                    <TableCell className="text-right font-mono">
                      {fmtNum(Math.abs(qty))}
                    </TableCell>

                    {/* Avg Price */}
                    <TableCell className="text-right font-mono">
                      {fmt(avg)}
                    </TableCell>

                    {/* LTP */}
                    <TableCell className="text-right font-mono">
                      {closed_ ? (
                        <span className="text-muted-foreground">—</span>
                      ) : ltp != null ? (
                        <span
                          className={cn(
                            ltp > avg
                              ? "text-green-400"
                              : ltp < avg
                                ? "text-red-400"
                                : "",
                          )}
                        >
                          {fmt(ltp)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-[10px] animate-pulse">
                          live…
                        </span>
                      )}
                    </TableCell>

                    {/* Day Qty */}
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {dayQty}
                    </TableCell>

                    {/* Unrealized P&L */}
                    <TableCell className="text-right">
                      {closed_ ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <PnlCell
                          v={unrealized}
                          base={
                            avg !== 0 && qty !== 0
                              ? avg * Math.abs(qty)
                              : undefined
                          }
                        />
                      )}
                    </TableCell>

                    {/* Realized P&L */}
                    <TableCell className="text-right">
                      <PnlCell v={pos.realizedProfit ?? 0} />
                    </TableCell>

                    {/* Action */}
                    {showAction && (
                      <TableCell className="text-right">
                        {canExit ? (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 text-[10px] px-2 border-destructive/60 text-destructive hover:bg-destructive hover:text-white"
                                disabled={exiting_}
                              >
                                {exiting_ ? "…" : "Exit"}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent className="max-w-sm">
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Exit {pos.tradingSymbol}?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  Place a MARKET {isLong ? "SELL" : "BUY"} order
                                  for <strong>{Math.abs(qty)}</strong> qty of{" "}
                                  <strong>{pos.tradingSymbol}</strong> at market
                                  price.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => exitSingle(pos)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Yes, Exit
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">
                            —
                          </span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* ── Carry-forward detail (shown when positions exist) ── */}
      {(tab === "open" || tab === "carryforward") && carryFwd.length > 0 && (
        <div className="rounded-md border bg-card/50 p-3">
          <p className="text-[11px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
            Carryforward Detail
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left py-1 pr-4">Symbol</th>
                  <th className="text-right py-1 pr-4">CF Buy Qty</th>
                  <th className="text-right py-1 pr-4">CF Buy Val</th>
                  <th className="text-right py-1 pr-4">CF Sell Qty</th>
                  <th className="text-right py-1">CF Sell Val</th>
                </tr>
              </thead>
              <tbody>
                {carryFwd.map((p, i) => (
                  <tr
                    key={i}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-1 pr-4 font-mono font-semibold">
                      {p.tradingSymbol}
                    </td>
                    <td className="text-right py-1 pr-4 font-mono">
                      {fmtNum(p.carryForwardBuyQty)}
                    </td>
                    <td className="text-right py-1 pr-4 font-mono">
                      {fmt(p.carryForwardBuyValue)}
                    </td>
                    <td className="text-right py-1 pr-4 font-mono">
                      {fmtNum(p.carryForwardSellQty)}
                    </td>
                    <td className="text-right py-1 font-mono">
                      {fmt(p.carryForwardSellValue)}
                    </td>
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
