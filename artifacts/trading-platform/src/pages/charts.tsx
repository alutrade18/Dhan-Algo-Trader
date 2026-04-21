import { useState, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
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

const TIMEFRAMES = [
  { label: "1m",  value: "1"  },
  { label: "5m",  value: "5"  },
  { label: "15m", value: "15" },
  { label: "25m", value: "25" },
  { label: "60m", value: "60" },
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
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialSymbol = (params.get("symbol") ?? "NIFTY") as IndexSymbol;
  const [symbol, setSymbol] = useState<IndexSymbol>(
    INDICES.some((i) => i.symbol === initialSymbol) ? initialSymbol : "NIFTY"
  );
  const [interval, setInterval] = useState<Interval>("1");

  const selectedIndex = INDICES.find((i) => i.symbol === symbol)!;

  const [ltp, setLtp] = useState<number | null>(null);
  const [wsOpen, setWsOpen] = useState<number | null>(null);
  const prevLtpRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const volContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const volChartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<typeof CandlestickSeries> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<typeof HistogramSeries> | null>(null);
  const liveRef = useRef<CandlestickData<UTCTimestamp> | null>(null);
  const priceLineRef = useRef<IPriceLine | null>(null);

  const staleMs = Number(interval) * 60_000;

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
    showTimeScale: boolean
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
        // Symmetric margins so current price stays centered in the visible range
        scaleMargins: { top: 0.15, bottom: 0.15 },
        minimumWidth: 72,
        autoScale: true,
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
        visible: showTimeScale,
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

  // Create chart instances once on mount
  useEffect(() => {
    const container = chartContainerRef.current;
    const volContainer = volContainerRef.current;
    if (!container || !volContainer) return;

    const mainChart = createChartInstance(container, 360, true);
    chartRef.current = mainChart;

    const candleSeries = mainChart.addSeries(CandlestickSeries, {
      upColor: CANDLE_UP,
      downColor: CANDLE_DOWN,
      borderUpColor: CANDLE_BORDER_UP,
      borderDownColor: CANDLE_BORDER_DOWN,
      wickUpColor: CANDLE_UP,
      wickDownColor: CANDLE_DOWN,
      lastValueVisible: true,
      priceLineVisible: false, // we manage our own price line
    });
    candleSeriesRef.current = candleSeries;

    const volChart = createChartInstance(volContainer, 90, false);
    volChartRef.current = volChart;

    const volSeries = volChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "right",
      color: "rgba(99,102,241,0.45)",
    });
    volSeriesRef.current = volSeries;

    const ro = new ResizeObserver(() => {
      mainChart.applyOptions({ width: container.clientWidth });
      volChart.applyOptions({ width: volContainer.clientWidth });
    });
    ro.observe(container);
    ro.observe(volContainer);

    return () => {
      ro.disconnect();
      mainChart.remove();
      volChart.remove();
      chartRef.current = null;
      volChartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      liveRef.current = null;
      priceLineRef.current = null;
    };
  }, []);

  // Load candle data whenever it changes (symbol or interval switch)
  useEffect(() => {
    const series = candleSeriesRef.current;
    const volSeries = volSeriesRef.current;
    const chart = chartRef.current;
    const volChart = volChartRef.current;
    const container = chartContainerRef.current;
    const volContainer = volContainerRef.current;
    if (!series || !volSeries || !chart || !volChart || !rawCandles) return;

    // Ensure correct dimensions in case container was zero-width at mount
    if (container) chart.applyOptions({ width: container.clientWidth });
    if (volContainer) volChart.applyOptions({ width: volContainer.clientWidth });

    const seen = new Set<number>();
    const candleData: CandlestickData<UTCTimestamp>[] = [];
    const volData: HistogramData<UTCTimestamp>[] = [];

    for (const c of rawCandles) {
      const time = parseISTtoUTC(c.timestamp);
      if (seen.has(time)) continue;
      seen.add(time);
      candleData.push({ time, open: c.open, high: c.high, low: c.low, close: c.close });
      volData.push({
        time,
        value: c.volume,
        color: c.close >= c.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
      });
    }

    candleData.sort((a, b) => a.time - b.time);
    volData.sort((a, b) => a.time - b.time);

    series.setData(candleData);
    volSeries.setData(volData);

    // fitContent auto-scales price axis to fit all visible candles
    chart.timeScale().fitContent();
    volChart.timeScale().fitContent();

    // Re-enable autoScale after setting data (resets any manual pan drift)
    chart.priceScale("right").applyOptions({ autoScale: true });

    liveRef.current = candleData[candleData.length - 1] ?? null;

    // Restore / create the LTP price line if we have a live price
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

  // WebSocket live ticks
  useEffect(() => {
    setLtp(null);
    setWsOpen(null);
    prevLtpRef.current = null;
    liveRef.current = null;
    // Remove stale price line when switching symbol
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
          const volSeries = volSeriesRef.current;

          // Update or create the price line
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

          // Update the live (current) candle
          if (series && liveRef.current) {
            const updated: CandlestickData<UTCTimestamp> = {
              ...liveRef.current,
              close: data.ltp,
              high: Math.max(liveRef.current.high, data.ltp),
              low: Math.min(liveRef.current.low, data.ltp),
            };
            liveRef.current = updated;
            series.update(updated);
            if (volSeries && data.volume != null) {
              volSeries.update({
                time: updated.time,
                value: data.volume,
                color:
                  updated.close >= updated.open
                    ? "rgba(34,197,94,0.35)"
                    : "rgba(239,68,68,0.35)",
              });
            }
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

  const tfLabel = TIMEFRAMES.find((t) => t.value === interval)?.label ?? interval;

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
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold mb-1">
            NSE · {selectedIndex.label} · {tfLabel} Candles
          </p>
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
        <div className="flex items-center gap-1.5 mb-2">
          <Activity className="w-3 h-3 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Candlestick · live WS</span>
          {ltp != null && (
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
          )}
        </div>
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

        <div className="relative" style={{ height: 360 }}>
          {(isLoading || !hasData) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10 bg-card/80">
              {isLoading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading chart data…</span>
                </>
              ) : (
                <>
                  <Activity className="w-6 h-6 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground text-center">
                    No intraday data available
                    <br />
                    <span className="text-xs">Market may be closed or broker not connected</span>
                  </p>
                </>
              )}
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>
      </div>

      {/* Volume chart */}
      <div className="bg-card border border-border rounded-xl px-4 pt-3 pb-2 overflow-hidden">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">
          Volume
        </p>
        <div className="relative" style={{ height: 90 }}>
          {(isLoading || !hasData) && (
            <div className="absolute inset-0 bg-card/80 z-10" />
          )}
          <div ref={volContainerRef} className="w-full h-full" />
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
