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
        setFlash(data.ltp > prevLtp.current ? "up" : "down");
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
  const change = ltp !== null && open !== null ? ltp - open : null;
  const changePct = change !== null && open !== null && open !== 0 ? (change / open) * 100 : null;
  const positive = change !== null && change >= 0;

  return (
    <div
      className={cn(
        "relative rounded-xl border bg-card px-4 py-3 flex items-center justify-between gap-3 transition-colors duration-300 min-w-0",
        flash === "up" && "border-success/40 bg-success/5",
        flash === "down" && "border-destructive/40 bg-destructive/5",
        !flash && "border-border/50",
      )}
    >
      {/* Left: label + name */}
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/70 leading-none mb-1">
          NSE INDEX
        </p>
        <p className="text-sm font-bold text-foreground leading-tight truncate">{index.name}</p>
        {change !== null && changePct !== null && (
          <p className={cn(
            "text-[10px] font-semibold font-mono tabular-nums mt-0.5",
            positive ? "text-success" : "text-destructive",
          )}>
            {positive ? "+" : ""}{fmt(change)} ({positive ? "+" : ""}{fmt(changePct, 2)}%)
          </p>
        )}
        {change === null && ltp === null && (
          <div className="flex gap-1 mt-1">
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-muted-foreground/30 animate-bounce [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {/* Right: price + trend icon */}
      <div className="text-right shrink-0">
        {change !== null ? (
          positive
            ? <TrendingUp className="w-3.5 h-3.5 text-success ml-auto mb-1" />
            : <TrendingDown className="w-3.5 h-3.5 text-destructive ml-auto mb-1" />
        ) : (
          <Minus className="w-3.5 h-3.5 text-muted-foreground/30 ml-auto mb-1" />
        )}
        <p className={cn(
          "text-base font-bold font-mono tabular-nums transition-colors duration-300",
          flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
          ltp === null && "text-muted-foreground/30",
        )}>
          {ltp !== null ? fmt(ltp) : "—"}
        </p>
      </div>
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
      <div className="flex flex-col gap-2">
        <div className="rounded-xl border bg-card px-4 py-3 animate-pulse h-[68px]" />
        <div className="rounded-xl border bg-card px-4 py-3 animate-pulse h-[68px]" />
      </div>
    );
  }

  if (isError || !indices?.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {indices.map((index) => (
        <IndexCard key={`${index.exchange}:${index.securityId}`} index={index} />
      ))}
    </div>
  );
}
