import { useState, useEffect, useRef, useMemo } from "react";
import { isHolidayToday } from "@/lib/market-calendar";
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
  Wifi,
  AlertTriangle,
} from "lucide-react";
import { marketSocket } from "@/lib/market-socket";

const BASE = import.meta.env.BASE_URL;

// Index underlying shape — loaded from DB (instruments table, instrument="INDEX")
interface IndexUnderlying {
  label: string;
  symbol: string;
  dhanSecId: number;   // security_id from DB — used for Dhan API calls
  dbSecId: number;     // underlying_security_id from DB
  segment: string;     // always "IDX_I" for INDEX instruments
  exchange: "NSE" | "MCX";
}

type Mode = "index" | "stock";
type Exchange = "NSE";

interface StockUnderlying {
  underlyingSymbol: string | null;
  underlyingSecurityId: number | null;
  exchId: string;
}

interface OptionEntry {
  strikePrice: number;
  callSecId?: number;
  putSecId?: number;
  // Price
  callLTP: number;
  callPrevClose: number;
  // OI
  callOI: number;
  callPrevOI: number;
  // Volume
  callVolume: number;
  // Greeks
  callIV: number;
  callDelta: number;
  callTheta: number;
  callGamma: number;
  callVega: number;
  // Bid/Ask
  callBidPrice: number;
  callBidQty: number;
  callAskPrice: number;
  callAskQty: number;
  // Put side mirrors
  putLTP: number;
  putPrevClose: number;
  putOI: number;
  putPrevOI: number;
  putVolume: number;
  putIV: number;
  putDelta: number;
  putTheta: number;
  putGamma: number;
  putVega: number;
  putBidPrice: number;
  putBidQty: number;
  putAskPrice: number;
  putAskQty: number;
}

// ── Market Hours (IST) ──────────────────────────────────────────────
// NSE Equity F&O           : Mon-Fri 09:15 → 15:30
// MCX Commodity F&O        : Mon-Fri 09:00 → 23:30
function getISTMinutes(): { mins: number; day: number } {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  return { mins: ist.getUTCHours() * 60 + ist.getUTCMinutes(), day: ist.getUTCDay() };
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
  if (isHolidayToday("NSE")) {
    return {
      isOpen: false,
      label: "Market closed · Public holiday",
      color: "text-muted-foreground",
    };
  }
  const open = 9 * 60 + 15;
  const close = 15 * 60 + 30;
  const closeLabel = "3:30 PM";
  const openLabel  = "9:15 AM";

  if (mins < open) {
    return {
      isOpen: false,
      label: `Pre-market · Opens ${openLabel} IST`,
      color: "text-amber-400",
    };
  }
  if (mins > close) {
    return {
      isOpen: false,
      label: `Market closed · Opens ${openLabel} IST tomorrow`,
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
  const exch = (r.exchId === "MCX" ? "MCX" : "NSE") as "NSE" | "MCX";
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
  const market: Exchange = "NSE";
  const [mode, setMode] = useState<Mode>("index");
  const [indexUnderlying, setIndexUnderlying] = useState<IndexUnderlying | null>(null);
  const [stockUnderlying, setStockUnderlying] = useState<StockUnderlying | null>(null);

  const [expiry, setExpiry] = useState("");
  // Live spot price from WS (overrides REST ltp when available)
  const [liveSpot, setLiveSpot] = useState<number>(0);

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
  const activeDbSecId = mode === "index"
    ? (activeIndex?.dbSecId ?? null)
    : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeDhanSecId = mode === "index"
    ? (activeIndex?.dhanSecId ?? null)
    : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeSegment = mode === "index"
    ? (activeIndex?.segment ?? "IDX_I")
    : "NSE_EQ";
  const activeLabel = mode === "index"
    ? (activeIndex?.label ?? "")
    : (stockUnderlying?.underlyingSymbol ?? "");
  const activeExchange: Exchange = "NSE";

  // Option contract segment
  const optionSegment = "NSE_FNO";

  // Market hours gate
  const marketStatus = useMarketStatus(activeExchange);

  // Expiry list — always fetched from Dhan API (NSE and MCX both use /optionchain/expirylist)
  const { data: expiryList = [], isLoading: expiryLoading } = useQuery<string[]>({
    queryKey: ["expiry-list", activeDhanSecId, activeSegment],
    queryFn: async () => {
      if (!activeDhanSecId || !activeSegment) return [];
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
    enabled: !!activeDhanSecId && !!activeSegment,
    // Refresh hourly — contracts expire intraday (e.g. CrudeOil on its expiry
    // day), so a 24h stale window would keep expired contracts selectable.
    staleTime: 60 * 60 * 1_000,
    gcTime: 60 * 60 * 1_000,
    refetchOnWindowFocus: false,
    refetchInterval: false,
    retry: 1,
  });

  useEffect(() => {
    setExpiry("");
    setLiveSpot(0); // clear stale live spot when underlying/market changes
  }, [activeDhanSecId, activeSegment, market]);
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
    // 30s REST poll — just for OI / IV / Volume refresh.
    // LTP is updated in real-time via WebSocket (see liveLtps below).
    refetchInterval: marketStatus.isOpen ? 30_000 : false,
    staleTime: 25_000,
    refetchOnWindowFocus: false,
    // NOTE: no `placeholderData` — carrying over the previous instrument's
    // chain while a new one loads briefly shows e.g. Gold strikes when the
    // user has just switched to Silver. staleTime+refetchInterval already
    // keep same-instrument background refreshes smooth, so we skip it.
    retry: 0,
  });

  // ── Parse chain data ─────────────────────────────────────────────
  const rawChain = chain?.data ?? {};
  const underlyingLtp = Number(chain?.ltp ?? 0);
  // displaySpot: prefer live WS price, fall back to REST snapshot
  const displaySpot = liveSpot > 0 ? liveSpot : underlyingLtp;
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
    const callSecId = Number(ce.security_id ?? ce.securityId ?? ce.SecurityId ?? 0) || undefined;
    const putSecId  = Number(pe.security_id ?? pe.securityId ?? pe.SecurityId ?? 0) || undefined;
    // Greeks are nested under ce.greeks / pe.greeks per Dhan API spec
    const ceG = (ce.greeks as Record<string, number> | undefined) ?? {};
    const peG = (pe.greeks as Record<string, number> | undefined) ?? {};
    entries.push({
      strikePrice: strike,
      callSecId,
      putSecId,
      // Price — Dhan field: last_price, prev: previous_close_price
      callLTP:       Number(ce.last_price ?? ce.ltp ?? 0),
      callPrevClose: Number(ce.previous_close_price ?? ce.prev_close ?? 0),
      // OI — Dhan fields: oi, previous_oi
      callOI,
      callPrevOI:  Number(ce.previous_oi ?? 0),
      callVolume:  Number(ce.volume ?? 0),
      // Greeks — Dhan fields: greeks.{delta,theta,gamma,vega}, implied_volatility
      callIV:    Number(ce.implied_volatility ?? 0),
      callDelta: Number(ceG.delta ?? 0),
      callTheta: Number(ceG.theta ?? 0),
      callGamma: Number(ceG.gamma ?? 0),
      callVega:  Number(ceG.vega ?? 0),
      // Bid/Ask — Dhan fields: top_bid_price, top_bid_quantity, top_ask_price, top_ask_quantity
      callBidPrice: Number(ce.top_bid_price ?? 0),
      callBidQty:   Number(ce.top_bid_quantity ?? 0),
      callAskPrice: Number(ce.top_ask_price ?? 0),
      callAskQty:   Number(ce.top_ask_quantity ?? 0),
      // ── Put side ────────────────────────────────────────────────────
      putLTP:       Number(pe.last_price ?? pe.ltp ?? 0),
      putPrevClose: Number(pe.previous_close_price ?? pe.prev_close ?? 0),
      putOI,
      putPrevOI:  Number(pe.previous_oi ?? 0),
      putVolume:  Number(pe.volume ?? 0),
      putIV:    Number(pe.implied_volatility ?? 0),
      putDelta: Number(peG.delta ?? 0),
      putTheta: Number(peG.theta ?? 0),
      putGamma: Number(peG.gamma ?? 0),
      putVega:  Number(peG.vega ?? 0),
      putBidPrice: Number(pe.top_bid_price ?? 0),
      putBidQty:   Number(pe.top_bid_quantity ?? 0),
      putAskPrice: Number(pe.top_ask_price ?? 0),
      putAskQty:   Number(pe.top_ask_quantity ?? 0),
    });
  }

  // ── ATM & display slice ─────────────────────────────────────────
  const atmStrike =
    displaySpot > 0 && strikes.length > 0
      ? strikes.reduce((prev, curr) =>
          Math.abs(curr - displaySpot) < Math.abs(prev - displaySpot) ? curr : prev,
        )
      : 0;

  const totalCallOI = entries.reduce((a, e) => a + e.callOI, 0);
  const totalPutOI = entries.reduce((a, e) => a + e.putOI, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  const displayEntries = (() => {
    if (entries.length === 0) return entries;
    const atmIdx = entries.findIndex((e) => e.strikePrice === atmStrike);
    if (atmIdx < 0 || displaySpot <= 0) {
      const mid = Math.floor(entries.length / 2);
      return entries.slice(Math.max(0, mid - 20), Math.min(entries.length, mid + 21));
    }
    return entries.slice(
      Math.max(0, atmIdx - 20),
      Math.min(entries.length, atmIdx + 21),
    );
  })();

  // ── WebSocket live LTP ────────────────────────────────────────────
  // liveBuffer: raw tick data written by WS callbacks (no re-render)
  // liveLtps: throttled snapshot flushed to state every 500 ms
  const liveBuffer = useRef<Map<number, number>>(new Map());
  const [liveLtps, setLiveLtps] = useState<Map<number, number>>(new Map());
  const [wsConnected, setWsConnected] = useState(false);

  // 500 ms flush: copy buffer → state (triggers single re-render per batch)
  useEffect(() => {
    const id = setInterval(() => {
      if (liveBuffer.current.size > 0) {
        setLiveLtps(new Map(liveBuffer.current));
      }
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Subscribe to underlying index/stock for live Spot price
  useEffect(() => {
    if (!activeDhanSecId || !activeSegment) return;
    const cb = (tick: { securityId: number; ltp: number }) => {
      if (tick.securityId === activeDhanSecId) setLiveSpot(tick.ltp);
    };
    const unsub = marketSocket.subscribe(activeSegment, activeDhanSecId, cb, "quote");
    return unsub;
  }, [activeDhanSecId, activeSegment]);

  // Subscribe to option strikes via WS (always active — market-closed instruments simply send no ticks)
  // displayEntries is a fresh array every render, so we derive a stable string key
  // from the actual security IDs; the effect only re-runs when the IDs truly change.
  const wsSubKey = useMemo(
    () =>
      displayEntries
        .map((e) => `${e.callSecId ?? 0}.${e.putSecId ?? 0}`)
        .join("|"),
    [displayEntries],
  );
  const wsSubIdsRef = useRef<number[]>([]);
  wsSubIdsRef.current = displayEntries.flatMap((e) =>
    [e.callSecId, e.putSecId].filter((id): id is number => !!id),
  );

  useEffect(() => {
    const allIds = wsSubIdsRef.current;
    if (allIds.length === 0) return;

    const cb = (tick: { securityId: number; ltp: number }) => {
      liveBuffer.current.set(tick.securityId, tick.ltp);
    };

    const unsubscribe = marketSocket.subscribeBatch(optionSegment, allIds, cb, "quote");
    setWsConnected(true);
    return () => {
      unsubscribe();
      setWsConnected(false);
    };
  }, [wsSubKey, optionSegment]);

  // ── Live LTP flash tracking ──────────────────────────────────────
  // prevPricesRef: prices from previous render cycle (REST or WS)
  const prevPricesRef = useRef<Map<number, { call: number; put: number }>>(new Map());
  const [flashDirs, setFlashDirs] = useState<Map<number, FlashEntry>>(new Map());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Flash on REST-based updates (OI/IV/volume refresh)
  useEffect(() => {
    if (entries.length === 0) return;

    const newPrices = new Map<number, { call: number; put: number }>();
    const newFlash = new Map<number, FlashEntry>();

    entries.forEach((e) => {
      const liveCe = e.callSecId ? (liveBuffer.current.get(e.callSecId) ?? e.callLTP) : e.callLTP;
      const livePe = e.putSecId  ? (liveBuffer.current.get(e.putSecId)  ?? e.putLTP)  : e.putLTP;
      newPrices.set(e.strikePrice, { call: liveCe, put: livePe });
      const prev = prevPricesRef.current.get(e.strikePrice);
      if (prev) {
        const callDir: Dir = liveCe > prev.call ? 1 : liveCe < prev.call ? -1 : 0;
        const putDir: Dir  = livePe > prev.put  ? 1 : livePe < prev.put  ? -1 : 0;
        if (callDir !== 0 || putDir !== 0) {
          newFlash.set(e.strikePrice, { call: callDir, put: putDir });
        }
      }
    });

    prevPricesRef.current = newPrices;

    if (newFlash.size > 0) {
      // Merge, don't replace — otherwise each 30s REST poll wipes in-progress
      // flashes triggered by WS ticks between polls.
      setFlashDirs((prev) => new Map([...prev, ...newFlash]));
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashDirs(new Map()), 2_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain]);

  // Flash on WebSocket LTP updates (500 ms cadence)
  useEffect(() => {
    if (displayEntries.length === 0 || liveLtps.size === 0) return;

    const newFlash = new Map<number, FlashEntry>();

    displayEntries.forEach((e) => {
      const liveCe = e.callSecId ? (liveLtps.get(e.callSecId) ?? e.callLTP) : e.callLTP;
      const livePe = e.putSecId  ? (liveLtps.get(e.putSecId)  ?? e.putLTP)  : e.putLTP;
      const prev = prevPricesRef.current.get(e.strikePrice);
      if (prev) {
        const callDir: Dir = liveCe > prev.call ? 1 : liveCe < prev.call ? -1 : 0;
        const putDir: Dir  = livePe > prev.put  ? 1 : livePe < prev.put  ? -1 : 0;
        if (callDir !== 0 || putDir !== 0) {
          newFlash.set(e.strikePrice, { call: callDir, put: putDir });
          prevPricesRef.current.set(e.strikePrice, { call: liveCe, put: livePe });
        }
      }
    });

    if (newFlash.size > 0) {
      setFlashDirs((prev) => new Map([...prev, ...newFlash]));
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashDirs(new Map()), 2_000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLtps]);

  // ── Batch REST LTP poll (POST /marketfeed/ltp) ───────────────────
  // Provides fresh LTP every 5 s for displayed strikes via Dhan Market Quote API.
  // WebSocket ticks remain primary — this is a reliable fallback + initialization.
  // Uses displayEntries (±20 ATM window) to stay well under the 1000-instrument limit.
  const allSecIds = displayEntries.flatMap(e =>
    [e.callSecId, e.putSecId].filter((id): id is number => !!id)
  );

  const { data: batchLtpData } = useQuery<{ ltps: Record<string, number> }>({
    queryKey: ["option-ltp-batch", optionSegment, expiry, allSecIds.slice(0, 4).join(",")],
    queryFn: async () => {
      if (allSecIds.length === 0) return { ltps: {} };
      const res = await fetch(`${BASE}api/market/ltp-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ securities: { [optionSegment]: allSecIds } }),
      });
      if (!res.ok) throw new Error("ltp-batch failed");
      return res.json() as Promise<{ ltps: Record<string, number> }>;
    },
    enabled: allSecIds.length > 0 && !!expiry && !!optionSegment,
    refetchInterval: marketStatus.isOpen ? 5_000 : false,
    staleTime: 4_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  // Merge batch LTP into the shared live buffer so the 500 ms flush picks it up.
  // WebSocket ticks written to the buffer more recently will naturally win.
  useEffect(() => {
    if (!batchLtpData?.ltps) return;
    let changed = false;
    for (const [secIdStr, ltp] of Object.entries(batchLtpData.ltps)) {
      if (ltp > 0) {
        liveBuffer.current.set(Number(secIdStr), ltp);
        changed = true;
      }
    }
    if (changed) setLiveLtps(new Map(liveBuffer.current));
  }, [batchLtpData]);

  // ── Auto-scroll table to ATM row ─────────────────────────────────
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const atmRowRef = useRef<HTMLTableRowElement>(null);

  // Only auto-scroll when the ATM strike or expiry actually changes.
  // Previously depended on `displayEntries` (a fresh array every render),
  // which snapped the scroll back to ATM on every LTP tick and trapped the
  // user on the ATM row even while they tried to scroll to OTM strikes.
  useEffect(() => {
    if (!atmRowRef.current || !tableContainerRef.current) return;
    const container = tableContainerRef.current;
    const row = atmRowRef.current;
    const rowMid = row.offsetTop + row.offsetHeight / 2;
    container.scrollTop = rowMid - container.clientHeight / 2;
  }, [atmStrike, expiry, activeDhanSecId]);

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
              Market closed · Showing last closing values · Live resumes at 9:15 AM IST
            </p>
          </div>
        ) : (
          <div />
        )}

        {/* Right: controls */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">

          {/* ── NSE controls ── */}
          <>
              {/* Index / Stock toggle */}
              <div className="flex rounded-md overflow-hidden border border-border text-xs">
                <button
                  className={`px-3 py-1.5 ${mode === "index" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setMode("index"); setStockUnderlying(null); setExpiry(""); }}
                >
                  Index
                </button>
                <button
                  className={`px-3 py-1.5 ${mode === "stock" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setMode("stock"); setExpiry(""); }}
                >
                  Stock
                </button>
              </div>

              {/* Index dropdown or Stock search */}
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
                <StockSearch onSelect={(s) => { setStockUnderlying(s); setExpiry(""); }} />
              )}

              {/* Expiry — shows once underlying is selected */}
              {(mode === "index" ? !!activeIndex : !!stockUnderlying) && (
                <Select value={expiry} onValueChange={setExpiry} disabled={expiryLoading || expiryList.length === 0}>
                  <SelectTrigger className="w-32 text-xs font-mono h-9">
                    <SelectValue placeholder={expiryLoading ? "Loading…" : "Expiry"} />
                  </SelectTrigger>
                  <SelectContent>
                    {expiryList.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
          </>

        </div>
      </div>

      {/* ── Stats bar ── */}
      {hasData && (
        <div className="flex items-center gap-6 flex-wrap text-xs">
          {displaySpot > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Spot:</span>
              <span className="font-mono font-bold text-foreground">
                ₹{displaySpot.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
              </span>
              {liveSpot > 0 && (
                <span className="text-[9px] text-emerald-400 font-medium">LIVE</span>
              )}
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
          {marketStatus.isOpen && (
            <span className={`flex items-center gap-1 text-[10px] font-medium ${wsConnected ? "text-emerald-400" : batchLtpData ? "text-sky-400" : "text-muted-foreground"}`}>
              <Wifi className="w-3 h-3" />
              {wsConnected ? "WS live" : batchLtpData ? "REST 5s" : "Connecting…"}
            </span>
          )}
        </div>
      )}

      {/* ── Thin-market notice ── */}
      {hasData && totalCallOI + totalPutOI < 50 && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-400/20 bg-amber-400/5 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <span className="text-amber-300/90 leading-snug">
            <strong>Thin market</strong> — Option premiums shown are last-traded reference prices (OI is very low or zero). Live bid/ask unavailable. Exercise caution when placing orders.
          </span>
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
                  colSpan={7}
                  className="py-2 text-center text-[11px] font-semibold tracking-wide text-red-400 bg-card border-r border-border"
                >
                  CALLS (CE) &nbsp;·&nbsp;
                </th>
                <th className="py-2 px-3 text-center text-[11px] font-semibold text-amber-400 bg-card whitespace-nowrap border-x border-border">
                  STRIKE
                </th>
                <th
                  colSpan={7}
                  className="py-2 text-center text-[11px] font-semibold tracking-wide text-emerald-400 bg-card border-l border-border"
                >
                  PUTS (PE) &nbsp;·&nbsp;
                </th>
              </tr>
              {/* Column headers — solid background */}
              <tr className="border-b border-border text-muted-foreground">
                {["OI Bar", "OI", "Volume", "IV%", "Δ", "Bid × Ask", "LTP"].map((h) => (
                  <th key={`ce-${h}`} className="px-2.5 py-1.5 text-right font-medium bg-muted whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th className="px-3 py-1.5 text-center font-medium bg-muted border-x border-border">₹</th>
                {["LTP", "Bid × Ask", "Δ", "IV%", "Volume", "OI", "OI Bar"].map((h) => (
                  <th key={`pe-${h}`} className="px-2.5 py-1.5 text-right font-medium bg-muted whitespace-nowrap">
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
                    {/* ── CALL side (7 cols) ── */}

                    {/* 1. OI Bar */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      <div className="flex justify-end">
                        <OIBar value={e.callOI} max={maxOI} side="ce" />
                      </div>
                    </td>

                    {/* 2. OI + ΔOI */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      <div className="flex flex-col items-end leading-tight gap-px">
                        <span className="font-mono text-red-400">{formatOI(e.callOI)}</span>
                        {e.callPrevOI > 0 && (() => {
                          const d = e.callOI - e.callPrevOI;
                          return d !== 0 ? (
                            <span className={`text-[9px] tabular-nums ${d > 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                              {d > 0 ? "▲" : "▼"}{formatOI(Math.abs(d))}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>

                    {/* 3. Volume */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-red-400/5" : ""}`}>
                      {formatOI(e.callVolume)}
                    </td>

                    {/* 4. IV% */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-red-400/5" : ""}`}>
                      {e.callIV > 0 ? e.callIV.toFixed(1) : "—"}
                    </td>

                    {/* 5. Delta */}
                    <td className={`px-2.5 py-2 text-right font-mono ${isATM ? "bg-red-400/5" : ""}`}>
                      {e.callDelta !== 0 ? (
                        <span className="text-sky-400/90">{e.callDelta.toFixed(3)}</span>
                      ) : "—"}
                    </td>

                    {/* 6. Bid × Ask */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      {e.callBidPrice > 0 || e.callAskPrice > 0 ? (
                        <div className="flex flex-col items-end leading-tight gap-px font-mono text-[10px]">
                          <span className="text-emerald-400/80">
                            {e.callBidPrice.toFixed(2)}
                            {e.callBidQty > 0 && <span className="text-muted-foreground/60 ml-0.5">({e.callBidQty})</span>}
                          </span>
                          <span className="text-red-400/80">
                            {e.callAskPrice.toFixed(2)}
                            {e.callAskQty > 0 && <span className="text-muted-foreground/60 ml-0.5">({e.callAskQty})</span>}
                          </span>
                        </div>
                      ) : "—"}
                    </td>

                    {/* 7. LTP + Chg% + θ — live via REST 5s + WebSocket */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-red-400/5" : ""}`}>
                      {(() => {
                        const liveLtp = e.callSecId ? liveLtps.get(e.callSecId) : undefined;
                        const ltp = liveLtp !== undefined ? liveLtp : e.callLTP;
                        if (ltp === 0) return <span className="font-mono text-muted-foreground/40">—</span>;
                        const chgPct = e.callPrevClose > 0 ? ((ltp - e.callPrevClose) / e.callPrevClose * 100) : null;
                        const isRef = e.callOI === 0 && e.callBidPrice === 0 && liveLtp === undefined;
                        return (
                          <div className="flex flex-col items-end leading-tight gap-px">
                            <span className={`font-mono font-semibold transition-colors duration-300 ${
                              isRef ? "text-foreground/50" :
                              callDir > 0 ? "text-emerald-400" : callDir < 0 ? "text-red-400" : "text-foreground"
                            }`}>
                              ₹{ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              {isRef && <span className="text-[8px] text-muted-foreground/50 ml-0.5">ref</span>}
                            </span>
                            {chgPct !== null && !isRef && (
                              <span className={`text-[9px] font-medium tabular-nums ${chgPct >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(1)}%
                              </span>
                            )}
                            {e.callTheta !== 0 && (
                              <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                                θ {e.callTheta.toFixed(1)}
                              </span>
                            )}
                          </div>
                        );
                      })()}
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

                    {/* ── PUT side (7 cols) ── */}

                    {/* 1. LTP + Chg% + θ — live via REST 5s + WebSocket */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {(() => {
                        const liveLtp = e.putSecId ? liveLtps.get(e.putSecId) : undefined;
                        const ltp = liveLtp !== undefined ? liveLtp : e.putLTP;
                        if (ltp === 0) return <span className="font-mono text-muted-foreground/40">—</span>;
                        const chgPct = e.putPrevClose > 0 ? ((ltp - e.putPrevClose) / e.putPrevClose * 100) : null;
                        const isRef = e.putOI === 0 && e.putBidPrice === 0 && liveLtp === undefined;
                        return (
                          <div className="flex flex-col items-end leading-tight gap-px">
                            <span className={`font-mono font-semibold transition-colors duration-300 ${
                              isRef ? "text-foreground/50" :
                              putDir > 0 ? "text-emerald-400" : putDir < 0 ? "text-red-400" : "text-foreground"
                            }`}>
                              ₹{ltp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                              {isRef && <span className="text-[8px] text-muted-foreground/50 ml-0.5">ref</span>}
                            </span>
                            {chgPct !== null && !isRef && (
                              <span className={`text-[9px] font-medium tabular-nums ${chgPct >= 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                                {chgPct >= 0 ? "+" : ""}{chgPct.toFixed(1)}%
                              </span>
                            )}
                            {e.putTheta !== 0 && (
                              <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                                θ {e.putTheta.toFixed(1)}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>

                    {/* 2. Bid × Ask */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {e.putBidPrice > 0 || e.putAskPrice > 0 ? (
                        <div className="flex flex-col items-end leading-tight gap-px font-mono text-[10px]">
                          <span className="text-emerald-400/80">
                            {e.putBidPrice.toFixed(2)}
                            {e.putBidQty > 0 && <span className="text-muted-foreground/60 ml-0.5">({e.putBidQty})</span>}
                          </span>
                          <span className="text-red-400/80">
                            {e.putAskPrice.toFixed(2)}
                            {e.putAskQty > 0 && <span className="text-muted-foreground/60 ml-0.5">({e.putAskQty})</span>}
                          </span>
                        </div>
                      ) : "—"}
                    </td>

                    {/* 3. Delta */}
                    <td className={`px-2.5 py-2 text-right font-mono ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {e.putDelta !== 0 ? (
                        <span className="text-sky-400/90">{e.putDelta.toFixed(3)}</span>
                      ) : "—"}
                    </td>

                    {/* 4. IV% */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {e.putIV > 0 ? e.putIV.toFixed(1) : "—"}
                    </td>

                    {/* 5. Volume */}
                    <td className={`px-2.5 py-2 text-right font-mono text-muted-foreground ${isATM ? "bg-emerald-400/5" : ""}`}>
                      {formatOI(e.putVolume)}
                    </td>

                    {/* 6. OI + ΔOI */}
                    <td className={`px-2.5 py-2 text-right ${isATM ? "bg-emerald-400/5" : ""}`}>
                      <div className="flex flex-col items-end leading-tight gap-px">
                        <span className="font-mono text-emerald-400">{formatOI(e.putOI)}</span>
                        {e.putPrevOI > 0 && (() => {
                          const d = e.putOI - e.putPrevOI;
                          return d !== 0 ? (
                            <span className={`text-[9px] tabular-nums ${d > 0 ? "text-emerald-400/70" : "text-red-400/70"}`}>
                              {d > 0 ? "▲" : "▼"}{formatOI(Math.abs(d))}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>

                    {/* 7. OI Bar */}
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
            LTP flash up/down · OI ΔOI change from prev close
          </span>
          <span className="flex items-center gap-1">
            <span className="text-sky-400/90 font-mono text-[10px]">Δ</span>
            Delta greek · θ Theta below LTP · Bid(qty)×Ask(qty)
          </span>
          <span className="flex items-center gap-1">
            <Wifi className="w-3 h-3 text-emerald-400" />
            LTP: WebSocket real-time + REST 5s fallback · OI/Greeks/Vol refresh every 30 s
          </span>
        </div>
      )}
    </div>
  );
}
