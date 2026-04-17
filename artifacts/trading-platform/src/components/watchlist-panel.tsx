import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { marketSocket } from "@/lib/market-socket";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  X, Search, Trash2, Plus, Star, Loader2, ChevronRight, BarChart2, ArrowLeft
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

function fmt(v: number | null | undefined, decimals = 2) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(v);
}

function wsExchange(exchId: string, segment: string): string {
  if (exchId === "NSE" && segment === "E") return "NSE_EQ";
  if (exchId === "NSE" && segment === "D") return "NSE_FNO";
  if (exchId === "NSE" && segment === "M") return "IDX_I";
  if (exchId === "MCX") return "MCX_COMM";
  if (exchId === "BSE" && segment === "E") return "BSE_EQ";
  return `${exchId}_EQ`;
}

function LiveLtp({ securityId, exchId, segment }: { securityId: number; exchId: string; segment: string }) {
  const [ltp, setLtp] = useState<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prev = useRef<number | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchange = wsExchange(exchId, segment);

  useEffect(() => {
    const unsub = marketSocket.subscribe(exchange, securityId, (data) => {
      const cur = data.ltp;
      if (prev.current !== null && cur !== prev.current) {
        const dir = cur > prev.current ? "up" : "down";
        setFlash(dir);
        if (flashRef.current) clearTimeout(flashRef.current);
        flashRef.current = setTimeout(() => setFlash(null), 700);
      }
      prev.current = cur;
      setLtp(cur);
    }, "ticker");
    return () => {
      unsub();
      if (flashRef.current) clearTimeout(flashRef.current);
    };
  }, [exchange, securityId]);

  return (
    <span className={cn(
      "font-bold font-mono tabular-nums text-xs min-w-[64px] text-right transition-colors duration-300",
      flash === "up" ? "text-green-400" : flash === "down" ? "text-red-400" : "text-foreground",
      ltp === null && "text-muted-foreground/40",
    )}>
      {ltp !== null ? fmt(ltp) : "—"}
    </span>
  );
}

// ── Left panel: Saved watchlist ───────────────────────────────────────────────
function SavedWatchlist({
  watchlist,
  isLoading,
  onDelete,
}: {
  watchlist: WatchlistItem[];
  isLoading: boolean;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            My Watchlist
          </span>
          {watchlist.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground font-mono bg-muted rounded px-1.5 py-0.5">
              {watchlist.length} saved
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
          </div>
        ) : watchlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 px-4 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Star className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">No saved stocks yet</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Search and add instruments →</p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {watchlist.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-muted/50 group border-b border-border/30 last:border-b-0"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate leading-tight">
                      {item.displayName || item.symbolName}
                    </span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 leading-4 font-normal">
                      {item.exchId}
                    </Badge>
                  </div>
                  {item.instrument && (
                    <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate">
                      {item.instrument}{item.expiryDate ? ` · ${item.expiryDate}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <LiveLtp securityId={item.securityId} exchId={item.exchId} segment={item.segment} />
                  <button
                    onClick={() => onDelete(item.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-red-400 ml-1"
                    title="Remove from watchlist"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Right panel: Search ───────────────────────────────────────────────────────
function SearchPanel({
  watchlistIds,
  onAdd,
  isAdding,
}: {
  watchlistIds: Set<string>;
  onAdd: (item: SearchResult) => void;
  isAdding: boolean;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: results = [], isFetching } = useQuery<SearchResult[]>({
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
    staleTime: 60000,
  });

  const handleSearch = () => {
    const q = query.trim();
    if (q.length < 1) return;
    setSubmittedQuery(q);
    setSelected(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            Search Instruments
          </span>
        </div>
        <div className="mt-2.5 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Symbol, company, ISIN…"
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button
            size="sm"
            className="h-8 px-3 text-xs gap-1.5 shrink-0"
            onClick={handleSearch}
            disabled={isFetching || query.trim().length < 1}
          >
            {isFetching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            Search
          </Button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          /* Instrument detail view */
          <div className="p-4 space-y-4">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to results
            </button>

            <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-bold text-foreground leading-tight">
                    {selected.displayName || selected.symbolName}
                  </h4>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{selected.symbolName}</p>
                </div>
                <Button
                  size="sm"
                  variant={watchlistIds.has(`${selected.securityId}:${selected.exchId}`) ? "outline" : "default"}
                  className="h-7 px-2 text-xs gap-1 shrink-0"
                  onClick={() => onAdd(selected)}
                  disabled={watchlistIds.has(`${selected.securityId}:${selected.exchId}`) || isAdding}
                >
                  {isAdding ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : watchlistIds.has(`${selected.securityId}:${selected.exchId}`) ? (
                    <>
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      Saved
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      Add to Watchlist
                    </>
                  )}
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {(
                  [
                    ["Exchange", selected.exchId],
                    ["Instrument", selected.instrument],
                    ["Security ID", String(selected.securityId)],
                    ["Lot Size", String(selected.lotSize ?? 1)],
                    ...(selected.expiryDate ? [["Expiry", selected.expiryDate]] : []),
                  ] as Array<[string, string | null]>
                ).map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
                    <span className="font-medium text-foreground font-mono">{value ?? "—"}</span>
                  </div>
                ))}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Live LTP</span>
                  <LiveLtp
                    securityId={selected.securityId}
                    exchId={selected.exchId}
                    segment={selected.segment}
                  />
                </div>
              </div>
            </div>
          </div>
        ) : submittedQuery && results.length > 0 ? (
          /* Search results list */
          <div className="py-1">
            <div className="px-4 py-2 text-[10px] text-muted-foreground font-mono">
              {results.length} result{results.length !== 1 ? "s" : ""} for "{submittedQuery}"
            </div>
            {results.map((r) => {
              const inWl = watchlistIds.has(`${r.securityId}:${r.exchId}`);
              return (
                <button
                  key={`${r.securityId}:${r.exchId}`}
                  onClick={() => setSelected(r)}
                  className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/50 text-left border-b border-border/30 last:border-b-0 group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold truncate">
                        {r.displayName || r.symbolName}
                      </span>
                      {inWl && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 leading-4 font-normal">{r.exchId}</Badge>
                      <span className="text-[10px] text-muted-foreground/60">{r.instrument}</span>
                      {r.expiryDate && <span className="text-[10px] text-muted-foreground/40">{r.expiryDate}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 ml-2" />
                </button>
              );
            })}
          </div>
        ) : submittedQuery && results.length === 0 && !isFetching ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-center px-4">
            <Search className="w-8 h-8 text-muted-foreground/15" />
            <p className="text-xs text-muted-foreground">No results for "{submittedQuery}"</p>
            <p className="text-[10px] text-muted-foreground/60">Try a different symbol or company name</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Search className="w-5 h-5 text-muted-foreground/30" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Search the instrument database</p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">Enter symbol, company name, or ISIN and press Search</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main WatchlistPanel ───────────────────────────────────────────────────────
interface WatchlistPanelProps {
  open: boolean;
  onClose: () => void;
}

export function WatchlistPanel({ open, onClose }: WatchlistPanelProps) {
  const queryClient = useQueryClient();

  const { data: watchlist = [], isLoading } = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/watchlist`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
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

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const panel = (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm transition-opacity duration-300",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Sliding panel */}
      <div
        className={cn(
          "fixed right-0 top-0 bottom-0 z-[101] w-full max-w-[680px] bg-background border-l border-border shadow-2xl flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border bg-sidebar shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-400/15 flex items-center justify-center">
              <Star className="w-4 h-4 text-amber-400 fill-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Watchlist</h3>
              <p className="text-[10px] text-muted-foreground">Track your favourite instruments</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Panel body: two columns */}
        <div className="flex-1 flex min-h-0">
          {/* LEFT: Saved watchlist (45%) */}
          <div className="w-[45%] border-r border-border flex flex-col min-h-0 bg-sidebar/30">
            <SavedWatchlist
              watchlist={watchlist}
              isLoading={isLoading}
              onDelete={(id) => deleteMutation.mutate(id)}
            />
          </div>

          {/* RIGHT: Search (55%) */}
          <div className="flex-1 flex flex-col min-h-0">
            <SearchPanel
              watchlistIds={watchlistIds}
              onAdd={(r) => addMutation.mutate(r)}
              isAdding={addMutation.isPending}
            />
          </div>
        </div>
      </div>
    </>
  );

  // Render via portal to document.body so it escapes any overflow/stacking context
  if (typeof document === "undefined") return null;
  return createPortal(panel, document.body);
}
