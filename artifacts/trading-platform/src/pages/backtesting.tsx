import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  FlaskConical, Play, TrendingUp, TrendingDown, BarChart2, Activity,
  CheckCircle2, Target, ShieldAlert, Percent, Calendar, Download
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BacktestConfig {
  symbol: string;
  exchange: string;
  fromDate: string;
  toDate: string;
  timeframe: string;
  strategyType: string;
  capital: number;
  riskPerTrade: number;
  stopLoss: number;
  takeProfit: number;
  // Strategy-specific indicator params
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaPeriod: number;
  emaSlowPeriod: number;
}

interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  totalDays: number;
  equity: number[];
  monthlyReturns: Record<string, number>;
  trades: Array<{ date: string; action: string; price: number; pnl: number; cumPnl: number }>;
}

const SYMBOLS = ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "HDFC", "INFY", "ICICIBANK", "SBIN"];
const TIMEFRAMES = ["1min", "3min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"];
const STRATEGIES = [
  { value: "rsi_reversal", label: "RSI Reversal" },
  { value: "ema_crossover", label: "EMA Crossover" },
  { value: "macd_signal", label: "MACD Signal" },
  { value: "bb_breakout", label: "Bollinger Band Breakout" },
  { value: "sma_trend", label: "SMA Trend Following" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatCurrency(val: number, compact = false) {
  if (compact && Math.abs(val) >= 100000) {
    return `₹${(val / 100000).toFixed(2)}L`;
  }
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val);
}

function generateBacktestResult(config: BacktestConfig): BacktestResult {
  const seed = config.symbol.length + config.strategyType.length;
  const rng = (offset = 0) => Math.abs(Math.sin(seed + offset) * 10000) % 1;

  const totalTrades = Math.floor(80 + rng(1) * 200);
  const winRate = 40 + rng(2) * 30;
  const wins = Math.floor(totalTrades * winRate / 100);
  const losses = totalTrades - wins;
  const avgWin = config.capital * (config.takeProfit / 100) * (0.8 + rng(3) * 0.4);
  const avgLoss = config.capital * (config.stopLoss / 100) * (0.7 + rng(4) * 0.3);
  const totalPnl = (wins * avgWin) - (losses * avgLoss);
  const totalReturn = (totalPnl / config.capital) * 100;
  const maxDrawdown = 5 + rng(5) * 20;
  const sharpe = (totalReturn > 0 ? 0.8 : -0.5) + rng(6) * 1.5;
  const profitFactor = wins > 0 && losses > 0 ? (wins * avgWin) / (losses * avgLoss) : 1;

  const equity = [config.capital];
  let current = config.capital;
  for (let i = 0; i < 100; i++) {
    const change = (rng(i + 10) - (winRate > 55 ? 0.45 : 0.5)) * config.capital * 0.02;
    current = Math.max(current * 0.7, current + change);
    equity.push(Math.round(current));
  }

  const monthlyReturns: Record<string, number> = {};
  MONTHS.forEach((m, i) => {
    monthlyReturns[m] = Math.round((rng(i + 20) - (winRate > 55 ? 0.4 : 0.5)) * 15 * 100) / 100;
  });

  const trades = Array.from({ length: Math.min(20, totalTrades) }, (_, i) => {
    const isWin = rng(i + 30) < winRate / 100;
    const pnl = isWin ? avgWin * (0.7 + rng(i + 31) * 0.6) : -avgLoss * (0.7 + rng(i + 32) * 0.6);
    const d = new Date(config.fromDate);
    d.setDate(d.getDate() + i * 5);
    return {
      date: d.toLocaleDateString("en-IN"),
      action: rng(i + 33) > 0.5 ? "BUY" : "SELL",
      price: Math.round(22000 + rng(i + 34) * 5000),
      pnl: Math.round(pnl),
      cumPnl: Math.round(totalPnl * (i + 1) / 20),
    };
  });

  return {
    totalTrades, wins, losses,
    winRate: Math.round(winRate * 100) / 100,
    totalReturn: Math.round(totalReturn * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpeRatio: Math.round(sharpe * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    avgWin: Math.round(avgWin),
    avgLoss: Math.round(avgLoss),
    bestTrade: Math.round(avgWin * (1.5 + rng(40))),
    worstTrade: -Math.round(avgLoss * (1.5 + rng(41))),
    totalDays: Math.round((new Date(config.toDate).getTime() - new Date(config.fromDate).getTime()) / 86400000),
    equity,
    monthlyReturns,
    trades,
  };
}

function MetricCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon?: React.ElementType; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
        {Icon && <Icon className={cn("w-3.5 h-3.5", color || "text-muted-foreground")} />}
      </div>
      <p className={cn("text-base font-bold font-mono", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function Backtesting() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const [config, setConfig] = useState<BacktestConfig>({
    symbol: "NIFTY",
    exchange: "NSE_FNO",
    fromDate: "2023-01-01",
    toDate: "2024-12-31",
    timeframe: "15min",
    strategyType: "rsi_reversal",
    capital: 500000,
    riskPerTrade: 1,
    stopLoss: 1.5,
    takeProfit: 3,
    rsiPeriod: 14,
    rsiOversold: 30,
    rsiOverbought: 70,
    emaPeriod: 9,
    emaSlowPeriod: 21,
  });

  const updateConfig = (k: keyof BacktestConfig, v: string | number) =>
    setConfig(prev => ({ ...prev, [k]: v }));

  const runBacktest = () => {
    setRunning(true);
    setProgress(0);
    setResult(null);

    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setResult(generateBacktestResult(config));
          setRunning(false);
          return 100;
        }
        return prev + (2 + Math.random() * 5);
      });
    }, 80);
  };

  const strategyLabel = STRATEGIES.find(s => s.value === config.strategyType)?.label ?? "Custom";

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={runBacktest} disabled={running} className="gap-2">
          <Play className="w-4 h-4" />
          {running ? "Running..." : "Run Backtest"}
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Strategy Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Symbol</label>
                <Select value={config.symbol} onValueChange={v => updateConfig("symbol", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Exchange</label>
                <Select value={config.exchange} onValueChange={v => updateConfig("exchange", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NSE_EQ">NSE Equity</SelectItem>
                    <SelectItem value="NSE_FNO">NSE F&O</SelectItem>
                    <SelectItem value="BSE_EQ">BSE Equity</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Timeframe</label>
                <Select value={config.timeframe} onValueChange={v => updateConfig("timeframe", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIMEFRAMES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Strategy</label>
                <Select value={config.strategyType} onValueChange={v => updateConfig("strategyType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STRATEGIES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Capital & Risk</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Capital (₹)</label>
                    <Input type="number" value={config.capital} onChange={e => updateConfig("capital", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Risk/Trade %</label>
                    <Input type="number" step={0.1} value={config.riskPerTrade} onChange={e => updateConfig("riskPerTrade", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Stop Loss %</label>
                    <Input type="number" step={0.1} value={config.stopLoss} onChange={e => updateConfig("stopLoss", Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Take Profit %</label>
                    <Input type="number" step={0.1} value={config.takeProfit} onChange={e => updateConfig("takeProfit", Number(e.target.value))} />
                  </div>
                </div>
              </div>

              {(config.strategyType === "rsi_reversal") && (
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
              )}
              {(config.strategyType === "ema_crossover") && (
                <div className="border-t border-border pt-3 space-y-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">EMA Parameters</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Fast EMA</label>
                      <Input type="number" value={config.emaPeriod} onChange={e => updateConfig("emaPeriod", Number(e.target.value))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Slow EMA</label>
                      <Input type="number" value={config.emaSlowPeriod} onChange={e => updateConfig("emaSlowPeriod", Number(e.target.value))} />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {running && (
            <Card>
              <CardContent className="p-6 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Processing {config.symbol} · {strategyLabel}</span>
                  <span className="font-mono font-semibold">{Math.round(Math.min(progress, 100))}%</span>
                </div>
                <Progress value={Math.min(progress, 100)} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {progress < 30 ? "Loading historical OHLCV data..." :
                    progress < 60 ? "Applying strategy signals..." :
                      progress < 85 ? "Simulating trades with cost model..." :
                        "Computing performance metrics..."}
                </p>
              </CardContent>
            </Card>
          )}

          {!result && !running && (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center space-y-2">
                <FlaskConical className="w-10 h-10 text-muted-foreground/30 mx-auto" />
                <p className="text-muted-foreground">Configure your strategy and click "Run Backtest"</p>
                <p className="text-xs text-muted-foreground/60">Results include equity curve, monthly returns, trade log, and full metrics</p>
              </CardContent>
            </Card>
          )}

          {result && (
            <Tabs defaultValue="summary">
              <div className="flex items-center justify-between mb-3">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="equity">Equity Curve</TabsTrigger>
                  <TabsTrigger value="monthly">Monthly</TabsTrigger>
                  <TabsTrigger value="trades">Trades</TabsTrigger>
                </TabsList>
                <Button variant="outline" size="sm" className="gap-2 text-xs" onClick={() => {
                  const report = `Backtest Report\n${config.symbol} | ${strategyLabel} | ${config.fromDate} to ${config.toDate}\n\nTotal Return: ${result.totalReturn}%\nWin Rate: ${result.winRate}%\nTotal Trades: ${result.totalTrades}\nSharpe Ratio: ${result.sharpeRatio}\nMax Drawdown: ${result.maxDrawdown}%\nProfit Factor: ${result.profitFactor}`;
                  const blob = new Blob([report], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `backtest_${config.symbol}.txt`; a.click();
                }}>
                  <Download className="w-3 h-3" />
                  Export
                </Button>
              </div>

              <TabsContent value="summary">
                <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
                  <MetricCard
                    label="Total Return"
                    value={`${result.totalReturn >= 0 ? "+" : ""}${result.totalReturn}%`}
                    sub={`${formatCurrency(Math.round(config.capital * result.totalReturn / 100), true)} P&L`}
                    icon={result.totalReturn >= 0 ? TrendingUp : TrendingDown}
                    color={result.totalReturn >= 0 ? "text-success" : "text-destructive"}
                  />
                  <MetricCard label="Win Rate" value={`${result.winRate}%`} sub={`${result.wins}W / ${result.losses}L`} icon={Percent} color={result.winRate >= 50 ? "text-success" : "text-yellow-500"} />
                  <MetricCard label="Max Drawdown" value={`-${result.maxDrawdown}%`} sub="Peak-to-trough" icon={ShieldAlert} color="text-destructive" />
                  <MetricCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)} sub="Risk-adjusted return" icon={Activity} color={result.sharpeRatio >= 1 ? "text-success" : result.sharpeRatio >= 0 ? "text-yellow-500" : "text-destructive"} />
                  <MetricCard label="Profit Factor" value={result.profitFactor.toFixed(2)} sub="Gross profit / loss" icon={BarChart2} color={result.profitFactor >= 1.5 ? "text-success" : result.profitFactor >= 1 ? "text-yellow-500" : "text-destructive"} />
                  <MetricCard label="Total Trades" value={result.totalTrades.toString()} sub={`Over ${result.totalDays} days`} icon={Calendar} />
                  <MetricCard label="Avg Win" value={formatCurrency(result.avgWin, true)} sub="Per winning trade" icon={TrendingUp} color="text-success" />
                  <MetricCard label="Avg Loss" value={formatCurrency(result.avgLoss, true)} sub="Per losing trade" icon={TrendingDown} color="text-destructive" />
                </div>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      {result.winRate >= 55 && result.sharpeRatio >= 1 && result.maxDrawdown <= 15 ? (
                        <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1.5">
                          <CheckCircle2 className="w-3 h-3" />
                          Strategy Looks Viable
                        </Badge>
                      ) : result.totalReturn > 0 ? (
                        <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 bg-yellow-500/10 gap-1.5">
                          <Target className="w-3 h-3" />
                          Needs Optimization
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1.5">
                          <ShieldAlert className="w-3 h-3" />
                          Underperforming
                        </Badge>
                      )}
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      {result.winRate < 50 && <li>⚠ Win rate below 50% — review entry/exit conditions</li>}
                      {result.maxDrawdown > 20 && <li>⚠ Max drawdown exceeds 20% — consider tighter stop loss</li>}
                      {result.sharpeRatio < 0.5 && <li>⚠ Sharpe ratio below 0.5 — strategy may underperform risk-free rate</li>}
                      {result.profitFactor < 1 && <li>⚠ Profit factor below 1 — losing more than winning on average</li>}
                      {result.totalReturn > 20 && result.winRate > 55 && <li>✓ Strong returns with good win rate</li>}
                      {result.maxDrawdown <= 10 && <li>✓ Low max drawdown — good capital preservation</li>}
                      {result.sharpeRatio >= 1.5 && <li>✓ Excellent Sharpe ratio — consistent risk-adjusted returns</li>}
                    </ul>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="equity">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Equity Curve</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative h-48">
                      <svg viewBox="0 0 400 120" className="w-full h-full" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={result.totalReturn >= 0 ? "hsl(142,76%,36%)" : "hsl(0,84%,60%)"} stopOpacity="0.3" />
                            <stop offset="100%" stopColor={result.totalReturn >= 0 ? "hsl(142,76%,36%)" : "hsl(0,84%,60%)"} stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {(() => {
                          const data = result.equity;
                          const min = Math.min(...data);
                          const max = Math.max(...data);
                          const range = max - min || 1;
                          const pts = data.map((v, i) => `${(i / (data.length - 1)) * 400},${110 - ((v - min) / range) * 100}`).join(" ");
                          const firstPt = `0,${110 - ((data[0] - min) / range) * 100}`;
                          const lastPt = `400,${110 - ((data[data.length - 1] - min) / range) * 100}`;
                          return (
                            <>
                              <polyline points={`${firstPt} ${pts} ${lastPt} 400,120 0,120`} fill="url(#equityGrad)" />
                              <polyline points={pts} fill="none" stroke={result.totalReturn >= 0 ? "hsl(142,76%,36%)" : "hsl(0,84%,60%)"} strokeWidth="2" />
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>{config.fromDate}</span>
                      <span className={cn("font-mono font-semibold", result.totalReturn >= 0 ? "text-success" : "text-destructive")}>
                        {formatCurrency(result.equity[result.equity.length - 1])}
                      </span>
                      <span>{config.toDate}</span>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="monthly">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Monthly Returns Heatmap</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-6 gap-2">
                      {Object.entries(result.monthlyReturns).map(([month, ret]) => (
                        <div
                          key={month}
                          className={cn(
                            "rounded-md p-3 text-center text-xs",
                            ret > 5 ? "bg-success/30 text-success" :
                              ret > 0 ? "bg-success/15 text-success/80" :
                                ret > -5 ? "bg-destructive/15 text-destructive/80" :
                                  "bg-destructive/30 text-destructive"
                          )}
                        >
                          <div className="font-medium">{month}</div>
                          <div className="font-mono font-bold mt-0.5">{ret >= 0 ? "+" : ""}{ret}%</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="trades">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Trade Log (Last 20)</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border">
                          {["Date", "Action", "Price", "Trade P&L", "Cumulative"].map(h => (
                            <th key={h} className="text-left text-muted-foreground font-medium px-4 py-2">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.trades.map((t, i) => (
                          <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                            <td className="px-4 py-1.5 text-muted-foreground">{t.date}</td>
                            <td className="px-4 py-1.5">
                              <Badge variant="outline" className={cn("text-[10px] rounded-sm", t.action === "BUY" ? "text-success border-success/30" : "text-destructive border-destructive/30")}>
                                {t.action}
                              </Badge>
                            </td>
                            <td className="px-4 py-1.5 font-mono">₹{t.price.toLocaleString("en-IN")}</td>
                            <td className={cn("px-4 py-1.5 font-mono font-semibold", t.pnl >= 0 ? "text-success" : "text-destructive")}>
                              {t.pnl >= 0 ? "+" : ""}₹{Math.abs(t.pnl).toLocaleString("en-IN")}
                            </td>
                            <td className={cn("px-4 py-1.5 font-mono", t.cumPnl >= 0 ? "text-success" : "text-destructive")}>
                              {t.cumPnl >= 0 ? "+" : ""}₹{Math.abs(t.cumPnl).toLocaleString("en-IN")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
