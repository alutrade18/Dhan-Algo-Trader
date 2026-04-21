import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { marketSocket, type QuoteData } from "@/lib/market-socket";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL;

const INDICES = [
  { label: "NIFTY 50", symbol: "NIFTY", securityId: 13, exchange: "IDX_I" },
  { label: "BANK NIFTY", symbol: "BANKNIFTY", securityId: 25, exchange: "IDX_I" },
] as const;

type IndexSymbol = (typeof INDICES)[number]["symbol"];

const TIMEFRAMES = [
  { label: "1m",  value: "1"  },
  { label: "3m",  value: "3"  },
  { label: "5m",  value: "5"  },
  { label: "15m", value: "15" },
  { label: "30m", value: "30" },
] as const;

type Interval = (typeof TIMEFRAMES)[number]["value"];

interface RawCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HealthData {
  marketOpen: boolean;
  brokerConnected: boolean;
}

function fmt(v: number, d = 2) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(v);
}

function OhlcBox({
  label,
  value,
  className,
}: {
  label: string;
  value: number | null;
  className?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className={cn("text-sm font-bold font-mono mt-1", className)}>
        {value != null ? fmt(value) : "—"}
      </p>
    </div>
  );
}

function parseISTtoUTC(ts: string): UTCTimestamp {
  const [datePart, timePart] = ts.split(" ");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min, s] = (timePart ?? "00:00:00").split(":").map(Number);
  const utcMs =
    Date.UTC(y, m - 1, d, h, min, s ?? 0) - 5.5 * 60 * 60 * 1000;
  return (utcMs / 1000) as UTCTimestamp;
}

const CANDLE_UP = "#22c55e";
const CANDLE_DOWN = "#ef4444";
const CANDLE_BORDER_UP = "#16a34a";
const CANDLE_BORDER_DOWN = "#dc2626";
const PRICE_LINE_COLOR = "#f59e0b";

export default function Charts() {
  const [symbol, setSymbol] = useState<IndexSymbol>("NIFTY");
  const [interval, setInterval] = useState<Interval>("1");

  const selectedIndex = INDICES.find((i) => i.symbol === symbol)!;

  const [ltp, setLtp] = useState<number | null>(null);
  const [wsOpen, setWsOpen] = useState<number | null>(null);
  const prevLtpRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const liveRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);

  const staleMs = Number(interval) * 60_000;

  const { data: health } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), staleTime: 25_000, refetchInterval: 30_000 },
  });
  const healthData = health as unknown as HealthData | undefined;
  const brokerConnected = healthData?.brokerConnected ?? true;
  const marketOpen = healthData?.marketOpen ?? true;
  const marketClosed = !brokerConnected || !marketOpen;

  const { data: rawCandles, isLoading, isFetching, refetch } = useQuery<RawCandle[]>({
    queryKey: ["intraday", symbol, interval],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/market/intraday`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: String(selectedIndex.securityId),
          exchangeSegment: selectedIndex.exchange,
          instrumentType: "INDEX",
          interval,
        }),
      });
      if (!res.ok) throw new Error("Failed to fetch chart data");
      const json = (await res.json()) as { data: RawCandle[] };
      return json.data ?? [];
    },
    staleTime: staleMs - 5_000,
    refetchInterval: staleMs,
  });

  const createChartInstance = (
    container: HTMLDivElement,
    height: number,
  ): IChartApi => {
    return createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: "hsl(215, 20%, 55%)",
        fontSize: 11,
        fontFamily: "'Inter', 'ui-monospace', monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#1e293b" },
        horzLine: { color: "rgba(255,255,255,0.15)", labelBackgroundColor: "#1e293b" },
      },
      rightPriceScale: {
        borderColor: "rgba(255,255,255,0.06)",
        scaleMargins: { top: 0.15, bottom: 0.15 },
        minimumWidth: 72,
        autoScale: true,
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
        visible: true,
        rightOffset: 5,
        tickMarkFormatter: (time: number) => {
          const ist = new Date((time + 5.5 * 3600) * 1000);
          return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { mouseWheel: true, pinch: true, axisDoubleClickReset: true },
    });
  };

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    const mainChart = createChartInstance(container, 380);
    chartRef.current = mainChart;

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: CANDLE_UP,
      downColor: CANDLE_DOWN,
      borderUpColor: CANDLE_BORDER_UP,
      borderDownColor: CANDLE_BORDER_DOWN,
      wickUpColor: CANDLE_UP,
      wickDownColor: CANDLE_DOWN,
      lastValueVisible: true,
      priceLineVisible: false,
    });
    candleSeriesRef.current = candleSeries;

    const ro = new ResizeObserver(() => {
      mainChart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      mainChart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      liveRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    const container = chartContainerRef.current;
    if (!series || !chart || !rawCandles) return;

    if (container) chart.applyOptions({ width: container.clientWidth });

    const seen = new Set<number>();
    const candleData: CandlestickData<UTCTimestamp>[] = [];

    for (const c of rawCandles) {
      const time = parseISTtoUTC(c.timestamp);
      if (seen.has(time)) continue;
      seen.add(time);
      candleData.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
    }

    candleData.sort((a, b) => a.time - b.time);
    series.setData(candleData);
    chart.timeScale().fitContent();
    chart.priceScale("right").applyOptions({ autoScale: true });
    liveRef.current = candleData[candleData.length - 1] ?? null;

    if (ltp != null) {
      if (priceLineRef.current) {
        priceLineRef.current.applyOptions({ price: ltp });
      } else {
        priceLineRef.current = series.createPriceLine({
          price: ltp,
          color: PRICE_LINE_COLOR,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "LTP",
        });
      }
    }
  }, [rawCandles]);

  useEffect(() => {
    setLtp(null);
    setWsOpen(null);
    prevLtpRef.current = null;
    liveRef.current = null;
    if (priceLineRef.current && candleSeriesRef.current) {
      try { candleSeriesRef.current.removePriceLine(priceLineRef.current); } catch {}
      priceLineRef.current = null;
    }

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

          const series = candleSeriesRef.current;
          if (series) {
            if (priceLineRef.current) {
              priceLineRef.current.applyOptions({ price: data.ltp });
            } else {
              priceLineRef.current = series.createPriceLine({
                price: data.ltp,
                color: PRICE_LINE_COLOR,
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: "LTP",
              });
            }
          }

          if (series && liveRef.current) {
            const updated: CandlestickData<UTCTimestamp> = {
              ...liveRef.current,
              close: data.ltp,
              high: Math.max(liveRef.current.high, data.ltp),
              low: Math.min(liveRef.current.low, data.ltp),
            };
            liveRef.current = updated;
            series.update(updated);
          }
        }
        if (data.open != null) setWsOpen(data.open);
      }
    );
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [symbol, selectedIndex.exchange, selectedIndex.securityId]);

  const lastCandle = rawCandles?.[rawCandles.length - 1];
  const openPrice = wsOpen ?? rawCandles?.[0]?.open ?? null;
  const currentPrice = ltp ?? lastCandle?.close ?? null;
  const change =
    openPrice != null && currentPrice != null ? currentPrice - openPrice : null;
  const changePct =
    openPrice != null && openPrice > 0 && change != null
      ? (change / openPrice) * 100
      : null;
  const isPositive = (change ?? 0) >= 0;

  const allHighs = rawCandles?.map((c) => c.high) ?? [];
  const allLows = rawCandles?.map((c) => c.low) ?? [];
  const dayHigh = allHighs.length ? Math.max(...allHighs) : null;
  const dayLow = allLows.length ? Math.min(...allLows) : null;

  const hasData = (rawCandles?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* Top bar: index selector + refresh */}
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

      {/* Price header */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div
            className={cn(
              "text-4xl font-bold font-mono tracking-tight transition-colors duration-300",
              flash === "up"
                ? "text-success"
                : flash === "down"
                ? "text-destructive"
                : "text-foreground"
            )}
          >
            {currentPrice != null ? fmt(currentPrice) : "—"}
          </div>
          {change != null && changePct != null && (
            <div
              className={cn(
                "flex items-center gap-1.5 text-sm font-mono mt-1.5",
                isPositive ? "text-success" : "text-destructive"
              )}
            >
              {isPositive ? (
                <TrendingUp className="w-4 h-4" />
              ) : (
                <TrendingDown className="w-4 h-4" />
              )}
              <span>
                {isPositive ? "+" : ""}
                {fmt(change)}
              </span>
              <span className="opacity-80">
                ({isPositive ? "+" : ""}
                {fmt(changePct)}%)
              </span>
            </div>
          )}
        </div>
        {ltp != null && (
          <span className="w-2 h-2 rounded-full bg-success animate-pulse inline-block mb-2" />
        )}
      </div>

      {/* Main candlestick chart */}
      <div className="bg-card border border-border rounded-xl p-4 overflow-hidden">
        {/* Timeframe selector */}
        <div className="flex items-center gap-1.5 mb-3">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setInterval(tf.value)}
              className={cn(
                "px-2.5 py-0.5 rounded text-xs font-semibold transition-colors",
                interval === tf.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              )}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="relative" style={{ height: 380 }}>
          {marketClosed && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-card/90 rounded-lg">
              <div className="w-10 h-10 rounded-full bg-muted/40 flex items-center justify-center">
                <svg className="w-5 h-5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-muted-foreground">Market is Closed</p>
              <p className="text-xs text-muted-foreground/60">
                {!brokerConnected ? "Broker not connected" : "Outside trading hours"}
              </p>
            </div>
          )}
          {!marketClosed && (isLoading || !hasData) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-card/80">
              {isLoading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading chart data…</span>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center">No intraday data available</p>
              )}
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>
      </div>

      {/* OHLC summary boxes */}
      {hasData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <OhlcBox label="Open" value={openPrice} />
          <OhlcBox label="High" value={dayHigh} className="text-success" />
          <OhlcBox label="Low" value={dayLow} className="text-destructive" />
          <OhlcBox
            label="LTP"
            value={currentPrice}
            className={isPositive ? "text-success" : "text-destructive"}
          />
        </div>
      )}
    </div>
  );
}
