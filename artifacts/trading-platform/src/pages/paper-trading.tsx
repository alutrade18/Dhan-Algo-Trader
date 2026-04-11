import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PlayCircle, PauseCircle, RefreshCw, TrendingUp, TrendingDown,
  Activity, Wallet, ShieldAlert, ArrowUpRight, ArrowDownRight, Plus, X
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface VirtualPosition {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPct: number;
  openTime: string;
  exchange: string;
}

interface PaperTrade {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  pnl: number;
  closedAt: string;
  result: "WIN" | "LOSS";
}

const SYMBOLS: Record<string, { base: number; volatility: number }> = {
  "NIFTY": { base: 22500, volatility: 0.003 },
  "BANKNIFTY": { base: 47800, volatility: 0.004 },
  "RELIANCE": { base: 2890, volatility: 0.005 },
  "TCS": { base: 3720, volatility: 0.004 },
  "HDFC": { base: 1710, volatility: 0.006 },
  "INFY": { base: 1540, volatility: 0.005 },
  "ICICIBANK": { base: 1180, volatility: 0.006 },
  "SBIN": { base: 820, volatility: 0.007 },
};

const INITIAL_CAPITAL = 1000000;

function simulatePrice(base: number, volatility: number): number {
  const change = (Math.random() - 0.48) * volatility;
  return Math.round(base * (1 + change) * 100) / 100;
}

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

export default function PaperTrading() {
  const { toast } = useToast();
  const [isActive, setIsActive] = useState(false);
  const [capital, setCapital] = useState(INITIAL_CAPITAL);
  const [usedMargin, setUsedMargin] = useState(0);
  const [positions, setPositions] = useState<VirtualPosition[]>([]);
  const [tradeHistory, setTradeHistory] = useState<PaperTrade[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>(() =>
    Object.fromEntries(Object.entries(SYMBOLS).map(([k, v]) => [k, v.base]))
  );

  const [orderSymbol, setOrderSymbol] = useState("NIFTY");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderQty, setOrderQty] = useState(1);
  const [orderExchange, setOrderExchange] = useState("NSE_FNO");

  const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);
  const closedPnl = tradeHistory.reduce((sum, t) => sum + t.pnl, 0);
  const totalEquity = capital + totalPnl;

  const updatePrices = useCallback(() => {
    setPrices(prev => {
      const next = { ...prev };
      Object.entries(SYMBOLS).forEach(([sym, cfg]) => {
        next[sym] = simulatePrice(prev[sym] || cfg.base, cfg.volatility);
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      updatePrices();
      setPositions(prev => prev.map(pos => {
        const current = prices[pos.symbol] || pos.currentPrice;
        const pnl = pos.side === "BUY"
          ? (current - pos.entryPrice) * pos.qty
          : (pos.entryPrice - current) * pos.qty;
        return { ...pos, currentPrice: current, pnl: Math.round(pnl * 100) / 100, pnlPct: Math.round((pnl / (pos.entryPrice * pos.qty)) * 10000) / 100 };
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [isActive, prices, updatePrices]);

  const placeOrder = () => {
    const price = prices[orderSymbol] || SYMBOLS[orderSymbol]?.base || 100;
    const required = price * orderQty;
    if (required > capital) {
      toast({ title: "Insufficient margin", description: `Required: ${formatCurrency(required)}`, variant: "destructive" });
      return;
    }

    const newPos: VirtualPosition = {
      id: `PT-${Date.now()}`,
      symbol: orderSymbol,
      side: orderSide,
      qty: orderQty,
      entryPrice: price,
      currentPrice: price,
      pnl: 0,
      pnlPct: 0,
      openTime: new Date().toLocaleTimeString("en-IN"),
      exchange: orderExchange,
    };

    setPositions(prev => [...prev, newPos]);
    setCapital(prev => prev - required);
    setUsedMargin(prev => prev + required);

    toast({
      title: `${orderSide} ${orderQty} ${orderSymbol}`,
      description: `Paper order placed @ ₹${price.toLocaleString("en-IN")}`,
    });
  };

  const closePosition = (pos: VirtualPosition) => {
    const current = prices[pos.symbol] || pos.currentPrice;
    const pnl = pos.side === "BUY"
      ? (current - pos.entryPrice) * pos.qty
      : (pos.entryPrice - current) * pos.qty;
    const margin = pos.entryPrice * pos.qty;

    setPositions(prev => prev.filter(p => p.id !== pos.id));
    setCapital(prev => prev + margin + pnl);
    setUsedMargin(prev => prev - margin);

    const trade: PaperTrade = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      qty: pos.qty,
      price: current,
      pnl: Math.round(pnl * 100) / 100,
      closedAt: new Date().toLocaleTimeString("en-IN"),
      result: pnl >= 0 ? "WIN" : "LOSS",
    };
    setTradeHistory(prev => [trade, ...prev.slice(0, 19)]);

    toast({
      title: `Position closed: ${pos.symbol}`,
      description: `P&L: ${pnl >= 0 ? "+" : ""}₹${Math.round(pnl).toLocaleString("en-IN")}`,
    });
  };

  const resetPaperTrading = () => {
    setPositions([]);
    setTradeHistory([]);
    setCapital(INITIAL_CAPITAL);
    setUsedMargin(0);
    setIsActive(false);
    setPrices(Object.fromEntries(Object.entries(SYMBOLS).map(([k, v]) => [k, v.base])));
    toast({ title: "Paper trading reset", description: "Virtual capital restored to ₹10,00,000" });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("gap-1.5 px-3 py-1", isActive ? "text-success border-success/30 bg-success/10" : "text-muted-foreground")}>
            <span className={cn("w-1.5 h-1.5 rounded-full", isActive ? "bg-success animate-pulse" : "bg-muted-foreground")} />
            {isActive ? "LIVE SIMULATION" : "PAUSED"}
          </Badge>
          <Button
            variant={isActive ? "outline" : "default"}
            size="sm"
            className="gap-2"
            onClick={() => setIsActive(!isActive)}
          >
            {isActive ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
            {isActive ? "Pause" : "Start Simulation"}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2" onClick={resetPaperTrading}>
            <RefreshCw className="w-4 h-4" />
            Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Virtual Capital</span>
              <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className="text-xl font-bold font-mono">{formatCurrency(capital)}</p>
            <p className="text-[10px] text-muted-foreground">Available to trade</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Unrealized P&L</span>
              {totalPnl >= 0 ? <TrendingUp className="w-3.5 h-3.5 text-success" /> : <TrendingDown className="w-3.5 h-3.5 text-destructive" />}
            </div>
            <p className={cn("text-xl font-bold font-mono", totalPnl >= 0 ? "text-success" : "text-destructive")}>
              {totalPnl >= 0 ? "+" : ""}{formatCurrency(totalPnl)}
            </p>
            <p className="text-[10px] text-muted-foreground">{positions.length} open positions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Realized P&L</span>
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className={cn("text-xl font-bold font-mono", closedPnl >= 0 ? "text-success" : "text-destructive")}>
              {closedPnl >= 0 ? "+" : ""}{formatCurrency(closedPnl)}
            </p>
            <p className="text-[10px] text-muted-foreground">{tradeHistory.length} closed trades</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">Total Equity</span>
              <ShieldAlert className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <p className={cn("text-xl font-bold font-mono", totalEquity >= INITIAL_CAPITAL ? "text-success" : "text-destructive")}>
              {formatCurrency(totalEquity)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {((totalEquity - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100).toFixed(2)}% return
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Place Order
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Symbol</label>
              <Select value={orderSymbol} onValueChange={setOrderSymbol}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(SYMBOLS).map(s => (
                    <SelectItem key={s} value={s}>
                      {s} — ₹{(prices[s] || SYMBOLS[s].base).toLocaleString("en-IN")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Side</label>
                <Select value={orderSide} onValueChange={v => setOrderSide(v as "BUY" | "SELL")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">BUY</SelectItem>
                    <SelectItem value="SELL">SELL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Quantity</label>
                <Input type="number" min={1} value={orderQty} onChange={e => setOrderQty(Number(e.target.value))} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Exchange Segment</label>
              <Select value={orderExchange} onValueChange={setOrderExchange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NSE_EQ">NSE Equity</SelectItem>
                  <SelectItem value="NSE_FNO">NSE F&O</SelectItem>
                  <SelectItem value="BSE_EQ">BSE Equity</SelectItem>
                  <SelectItem value="MCX">MCX</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted/40 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">LTP (simulated)</span>
                <span className="font-mono font-medium">₹{(prices[orderSymbol] || 0).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Order Value</span>
                <span className="font-mono font-medium">₹{((prices[orderSymbol] || 0) * orderQty).toLocaleString("en-IN")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available</span>
                <span className={cn("font-mono font-medium", capital < (prices[orderSymbol] || 0) * orderQty ? "text-destructive" : "text-success")}>
                  {formatCurrency(capital)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                className="gap-1 bg-success hover:bg-success/90 text-white"
                onClick={() => { setOrderSide("BUY"); placeOrder(); }}
              >
                <ArrowUpRight className="w-4 h-4" />
                BUY
              </Button>
              <Button
                className="gap-1 bg-destructive hover:bg-destructive/90 text-white"
                onClick={() => { setOrderSide("SELL"); placeOrder(); }}
              >
                <ArrowDownRight className="w-4 h-4" />
                SELL
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Open Positions</CardTitle>
                <Badge variant="outline" className="text-[10px]">{positions.length} active</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {positions.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground border-t border-border">
                  No open positions. Place an order to start.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Symbol", "Side", "Qty", "Entry", "LTP", "P&L", ""].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-medium px-4 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos.id} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-4 py-2 font-mono font-medium">{pos.symbol}</td>
                        <td className="px-4 py-2">
                          <Badge variant="outline" className={cn("text-[10px] rounded-sm", pos.side === "BUY" ? "text-success border-success/30" : "text-destructive border-destructive/30")}>
                            {pos.side}
                          </Badge>
                        </td>
                        <td className="px-4 py-2">{pos.qty}</td>
                        <td className="px-4 py-2 font-mono">₹{pos.entryPrice.toLocaleString("en-IN")}</td>
                        <td className="px-4 py-2 font-mono">
                          ₹{(prices[pos.symbol] || pos.currentPrice).toLocaleString("en-IN")}
                        </td>
                        <td className={cn("px-4 py-2 font-mono font-semibold", pos.pnl >= 0 ? "text-success" : "text-destructive")}>
                          {pos.pnl >= 0 ? "+" : ""}₹{Math.abs(pos.pnl).toLocaleString("en-IN")}
                          <span className="text-[9px] ml-1 opacity-70">({pos.pnlPct >= 0 ? "+" : ""}{pos.pnlPct}%)</span>
                        </td>
                        <td className="px-4 py-2">
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => closePosition(pos)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Live Market Watch</CardTitle>
                {isActive && <span className="text-[10px] text-success animate-pulse">● UPDATING</span>}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    {["Symbol", "LTP", "Change"].map(h => (
                      <th key={h} className="text-left text-muted-foreground font-medium px-4 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(SYMBOLS).map(([sym, cfg]) => {
                    const current = prices[sym] || cfg.base;
                    const change = ((current - cfg.base) / cfg.base) * 100;
                    return (
                      <tr key={sym} className="border-b border-border/40 hover:bg-muted/20 cursor-pointer" onClick={() => setOrderSymbol(sym)}>
                        <td className="px-4 py-1.5 font-mono font-medium">{sym}</td>
                        <td className="px-4 py-1.5 font-mono">₹{current.toLocaleString("en-IN")}</td>
                        <td className={cn("px-4 py-1.5 font-mono text-[11px]", change >= 0 ? "text-success" : "text-destructive")}>
                          {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {tradeHistory.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Closed Trades</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      {["Symbol", "Side", "Qty", "Exit", "P&L", "Time", "Result"].map(h => (
                        <th key={h} className="text-left text-muted-foreground font-medium px-4 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tradeHistory.map(trade => (
                      <tr key={trade.id} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="px-4 py-1.5 font-mono font-medium">{trade.symbol}</td>
                        <td className="px-4 py-1.5">
                          <Badge variant="outline" className={cn("text-[10px] rounded-sm", trade.side === "BUY" ? "text-success border-success/30" : "text-destructive border-destructive/30")}>
                            {trade.side}
                          </Badge>
                        </td>
                        <td className="px-4 py-1.5">{trade.qty}</td>
                        <td className="px-4 py-1.5 font-mono">₹{trade.price.toLocaleString("en-IN")}</td>
                        <td className={cn("px-4 py-1.5 font-mono font-semibold", trade.pnl >= 0 ? "text-success" : "text-destructive")}>
                          {trade.pnl >= 0 ? "+" : ""}₹{Math.abs(trade.pnl).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-1.5 text-muted-foreground">{trade.closedAt}</td>
                        <td className="px-4 py-1.5">
                          <Badge variant="outline" className={cn("text-[10px] rounded-sm", trade.result === "WIN" ? "text-success border-success/30 bg-success/5" : "text-destructive border-destructive/30 bg-destructive/5")}>
                            {trade.result}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
