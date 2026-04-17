import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { marketSocket } from "@/lib/market-socket";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X, Search, Trash2, Plus, TrendingUp, TrendingDown,
  Star, Loader2, ChevronRight, ExternalLink
} from "lucide-react";

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
  addedAt: string;
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

function fmt(v: number, decimals = 2) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function ltpExchange(exchId: string, segment: string): string {
  if (exchId === "NSE" && segment === "E") return "NSE_EQ";
  if (exchId === "NSE" && segment === "D") return "NSE_FNO";
  if (exchId === "MCX") return "MCX_COMM";
  if (exchId === "BSE" && segment === "E") return "BSE_EQ";
  return `${exchId}_${segment}`;
}

function WatchlistRow({ item, onDelete }: { item: WatchlistItem; onDelete: (id: number) => void }) {
  const [ltp, setLtp] = useState<number | null>(null);
  const [prevLtp, setPrevLtp] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exchange = ltpExchange(item.exchId, item.segment);

  useEffect(() => {
    const unsub = marketSocket.subscribe(exchange, item.securityId, (data) => {
      setLtp(data.ltp);
      setPrevLtp(prev => {
        if (prev !== null && data.ltp !== prev) {
          const dir = data.ltp > prev ? "up" : "down";
          setFlash(dir);
          if (flashRef.current) clearTimeout(flashRef.current);
          flashRef.current = setTimeout(() => setFlash(null), 600);
        }
        return data.ltp;
      });
    }, "ticker");
    return () => {
      unsub();
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, [exchange, item.securityId]);

  const displayLabel = item.displayName || item.symbolName;

  return (
    <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 rounded-lg group gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-foreground truncate">{displayLabel}</span>
          <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 leading-4">{item.exchId}</Badge>
        </div>
        {item.instrument && (
          <p className="text-[10px] text-muted-foreground/60 truncate">{item.instrument}{item.expiryDate ? ` · ${item.expiryDate}` : ""}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            "text-xs font-bold font-mono tabular-nums transition-colors duration-300 min-w-[60px] text-right",
            flash === "up" ? "text-success" : flash === "down" ? "text-destructive" : "text-foreground",
            ltp === null && "text-muted-foreground/40",
          )}
        >
          {ltp !== null ? fmt(ltp) : "—"}
        </span>
        <button
          onClick={() => onDelete(item.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          title="Remove from watchlist"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

interface SearchResultDetailProps {
  result: SearchResult;
  isInWatchlist: boolean;
  onAdd: (result: SearchResult) => void;
  isAdding: boolean;
}

function SearchResultDetail({ result, isInWatchlist, onAdd, isAdding }: SearchResultDetailProps) {
  const [ltp, setLtp] = useState<number | null>(null);
  const exchange = ltpExchange(result.exchId, result.segment);

  useEffect(() => {
    const unsub = marketSocket.subscribe(exchange, result.securityId, (data) => {
      setLtp(data.ltp);
    }, "ticker");
    return () => unsub();
  }, [exchange, result.securityId]);

  const displayLabel = result.displayName || result.symbolName;

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-foreground">{displayLabel}</h4>
          <p className="text-[10px] text-muted-foreground">{result.symbolName}</p>
        </div>
        <Button
          size="sm"
          variant={isInWatchlist ? "outline" : "default"}
          className="h-7 px-2 text-xs gap-1 shrink-0"
          onClick={() => onAdd(result)}
          disabled={isInWatchlist || isAdding}
        >
          {isAdding ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : isInWatchlist ? (
            <>
              <Star className="w-3 h-3 fill-current" />
              Added
            </>
          ) : (
            <>
              <Plus className="w-3 h-3" />
              Add
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Exchange</span>
            <span className="font-medium">{result.exchId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Instrument</span>
            <span className="font-medium">{result.instrument}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lot Size</span>
            <span className="font-medium">{result.lotSize ?? 1}</span>
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Security ID</span>
            <span className="font-mono font-medium">{result.securityId}</span>
          </div>
          {result.expiryDate && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expiry</span>
              <span className="font-medium">{result.expiryDate}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">LTP</span>
            <span className={cn("font-bold font-mono", ltp === null && "text-muted-foreground/40")}>
              {ltp !== null ? fmt(ltp) : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface WatchlistPanelProps {
  open: boolean;
  onClose: () => void;
}

export function WatchlistPanel({ open, onClose }: WatchlistPanelProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  const { data: watchlist = [], isLoading: wlLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/watchlist`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: searchResults = [], isFetching: isSearching } = useQuery<SearchResult[]>({
    queryKey: ["watchlist-search", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim() || debouncedQuery.length < 1) return [];
      const url = new URL(`${window.location.origin}${BASE}api/instruments/search`);
      url.searchParams.set("q", debouncedQuery.trim());
      url.searchParams.set("limit", "10");
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: debouncedQuery.length >= 1,
    staleTime: 30000,
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
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["watchlist"] }),
  });

  const watchlistIds = new Set(watchlist.map(w => `${w.securityId}:${w.exchId}`));

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-40 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-50 w-full max-w-2xl bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-base">Watchlist</h3>
            {watchlist.length > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">{watchlist.length}</Badge>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left: Saved watchlist */}
          <div className="w-[45%] border-r border-border flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border/50 shrink-0">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Saved</p>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {wlLoading ? (
                <div className="flex items-center justify-center h-20">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : watchlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 px-4 text-center">
                  <Star className="w-8 h-8 text-muted-foreground/20" />
                  <p className="text-xs text-muted-foreground">No instruments saved. Search and add instruments to your watchlist.</p>
                </div>
              ) : (
                <div className="px-1">
                  {watchlist.map(item => (
                    <WatchlistRow
                      key={item.id}
                      item={item}
                      onDelete={(id) => deleteMutation.mutate(id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Search + details */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-border/50 shrink-0">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Search Instruments</p>
            </div>

            <div className="p-3 border-b border-border/50 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  ref={inputRef}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedResult(null);
                  }}
                  placeholder="Symbol, name or ISIN…"
                  className="pl-8 h-8 text-sm"
                />
                {isSearching && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {selectedResult ? (
                <div className="p-3 space-y-3">
                  <button
                    onClick={() => setSelectedResult(null)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Back to results
                  </button>
                  <SearchResultDetail
                    result={selectedResult}
                    isInWatchlist={watchlistIds.has(`${selectedResult.securityId}:${selectedResult.exchId}`)}
                    onAdd={(r) => addMutation.mutate(r)}
                    isAdding={addMutation.isPending}
                  />
                </div>
              ) : debouncedQuery && searchResults.length > 0 ? (
                <div className="py-1">
                  {searchResults.map((result) => {
                    const inWatchlist = watchlistIds.has(`${result.securityId}:${result.exchId}`);
                    return (
                      <button
                        key={`${result.securityId}:${result.exchId}`}
                        onClick={() => setSelectedResult(result)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 text-left group gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-semibold truncate">{result.displayName || result.symbolName}</span>
                            {inWatchlist && <Star className="w-2.5 h-2.5 text-primary fill-current shrink-0" />}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4">{result.exchId}</Badge>
                            <span className="text-[10px] text-muted-foreground/60">{result.instrument}</span>
                            {result.expiryDate && <span className="text-[10px] text-muted-foreground/50">{result.expiryDate}</span>}
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              ) : debouncedQuery && !isSearching && searchResults.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-24 gap-1.5 text-center px-4">
                  <Search className="w-6 h-6 text-muted-foreground/20" />
                  <p className="text-xs text-muted-foreground">No instruments found for "{debouncedQuery}"</p>
                </div>
              ) : !debouncedQuery ? (
                <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
                  <ExternalLink className="w-8 h-8 text-muted-foreground/15" />
                  <p className="text-xs text-muted-foreground">Type a symbol or company name to search the instrument database.</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
