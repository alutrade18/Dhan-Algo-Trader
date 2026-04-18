import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, RefreshCw, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { marketSocket, type QuoteData } from "@/lib/market-socket";

const BASE = import.meta.env.BASE_URL;

const INDICES = [
  { label: "NIFTY 50", symbol: "NIFTY", securityId: 13, exchange: "IDX_I" },
  { label: "BANK NIFTY", symbol: "BANKNIFTY", securityId: 25, exchange: "IDX_I" },
] as const;

type IndexSymbol = (typeof INDICES)[number]["symbol"];

interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  displayTime?: string;
}

function formatTime(ts: string): string {
  if (!ts) return "";
  const parts = ts.split(" ");
  if (parts.length === 2) return parts[1].slice(0, 5);
  return ts.slice(11, 16) || ts;
}

function fmt(v: number, d = 2) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);
}

function OhlcBox({ label, value, className }: { label: string; value: number | null; className?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{label}</p>
      <p className={cn("text-sm font-bold font-mono mt-1", className)}>
        {value != null ? fmt(value) : "—"}
      </p>
    </div>
  );
}

export default function Charts() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialSymbol = (params.get("symbol") ?? "NIFTY") as IndexSymbol;
  const [symbol, setSymbol] = useState<IndexSymbol>(
    INDICES.some(i => i.symbol === initialSymbol) ? initialSymbol : "NIFTY"
  );

  const selectedIndex = INDICES.find(i => i.symbol === symbol)!;

  const [ltp, setLtp] = useState<number | null>(null);
  const [wsOpen, setWsOpen] = useState<number | null>(null);
  const prevLtpRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: rawCandles, isLoading, isFetching, refetch } = useQuery<Candle[]>({
    queryKey: ["intraday", symbol],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/market/intraday`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: String(selectedIndex.securityId),
          exchangeSegment: selectedIndex.exchange,
          instrumentType: "INDEX",
        }),
      });
      if (!res.ok) throw new Error("Failed to fetch chart data");
      const json = await res.json() as { data: Candle[] };
      return (json.data ?? []).map((c) => ({
        ...c,
        displayTime: formatTime(c.timestamp),
      }));
    },
    staleTime: 55_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    setLtp(null);
    setWsOpen(null);
    prevLtpRef.current = null;

    const unsub = marketSocket.subscribeQuote(
      selectedIndex.exchange,
      selectedIndex.securityId,
      (data: QuoteData) => {
        if (data.ltp != null) {
          const prev = prevLtpRef.current;
          if (prev !== null && data.ltp !== prev) {
            setFlash(data.ltp > prev ? "up" : "down");
            if (flashTimer.current) clearTimeout(flashTimer.current);
            flashTimer.current = setTimeout(() => setFlash(null), 500);
          }
          prevLtpRef.current = data.ltp;
          setLtp(data.ltp);
        }
        if (data.open != null) setWsOpen(data.open);
      }
    );
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [symbol, selectedIndex.exchange, selectedIndex.securityId]);

  const chartCandles: Candle[] = (() => {
    if (!rawCandles?.length) return [];
    const candles = [...rawCandles];
    if (ltp != null && candles.length > 0) {
      candles[candles.length - 1] = { ...candles[candles.length - 1], close: ltp };
    }
    return candles;
  })();

  const openPrice = wsOpen ?? rawCandles?.[0]?.open ?? null;
  const lastClose = chartCandles[chartCandles.length - 1]?.close ?? null;
  const currentPrice = ltp ?? lastClose;
  const change = openPrice != null && currentPrice != null ? currentPrice - openPrice : null;
  const changePct = openPrice != null && openPrice > 0 && change != null ? (change / openPrice) * 100 : null;
  const isPositive = (change ?? 0) >= 0;

  const priceColor = isPositive ? "#22c55e" : "#ef4444";

  const allLows = chartCandles.map(c => c.low).filter(Boolean);
  const allHighs = chartCandles.map(c => c.high).filter(Boolean);
  const domainPad = (v: number) => v * 0.0005;
  const yMin = allLows.length ? Math.min(...allLows) - domainPad(Math.min(...allLows)) : "auto";
  const yMax = allHighs.length ? Math.max(...allHighs) + domainPad(Math.max(...allHighs)) : "auto";

  const dayHigh = allHighs.length ? Math.max(...allHighs) : null;
  const dayLow = allLows.length ? Math.min(...allLows) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          {INDICES.map((idx) => (
            <Button
              key={idx.symbol}
              variant={symbol === idx.symbol ? "default" : "outline"}
              size="sm"
              className="h-8 px-5 text-sm font-semibold"
              onClick={() => setSymbol(idx.symbol)}
            >
              {idx.label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">
            NSE · {selectedIndex.label} · Intraday
          </p>
          <div
            className={cn(
              "text-4xl font-bold font-mono tracking-tight transition-colors duration-300",
              flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
            )}
          >
            {currentPrice != null ? fmt(currentPrice) : "—"}
          </div>
          {change != null && changePct != null && (
            <div className={cn(
              "flex items-center gap-1.5 text-sm font-mono mt-1.5",
              isPositive ? "text-success" : "text-destructive",
            )}>
              {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              <span>{isPositive ? "+" : ""}{fmt(change)}</span>
              <span className="opacity-80">({isPositive ? "+" : ""}{fmt(changePct)}%)</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <Activity className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">1-min candles · live</span>
          {ltp != null && (
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <div className="h-[340px] w-full">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading chart data…</span>
            </div>
          ) : chartCandles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2">
              <Activity className="w-6 h-6 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground text-center">
                No intraday data available
                <br />
                <span className="text-xs">Market may be closed or broker not connected</span>
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartCandles} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={priceColor} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={priceColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis
                  dataKey="displayTime"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  minTickGap={70}
                />
                <YAxis
                  domain={[yMin, yMax]}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(v)
                  }
                  tickLine={false}
                  axisLine={false}
                  width={68}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    padding: "8px 12px",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))", marginBottom: 4 }}
                  formatter={(value: number, name: string) => [fmt(value), name === "close" ? "Price" : name]}
                  labelFormatter={(label) => `Time: ${label}`}
                />
                {openPrice != null && (
                  <ReferenceLine
                    y={openPrice}
                    stroke="rgba(255,255,255,0.18)"
                    strokeDasharray="5 4"
                    label={{ value: "Open", fill: "hsl(var(--muted-foreground))", fontSize: 9, position: "insideTopLeft" }}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={priceColor}
                  strokeWidth={1.8}
                  fill={`url(#grad-${symbol})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: priceColor }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {chartCandles.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-3">Volume</p>
          <div className="h-[90px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartCandles} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="displayTime" hide />
                <YAxis
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) =>
                    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)
                  }
                  tickLine={false}
                  axisLine={false}
                  width={42}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    borderColor: "hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                    padding: "8px 12px",
                  }}
                  formatter={(value: number) => [new Intl.NumberFormat("en-IN").format(value), "Volume"]}
                  labelFormatter={(label) => `Time: ${label}`}
                />
                <Area
                  type="monotone"
                  dataKey="volume"
                  stroke="rgba(99,102,241,0.5)"
                  fill="rgba(99,102,241,0.12)"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {chartCandles.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OhlcBox label="Open" value={openPrice} />
          <OhlcBox label="High" value={dayHigh} className="text-success" />
          <OhlcBox label="Low" value={dayLow} className="text-destructive" />
          <OhlcBox label="LTP" value={currentPrice} className={isPositive ? "text-success" : "text-destructive"} />
        </div>
      )}
    </div>
  );
}
