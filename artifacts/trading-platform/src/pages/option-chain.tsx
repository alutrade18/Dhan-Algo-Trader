import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WifiOff,
  Search,
  X,
  Clock,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

// Index underlying shape — loaded from DB (instruments table, instrument="INDEX")
interface IndexUnderlying {
  label: string;
  symbol: string;
  dhanSecId: number;   // security_id from DB — used for Dhan API calls
  dbSecId: number;     // underlying_security_id from DB
  segment: string;     // always "IDX_I" for INDEX instruments
  exchange: "NSE" | "BSE" | "MCX";
}

type Mode = "index" | "stock";
type Exchange = "NSE" | "MCX";

interface StockUnderlying {
  underlyingSymbol: string | null;
  underlyingSecurityId: number | null;
  exchId: string;
}

interface OptionEntry {
  strikePrice: number;
  callLTP: number;
  callOI: number;
  callVolume: number;
  callIV: number;
  putLTP: number;
  putOI: number;
  putVolume: number;
  putIV: number;
}

// ── Market Hours (IST) ──────────────────────────────────────────────
// NSE F&O / Stock Options  : Mon-Fri 08:50 → 18:40
// MCX F&O                  : Mon-Fri 08:50 → 23:59
function getISTMinutes(): { mins: number; day: number } {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const ist = new Date(utcMs + 5.5 * 3_600_000);
  return { mins: ist.getHours() * 60 + ist.getMinutes(), day: ist.getDay() };
}

function computeMarketStatus(exchange: Exchange): {
  isOpen: boolean;
  label: string;
  color: string;
} {
  const { mins, day } = getISTMinutes();
  if (day === 0 || day === 6) {
    return {
      isOpen: false,
      label: "Market closed · Weekend",
      color: "text-muted-foreground",
    };
  }
  const open = 8 * 60 + 50; // 08:50
  const close = exchange === "MCX" ? 23 * 60 + 59 : 18 * 60 + 40;
  const closeLabel = exchange === "MCX" ? "11:59 PM" : "6:40 PM";

  if (mins < open) {
    return {
      isOpen: false,
      label: `Pre-market · Opens 8:50 AM IST`,
      color: "text-amber-400",
    };
  }
  if (mins > close) {
    return {
      isOpen: false,
      label: `Market closed · Opens 8:50 AM IST tomorrow`,
      color: "text-muted-foreground",
    };
  }
  return {
    isOpen: true,
    label: `Live · Closes ${closeLabel} IST`,
    color: "text-emerald-400",
  };
}

function useMarketStatus(exchange: Exchange) {
  const [status, setStatus] = useState(() => computeMarketStatus(exchange));
  useEffect(() => {
    setStatus(computeMarketStatus(exchange));
    const id = setInterval(
      () => setStatus(computeMarketStatus(exchange)),
      30_000,
    );
    return () => clearInterval(id);
  }, [exchange]);
  return status;
}

// ── Formatters ──────────────────────────────────────────────────────
function formatOI(oi: number) {
  if (oi >= 10_000_000) return `${(oi / 10_000_000).toFixed(2)}Cr`;
  if (oi >= 100_000) return `${(oi / 100_000).toFixed(1)}L`;
  if (oi >= 1_000) return `${(oi / 1_000).toFixed(1)}K`;
  return String(oi);
}

function OIBar({
  value,
  max,
  side,
}: {
  value: number;
  max: number;
  side: "ce" | "pe";
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const isCall = side === "ce";
  return (
    <div className="w-16 h-2.5 rounded-full bg-muted/40 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          isCall
            ? "bg-gradient-to-r from-red-600 to-red-400"
            : "bg-gradient-to-l from-emerald-600 to-emerald-400"
        }`}
        style={{
          width: `${pct}%`,
          marginLeft: isCall ? "auto" : "0",
          float: isCall ? "right" : "left",
        }}
      />
    </div>
  );
}

// ── Stock Symbol Search ─────────────────────────────────────────────
function StockSearch({ onSelect }: { onSelect: (s: StockUnderlying) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<StockUnderlying[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${BASE}api/instruments/option-underlyings?q=${encodeURIComponent(q)}`,
        );
        const data = (await res.json()) as StockUnderlying[];
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [q]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative w-52">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search stock…"
          className="pl-8 pr-8 h-9 text-xs"
        />
        {q && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQ("");
              setResults([]);
              setOpen(false);
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
          {results.map((r, i) => (
            <button
              key={i}
              className="w-full text-left px-3 py-2 text-xs hover:bg-muted/60 flex items-center gap-2"
              onClick={() => {
                onSelect(r);
                setQ(r.underlyingSymbol ?? "");
                setOpen(false);
              }}
            >
              <span className="font-mono font-semibold">
                {r.underlyingSymbol}
              </span>
              <Badge variant="outline" className="text-[9px] px-1 py-0">
                {r.exchId}
              </Badge>
            </button>
          ))}
          {loading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Searching…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── DB instrument row (partial) ──────────────────────────────────────
interface DbInstrument {
  securityId: number;
  underlyingSecurityId: number | null;
  symbolName: string;
  displayName: string | null;
  exchId: string;
  segment: string;
}

function mapDbToUnderlying(r: DbInstrument): IndexUnderlying {
  const exch = (r.exchId === "BSE" ? "BSE" : r.exchId === "MCX" ? "MCX" : "NSE") as "NSE" | "BSE" | "MCX";
  return {
    label: r.displayName ?? r.symbolName,
    symbol: r.symbolName,
    dhanSecId: r.securityId,
    dbSecId: r.underlyingSecurityId ?? r.securityId,
    segment: "IDX_I",
    exchange: exch,
  };
}

// ── Flash direction type ─────────────────────────────────────────────
type Dir = 1 | -1 | 0;
interface FlashEntry { call: Dir; put: Dir }

// ── Main Component ──────────────────────────────────────────────────
export default function OptionChain() {
  const [mode, setMode] = useState<Mode>("index");
  const [indexUnderlying, setIndexUnderlying] = useState<IndexUnderlying | null>(null);
  const [stockUnderlying, setStockUnderlying] = useState<StockUnderlying | null>(null);
  const [expiry, setExpiry] = useState("");

  // Load index underlyings from DB (instrument="INDEX")
  const { data: indexList = [], isLoading: indexListLoading } = useQuery<IndexUnderlying[]>({
    queryKey: ["index-underlyings"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/instruments?instrument=INDEX&limit=50`);
      if (!res.ok) return [];
      const rows = (await res.json()) as DbInstrument[];
      return rows.map(mapDbToUnderlying);
    },
    staleTime: Infinity,
  });

  // Auto-select NIFTY 50 (securityId=13) as default; fallback to first in list
  useEffect(() => {
    if (indexList.length === 0 || indexUnderlying !== null) return;
    const nifty = indexList.find((u) => u.dhanSecId === 13 || u.symbol === "NIFTY");
    setIndexUnderlying(nifty ?? indexList[0]);
  }, [indexList, indexUnderlying]);

  // Active IDs / segment
  const activeIndex = indexUnderlying;
  const activeDbSecId =
    mode === "index"
      ? (activeIndex?.dbSecId ?? null)
      : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeDhanSecId =
    mode === "index"
      ? (activeIndex?.dhanSecId ?? null)
      : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeSegment =
    mode === "index"
      ? (activeIndex?.segment ?? "IDX_I")
      : stockUnderlying?.exchId === "BSE"
        ? "BSE_EQ"
        : "NSE_EQ";
  const activeLabel =
    mode === "index"
      ? (activeIndex?.label ?? "")
      : (stockUnderlying?.underlyingSymbol ?? "");
  const activeExchange: Exchange = "NSE";

  // Market hours gate
  const marketStatus = useMarketStatus(activeExchange);

  // Expiry list — fetched once from Dhan API and cached for 24 h.
  // Does NOT auto-refetch, so no repeated calls when market is closed.
  const { data: expiryList = [], isLoading: expiryLoading } = useQuery<string[]>({
    queryKey: ["expiry-list", activeDhanSecId, activeSegment],
    queryFn: async () => {
      if (!activeDhanSecId) return [];
      const res = await fetch(`${BASE}api/market/expiry-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          underSecurityId: String(activeDhanSecId),
          underExchangeSegment: activeSegment,
        }),
      });
      if (!res.ok) throw new Error("Failed to load expiry list");
      const json = (await res.json()) as { data?: string[] };
      return json.data ?? [];
    },
    enabled: !!activeDhanSecId,
    staleTime: 24 * 60 * 60 * 1_000,   // 24 h — never re-fetches mid-session
    gcTime: 24 * 60 * 60 * 1_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
  });

  useEffect(() => {
    setExpiry("");
  }, [activeDhanSecId, activeSegment]);
  useEffect(() => {
    if (expiryList.length > 0 && !expiry) setExpiry(expiryList[0]);
  }, [expiryList, expiry]);

  // Option chain — auto-refreshes every 3s; no page dimming on background fetch
  const { data: chain, isLoading: chainLoading, error: chainError } = useQuery({
    queryKey: ["option-chain", activeDhanSecId, activeSegment, expiry],
    queryFn: async () => {
      if (!expiry || !activeDhanSecId) return null;
      const res = await fetch(`${BASE}api/market/option-chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          underSecurityId: String(activeDhanSecId),
          underExchangeSegment: activeSegment,
          expiry,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to fetch option chain");
      }
      return res.json() as Promise<{ data?: Record<string, unknown>; ltp?: number }>;
    },
    enabled: !!expiry && !!activeDhanSecId,
    refetchInterval: marketStatus.isOpen ? 3_000 : false,
    staleTime: 2_500,
    refetchOnWindowFocus: false,
    // Keep previous data visible during background refetch — no dimming
    placeholderData: (prev) => prev,
    retry: 0,
  });

  // ── Parse chain data ─────────────────────────────────────────────
  const rawChain = chain?.data ?? {};
  const underlyingLtp = Number(chain?.ltp ?? 0);
  const entries: OptionEntry[] = [];

  const strikeKeys = Object.keys(rawChain);
  const strikes = strikeKeys
    .map((k) => parseFloat(k))
    .filter((n) => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  let maxOI = 1;
  for (const strike of strikes) {
    const key = strikeKeys.find((k) => parseFloat(k) === strike) ?? String(strike);
    const s = rawChain[key] as Record<string, Record<string, unknown>> | undefined;
    const ce = s?.["ce"] ?? s?.["CE"] ?? {};
    const pe = s?.["pe"] ?? s?.["PE"] ?? {};
    const callOI = Number(ce.oi ?? ce.openInterest ?? 0);
    const putOI = Number(pe.oi ?? pe.openInterest ?? 0);
    if (callOI > maxOI) maxOI = callOI;
    if (putOI > maxOI) maxOI = putOI;
    entries.push({
      strikePrice: strike,
      callLTP: Number(ce.last_price ?? ce.ltp ?? 0),
      callOI,
      callVolume: Number(ce.volume ?? 0),
      callIV: Number(ce.implied_volatility ?? ce.iv ?? ce.impliedVolatility ?? 0),
      putLTP: Number(pe.last_price ?? pe.ltp ?? 0),
      putOI,
      putVolume: Number(pe.volume ?? 0),
      putIV: Number(pe.implied_volatility ?? pe.iv ?? pe.impliedVolatility ?? 0),
    });
  }

  // ── ATM & display slice ─────────────────────────────────────────
  const atmStrike =
    underlyingLtp > 0 && strikes.length > 0
      ? strikes.reduce((prev, curr) =>
          Math.abs(curr - underlyingLtp) < Math.abs(prev - underlyingLtp) ? curr : prev,
        )
      : 0;

  const totalCallOI = entries.reduce((a, e) => a + e.callOI, 0);
  const totalPutOI = entries.reduce((a, e) => a + e.putOI, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const displayEntries = (() => {
    if (entries.length === 0) return entries;
    const atmIdx = entries.findIndex((e) => e.strikePrice === atmStrike);
    if (atmIdx < 0 || underlyingLtp <= 0) {
      const mid = Math.floor(entries.length / 2);
      return entries.slice(Math.max(0, mid - 20), Math.min(entries.length, mid + 21));
    }
    return entries.slice(
      Math.max(0, atmIdx - 20),
      Math.min(entries.length, atmIdx + 21),
    );
  })();

  // ── Live LTP flash tracking ──────────────────────────────────────
  // prevPricesRef: prices from previous fetch cycle
  const prevPricesRef = useRef<Map<number, { call: number; put: number }>>(new Map());
  // flashDirs: direction of last price change per strike (1=up, -1=down, 0=no change)
  const [flashDirs, setFlashDirs] = useState<Map<number, FlashEntry>>(new Map());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;

    const newPrices = new Map<number, { call: number; put: number }>();
    const newFlash = new Map<number, FlashEntry>();

    entries.forEach((e) => {
      newPrices.set(e.strikePrice, { call: e.callLTP, put: e.putLTP });
      const prev = prevPricesRef.current.get(e.strikePrice);
      if (prev) {
        const callDir: Dir = e.callLTP > prev.call ? 1 : e.callLTP < prev.call ? -1 : 0;
        const putDir: Dir = e.putLTP > prev.put ? 1 : e.putLTP < prev.put ? -1 : 0;
        if (callDir !== 0 || putDir !== 0) {
          newFlash.set(e.strikePrice, { call: callDir, put: putDir });
        }
      }
    });

    // Always update prev prices immediately for next cycle comparison
    prevPricesRef.current = newPrices;

    if (newFlash.size > 0) {
      setFlashDirs(newFlash);
      // Flash color shows for 2 seconds then fades to neutral
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashDirs(new Map()), 2_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);

  // ── Auto-scroll table to ATM row ─────────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (!atmRowRef.current || !tableContainerRef.current) return;
    const container = tableContainerRef.current;
    const row = atmRowRef.current;
    // Scroll table container (not page) so ATM row is centred
    const rowMid = row.offsetTop + row.offsetHeight / 2;
    container.scrollTop = rowMid - container.clientHeight / 2;
  }, [displayEntries, atmStrike]);

  const isLoading = expiryLoading || chainLoading;
  const hasData = displayEntries.length > 0;

  return (
    <div className="space-y-4">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Left: market closed notice */}
        {!marketStatus.isOpen && expiry && !chainError ? (
          <div className="flex items-center gap-2 min-w-0 px-3 py-1.5 rounded-lg border border-warning/25 bg-warning/8">
            <Clock className="w-3.5 h-3.5 text-warning shrink-0" />
            <p className="text-xs font-medium text-warning leading-snug">
              Market closed Showing Last Clsoing Value - Live resumes at 8:00 AM IST
            </p>
          </div>
        ) : (
          <div />
        )}

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {/* Index / Stock toggle */}
          <div className="flex rounded-md overflow-hidden border border-border text-xs">
            <button
              className={`px-3 py-1.5 ${mode === "index" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setMode("index");
                setStockUnderlying(null);
                setExpiry("");
              }}
            >
              Index
            </button>
            <button
              className={`px-3 py-1.5 ${mode === "stock" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setMode("stock");
                setExpiry("");
              }}
            >
              Stock
            </button>
          </div>

          {/* Index dropdown / Stock search */}
          {mode === "index" ? (
            <Select
              value={activeIndex ? String(activeIndex.dhanSecId) : ""}
              onValueChange={(v) => {
                const u = indexList.find((u) => String(u.dhanSecId) === v);
                if (u) { setIndexUnderlying(u); setExpiry(""); }
              }}
              disabled={indexListLoading || indexList.length === 0}
            >
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder={indexListLoading ? "Loading…" : "Select Index"} />
              </SelectTrigger>
              <SelectContent>
                {indexList.map((u) => (
                  <SelectItem key={u.dhanSecId} value={String(u.dhanSecId)}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StockSearch
              onSelect={(s) => {
                setStockUnderlying(s);
                setExpiry("");
              }}
            />
          )}

          {/* Expiry dropdown */}
          <Select
            value={expiry}
            onValueChange={setExpiry}
            disabled={expiryLoading || expiryList.length === 0 || !activeDbSecId}
          >
            <SelectTrigger className="w-32 text-xs font-mono h-9">
              <SelectValue placeholder={expiryLoading ? "Loading…" : "Expiry"} />
            </SelectTrigger>
            <SelectContent>
              {expiryList.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Stats bar ── */}
      {hasData && (
        <div className="flex items-center gap-6 flex-wrap text-xs">
          {underlyingLtp > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Spot:</span>
              <span className="font-mono font-bold text-foreground">
                ₹{underlyingLtp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
          {atmStrike > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">ATM:</span>
              <span className="font-mono font-bold text-amber-400">
                ₹{atmStrike.toLocaleString("en-IN")}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">PCR:</span>
            <span className={`font-mono font-bold ${pcr > 1 ? "text-emerald-400" : "text-red-400"}`}>
              {pcr.toFixed(2)}
            </span>
            {pcr > 1.2 ? (
              <TrendingUp className="w-3 h-3 text-emerald-400" />
            ) : pcr < 0.8 ? (
              <TrendingDown className="w-3 h-3 text-red-400" />
            ) : null}
            <span className="text-muted-foreground">
              {pcr > 1.2 ? "Bullish" : pcr < 0.8 ? "Bearish" : "Neutral"}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Total Call OI:</span>
            <span className="font-mono text-red-400">{formatOI(totalCallOI)}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Total Put OI:</span>
            <span className="font-mono text-emerald-400">{formatOI(totalPutOI)}</span>
          </div>
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
            {activeLabel} · {expiry}
          </Badge>
        </div>
      )}

      {/* ── States ── */}
      {mode === "stock" && !stockUnderlying ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Search for a stock symbol above to view its option chain.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !expiry ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Select an expiry date to load the option chain.
          </CardContent>
        </Card>
      ) : chainError ? (
        <Card className="border-amber-400/20 bg-amber-400/5">
          <CardContent className="flex items-start gap-3 py-5">
            <WifiOff className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-400">
                {(chainError as Error).message?.includes("not Subscribed")
                  ? "Dhan Data API subscription required"
                  : "Failed to load option chain"}
              </p>
              <p className="text-xs text-muted-foreground">
                {(chainError as Error).message?.includes("not Subscribed")
                  ? "Your Dhan account needs a Data API add-on. Enable it at dhan.co › Settings › Data APIs, then retry."
                  : ((chainError as Error).message ?? "Check Dhan broker connection and retry.")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : !hasData ? (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span className="text-sm">
              No data. Check your Dhan connection or select a different expiry.
            </span>
          </CardContent>
        </Card>
      ) : (
        /* ── Option Chain Table ──
           overflow-y-auto + max-h = table scrolls independently (not the page)
           No opacity change on background refetch = no dimming
        */
        <div
          ref={tableContainerRef}
          className="overflow-x-auto overflow-y-auto rounded-lg border border-border"
          style={{ maxHeight: "62vh" }}
        >
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              {/* Section labels — solid background so scrolled rows don't bleed through */}
              <tr className="border-b border-border">
                <th
                  colSpan={5}
                  className="py-2 text-center text-[11px] font-semibold tracking-wide text-red-400 bg-card border-r border-border"
                >
                  CALLS (CE) &nbsp;·&nbsp;
                </th>
                <th className="py-2 px-3 text-center text-[11px] font-semibold text-amber-400 bg-card whitespace-nowrap border-x border-border">
                  STRIKE
                </th>
                <th
                  colSpan={5}
                  className="py-2 text-center text-[11px] font-semibold tracking-wide text-emerald-400 bg-card border-l border-border"
                >
                  PUTS (PE) &nbsp;·&nbsp;
                </th>
              </tr>
              {/* Column headers — solid background */}
              <tr className="border-b border-border text-muted-foreground">
                {["OI Bar", "OI", "Volume", "IV%", "LTP"].map((h) => (
                  <th key={`ce-${h}`} className="px-2.5 py-1.5 text-right font-medium bg-muted">
                    {h}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-center font-medium bg-muted border-x border-border">₹</th>
                {["LTP", "IV%", "Volume", "OI", "OI Bar"].map((h) => (
                  <th key={`pe-${h}`} className="px-2.5 py-1.5 text-right font-medium bg-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {displayEntries.map((e) => {
                const isATM = e.strikePrice === atmStrike;
                const flash = flashDirs.get(e.strikePrice);
                const callDir = flash?.call ?? 0;
                const putDir = flash?.put ?? 0;

                return (
                  <tr
                    key={e.strikePrice}
                    ref={isATM ? atmRowRef : undefined}
                    className={`border-b border-border/30 transition-colors ${
                      isATM
                        ? "bg-amber-400/10 hover:bg-amber-400/15"
                        : "hover:bg-muted/15"
                    }`}
                  >
                    {/* ── CALL side ── */}
                    {/* OI Bar */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      <div className="flex justify-end">
                        <OIBar value={e.callOI} max={maxOI} side="ce" />
                      </div>
                    </td>
                    {/* OI */}
                    <td className={`px-2.5 py-2 text-right font-mono ${isATM ? "bg-red-400/5" : ""}`}>
                      <span className="text-red-400">{formatOI(e.callOI)}</span>
                    </td>
                    {/* Volume */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-red-400/5" : ""}`}>
                      {formatOI(e.callVolume)}
                    </td>
                    {/* IV */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-red-400/5" : ""}`}>
                      {e.callIV > 0 ? e.callIV.toFixed(1) : "—"}
                    </td>
                    {/* LTP — color flashes on price change */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      <span
                        className={`font-mono font-semibold transition-colors duration-300 ${
                          callDir > 0
                            ? "text-emerald-400"
                            : callDir < 0
                              ? "text-red-400"
                              : "text-foreground"
                        }`}
                      >
                        ₹{e.callLTP.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </td>

                    {/* ── STRIKE ── */}
                    <td
                      className={`px-3 py-2 text-center font-mono font-bold border-x border-border whitespace-nowrap ${
                        isATM
                          ? "bg-amber-400/15 text-amber-400 text-[13px]"
                          : "text-foreground/80"
                      }`}
                    >
                      {e.strikePrice.toLocaleString("en-IN")}
                      {isATM && (
                        <div className="text-[9px] font-bold text-amber-400 leading-none mt-0.5 tracking-wider">
                          ◆ ATM
                        </div>
                      )}
                    </td>

                    {/* ── PUT side ── */}
                    {/* LTP — color flashes on price change */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-emerald-400/5" : ""}`}>
                      <span
                        className={`font-mono font-semibold transition-colors duration-300 ${
                          putDir > 0
                            ? "text-emerald-400"
                            : putDir < 0
                              ? "text-red-400"
                              : "text-foreground"
                        }`}
                      >
                        ₹{e.putLTP.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    {/* IV */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {e.putIV > 0 ? e.putIV.toFixed(1) : "—"}
                    </td>
                    {/* Volume */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {formatOI(e.putVolume)}
                    </td>
                    {/* OI */}
                    <td className={`px-2.5 py-2 text-right font-mono ${isATM ? "bg-emerald-400/5" : ""}`}>
                      <span className="text-emerald-400">{formatOI(e.putOI)}</span>
                    </td>
                    {/* OI Bar */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-emerald-400/5" : ""}`}>
                      <div className="flex justify-start">
                        <OIBar value={e.putOI} max={maxOI} side="pe" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      {hasData && (
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-3 h-1.5 rounded-full bg-gradient-to-r from-red-600 to-red-400 inline-block" />
            Call OI bar
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-1.5 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 inline-block" />
            Put OI bar
          </span>
          <span className="flex items-center gap-1">
            <span className="text-amber-400">◆</span>
            ATM (At The Money)
          </span>
          <span className="flex items-center gap-1">
            <span className="text-emerald-400 text-[10px]">▲</span>
            <span className="text-red-400 text-[10px]">▼</span>
            LTP up / down from last update
          </span>
        </div>
      )}
    </div>
  );
}
