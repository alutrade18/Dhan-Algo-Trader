import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

export interface InstrumentResult {
  securityId: number;
  exchId: string;
  segment: string;
  instrument: string;
  symbolName: string;
  displayName: string | null;
  isin: string | null;
  series: string | null;
  lotSize: number | null;
  tickSize: string | null;
  underlyingSymbol: string | null;
  expiryDate: string | null;
  strikePrice: string | null;
  optionType: string | null;
}

interface Props {
  value?: InstrumentResult | null;
  onChange?: (instrument: InstrumentResult | null) => void;
  placeholder?: string;
  filterInstrument?: string;
  filterInstruments?: string[];
  filterExch?: string;
  disabled?: boolean;
  className?: string;
}

function segmentLabel(segment: string, exch: string) {
  const map: Record<string, string> = {
    E: `${exch} EQ`,
    D: `${exch} DEBT`,
    C: `${exch} CURR`,
    F: `${exch} F&O`,
    I: `${exch} IDX`,
  };
  return map[segment] ?? `${exch} ${segment}`;
}

function instrumentColor(instrument: string) {
  if (instrument === "EQUITY") return "text-blue-400 border-blue-400/30 bg-blue-400/10";
  if (instrument.startsWith("FUT")) return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  if (instrument.startsWith("OPT")) return "text-purple-400 border-purple-400/30 bg-purple-400/10";
  if (instrument === "INDEX") return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
  return "text-muted-foreground border-muted";
}

export function SymbolSearch({ value, onChange, placeholder = "Search symbol...", filterInstrument, filterInstruments, filterExch, disabled, className }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: "15" });
      if (filterInstruments && filterInstruments.length > 0) {
        params.set("instruments", filterInstruments.join(","));
      } else if (filterInstrument) {
        params.set("instrument", filterInstrument);
      }
      if (filterExch) params.set("exch", filterExch);
      const res = await fetch(`${BASE}api/instruments/search?${params}`, { signal: ac.signal });
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json() as InstrumentResult[];
      setResults(data);
      setOpen(data.length > 0);
      setHighlighted(0);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setResults([]);
    } finally {
      setLoading(false);
    }
  }, [filterInstrument, filterInstruments, filterExch]);

  useEffect(() => {
    const timer = setTimeout(() => { void search(query); }, 200);
    return () => clearTimeout(timer);
  }, [query, search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node) && !inputRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function select(item: InstrumentResult) {
    onChange?.(item);
    setQuery("");
    setOpen(false);
    setResults([]);
  }

  function clear() {
    onChange?.(null);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[highlighted]) select(results[highlighted]); }
    else if (e.key === "Escape") { setOpen(false); }
  }

  if (value) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 border border-primary/40 rounded-md bg-primary/5 ${className ?? ""}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold truncate">{value.symbolName}</span>
            <Badge variant="outline" className={`text-[10px] shrink-0 ${instrumentColor(value.instrument)}`}>{value.instrument}</Badge>
            <Badge variant="outline" className="text-[10px] shrink-0">{value.exchId}</Badge>
          </div>
          {value.displayName && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{value.displayName}</p>}
          <p className="text-[10px] text-muted-foreground font-mono">ID: {value.securityId} · Lot: {value.lotSize ?? 1}</p>
        </div>
        {!disabled && (
          <button onClick={clear} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ""}`}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKey}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
          disabled={disabled}
          className="pl-8 pr-8 text-xs font-mono"
        />
        {loading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </div>

      {open && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 z-50 mt-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden"
        >
          <div className="max-h-72 overflow-y-auto">
            {results.map((item, i) => (
              <button
                key={`${item.securityId}-${item.exchId}`}
                className={`w-full text-left px-3 py-2 flex items-start gap-3 hover:bg-accent transition-colors border-b border-border/40 last:border-0 ${i === highlighted ? "bg-accent" : ""}`}
                onMouseDown={e => { e.preventDefault(); select(item); }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono text-xs font-semibold">{item.symbolName}</span>
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 ${instrumentColor(item.instrument)}`}>{item.instrument}</Badge>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">{segmentLabel(item.segment, item.exchId)}</Badge>
                    {item.optionType && <Badge variant="outline" className={`text-[9px] px-1 py-0 ${item.optionType === "CE" ? "text-emerald-400" : "text-red-400"}`}>{item.optionType}</Badge>}
                  </div>
                  {item.displayName && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.displayName}</p>}
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] font-mono text-muted-foreground">ID: {item.securityId}</span>
                    {item.lotSize && item.lotSize > 1 && <span className="text-[10px] text-muted-foreground">Lot: {item.lotSize}</span>}
                    {item.expiryDate && <span className="text-[10px] text-muted-foreground">Exp: {item.expiryDate}</span>}
                    {item.strikePrice && <span className="text-[10px] font-mono text-muted-foreground">Strike: ₹{item.strikePrice}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
