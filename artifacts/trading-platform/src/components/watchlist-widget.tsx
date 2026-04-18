import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { marketSocket } from "@/lib/market-socket";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Star, Search, Trash2, Plus, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface WatchlistItem {
  id: number;
  securityId: number;
  exchId: string;
  segment: string;
  symbolName: string;
  displayName: string | null;
  instrument: string | null;
  lotSize: number | null;
  expiryDate: string | null;
}

interface SearchResult {
  securityId: number;
  exchId: string;
  segment: string;
  instrument: string;
  symbolName: string;
  displayName: string | null;
  expiryDate: string | null;
  lotSize: number | null;
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
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
}

function LiveLtp({ securityId, exchId, segment }: { securityId: number; exchId: string; segment: string }) {
  const [ltp, setLtp] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchange = wsExchange(exchId, segment);

  useEffect(() => {
    const unsub = marketSocket.subscribe(exchange, securityId, (data) => {
      const cur = data.ltp;
      if (prev.current !== null && cur !== prev.current) {
        setFlash(cur > prev.current ? "up" : "down");
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setFlash(null), 600);
      }
      prev.current = cur;
      setLtp(cur);
    }, "ticker");
    return () => { unsub(); if (timer.current) clearTimeout(timer.current); };
  }, [exchange, securityId]);

  return (
    <span className={cn(
      "font-bold font-mono tabular-nums text-sm transition-colors duration-300",
      flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
      ltp === null && "text-muted-foreground/40",
    )}>
      {ltp !== null ? fmt(ltp) : "—"}
    </span>
  );
}

// ─── Saved instrument row ──────────────────────────────────────────────────────
function WatchlistRow({ item, onDelete }: { item: WatchlistItem; onDelete: () => void }) {
  return (
    <div className="group flex items-start justify-between px-4 py-3 hover:bg-muted/30 border-b border-border/20 last:border-b-0 transition-colors gap-3">
      {/* Left: details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0 mb-0.5">
          <span className="text-xs font-bold text-foreground truncate leading-tight">
            {item.displayName ?? item.symbolName}
          </span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4 shrink-0 border-border/50 text-muted-foreground">
            {item.exchId}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {item.instrument && (
            <span className="text-[10px] text-muted-foreground/60 font-medium">
              {item.instrument}
            </span>
          )}
          {item.lotSize && item.lotSize > 1 && (
            <span className="text-[10px] text-muted-foreground/50">
              Lot: {item.lotSize.toLocaleString()}
            </span>
          )}
          {item.expiryDate && (
            <span className="text-[10px] text-primary/60 font-mono">
              Exp: {item.expiryDate}
            </span>
          )}
        </div>
      </div>

      {/* Right: LTP + delete */}
      <div className="flex items-center gap-2 shrink-0">
        <LiveLtp securityId={item.securityId} exchId={item.exchId} segment={item.segment} />
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-destructive p-0.5 rounded"
          title="Remove from watchlist"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Search result row ────────────────────────────────────────────────────────
function SearchRow({
  result,
  inWatchlist,
  onAdd,
  isAdding,
}: {
  result: SearchResult;
  inWatchlist: boolean;
  onAdd: () => void;
  isAdding: boolean;
}) {
  return (
    <div className="flex items-start justify-between px-4 py-3 border-b border-border/20 last:border-b-0 hover:bg-muted/20 transition-colors gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-bold text-foreground truncate">
            {result.displayName ?? result.symbolName}
          </span>
          {inWatchlist && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />}
          <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4 shrink-0 border-border/50 text-muted-foreground">
            {result.exchId}
          </Badge>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-muted-foreground/60">{result.instrument}</span>
          {result.lotSize && result.lotSize > 1 && (
            <span className="text-[10px] text-muted-foreground/50">Lot: {result.lotSize.toLocaleString()}</span>
          )}
          {result.expiryDate && (
            <span className="text-[10px] text-primary/60 font-mono">Exp: {result.expiryDate}</span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant={inWatchlist ? "outline" : "default"}
        className="h-7 px-2 text-xs gap-1 shrink-0"
        onClick={onAdd}
        disabled={inWatchlist || isAdding}
      >
        {isAdding
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : inWatchlist
          ? <><Star className="w-3 h-3 fill-amber-400 text-amber-400" />Saved</>
          : <><Plus className="w-3 h-3" />Add</>}
      </Button>
    </div>
  );
}

// ─── Main WatchlistWidget ─────────────────────────────────────────────────────
interface WatchlistWidgetProps {
  onOpenPanel?: () => void;
}

export function WatchlistWidget({ onOpenPanel }: WatchlistWidgetProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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

  const { data: searchResults = [], isFetching: isSearching } = useQuery<SearchResult[]>({
    queryKey: ["watchlist-search", submittedQuery],
    queryFn: async () => {
      if (!submittedQuery.trim()) return [];
      const url = new URL(`${window.location.origin}${BASE}api/instruments/search`);
      url.searchParams.set("q", submittedQuery.trim());
      url.searchParams.set("limit", "15");
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: submittedQuery.length >= 1,
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async (item: SearchResult) => {
      const res = await fetch(`${BASE}api/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          securityId: item.securityId,
          exchId: item.exchId,
          segment: item.segment,
          symbolName: item.symbolName,
          displayName: item.displayName,
          instrument: item.instrument,
          lotSize: item.lotSize,
          expiryDate: item.expiryDate,
        }),
      });
      if (!res.ok && res.status !== 409) throw new Error("Failed to add");
      return res.status !== 409 ? res.json() : null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}api/watchlist/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const watchlistIds = new Set(watchlist.map(w => `${w.securityId}:${w.exchId}`));

  const handleSearch = () => {
    const q = query.trim();
    if (q.length >= 1) setSubmittedQuery(q);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
    if (e.key === "Escape") { setQuery(""); setSubmittedQuery(""); }
  };

  const showSearch = submittedQuery.length > 0;

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm flex flex-col h-full min-h-[400px]">

      {/* Header */}
      <div className="px-4 py-3 border-b border-border/30 bg-muted/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-amber-400/15 flex items-center justify-center">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">My Watchlist</p>
            {watchlist.length > 0 && (
              <p className="text-[10px] text-muted-foreground">
                {watchlist.length} instrument{watchlist.length !== 1 ? "s" : ""} saved
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onOpenPanel}
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted/40"
        >
          Full View
        </button>
      </div>

      {/* Search bar */}
      <div className="px-4 py-2.5 border-b border-border/20 shrink-0 bg-muted/5">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search symbol, company…"
              className="pl-8 h-8 text-xs bg-background/60"
            />
          </div>
          <Button
            size="sm"
            className="h-8 px-3 text-xs gap-1.5 shrink-0"
            onClick={handleSearch}
            disabled={isSearching || query.trim().length < 1}
          >
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Search
          </Button>
          {showSearch && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={() => { setQuery(""); setSubmittedQuery(""); }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {showSearch ? (
          /* Search results */
          isSearching ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
            </div>
          ) : searchResults.length > 0 ? (
            <div>
              <div className="px-4 py-1.5 text-[10px] text-muted-foreground font-mono border-b border-border/10 bg-muted/5">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{submittedQuery}&rdquo;
              </div>
              {searchResults.map(r => (
                <SearchRow
                  key={`${r.securityId}:${r.exchId}`}
                  result={r}
                  inWatchlist={watchlistIds.has(`${r.securityId}:${r.exchId}`)}
                  onAdd={() => addMutation.mutate(r)}
                  isAdding={addMutation.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
              <Search className="w-8 h-8 text-muted-foreground/15" />
              <p className="text-xs text-muted-foreground">No results for &ldquo;{submittedQuery}&rdquo;</p>
            </div>
          )
        ) : (
          /* Saved watchlist */
          isLoading ? (
            <div className="flex flex-col">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="flex items-start justify-between px-4 py-3 border-b border-border/20">
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3.5 w-32 bg-muted/50 rounded animate-pulse" />
                    <div className="h-2.5 w-24 bg-muted/30 rounded animate-pulse" />
                  </div>
                  <div className="h-4 w-16 bg-muted/50 rounded animate-pulse" />
                </div>
              ))}
            </div>
          ) : watchlist.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-muted/40 flex items-center justify-center">
                <Star className="w-5 h-5 text-muted-foreground/25" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">No instruments saved yet</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1">
                  Use the search bar above to find and add instruments
                </p>
              </div>
            </div>
          ) : (
            <div>
              {watchlist.map(item => (
                <WatchlistRow
                  key={item.id}
                  item={item}
                  onDelete={() => deleteMutation.mutate(item.id)}
                />
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
