import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, TrendingUp, TrendingDown, WifiOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const UNDERLYINGS = [
  { label: "NIFTY 50", securityId: "13", segment: "IDX_I" },
  { label: "BANK NIFTY", securityId: "25", segment: "IDX_I" },
  { label: "FIN NIFTY", securityId: "27", segment: "IDX_I" },
  { label: "MIDCAP NIFTY", securityId: "442", segment: "IDX_I" },
  { label: "SENSEX", securityId: "1", segment: "BSE_EQ" },
];

interface OptionEntry {
  strikePrice?: number;
  callLTP?: number;
  callOI?: number;
  callVolume?: number;
  callIV?: number;
  putLTP?: number;
  putOI?: number;
  putVolume?: number;
  putIV?: number;
  [key: string]: unknown;
}

function formatOI(oi: number) {
  if (oi >= 10000000) return `${(oi / 10000000).toFixed(2)}Cr`;
  if (oi >= 100000) return `${(oi / 100000).toFixed(1)}L`;
  if (oi >= 1000) return `${(oi / 1000).toFixed(1)}K`;
  return String(oi);
}

function OIBar({ value, max, side }: { value: number; max: number; side: "ce" | "pe" }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
      <div
        className={`h-full rounded-full ${side === "ce" ? "bg-emerald-400/60" : "bg-red-400/60"}`}
        style={{ width: `${pct}%`, float: side === "ce" ? "right" : "left" }}
      />
    </div>
  );
}

export default function OptionChain() {
  const [underlying, setUnderlying] = useState(UNDERLYINGS[0]);
  const [expiry, setExpiry] = useState("");

  const { data: expiryList = [], isLoading: expiryLoading } = useQuery<string[]>({
    queryKey: ["expiry-list", underlying.securityId],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/market/expiry-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ underSecurityId: underlying.securityId, underExchangeSegment: underlying.segment }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as { data?: string[] };
      return data.data ?? [];
    },
    staleTime: 300000,
  });

  useEffect(() => {
    if (expiryList.length > 0 && !expiry) setExpiry(expiryList[0]);
  }, [expiryList, expiry]);

  const { data: chain, isLoading: chainLoading, refetch, isFetching } = useQuery({
    queryKey: ["option-chain", underlying.securityId, expiry],
    queryFn: async () => {
      if (!expiry) return null;
      const res = await fetch(`${BASE}api/market/option-chain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ underSecurityId: underlying.securityId, underExchangeSegment: underlying.segment, expiry }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to fetch option chain");
      }
      return res.json() as Promise<{ data?: unknown }>;
    },
    enabled: !!expiry,
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const rawChain = chain?.data as Record<string, unknown> | undefined;
  const entries: OptionEntry[] = [];
  let atmStrike = 0;

  if (rawChain) {
    const strikes = Object.keys(rawChain).map(Number).sort((a, b) => a - b);
    let maxOI = 0;
    for (const strike of strikes) {
      const s = rawChain[String(strike)] as Record<string, Record<string, unknown>> | undefined;
      const ce = s?.["CE"] ?? {};
      const pe = s?.["PE"] ?? {};
      const entry: OptionEntry = {
        strikePrice: strike,
        callLTP: Number(ce.last_price ?? 0),
        callOI: Number(ce.oi ?? 0),
        callVolume: Number(ce.volume ?? 0),
        callIV: Number(ce.iv ?? 0),
        putLTP: Number(pe.last_price ?? 0),
        putOI: Number(pe.oi ?? 0),
        putVolume: Number(pe.volume ?? 0),
        putIV: Number(pe.iv ?? 0),
      };
      entries.push(entry);
      if (Number(ce.oi ?? 0) > maxOI) maxOI = Number(ce.oi ?? 0);
      if (Number(pe.oi ?? 0) > maxOI) maxOI = Number(pe.oi ?? 0);
    }
    const underlying_ltp = Number(rawChain.last_price ?? 0);
    if (underlying_ltp > 0 && strikes.length > 0) {
      atmStrike = strikes.reduce((prev, curr) => Math.abs(curr - underlying_ltp) < Math.abs(prev - underlying_ltp) ? curr : prev);
    }
  }

  const maxOI = Math.max(...entries.map(e => Math.max(e.callOI ?? 0, e.putOI ?? 0)), 1);
  const pcr = entries.reduce((a, e) => a + (e.putOI ?? 0), 0) / Math.max(entries.reduce((a, e) => a + (e.callOI ?? 0), 0), 1);

  const isLoading = expiryLoading || chainLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Option Chain</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Live F&O data · Auto-refresh every 60s · Max 1 req/3s</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={underlying.securityId} onValueChange={v => {
            const u = UNDERLYINGS.find(u => u.securityId === v);
            if (u) { setUnderlying(u); setExpiry(""); }
          }}>
            <SelectTrigger className="w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {UNDERLYINGS.map(u => <SelectItem key={u.securityId} value={u.securityId}>{u.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={expiry} onValueChange={setExpiry} disabled={expiryLoading || expiryList.length === 0}>
            <SelectTrigger className="w-32 text-xs font-mono">
              <SelectValue placeholder={expiryLoading ? "Loading..." : "Expiry"} />
            </SelectTrigger>
            <SelectContent>
              {expiryList.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refetch()} disabled={isFetching || !expiry}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {entries.length > 0 && (
        <div className="flex items-center gap-6 flex-wrap text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">PCR:</span>
            <span className={`font-mono font-semibold ${pcr > 1 ? "text-emerald-400" : "text-red-400"}`}>{pcr.toFixed(2)}</span>
            <span className="text-muted-foreground">{pcr > 1.2 ? "Bullish" : pcr < 0.8 ? "Bearish" : "Neutral"}</span>
          </div>
          {atmStrike > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">ATM Strike:</span>
              <span className="font-mono font-semibold text-amber-400">₹{atmStrike.toLocaleString("en-IN")}</span>
            </div>
          )}
          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
            {underlying.label} · {expiry}
          </Badge>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : !expiry ? (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">Select an expiry date to load the option chain.</CardContent></Card>
      ) : entries.length === 0 ? (
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
                <th colSpan={4} className="text-center py-2 text-emerald-400 font-medium border-r border-border">CALL (CE)</th>
                <th className="text-center py-2 text-amber-400 font-semibold px-3">STRIKE</th>
                <th colSpan={4} className="text-center py-2 text-red-400 font-medium border-l border-border">PUT (PE)</th>
              </tr>
              <tr className="border-b border-border bg-muted/20">
                {["OI", "Vol", "IV", "LTP"].map(h => <th key={`ce-${h}`} className="px-2 py-1.5 text-right text-muted-foreground font-medium">{h}</th>)}
                <th className="px-3 py-1.5 text-center text-muted-foreground font-medium border-x border-border">₹</th>
                {["LTP", "IV", "Vol", "OI"].map(h => <th key={`pe-${h}`} className="px-2 py-1.5 text-right text-muted-foreground font-medium">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const isATM = e.strikePrice === atmStrike;
                return (
                  <tr key={e.strikePrice} className={`border-b border-border/40 hover:bg-muted/20 transition-colors ${isATM ? "bg-amber-400/5" : ""}`}>
                    <td className="px-2 py-1.5 text-right font-mono text-emerald-400/80">{formatOI(e.callOI ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatOI(e.callVolume ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{(e.callIV ?? 0).toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-emerald-400">
                      ₹{(e.callLTP ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className={`px-3 py-1.5 text-center font-mono font-bold border-x border-border ${isATM ? "text-amber-400" : "text-foreground"}`}>
                      {(e.strikePrice ?? 0).toLocaleString("en-IN")}
                      {isATM && <span className="ml-1 text-[9px] text-amber-400">ATM</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-red-400">
                      ₹{(e.putLTP ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{(e.putIV ?? 0).toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">{formatOI(e.putVolume ?? 0)}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-red-400/80">{formatOI(e.putOI ?? 0)}</td>
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
