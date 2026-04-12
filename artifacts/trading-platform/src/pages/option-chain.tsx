import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, WifiOff, Search, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

// dhanSecId  = security ID used in Dhan's option-chain & expiry-list API calls
// dbSecId    = underlying_security_id stored in our instruments DB (for local expiry query)
const INDEX_UNDERLYINGS = [
  { label: "NIFTY 50",       symbol: "NIFTY",      dhanSecId: 13,   dbSecId: 26000, segment: "IDX_I" },
  { label: "BANK NIFTY",     symbol: "BANKNIFTY",  dhanSecId: 25,   dbSecId: 26009, segment: "IDX_I" },
  { label: "FIN NIFTY",      symbol: "FINNIFTY",   dhanSecId: 27,   dbSecId: 26037, segment: "IDX_I" },
  { label: "MIDCAP NIFTY",   symbol: "MIDCPNIFTY", dhanSecId: 442,  dbSecId: 26074, segment: "IDX_I" },
  { label: "SENSEX",         symbol: "SENSEX",     dhanSecId: 1,    dbSecId: 1,     segment: "IDX_I" },
  { label: "BANKEX",         symbol: "BANKEX",     dhanSecId: 12,   dbSecId: 12,    segment: "IDX_I" },
  { label: "NIFTYNXT50",     symbol: "NIFTYNXT50", dhanSecId: 26013,dbSecId: 26013, segment: "IDX_I" },
];

type Mode = "index" | "stock";

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

function formatOI(oi: number) {
  if (oi >= 10_000_000) return `${(oi / 10_000_000).toFixed(2)}Cr`;
  if (oi >= 100_000)    return `${(oi / 100_000).toFixed(1)}L`;
  if (oi >= 1_000)      return `${(oi / 1_000).toFixed(1)}K`;
  return String(oi);
}

function OIBar({ value, max, side }: { value: number; max: number; side: "ce" | "pe" }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${side === "ce" ? "bg-emerald-400/60" : "bg-red-400/60"}`}
        style={{ width: `${pct}%`, float: side === "ce" ? "right" : "left" }}
      />
    </div>
  );
}

function StockSearch({ onSelect }: { onSelect: (s: StockUnderlying) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<StockUnderlying[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`${BASE}api/instruments/option-underlyings?q=${encodeURIComponent(q)}`);
        const data = await res.json() as StockUnderlying[];
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } finally { setLoading(false); }
    }, 300);
  }, [q]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
          onChange={e => setQ(e.target.value)}
          placeholder="Search stock…"
          className="pl-8 pr-8 h-9 text-xs"
        />
        {q && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => { setQ(""); setResults([]); setOpen(false); }}>
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
              onClick={() => { onSelect(r); setQ(r.underlyingSymbol ?? ""); setOpen(false); }}
            >
              <span className="font-mono font-semibold">{r.underlyingSymbol}</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0">{r.exchId}</Badge>
            </button>
          ))}
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
        </div>
      )}
    </div>
  );
}

export default function OptionChain() {
  const [mode, setMode] = useState<Mode>("index");
  const [indexUnderlying, setIndexUnderlying] = useState(INDEX_UNDERLYINGS[0]);
  const [stockUnderlying, setStockUnderlying] = useState<StockUnderlying | null>(null);
  const [expiry, setExpiry] = useState("");

  // dbSecId → used for local DB expiry list query (matches instruments.underlying_security_id)
  // dhanSecId → used for Dhan API calls (option chain, expiry list from Dhan)
  const activeDbSecId = mode === "index"
    ? indexUnderlying.dbSecId
    : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeDhanSecId = mode === "index"
    ? indexUnderlying.dhanSecId
    : (stockUnderlying?.underlyingSecurityId ?? null);
  const activeInstrument = mode === "index" ? "OPTIDX" : "OPTSTK";
  const activeSegment = mode === "index"
    ? indexUnderlying.segment
    : (stockUnderlying?.exchId === "BSE" ? "BSE_EQ" : "NSE_EQ");
  const activeLabel = mode === "index"
    ? indexUnderlying.label
    : (stockUnderlying?.underlyingSymbol ?? "");

  // Expiry list via Dhan API — fires only for the active underlying
  const { data: expiryList = [], isLoading: expiryLoading } = useQuery<string[]>({
    queryKey: ["expiry-list-dhan", activeDhanSecId, activeSegment],
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
      const json = await res.json() as { data?: string[] };
      return json.data ?? [];
    },
    enabled: !!activeDhanSecId,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  useEffect(() => {
    setExpiry("");
  }, [activeDhanSecId, activeSegment]);

  useEffect(() => {
    if (expiryList.length > 0 && !expiry) setExpiry(expiryList[0]);
  }, [expiryList, expiry]);

  // Option chain — max 1 request per 10 seconds; only for the active script + expiry
  const { data: chain, isLoading: chainLoading, refetch, isFetching, error: chainError } = useQuery({
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
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to fetch option chain");
      }
      return res.json() as Promise<{ data?: Record<string, unknown>; ltp?: number }>;
    },
    enabled: !!expiry && !!activeDhanSecId,
    refetchInterval: 10_000,
    staleTime: 8_000,
    refetchOnWindowFocus: false,
    retry: 0,
  });

  // rawChain is now the oc object: { "25650.000000": { ce: {...}, pe: {...} }, ... }
  const rawChain = chain?.data ?? {};
  const underlyingLtp = Number(chain?.ltp ?? 0);
  const entries: OptionEntry[] = [];

  // Dhan uses float string keys like "25650.000000" — parseFloat them, then find by value
  const strikeKeys = Object.keys(rawChain);
  const strikes = strikeKeys
    .map(k => parseFloat(k))
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  let maxOI = 1;
  for (const strike of strikes) {
    // Find original key that matches this float value (handles "25650.000000" → 25650)
    const key = strikeKeys.find(k => parseFloat(k) === strike) ?? String(strike);
    const s = rawChain[key] as Record<string, Record<string, unknown>> | undefined;
    // Dhan returns lowercase ce/pe
    const ce = s?.["ce"] ?? s?.["CE"] ?? {};
    const pe = s?.["pe"] ?? s?.["PE"] ?? {};
    const callOI = Number(ce.oi ?? ce.openInterest ?? 0);
    const putOI  = Number(pe.oi ?? pe.openInterest ?? 0);
    if (callOI > maxOI) maxOI = callOI;
    if (putOI  > maxOI) maxOI = putOI;
    entries.push({
      strikePrice: strike,
      callLTP:    Number(ce.last_price ?? ce.ltp ?? 0),
      callOI,
      callVolume: Number(ce.volume ?? 0),
      callIV:     Number(ce.implied_volatility ?? ce.iv ?? ce.impliedVolatility ?? 0),
      putLTP:     Number(pe.last_price ?? pe.ltp ?? 0),
      putOI,
      putVolume:  Number(pe.volume ?? 0),
      putIV:      Number(pe.implied_volatility ?? pe.iv ?? pe.impliedVolatility ?? 0),
    });
  }

  const atmStrike = underlyingLtp > 0 && strikes.length > 0
    ? strikes.reduce((prev, curr) => Math.abs(curr - underlyingLtp) < Math.abs(prev - underlyingLtp) ? curr : prev)
    : 0;

  // PCR computed from ALL strikes, display limited to 20 below + ATM + 20 above
  const totalCallOI = entries.reduce((a, e) => a + e.callOI, 0);
  const totalPutOI  = entries.reduce((a, e) => a + e.putOI, 0);
  const pcr = totalCallOI > 0 ? totalPutOI / totalCallOI : 0;

  // Show only 20 strikes below ATM and 20 above ATM (41 max) to avoid rate-limit flooding
  const displayEntries = (() => {
    if (entries.length === 0) return entries;
    const atmIdx = entries.findIndex(e => e.strikePrice === atmStrike);
    if (atmIdx < 0 || underlyingLtp <= 0) {
      const mid = Math.floor(entries.length / 2);
      return entries.slice(Math.max(0, mid - 20), Math.min(entries.length, mid + 21));
    }
    return entries.slice(Math.max(0, atmIdx - 20), Math.min(entries.length, atmIdx + 21));
  })();

  const isLoading = expiryLoading || chainLoading;
  const hasData = displayEntries.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Option Chain</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live F&amp;O data · Auto-refresh every 10 sec · ±20 strikes around ATM
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-md overflow-hidden border border-border text-xs">
            <button
              className={`px-3 py-1.5 ${mode === "index" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => { setMode("index"); setStockUnderlying(null); setExpiry(""); }}
            >
              Index
            </button>
            <button
              className={`px-3 py-1.5 ${mode === "stock" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => { setMode("stock"); setExpiry(""); }}
            >
              Stock
            </button>
          </div>

          {mode === "index" ? (
            <Select
              value={String(indexUnderlying.dhanSecId)}
              onValueChange={v => {
                const u = INDEX_UNDERLYINGS.find(u => String(u.dhanSecId) === v);
                if (u) { setIndexUnderlying(u); setExpiry(""); }
              }}
            >
              <SelectTrigger className="w-36 text-xs h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INDEX_UNDERLYINGS.map(u => (
                  <SelectItem key={u.dhanSecId} value={String(u.dhanSecId)}>{u.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <StockSearch onSelect={s => { setStockUnderlying(s); setExpiry(""); }} />
          )}

          <Select
            value={expiry}
            onValueChange={setExpiry}
            disabled={expiryLoading || expiryList.length === 0 || !activeDbSecId}
          >
            <SelectTrigger className="w-32 text-xs font-mono h-9">
              <SelectValue placeholder={expiryLoading ? "Loading…" : "Expiry"} />
            </SelectTrigger>
            <SelectContent>
              {expiryList.map(e => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-9"
            onClick={() => void refetch()}
            disabled={isFetching || !expiry || !activeDhanSecId}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {hasData && (
        <div className="flex items-center gap-6 flex-wrap text-xs">
          {underlyingLtp > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Spot:</span>
              <span className="font-mono font-semibold">₹{underlyingLtp.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">PCR:</span>
            <span className={`font-mono font-semibold ${pcr > 1 ? "text-emerald-400" : "text-red-400"}`}>{pcr.toFixed(2)}</span>
            <span className="text-muted-foreground">{pcr > 1.2 ? "Bullish" : pcr < 0.8 ? "Bearish" : "Neutral"}</span>
          </div>
          {atmStrike > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">ATM:</span>
              <span className="font-mono font-semibold text-amber-400">₹{atmStrike.toLocaleString("en-IN")}</span>
            </div>
          )}
          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
            {activeLabel} · {expiry}
          </Badge>
        </div>
      )}

      {mode === "stock" && !stockUnderlying ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Search for a stock symbol above to view its option chain.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-2">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
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
            <span className="text-sm">No data available. Connect your Dhan account or try a different expiry.</span>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th colSpan={5} className="text-center py-2 text-emerald-400 font-medium border-r border-border">CALL (CE)</th>
                <th className="text-center py-2 text-amber-400 font-semibold px-3 whitespace-nowrap">STRIKE</th>
                <th colSpan={5} className="text-center py-2 text-red-400 font-medium border-l border-border">PUT (PE)</th>
              </tr>
              <tr className="border-b border-border bg-muted/20">
                {["OI Bar", "OI", "Vol", "IV%", "LTP"].map(h => (
                  <th key={`ce-${h}`} className="px-2 py-1.5 text-right text-muted-foreground font-medium">{h}</th>
                ))}
                <th className="px-3 py-1.5 text-center text-muted-foreground font-medium border-x border-border">₹</th>
                {["LTP", "IV%", "Vol", "OI", "OI Bar"].map(h => (
                  <th key={`pe-${h}`} className="px-2 py-1.5 text-right text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayEntries.map(e => {
                const isATM = e.strikePrice === atmStrike;
                return (
                  <tr
                    key={e.strikePrice}
                    className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${isATM ? "bg-amber-400/5" : ""}`}
                  >
                    <td className="px-2 py-1.5 text-right">
                      <OIBar value={e.callOI} max={maxOI} side="ce" />
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-emerald-400/80">{formatOI(e.callOI)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatOI(e.callVolume)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{e.callIV.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-emerald-400">
                      ₹{e.callLTP.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-3 py-1.5 text-center font-mono font-bold border-x border-border whitespace-nowrap ${isATM ? "text-amber-400" : "text-foreground"}`}>
                      {e.strikePrice.toLocaleString("en-IN")}
                      {isATM && <span className="ml-1 text-[9px] text-amber-400">ATM</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-red-400">
                      ₹{e.putLTP.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{e.putIV.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatOI(e.putVolume)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-400/80">{formatOI(e.putOI)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <OIBar value={e.putOI} max={maxOI} side="pe" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
