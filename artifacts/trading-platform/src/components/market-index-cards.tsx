import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketSocket, type QuoteData } from "@/lib/market-socket";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface MarketIndex {
  name: string;
  symbol: string;
  securityId: number;
  exchange: string;
  lotSize: number;
  expiry?: string;
}

function fmt(v: number, decimals = 2) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function IndexCard({ index }: { index: MarketIndex }) {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const prevLtp = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = marketSocket.subscribeQuote(index.exchange, index.securityId, (data) => {
      setQuote(data);
      if (prevLtp.current !== null && data.ltp !== prevLtp.current) {
        const dir = data.ltp > prevLtp.current ? "up" : "down";
        setFlash(dir);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 600);
      }
      prevLtp.current = data.ltp;
    });
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [index.exchange, index.securityId]);

  const ltp = quote?.ltp ?? null;
  const open = quote?.open ?? null;
  const high = quote?.high ?? null;
  const low = quote?.low ?? null;

  const change = ltp !== null && open !== null ? ltp - open : null;
  const changePct = change !== null && open !== null && open !== 0 ? (change / open) * 100 : null;
  const positive = change !== null && change >= 0;

  const isMCX = index.exchange === "MCX_COMM";
  const decimals = isMCX ? 0 : 2;

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card p-3 md:p-4 flex flex-col gap-1.5 transition-colors duration-300 min-w-0",
        flash === "up" && "bg-success/5 border-success/30",
        flash === "down" && "bg-destructive/5 border-destructive/30",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
            {index.exchange === "IDX_I" ? "NSE INDEX" : "MCX"}
          </p>
          <p className="text-sm font-bold text-foreground leading-tight truncate">{index.name}</p>
          {index.expiry && (
            <p className="text-[9px] text-muted-foreground/60">{index.expiry}</p>
          )}
        </div>
        {change !== null ? (
          positive ? (
            <TrendingUp className="w-4 h-4 text-success shrink-0 mt-0.5" />
          ) : (
            <TrendingDown className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          )
        ) : (
          <Minus className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-0.5" />
        )}
      </div>

      <div className="flex items-baseline gap-2 flex-wrap">
        <span
          className={cn(
            "text-lg md:text-xl font-bold font-mono tabular-nums transition-colors duration-300",
            flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
          )}
        >
          {ltp !== null ? fmt(ltp, decimals) : <span className="text-muted-foreground/40 text-base">—</span>}
        </span>
        {change !== null && changePct !== null && (
          <span
            className={cn(
              "text-xs font-semibold font-mono tabular-nums",
              positive ? "text-success" : "text-destructive",
            )}
          >
            {positive ? "+" : ""}{fmt(change, decimals)} ({positive ? "+" : ""}{fmt(changePct, 2)}%)
          </span>
        )}
      </div>

      {(high !== null || low !== null) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
          {high !== null && <span>H: <span className="text-success/80">{fmt(high, decimals)}</span></span>}
          {low !== null && <span>L: <span className="text-destructive/80">{fmt(low, decimals)}</span></span>}
        </div>
      )}

      {ltp === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/50 rounded-xl">
          <div className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:0ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:300ms]" />
          </div>
        </div>
      )}
    </div>
  );
}

export function MarketIndexCards() {
  const { data: indices, isLoading, isError } = useQuery<MarketIndex[]>({
    queryKey: ["market-indices"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/market/indices`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch market indices");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-3 md:p-4 animate-pulse h-[90px]" />
        ))}
      </div>
    );
  }

  if (isError || !indices?.length) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {indices.map((index) => (
        <IndexCard key={`${index.exchange}:${index.securityId}`} index={index} />
      ))}
    </div>
  );
}
