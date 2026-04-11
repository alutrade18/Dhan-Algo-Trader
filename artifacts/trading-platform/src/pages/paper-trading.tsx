import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, Activity, Wallet, RefreshCw, X, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

const COMMON_SYMBOLS = [
  { label: "NIFTY 50", securityId: "13", exchange: "IDX_I", basePrice: 22500 },
  { label: "BANK NIFTY", securityId: "25", exchange: "IDX_I", basePrice: 47800 },
  { label: "RELIANCE", securityId: "1333", exchange: "NSE_EQ", basePrice: 2890 },
  { label: "TCS", securityId: "11536", exchange: "NSE_EQ", basePrice: 3720 },
  { label: "HDFC Bank", securityId: "1330", exchange: "NSE_EQ", basePrice: 1710 },
  { label: "INFY", securityId: "10999", exchange: "NSE_EQ", basePrice: 1540 },
  { label: "ICICI Bank", securityId: "4963", exchange: "NSE_EQ", basePrice: 1180 },
  { label: "SBIN", securityId: "3045", exchange: "NSE_EQ", basePrice: 820 },
];

interface PaperTrade {
  id: number;
  symbol: string;
  securityId: string;
  exchange: string;
  side: string;
  qty: number;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  status: string;
  entryTime: string;
  exitTime: string | null;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function simPrice(base: number): number {
  const change = (Math.random() - 0.48) * 0.003;
  return Math.round(base * (1 + change) * 100) / 100;
}

export default function PaperTrading() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedSymbolId, setSelectedSymbolId] = useState(COMMON_SYMBOLS[0].securityId);
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderQty, setOrderQty] = useState(1);
  const [livePrices, setLivePrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(COMMON_SYMBOLS.map(s => [s.securityId, s.basePrice]))
  );
  const priceRef = useRef(livePrices);
  priceRef.current = livePrices;

  const selectedSymbol = COMMON_SYMBOLS.find(s => s.securityId === selectedSymbolId)!;

  const { data: trades, isLoading } = useQuery<PaperTrade[]>({
    queryKey: ["paper-trades"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/paper-trades`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const openTrades = trades?.filter(t => t.status === "OPEN") ?? [];
  const closedTrades = trades?.filter(t => t.status === "CLOSED") ?? [];

  const fetchSelectedPrice = useCallback(async () => {
    const sym = COMMON_SYMBOLS.find(s => s.securityId === selectedSymbolId);
    if (!sym) return;
    try {
      const exchange = sym.exchange.includes("IDX") ? "IDX_I" : "NSE_EQ";
      const res = await fetch(`${BASE}api/market/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securities: { [exchange]: [sym.securityId] },
          quoteType: "LTP",
        }),
      });
      if (res.ok) {
        const data = await res.json() as { data?: Record<string, Record<string, { ltp?: number }>> };
        const exchange_data = data.data && data.data[exchange];
        const ltp = exchange_data && exchange_data[sym.securityId]?.ltp;
        if (ltp && ltp > 0) {
          setLivePrices(prev => ({ ...prev, [sym.securityId]: ltp }));
          return;
        }
      }
    } catch {
      // fall through
    }
    setLivePrices(prev => ({
      ...prev,
      [sym.securityId]: simPrice(prev[sym.securityId] ?? sym.basePrice),
    }));
  }, [selectedSymbolId]);

  useEffect(() => {
    const simulateAll = () => {
      setLivePrices(prev => {
        const next = { ...prev };
        COMMON_SYMBOLS.forEach(s => {
          if (s.securityId !== selectedSymbolId) {
            next[s.securityId] = simPrice(prev[s.securityId] ?? s.basePrice);
          }
        });
        return next;
      });
    };

    fetchSelectedPrice();
    simulateAll();

    const id = setInterval(() => {
      fetchSelectedPrice();
      simulateAll();
    }, 5000);
    return () => clearInterval(id);
  }, [fetchSelectedPrice, selectedSymbolId]);

  const openPosition = useMutation({
    mutationFn: async () => {
      const price = priceRef.current[selectedSymbolId] ?? selectedSymbol.basePrice;
      const res = await fetch(`${BASE}api/paper-trades`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: selectedSymbol.label,
          securityId: selectedSymbol.securityId,
          exchange: selectedSymbol.exchange,
          side: orderSide,
          qty: orderQty,
          entryPrice: price,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: `${orderSide} order placed`, description: `${orderQty} × ${selectedSymbol.label} at ₹${livePrices[selectedSymbolId]?.toFixed(2)}` });
      queryClient.invalidateQueries({ queryKey: ["paper-trades"] });
    },
    onError: () => toast({ title: "Order failed", variant: "destructive" }),
  });

  const closePosition = useMutation({
    mutationFn: async (id: number) => {
      const trade = openTrades.find(t => t.id === id);
      if (!trade) throw new Error("Trade not found");
      const exitPrice = priceRef.current[trade.securityId] ?? trade.entryPrice;
      const res = await fetch(`${BASE}api/paper-trades/${id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exitPrice }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<PaperTrade>;
    },
    onSuccess: (trade) => {
      const pnl = trade.pnl ?? 0;
      toast({
        title: `Position closed — ${pnl >= 0 ? "+" : ""}${formatCurrency(pnl)}`,
        variant: pnl >= 0 ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: ["paper-trades"] });
    },
    onError: () => toast({ title: "Failed to close position", variant: "destructive" }),
  });

  const clearAll = useMutation({
    mutationFn: async () => {
      await fetch(`${BASE}api/paper-trades`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["paper-trades"] });
      toast({ title: "All paper trades cleared" });
    },
  });

  const totalOpenPnl = openTrades.reduce((sum, t) => {
    const cur = livePrices[t.securityId] ?? t.entryPrice;
    const pnl = t.side === "BUY" ? (cur - t.entryPrice) * t.qty : (t.entryPrice - cur) * t.qty;
    return sum + pnl;
  }, 0);
  const totalClosedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Open P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold font-mono", totalOpenPnl >= 0 ? "text-success" : "text-destructive")}>
              {totalOpenPnl >= 0 ? "+" : ""}{formatCurrency(totalOpenPnl)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground flex items-center gap-1.5"><Wallet className="h-3.5 w-3.5" /> Closed P&L</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold font-mono", totalClosedPnl >= 0 ? "text-success" : "text-destructive")}>
              {totalClosedPnl >= 0 ? "+" : ""}{formatCurrency(totalClosedPnl)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Open Positions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{openTrades.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{trades?.length ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Place Paper Order</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Select value={selectedSymbolId} onValueChange={setSelectedSymbolId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {COMMON_SYMBOLS.map(s => (
                    <SelectItem key={s.securityId} value={s.securityId}>
                      <span>{s.label}</span>
                      <span className="text-muted-foreground ml-2 font-mono text-xs">
                        ₹{livePrices[s.securityId]?.toFixed(2)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md bg-muted/40 p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">{selectedSymbol.label} — Live Price</div>
              <div className="text-3xl font-bold font-mono">
                ₹{livePrices[selectedSymbolId]?.toFixed(2) ?? "—"}
              </div>
              <div className="flex items-center justify-center gap-1 mt-1 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin-slow" /> Updates every 5 seconds
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={orderSide === "BUY" ? "default" : "outline"}
                className={cn(orderSide === "BUY" && "bg-success hover:bg-success/90 text-white")}
                onClick={() => setOrderSide("BUY")}
              >
                <ArrowUpRight className="h-4 w-4 mr-1" /> BUY
              </Button>
              <Button
                variant={orderSide === "SELL" ? "default" : "outline"}
                className={cn(orderSide === "SELL" && "bg-destructive hover:bg-destructive/90")}
                onClick={() => setOrderSide("SELL")}
              >
                <ArrowDownRight className="h-4 w-4 mr-1" /> SELL
              </Button>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Quantity</label>
              <Input
                type="number"
                min={1}
                value={orderQty}
                onChange={e => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>

            <div className="rounded-md bg-muted/20 p-2 text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>Price</span>
                <span className="font-mono">₹{livePrices[selectedSymbolId]?.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Value</span>
                <span className="font-mono">₹{((livePrices[selectedSymbolId] ?? 0) * orderQty).toFixed(0)}</span>
              </div>
            </div>

            <Button
              className="w-full"
              variant={orderSide === "BUY" ? "default" : "destructive"}
              onClick={() => openPosition.mutate()}
              disabled={openPosition.isPending}
            >
              {openPosition.isPending ? "Placing..." : `${orderSide} ${orderQty} × ${selectedSymbol.label}`}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Open Positions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : openTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No open positions</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Entry ₹</TableHead>
                      <TableHead className="text-right">Current ₹</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {openTrades.map(t => {
                      const cur = livePrices[t.securityId] ?? t.entryPrice;
                      const pnl = t.side === "BUY" ? (cur - t.entryPrice) * t.qty : (t.entryPrice - cur) * t.qty;
                      const pnlPct = ((cur - t.entryPrice) / t.entryPrice) * 100 * (t.side === "SELL" ? -1 : 1);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium text-sm">{t.symbol}</TableCell>
                          <TableCell>
                            <Badge variant={t.side === "BUY" ? "default" : "destructive"} className={cn("text-[10px]", t.side === "BUY" && "bg-success")}>
                              {t.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">₹{t.entryPrice.toFixed(2)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">₹{cur.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-xs">{t.qty}</TableCell>
                          <TableCell className="text-right">
                            <div className={cn("font-mono text-xs font-medium", pnl >= 0 ? "text-success" : "text-destructive")}>
                              {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)}
                            </div>
                            <div className={cn("text-[10px]", pnlPct >= 0 ? "text-success" : "text-destructive")}>
                              {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
                            </div>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive"
                              onClick={() => closePosition.mutate(t.id)}
                              disabled={closePosition.isPending}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">Closed Trades</CardTitle>
              {closedTrades.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => clearAll.mutate()}>
                  Clear all
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {closedTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">No closed trades yet</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Entry</TableHead>
                      <TableHead className="text-right">Exit</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">P&L</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closedTrades.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium text-sm">{t.symbol}</TableCell>
                        <TableCell>
                          <Badge variant={t.side === "BUY" ? "default" : "destructive"} className={cn("text-[10px]", t.side === "BUY" && "bg-success")}>
                            {t.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">₹{t.entryPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-mono text-xs">₹{t.exitPrice?.toFixed(2) ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{t.qty}</TableCell>
                        <TableCell className="text-right">
                          <span className={cn("font-mono text-xs font-medium", (t.pnl ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                            {(t.pnl ?? 0) >= 0 ? "+" : ""}{formatCurrency(t.pnl ?? 0)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {t.exitTime ? new Date(t.exitTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/20 p-3">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Live Prices — All Symbols</p>
        <div className="grid grid-cols-4 gap-2">
          {COMMON_SYMBOLS.map(s => {
            const price = livePrices[s.securityId] ?? s.basePrice;
            const change = ((price - s.basePrice) / s.basePrice) * 100;
            return (
              <button
                key={s.securityId}
                onClick={() => setSelectedSymbolId(s.securityId)}
                className={cn("flex flex-col rounded-md border p-2 text-left transition-colors hover:bg-muted/60", selectedSymbolId === s.securityId && "border-primary bg-muted/60")}
              >
                <span className="text-[10px] font-medium text-muted-foreground">{s.label}</span>
                <span className="font-mono text-sm font-bold">₹{price.toFixed(2)}</span>
                <span className={cn("text-[10px] font-mono", change >= 0 ? "text-success" : "text-destructive")}>
                  {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
