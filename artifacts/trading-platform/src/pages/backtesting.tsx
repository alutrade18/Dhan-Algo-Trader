import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Play, TrendingUp, TrendingDown, BarChart2, Activity,
  CheckCircle2, Target, ShieldAlert, Percent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell,
} from "recharts";
import { useGetStrategies } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL;

interface BacktestConfig {
  securityId: string;
  symbol: string;
  exchange: string;
  fromDate: string;
  toDate: string;
  strategyId: string;
  capital: number;
  stopLoss: number;
  takeProfit: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
}

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TradeLog {
  entryTime: string;
  exitTime: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  cumPnl: number;
}

interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  equity: Array<{ i: number; value: number }>;
  trades: TradeLog[];
  candleCount: number;
  isRealData: boolean;
}

const POPULAR_SYMBOLS = [
  { label: "NIFTY 50", securityId: "13", symbol: "NIFTY-I", exchange: "IDX_I" },
  { label: "BANK NIFTY", securityId: "25", symbol: "BANKNIFTY-I", exchange: "IDX_I" },
  { label: "RELIANCE", securityId: "1333", symbol: "RELIANCE", exchange: "NSE_EQ" },
  { label: "TCS", securityId: "11536", symbol: "TCS", exchange: "NSE_EQ" },
  { label: "HDFC Bank", securityId: "1330", symbol: "HDFCBANK", exchange: "NSE_EQ" },
  { label: "INFY", securityId: "10999", symbol: "INFY", exchange: "NSE_EQ" },
];

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function calcRSI(closes: number[], period = 14): number[] {
  const result: number[] = new Array(period).fill(50);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function simulateStrategy(candles: Candle[], config: BacktestConfig): BacktestResult {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes, config.rsiPeriod);

  const trades: TradeLog[] = [];
  let inTrade = false;
  let entryPrice = 0;
  let entryTime = "";
  let equity = config.capital;
  const equityCurve: Array<{ i: number; value: number }> = [{ i: 0, value: equity }];

  for (let i = config.rsiPeriod + 1; i < candles.length - 1; i++) {
    const r = rsi[i];
    const close = closes[i];

    if (!inTrade && r < config.rsiOversold) {
      inTrade = true;
      entryPrice = closes[i + 1];
      entryTime = candles[i + 1].timestamp;
    } else if (inTrade) {
      const pct = ((close - entryPrice) / entryPrice) * 100;
      const shouldExit = r > config.rsiOverbought || pct >= config.takeProfit || pct <= -config.stopLoss;
      if (shouldExit) {
        const exitPrice = closes[i + 1];
        const pnl = ((exitPrice - entryPrice) / entryPrice) * equity * 0.95;
        const cumPnl = trades.reduce((s, t) => s + t.pnl, 0) + pnl;
        trades.push({
          entryTime,
          exitTime: candles[i + 1].timestamp,
          side: "BUY",
          entryPrice,
          exitPrice,
          pnl: Math.round(pnl * 100) / 100,
          cumPnl: Math.round(cumPnl * 100) / 100,
        });
        equity += pnl;
        equityCurve.push({ i: trades.length, value: Math.round(equity) });
        inTrade = false;
      }
    }
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const totalReturn = (totalPnl / config.capital) * 100;

  let peak = config.capital;
  let maxDrawdown = 0;
  let running = config.capital;
  for (const t of trades) {
    running += t.pnl;
    if (running > peak) peak = running;
    const dd = ((peak - running) / peak) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const returns = trades.map(t => t.pnl / config.capital);
  const meanReturn = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
  const stdReturn = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length || 1));
  const sharpeRatio = stdReturn > 0 ? (meanReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Math.round(winRate * 10) / 10,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalReturn: Math.round(totalReturn * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10) / 10,
    sharpeRatio: Math.round(sharpeRatio * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    equity: equityCurve,
    trades,
    candleCount: candles.length,
    isRealData: true,
  };
}

function MetricCard({ label, value, icon: Icon, positive }: { label: string; value: string; icon?: React.ElementType; positive?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className={cn("text-xl font-bold font-mono mt-1", positive !== undefined && (positive ? "text-success" : "text-destructive"))}>
          {value}
        </div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground mt-1" />}
      </CardContent>
    </Card>
  );
}

export default function Backtesting() {
  const { toast } = useToast();
  const { data: strategies } = useGetStrategies();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split("T")[0];

  const [config, setConfig] = useState<BacktestConfig>({
    securityId: "13",
    symbol: "NIFTY-I",
    exchange: "IDX_I",
    fromDate: thirtyDaysAgo,
    toDate: today,
    strategyId: "",
    capital: 100000,
    stopLoss: 1.5,
    takeProfit: 3,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
  });

  const updateConfig = <K extends keyof BacktestConfig>(key: K, val: BacktestConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const runBacktest = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`${BASE}api/market/historical`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: config.securityId,
          exchangeSegment: config.exchange,
          instrumentType: "EQUITY",
          expiryCode: 0,
          fromDate: config.fromDate,
          toDate: config.toDate,
        }),
      });

      let candles: Candle[] = [];
      if (res.ok) {
        const data = await res.json() as { data?: Candle[] };
        if (data.data && data.data.length > 0) {
          candles = data.data;
          toast({ title: `Loaded ${candles.length} candles from Dhan`, description: "Running simulation on real data..." });
        } else {
          toast({ title: "No data from API", description: "Broker may not be connected or market is closed. Using simulated data.", variant: "destructive" });
          candles = generateSimulatedCandles(config);
        }
      } else {
        toast({ title: "API unavailable", description: "Using simulated candle data for demonstration.", variant: "destructive" });
        candles = generateSimulatedCandles(config);
      }

      const backtestResult = simulateStrategy(candles, config);
      setResult(backtestResult);
    } catch (e) {
      toast({ title: "Backtest error", description: String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={runBacktest} disabled={running} className="gap-2">
          <Play className="w-4 h-4" />
          {running ? "Running..." : "Run Backtest"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Symbol</label>
                <Select
                  value={config.securityId}
                  onValueChange={v => {
                    const s = POPULAR_SYMBOLS.find(s => s.securityId === v);
                    if (s) updateConfig("securityId", s.securityId), updateConfig("symbol", s.symbol), updateConfig("exchange", s.exchange);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {POPULAR_SYMBOLS.map(s => <SelectItem key={s.securityId} value={s.securityId}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {strategies && strategies.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Strategy (optional)</label>
                  <Select value={config.strategyId} onValueChange={v => updateConfig("strategyId", v)}>
                    <SelectTrigger><SelectValue placeholder="Select a strategy..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rsi_default">RSI Reversal (default)</SelectItem>
                      {strategies.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">From</label>
                  <Input type="date" value={config.fromDate} onChange={e => updateConfig("fromDate", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">To</label>
                  <Input type="date" value={config.toDate} onChange={e => updateConfig("toDate", e.target.value)} />
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Capital & Risk</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Capital (₹)</label>
                    <Input type="number" value={config.capital} onChange={e => updateConfig("capital", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">SL %</label>
                    <Input type="number" step={0.1} value={config.stopLoss} onChange={e => updateConfig("stopLoss", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Target %</label>
                    <Input type="number" step={0.1} value={config.takeProfit} onChange={e => updateConfig("takeProfit", Number(e.target.value))} />
                  </div>
                </div>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">RSI Parameters</p>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Period</label>
                    <Input type="number" value={config.rsiPeriod} onChange={e => updateConfig("rsiPeriod", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Oversold</label>
                    <Input type="number" value={config.rsiOversold} onChange={e => updateConfig("rsiOversold", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Overbought</label>
                    <Input type="number" value={config.rsiOverbought} onChange={e => updateConfig("rsiOverbought", Number(e.target.value))} />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {running && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <div className="grid grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
              </div>
            </div>
          )}

          {!running && result && (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={result.isRealData ? "default" : "secondary"} className="text-xs">
                  {result.isRealData ? `${result.candleCount} real candles` : "Simulated data"}
                </Badge>
                <Badge variant={result.totalPnl >= 0 ? "default" : "destructive"} className={cn("text-xs", result.totalPnl >= 0 && "bg-success")}>
                  {result.totalPnl >= 0 ? "+" : ""}{result.totalReturn.toFixed(2)}% return
                </Badge>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MetricCard label="Total Trades" value={String(result.totalTrades)} icon={Activity} />
                <MetricCard label="Win Rate" value={`${result.winRate}%`} icon={CheckCircle2} positive={result.winRate >= 50} />
                <MetricCard label="Total P&L" value={formatCurrency(result.totalPnl)} icon={TrendingUp} positive={result.totalPnl >= 0} />
                <MetricCard label="Profit Factor" value={result.profitFactor === 999 ? "∞" : result.profitFactor.toFixed(2)} icon={Target} positive={result.profitFactor >= 1} />
                <MetricCard label="Max Drawdown" value={`${result.maxDrawdown}%`} icon={ShieldAlert} positive={result.maxDrawdown < 10} />
                <MetricCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} icon={BarChart2} positive={result.sharpeRatio >= 1} />
                <MetricCard label="Avg Win" value={formatCurrency(result.avgWin)} icon={TrendingUp} positive />
                <MetricCard label="Avg Loss" value={formatCurrency(result.avgLoss)} icon={TrendingDown} positive={false} />
              </div>

              <Tabs defaultValue="equity">
                <TabsList>
                  <TabsTrigger value="equity">Equity Curve</TabsTrigger>
                  <TabsTrigger value="trades">Trade Log ({result.totalTrades})</TabsTrigger>
                  <TabsTrigger value="pnl">P&L Distribution</TabsTrigger>
                </TabsList>

                <TabsContent value="equity">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">Portfolio Equity Curve</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={result.equity} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={result.totalPnl >= 0 ? "hsl(var(--success, 142 76% 36%))" : "hsl(var(--destructive))"} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={result.totalPnl >= 0 ? "hsl(var(--success, 142 76% 36%))" : "hsl(var(--destructive))"} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="i" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Trade #", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [formatCurrency(v), "Equity"]} />
                          <ReferenceLine y={config.capital} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 2" />
                          <Area type="monotone" dataKey="value" stroke={result.totalPnl >= 0 ? "#22c55e" : "hsl(var(--destructive))"} strokeWidth={2} fill="url(#eqGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="trades">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">Trade-by-Trade Log</CardTitle></CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-80 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>Entry</TableHead>
                              <TableHead>Exit</TableHead>
                              <TableHead className="text-right">Entry ₹</TableHead>
                              <TableHead className="text-right">Exit ₹</TableHead>
                              <TableHead className="text-right">P&L</TableHead>
                              <TableHead className="text-right">Cum P&L</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {result.trades.map((t, i) => (
                              <TableRow key={i}>
                                <TableCell className="text-xs">{i + 1}</TableCell>
                                <TableCell className="text-xs font-mono">{t.entryTime?.slice(0, 10) ?? "—"}</TableCell>
                                <TableCell className="text-xs font-mono">{t.exitTime?.slice(0, 10) ?? "—"}</TableCell>
                                <TableCell className="text-right text-xs font-mono">₹{t.entryPrice.toFixed(2)}</TableCell>
                                <TableCell className="text-right text-xs font-mono">₹{t.exitPrice.toFixed(2)}</TableCell>
                                <TableCell className={cn("text-right text-xs font-mono font-medium", t.pnl >= 0 ? "text-success" : "text-destructive")}>
                                  {t.pnl >= 0 ? "+" : ""}{formatCurrency(t.pnl)}
                                </TableCell>
                                <TableCell className={cn("text-right text-xs font-mono", t.cumPnl >= 0 ? "text-success" : "text-destructive")}>
                                  {formatCurrency(t.cumPnl)}
                                </TableCell>
                              </TableRow>
                            ))}
                            {result.trades.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground text-sm">
                                  No trades generated — try adjusting RSI thresholds or date range
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="pnl">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-sm">P&L Per Trade</CardTitle></CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={result.trades.map((t, i) => ({ i: i + 1, pnl: t.pnl }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="i" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={v => `₹${v >= 1000 ? (v / 1000).toFixed(0) + "k" : v}`} />
                          <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }} formatter={(v: number) => [formatCurrency(v), "P&L"]} />
                          <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                          <Bar dataKey="pnl" radius={[2, 2, 0, 0]}>
                            {result.trades.map((t, i) => (
                              <Cell key={i} fill={t.pnl >= 0 ? "#22c55e" : "#ef4444"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}

          {!running && !result && (
            <Card className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
              <p className="text-sm font-medium text-muted-foreground">Configure and run a backtest</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Real historical data is fetched from Dhan when broker is connected</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function generateSimulatedCandles(config: BacktestConfig): Candle[] {
  const candles: Candle[] = [];
  const fromMs = new Date(config.fromDate).getTime();
  const toMs = new Date(config.toDate).getTime();
  const days = Math.ceil((toMs - fromMs) / (24 * 3600 * 1000));
  let price = 22500;
  for (let d = 0; d < days; d++) {
    const date = new Date(fromMs + d * 24 * 3600 * 1000);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const ts = date.toISOString().split("T")[0];
    const change = (Math.random() - 0.48) * price * 0.015;
    const open = price;
    const close = Math.round((price + change) * 100) / 100;
    const high = Math.round(Math.max(open, close) * (1 + Math.random() * 0.005) * 100) / 100;
    const low = Math.round(Math.min(open, close) * (1 - Math.random() * 0.005) * 100) / 100;
    candles.push({ timestamp: ts, open, high, low, close, volume: Math.floor(100000 + Math.random() * 500000) });
    price = close;
  }
  return candles;
}
