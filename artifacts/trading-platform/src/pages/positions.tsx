import { useState, useEffect } from "react";
import { useGetPositions, GetPositionsQueryResult } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { marketSocket } from "@/lib/market-socket";
import { RefreshCw, LogOut } from "lucide-react";

type Position = NonNullable<GetPositionsQueryResult>[number];

const BASE = import.meta.env.BASE_URL;
const fmt = (v?: number) => v !== undefined ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(v) : "—";
const fmtChange = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

export default function Positions() {
  const { data: positions, isLoading, refetch } = useGetPositions();
  const { toast } = useToast();
  const [ltpMap, setLtpMap] = useState<Record<string, number>>({});
  const [exiting, setExiting] = useState<Record<string, boolean>>({});
  const [exitingAll, setExitingAll] = useState(false);

  const intradayPositions = positions?.filter(p => p.productType !== "CNC" && (p.netQty ?? 0) !== 0) ?? [];

  useEffect(() => {
    if (!intradayPositions.length) return;
    const unsubs: Array<() => void> = [];
    intradayPositions.forEach(pos => {
      if (!pos.securityId) return;
      const secId = Number(pos.securityId);
      const exchange = pos.exchangeSegment ?? "NSE_EQ";
      const unsub = marketSocket.subscribe(exchange, secId, (tick) => {
        setLtpMap(prev => ({ ...prev, [pos.securityId!]: tick.ltp }));
      }, "ticker");
      unsubs.push(unsub);
    });
    return () => unsubs.forEach(u => u());
  }, [positions?.length]);

  const calcUnrealizedPnl = (pos: Position, ltp: number) => {
    const qty = pos.netQty ?? 0;
    const avg = qty >= 0 ? (pos.buyAvg ?? 0) : (pos.sellAvg ?? 0);
    return qty >= 0 ? (ltp - avg) * qty : (avg - ltp) * Math.abs(qty);
  };

  const exitSingle = async (pos: Position) => {
    const key = pos.securityId ?? "";
    setExiting(prev => ({ ...prev, [key]: true }));
    try {
      const qty = Math.abs(pos.netQty ?? 0);
      const oppSide = (pos.netQty ?? 0) >= 0 ? "SELL" : "BUY";
      const res = await fetch(`${BASE}api/positions/exit-single`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: pos.securityId,
          exchangeSegment: pos.exchangeSegment,
          productType: "INTRADAY",
          quantity: qty,
          transactionType: oppSide,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.errorMessage ?? data.error ?? "Failed");
      toast({ title: "Exit order placed", description: `${pos.tradingSymbol} — Order: ${data.orderId}` });
      setTimeout(() => refetch(), 2000);
    } catch (e: unknown) {
      toast({ title: "Exit failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setExiting(prev => ({ ...prev, [key]: false }));
    }
  };

  const exitAll = async () => {
    setExitingAll(true);
    try {
      const res = await fetch(`${BASE}api/positions`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      toast({ title: "All positions exiting", description: data.message ?? "Exit orders placed" });
      setTimeout(() => refetch(), 3000);
    } catch (e: unknown) {
      toast({ title: "Exit All failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setExitingAll(false);
    }
  };

  const totalUnrealized = intradayPositions.reduce((acc, pos) => {
    const ltp = ltpMap[pos.securityId ?? ""] ?? 0;
    return acc + (ltp > 0 ? calcUnrealizedPnl(pos, ltp) : (pos.unrealizedProfit ?? 0));
  }, 0);
  const totalRealized = intradayPositions.reduce((acc, pos) => acc + (pos.realizedProfit ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-3">
          <div className="bg-card border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-0.5">Unrealized P&L</div>
            <div className={cn("text-lg font-mono font-bold", totalUnrealized >= 0 ? "text-success" : "text-destructive")}>
              {fmt(totalUnrealized)}
            </div>
          </div>
          <div className="bg-card border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-0.5">Realized P&L</div>
            <div className={cn("text-lg font-mono font-bold", totalRealized >= 0 ? "text-success" : "text-destructive")}>
              {fmt(totalRealized)}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          {intradayPositions.length > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={exitingAll}>
                  <LogOut className="h-3.5 w-3.5 mr-1" />
                  {exitingAll ? "Exiting..." : "Exit All"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Exit All Positions?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will place MARKET SELL/BUY orders for all {intradayPositions.length} open intraday positions immediately.
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
          )}
        </div>
      </div>

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Avg Price</TableHead>
              <TableHead className="text-right">LTP</TableHead>
              <TableHead className="text-right">Unrealized</TableHead>
              <TableHead className="text-right">Realized</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-16" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : intradayPositions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                  No open intraday positions
                </TableCell>
              </TableRow>
            ) : (
              intradayPositions.map(pos => {
                const ltp = ltpMap[pos.securityId ?? ""] ?? 0;
                const unrealized = ltp > 0 ? calcUnrealizedPnl(pos, ltp) : (pos.unrealizedProfit ?? 0);
                const qty = pos.netQty ?? 0;
                const isLong = qty > 0;
                const key = pos.securityId ?? "";
                return (
                  <TableRow key={key}>
                    <TableCell className="font-mono font-medium">{pos.tradingSymbol}</TableCell>
                    <TableCell>
                      <Badge className={cn("text-[10px]", isLong ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive")}>
                        {isLong ? "LONG" : "SHORT"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">{Math.abs(qty)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(isLong ? pos.buyAvg : pos.sellAvg)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {ltp > 0 ? (
                        <span className="text-foreground">{fmt(ltp)}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">Loading...</span>
                      )}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono", unrealized >= 0 ? "text-success" : "text-destructive")}>
                      {fmt(unrealized)}
                      {ltp > 0 && <span className="text-xs ml-1">({fmtChange(unrealized / (Math.abs(qty) * (isLong ? (pos.buyAvg ?? 1) : (pos.sellAvg ?? 1))) * 100)}%)</span>}
                    </TableCell>
                    <TableCell className={cn("text-right font-mono", (pos.realizedProfit ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                      {fmt(pos.realizedProfit ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white"
                        disabled={exiting[key]}
                        onClick={() => exitSingle(pos)}
                      >
                        {exiting[key] ? "..." : "Exit"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
