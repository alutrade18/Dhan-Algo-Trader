import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketSocket } from "@/lib/market-socket";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface WatchlistItem {
  id: number;
  securityId: number;
  exchId: string;
  segment: string;
  symbolName: string;
  displayName: string | null;
  instrument: string | null;
  expiryDate: string | null;
}

function wsExchange(exchId: string, segment: string): string {
  if (exchId === "NSE" && segment === "E") return "NSE_EQ";
  if (exchId === "NSE" && segment === "D") return "NSE_FNO";
  if (exchId === "NSE" && segment === "M") return "IDX_I";
  if (exchId === "MCX") return "MCX_COMM";
  if (exchId === "BSE" && segment === "E") return "BSE_EQ";
  return `${exchId}_EQ`;
}

function fmt(v: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}

function WatchlistRow({ item }: { item: WatchlistItem }) {
  const [ltp, setLtp] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchange = wsExchange(item.exchId, item.segment);

  useEffect(() => {
    const unsub = marketSocket.subscribe(exchange, item.securityId, (data) => {
      const cur = data.ltp;
      if (prev.current !== null && cur !== prev.current) {
        const dir = cur > prev.current ? "up" : "down";
        setFlash(dir);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setFlash(null), 600);
      }
      prev.current = cur;
      setLtp(cur);
    }, "ticker");
    return () => {
      unsub();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [exchange, item.securityId]);

  return (
    <div className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/30 border-b border-border/20 last:border-b-0 transition-colors">
      {/* Symbol info */}
      <div className="min-w-0 flex-1 mr-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate leading-tight">
            {item.displayName ?? item.symbolName}
          </span>
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 leading-4 font-normal shrink-0 border-border/50 text-muted-foreground"
          >
            {item.exchId}
          </Badge>
        </div>
        {item.instrument && (
          <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">
            {item.instrument}
            {item.expiryDate ? ` · ${item.expiryDate}` : ""}
          </p>
        )}
      </div>

      {/* Live LTP with flash */}
      <span className={cn(
        "font-bold font-mono tabular-nums text-xs min-w-[64px] text-right transition-colors duration-300",
        flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
        ltp === null && "text-muted-foreground/40",
      )}>
        {ltp !== null ? fmt(ltp) : "—"}
      </span>
    </div>
  );
}

// ─── Main WatchlistWidget ─────────────────────────────────────────────────────
interface WatchlistWidgetProps {
  onOpenPanel?: () => void;
}

export function WatchlistWidget({ onOpenPanel }: WatchlistWidgetProps) {
  const { data: watchlist = [], isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/watchlist`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 bg-muted/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-400/15 flex items-center justify-center">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">My Watchlist</p>
            {watchlist.length > 0 && (
              <p className="text-[10px] text-muted-foreground">{watchlist.length} instrument{watchlist.length !== 1 ? "s" : ""} tracked</p>
            )}
          </div>
        </div>
        <button
          onClick={onOpenPanel}
          className="flex items-center gap-1.5 text-[11px] font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-lg hover:bg-primary/8"
          title="Open full watchlist"
        >
          <Star className="w-3 h-3" />
          Manage
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto max-h-[340px]">
        {isLoading ? (
          <div className="flex flex-col gap-0">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2.5 border-b border-border/20">
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 bg-muted/50 rounded animate-pulse" />
                  <div className="h-2.5 w-16 bg-muted/30 rounded animate-pulse" />
                </div>
                <div className="h-3.5 w-16 bg-muted/50 rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
              <Star className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">No instruments saved yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Click <span className="font-semibold text-primary">Manage</span> to search and add instruments
              </p>
            </div>
            <button
              onClick={onOpenPanel}
              className="mt-1 text-xs font-semibold text-primary border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-primary/8 transition-colors"
            >
              + Add Instruments
            </button>
          </div>
        ) : (
          <div>
            {watchlist.map((item) => (
              <WatchlistRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
