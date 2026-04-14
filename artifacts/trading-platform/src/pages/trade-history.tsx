import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download, RefreshCw, Wallet, CalendarIcon,
  ChevronLeft, ChevronRight, TrendingUp, BarChart2, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

const BASE = import.meta.env.BASE_URL;

// ── Date helpers ──────────────────────────────────────────────────────────────
function getTodayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}
function toYMD(d: Date) { return d.toISOString().slice(0, 10); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function ymdToDisplay(ymd: string) {
  if (!ymd || ymd.length !== 10) return ymd;
  const [y, m, d] = ymd.split("-");
  return `${d}-${m}-${y}`;
}
function displayToYmd(display: string) {
  const parts = display.trim().replace(/\//g, "-").split("-");
  if (parts.length !== 3) return "";
  const [d, m, y] = parts;
  if (y.length !== 4) return "";
  const ymd = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isNaN(new Date(ymd).getTime()) ? "" : ymd;
}
function parseAmount(val: string | undefined): number {
  return Number(String(val ?? "0").replace(/,/g, ""));
}
function formatCurrency(val?: number | null) {
  if (val === undefined || val === null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
}
function formatL(v: number) {
  const abs = Math.abs(v);
  if (abs >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v.toFixed(0)}`;
}
function formatDisplayDate(raw: string) {
  if (!raw || raw === "—") return "—";
  const d = new Date(raw);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
    return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  }
  return "—";
}

// ── Indian FY helpers ─────────────────────────────────────────────────────────
function currentFYYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1;
  return month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
}
function fyStart(fyYear: number) { return new Date(fyYear, 3, 1); }  // Apr 1
function fyEnd(fyYear: number) { return new Date(fyYear + 1, 2, 31); } // Mar 31

function getWeekNumber(date: Date, fyYear: number): number {
  const start = fyStart(fyYear);
  const dayOfWeek = start.getDay(); // 0=Sun
  const mondayBefore = new Date(start);
  mondayBefore.setDate(start.getDate() - ((dayOfWeek + 6) % 7));
  const diff = Math.floor((date.getTime() - mondayBefore.getTime()) / 86400000);
  return Math.floor(diff / 7) + 1;
}

function weeksInFY(fyYear: number): number {
  return getWeekNumber(fyEnd(fyYear), fyYear);
}

function weekRangeISO(weekNum: number, fyYear: number): { from: string; to: string } {
  const start = fyStart(fyYear);
  const dayOfWeek = start.getDay();
  const mondayBefore = new Date(start);
  mondayBefore.setDate(start.getDate() - ((dayOfWeek + 6) % 7));
  const weekStart = new Date(mondayBefore);
  weekStart.setDate(mondayBefore.getDate() + (weekNum - 1) * 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  return { from: toYMD(weekStart), to: toYMD(weekEnd) };
}

// ── Equity curve helpers ──────────────────────────────────────────────────────
interface EquityPoint {
  date: string;
  pnl: number;
  cumulative: number;
  runbal?: number;
  type?: "DEPOSIT" | "WITHDRAWAL" | "PNL";
  label?: string;
}

function computeYScale(maxVal: number): { yMax: number; yTicks: number[] } {
  if (maxVal <= 0) return { yMax: 10_000, yTicks: [0, 2_000, 4_000, 6_000, 8_000, 10_000] };
  const rawStep = maxVal / 8;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const niceSteps = [1, 2, 2.5, 5, 10];
  const step = niceSteps.map(n => n * magnitude).find(s => s >= rawStep) ?? 10 * magnitude;
  const yMax = Math.ceil((maxVal * 1.1) / step) * step;
  const count = Math.round(yMax / step);
  return { yMax, yTicks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

function CustomDot(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: EquityPoint };
  if (payload.type === "DEPOSIT") return <circle cx={cx} cy={cy} r={5} fill="#22c55e" stroke="#fff" strokeWidth={1.5} />;
  if (payload.type === "WITHDRAWAL") return <circle cx={cx} cy={cy} r={5} fill="#ef4444" stroke="#fff" strokeWidth={1.5} />;
  return <circle cx={cx} cy={cy} r={3.5} fill="hsl(var(--primary))" stroke="none" />;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: EquityPoint }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const typeLabel = d.type === "DEPOSIT" ? "Deposit" : d.type === "WITHDRAWAL" ? "Withdrawal" : "P&L";
  const typeClass = d.type === "DEPOSIT" ? "text-emerald-400 border-emerald-400/30" : d.type === "WITHDRAWAL" ? "text-red-400 border-red-400/30" : "text-primary border-primary/30";
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-1.5 min-w-[200px]">
      <p className="font-medium">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", typeClass)}>{typeLabel}</Badge>
        <span className={cn("font-mono font-semibold", d.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>{d.pnl >= 0 ? "+" : ""}{formatCurrency(d.pnl)}</span>
      </div>
      {d.runbal !== undefined && (
        <div className="flex justify-between text-muted-foreground"><span>Balance</span><span className="font-mono">{formatCurrency(d.runbal)}</span></div>
      )}
      {d.label && <p className="text-[10px] text-muted-foreground truncate max-w-[200px]">{d.label}</p>}
    </div>
  );
}

type DateMode = "alltime" | "7d" | "30d" | "365d" | "custom";
const EQUITY_PRESETS: { label: string; mode: Exclude<DateMode, "custom">; days: number | null }[] = [
  { label: "7 Days", mode: "7d", days: 6 },
  { label: "30 Days", mode: "30d", days: 29 },
  { label: "365 Days", mode: "365d", days: 364 },
  { label: "All-Time", mode: "alltime", days: null },
];

// ── Controlled date input ─────────────────────────────────────────────────────
function DateField({ value, onChange, min, max }: { value: string; onChange: (ymd: string) => void; min?: string; max?: string }) {
  const [text, setText] = useState(() => ymdToDisplay(value));
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(ymdToDisplay(value)); }, [value]);
  function commit(raw: string) {
    const ymd = displayToYmd(raw);
    if (!ymd) { setText(ymdToDisplay(value)); return; }
    if (min && ymd < min) { setText(ymdToDisplay(value)); return; }
    if (max && ymd > max) { setText(ymdToDisplay(value)); return; }
    onChange(ymd);
    setText(ymdToDisplay(ymd));
  }
  return (
    <div className="relative flex items-center">
      <Input type="text" value={text} placeholder="DD-MM-YYYY" maxLength={10} className="w-36 text-xs font-mono h-9 pr-8"
        onChange={e => setText(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      />
      <button type="button" className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => pickerRef.current?.showPicker()} tabIndex={-1}>
        <CalendarIcon className="w-3.5 h-3.5" />
      </button>
      <input ref={pickerRef} type="date" value={value} min={min} max={max}
        onChange={e => { onChange(e.target.value); setText(ymdToDisplay(e.target.value)); }}
        className="sr-only absolute inset-0 w-0 h-0 opacity-0 pointer-events-none" tabIndex={-1}
      />
    </div>
  );
}

// ── Ledger types ──────────────────────────────────────────────────────────────
interface LedgerEntry {
  dhanClientId?: string; narration?: string; voucherdate?: string;
  exchange?: string; voucherdesc?: string; vouchernumber?: string;
  debit?: string; credit?: string; runbal?: string;
  [key: string]: unknown;
}
function isSummaryRow(r: LedgerEntry) {
  const n = String(r.narration ?? "").toUpperCase();
  return n.includes("OPENING BALANCE") || n.includes("CLOSING BALANCE");
}
function isClosingBalance(r: LedgerEntry) {
  return String(r.narration ?? "").toUpperCase().includes("CLOSING BALANCE");
}

// ── Trade history types ───────────────────────────────────────────────────────
interface TradeRecord {
  orderId?: string;
  exchangeOrderId?: string;
  transactionType?: string;
  tradingSymbol?: string;
  exchangeSegment?: string;
  tradedQuantity?: number;
  tradePrice?: number;
  brokerage?: number;
  createTime?: string;
  [key: string]: unknown;
}

interface DayStats {
  date: string;          // YYYY-MM-DD
  tradeCount: number;    // number of unique order executions
  buyValue: number;
  sellValue: number;
  overallPnl: number;    // gross P&L (sell - buy)
  brokerage: number;
  netPnl: number;
}

function buildDayStats(trades: TradeRecord[]): Map<string, DayStats> {
  const map = new Map<string, DayStats>();
  for (const t of trades) {
    const raw = t.createTime ?? "";
    const date = raw.slice(0, 10);
    if (!date || date === "0001-01-01") continue;
    if (!map.has(date)) map.set(date, { date, tradeCount: 0, buyValue: 0, sellValue: 0, overallPnl: 0, brokerage: 0, netPnl: 0 });
    const s = map.get(date)!;
    s.tradeCount++;
    const val = Number(t.tradePrice ?? 0) * Number(t.tradedQuantity ?? 0);
    const brk = Number(t.brokerage ?? 0);
    if ((t.transactionType ?? "").toUpperCase() === "BUY") s.buyValue += val;
    else s.sellValue += val;
    s.brokerage += brk;
  }
  for (const s of map.values()) {
    s.overallPnl = Math.round((s.sellValue - s.buyValue) * 100) / 100;
    s.netPnl = Math.round((s.overallPnl - s.brokerage) * 100) / 100;
  }
  return map;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TradeHistory() {
  const [today, setToday] = useState<string>(getTodayIST);
  const [activeTab, setActiveTab] = useState<"equity" | "ledger" | "diary">("equity");

  // Auto-update today every minute
  useEffect(() => {
    const id = setInterval(() => {
      const newToday = getTodayIST();
      setToday(prev => {
        if (prev !== newToday) {
          setToDate(prevTo => prevTo === prev ? newToday : prevTo);
          return newToday;
        }
        return prev;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Ledger state ────────────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState(toYMD(daysAgo(29)));
  const [toDate, setToDate] = useState<string>(getTodayIST);
  const [ledgerData, setLedgerData] = useState<LedgerEntry[]>([]);
  const [closingBalance, setClosingBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState(false);

  const fetchLedger = useCallback(async () => {
    setLoading(true); setError(null); setFetched(true); setClosingBalance(null);
    try {
      const res = await fetch(`${BASE}api/trades/ledger?fromDate=${fromDate}&toDate=${toDate}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Failed to load ledger");
      }
      const data = await res.json() as LedgerEntry[] | { data?: LedgerEntry[] };
      const all: LedgerEntry[] = Array.isArray(data) ? data : (data.data ?? []);
      const closingRow = all.find(isClosingBalance);
      if (closingRow) {
        const cb = parseAmount(closingRow.credit) || parseAmount(closingRow.runbal);
        setClosingBalance(cb);
      }
      setLedgerData(all.filter(r => !isSummaryRow(r)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLedgerData([]);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  function exportCSV() {
    if (!ledgerData.length) return;
    const headers = ["Date", "Narration", "Exchange", "Voucher No.", "Debit", "Credit", "Balance"];
    const rows = ledgerData.map(r => [formatDisplayDate(String(r.voucherdate ?? "")), String(r.narration ?? ""), String(r.exchange ?? ""), String(r.vouchernumber ?? ""), String(r.debit ?? "0"), String(r.credit ?? "0"), String(r.runbal ?? "")]);
    const csv = [headers, ...rows].map(row => row.map(v => JSON.stringify(v)).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `ledger_${fromDate}_to_${toDate}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  const totalDebit = ledgerData.reduce((s, r) => s + parseAmount(r.debit), 0);
  const totalCredit = ledgerData.reduce((s, r) => s + parseAmount(r.credit), 0);

  // ── Equity curve state ──────────────────────────────────────────────────────
  const [eqFromInput, setEqFromInput] = useState(toYMD(daysAgo(364)));
  const [eqToInput, setEqToInput] = useState(toYMD(new Date()));
  const [activeQuery, setActiveQuery] = useState<{ mode: DateMode; from: string; to: string }>({
    mode: "30d", from: toYMD(daysAgo(29)), to: toYMD(new Date()),
  });

  const { data: equityCurve, isLoading: isEquityLoading } = useQuery<EquityPoint[]>({
    queryKey: ["equity-curve", activeQuery.mode, activeQuery.from, activeQuery.to],
    queryFn: async () => {
      let url = `${BASE}api/dashboard/equity-curve?source=ledger`;
      if (activeQuery.mode === "alltime") url += "&allTime=true";
      else if (activeQuery.mode === "7d") url += "&days=7";
      else if (activeQuery.mode === "30d") url += "&days=30";
      else if (activeQuery.mode === "365d") url += "&days=365";
      else url += `&fromDate=${activeQuery.from}&toDate=${activeQuery.to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: activeTab === "equity",
    staleTime: 15 * 60 * 1_000,
    gcTime: 30 * 60 * 1_000,
  });

  function handlePreset(p: (typeof EQUITY_PRESETS)[0]) {
    if (p.days === null) {
      const from = toYMD(daysAgo(3 * 365));
      setActiveQuery({ mode: p.mode, from, to: toYMD(new Date()) });
    } else {
      setActiveQuery({ mode: p.mode, from: toYMD(daysAgo(p.days)), to: toYMD(new Date()) });
    }
  }
  function applyCustomRange() {
    if (!eqFromInput || !eqToInput || eqFromInput > eqToInput) return;
    setActiveQuery({ mode: "custom", from: eqFromInput, to: eqToInput });
  }

  const equityData = (equityCurve ?? [])
    .filter(p => {
      if (!p.date || p.date.startsWith("1970")) return false;
      const lbl = (p.label ?? "").toLowerCase();
      if (lbl === "opening balance" || lbl === "closing balance") return false;
      return p.pnl !== 0 || (p.runbal !== undefined && p.runbal !== 0);
    })
    .map(p => ({
      ...p,
      date: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
    }));
  const maxRunbal = equityData.reduce((m, p) => Math.max(m, p.runbal ?? 0), 0);
  const { yMax: Y_MAX, yTicks: Y_TICKS } = computeYScale(maxRunbal);

  // ── Diary state ─────────────────────────────────────────────────────────────
  const [diaryPeriod, setDiaryPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [monthOffset, setMonthOffset] = useState(0);
  const [fyOffset, setFyOffset] = useState(0);

  const diaryFYYear = currentFYYear() + fyOffset;
  const now = new Date();
  const diaryMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const diaryMonthYear = `${diaryMonth.getFullYear()}-${String(diaryMonth.getMonth() + 1).padStart(2, "0")}`;

  const diaryFrom = useMemo(() => {
    if (diaryPeriod === "monthly") {
      return `${diaryMonthYear}-01`;
    }
    return toYMD(fyStart(diaryFYYear));
  }, [diaryPeriod, diaryMonthYear, diaryFYYear]);

  const diaryTo = useMemo(() => {
    if (diaryPeriod === "monthly") {
      const lastDay = new Date(diaryMonth.getFullYear(), diaryMonth.getMonth() + 1, 0);
      return toYMD(lastDay);
    }
    const end = fyEnd(diaryFYYear);
    const todayStr = toYMD(new Date());
    return toYMD(end) > todayStr ? todayStr : toYMD(end);
  }, [diaryPeriod, diaryMonthYear, diaryFYYear]);

  const { data: diaryTrades = [], isLoading: isDiaryLoading } = useQuery<TradeRecord[]>({
    queryKey: ["diary-trades", diaryFrom, diaryTo],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/trades/history?fromDate=${diaryFrom}&toDate=${diaryTo}`);
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
    enabled: activeTab === "diary",
    staleTime: 10 * 60 * 1_000,
  });

  const dayStatsMap = useMemo(() => buildDayStats(diaryTrades), [diaryTrades]);

  const diaryDays = useMemo(() => Array.from(dayStatsMap.values()).sort((a, b) => a.date.localeCompare(b.date)), [dayStatsMap]);

  const tradingDaysTotal = useMemo(() => {
    if (diaryPeriod === "monthly") {
      const d = new Date(diaryMonth.getFullYear(), diaryMonth.getMonth() + 1, 0).getDate();
      return d;
    }
    const start = fyStart(diaryFYYear);
    const end = new Date(Math.min(fyEnd(diaryFYYear).getTime(), new Date().getTime()));
    return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
  }, [diaryPeriod, diaryMonthYear, diaryFYYear]);

  const tradedOn = diaryDays.length;
  const inProfitDays = diaryDays.filter(d => d.overallPnl > 0).length;

  let winningStreak = 0, curStreak = 0, maxStreak = 0;
  const sortedDays = [...diaryDays].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of sortedDays) {
    if (d.overallPnl > 0) { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
    else curStreak = 0;
  }
  winningStreak = maxStreak;
  let currentStreakCount = 0;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    if (i === sortedDays.length - 1) { currentStreakCount = 1; continue; }
    const prev = sortedDays[i + 1];
    const cur = sortedDays[i];
    if ((prev.overallPnl > 0) === (cur.overallPnl > 0)) currentStreakCount++;
    else break;
  }

  const periodNetPnl = diaryDays.reduce((s, d) => s + d.netPnl, 0);
  const periodOverallPnl = diaryDays.reduce((s, d) => s + d.overallPnl, 0);
  const periodBrokerage = diaryDays.reduce((s, d) => s + d.brokerage, 0);
  const periodTrades = diaryDays.reduce((s, d) => s + d.tradeCount, 0);

  const bestDay = diaryDays.reduce<DayStats | null>((best, d) => (!best || d.overallPnl > best.overallPnl) ? d : best, null);

  const allTimeBestDay = useMemo<{ pnl: number; date: string } | null>(() => {
    if (diaryDays.length === 0) return null;
    const best = diaryDays.reduce((b, d) => d.overallPnl > b.overallPnl ? d : b, diaryDays[0]);
    return { pnl: best.overallPnl, date: best.date };
  }, [diaryDays]);

  // ── Period labels ───────────────────────────────────────────────────────────
  function fyLabel(y: number) { return `FY ${y}-${String(y + 1).slice(2)}`; }
  function monthLabel(offset: number) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
  }

  const periodLabel = diaryPeriod === "monthly"
    ? monthLabel(monthOffset)
    : fyLabel(diaryFYYear);

  const totalWeeks = weeksInFY(diaryFYYear);
  const periodTitle = diaryPeriod === "weekly"
    ? `${totalWeeks} Weeks of ${fyLabel(diaryFYYear)}`
    : diaryPeriod === "monthly"
    ? monthLabel(monthOffset)
    : fyLabel(diaryFYYear);

  // ── Calendar helpers ─────────────────────────────────────────────────────────
  function cellClass(pnl: number | undefined) {
    if (pnl === undefined) return "bg-muted/20 text-muted-foreground";
    if (pnl > 0) return "bg-emerald-500/10 border-emerald-500/40 text-emerald-500";
    if (pnl < 0) return "bg-red-500/10 border-red-500/40 text-red-500";
    return "bg-yellow-500/10 border-yellow-500/30 text-yellow-500";
  }

  const todayStr = toYMD(new Date());

  // ── Tab toggle labels ────────────────────────────────────────────────────────
  const tabs: { key: "equity" | "ledger" | "diary"; label: string; icon: typeof TrendingUp }[] = [
    { key: "equity", label: "Equity Curve", icon: TrendingUp },
    { key: "ledger", label: "Ledger Statement", icon: BookOpen },
    { key: "diary", label: "Trader Diary", icon: BarChart2 },
  ];

  return (
    <div className="space-y-4">
      {/* ── Tab toggle bar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border transition-all",
              activeTab === t.key
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}

        {/* Ledger controls inline — only shown when ledger tab is active */}
        {activeTab === "ledger" && (
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <span className="text-xs text-muted-foreground">From</span>
            <DateField value={fromDate} onChange={setFromDate} max={toDate} />
            <span className="text-xs text-muted-foreground">To</span>
            <DateField value={toDate} onChange={setToDate} min={fromDate} max={today} />
            <Button size="sm" className="gap-1.5 h-9" onClick={fetchLedger} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              {loading ? "Loading…" : "Fetch Ledger"}
            </Button>
            {closingBalance !== null && (
              <div className="flex items-center gap-1.5 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 h-9 text-xs">
                <Wallet className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-muted-foreground">Closing Balance:</span>
                <span className="font-mono font-semibold text-emerald-400">₹{closingBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
              </div>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 h-9 ml-auto" onClick={exportCSV} disabled={ledgerData.length === 0}>
              <Download className="w-3.5 h-3.5" />Export CSV
            </Button>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: EQUITY CURVE
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "equity" && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between flex-wrap">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm shrink-0">Equity Curve</CardTitle>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Deposit</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Withdrawal</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary inline-block" /> P&amp;L</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {EQUITY_PRESETS.map(p => (
                  <Button key={p.mode} variant={activeQuery.mode === p.mode ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => handlePreset(p)}>
                    {p.label}
                  </Button>
                ))}
                <div className="flex items-center gap-1 border border-border rounded-md px-2 py-1 bg-background">
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap">From</span>
                  <Input type="date" value={eqFromInput} max={eqToInput}
                    onChange={e => setEqFromInput(e.target.value)}
                    className="h-6 border-0 p-0 text-xs w-[110px] bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <span className="text-[11px] text-muted-foreground">—</span>
                  <Input type="date" value={eqToInput} min={eqFromInput} max={toYMD(new Date())}
                    onChange={e => setEqToInput(e.target.value)}
                    className="h-6 border-0 p-0 text-xs w-[110px] bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                  <Button size="sm" className="h-6 px-2 text-xs" onClick={applyCustomRange} disabled={!eqFromInput || !eqToInput || eqFromInput > eqToInput}>Go</Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {isEquityLoading ? (
              <Skeleton className="h-80 w-full" />
            ) : equityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={360}>
                <AreaChart data={equityData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval="preserveStartEnd" tickLine={false} />
                  <YAxis ticks={Y_TICKS} domain={[0, Y_MAX]} tickFormatter={v => formatL(v)} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} width={52} />
                  <ReferenceLine y={0} stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="runbal" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#equityGrad)" dot={<CustomDot />}
                    activeDot={{ r: 7, stroke: "hsl(var(--primary))", strokeWidth: 2, fill: "hsl(var(--card))" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
                No ledger entries found for this period — your Dhan account ledger will appear here
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: LEDGER STATEMENT (original code untouched)
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "ledger" && (
        <div className="space-y-3">
          <p className="text-sm font-bold text-foreground">
            Account credit and debit details fetched live from Dhan
          </p>

          {ledgerData.length > 0 && (
            <div className="flex items-center gap-6 text-xs flex-wrap">
              <span className="text-muted-foreground">Entries: <span className="text-foreground font-semibold">{ledgerData.length}</span></span>
              <span>Total Credit: <span className="text-emerald-400 font-mono font-semibold">₹{totalCredit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></span>
              <span>Total Debit: <span className="text-red-400 font-mono font-semibold">₹{totalDebit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></span>
            </div>
          )}

          {error && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-4 text-center text-sm text-destructive">{error}</CardContent>
            </Card>
          )}

          {loading ? (
            <div className="space-y-2">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : ledgerData.length === 0 && !error ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                {fetched ? "No ledger entries found for the selected period." : "Select a date range and click Fetch Ledger to view your account statement."}
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full table-auto text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {[{ label: "Date", right: false }, { label: "Narration", right: false }, { label: "Exchange", right: false }, { label: "Voucher No.", right: false }, { label: "Debit", right: true }, { label: "Credit", right: true }, { label: "Balance", right: true }].map(h => (
                      <th key={h.label} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${h.right ? "text-right" : "text-left"}`}>{h.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerData.map((row, i) => {
                    const debit = parseAmount(row.debit);
                    const credit = parseAmount(row.credit);
                    const balance = parseAmount(row.runbal);
                    return (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/20">
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{formatDisplayDate(String(row.voucherdate ?? ""))}</td>
                        <td className="px-3 py-2 text-xs max-w-[220px] truncate" title={String(row.narration ?? "")}>{String(row.narration ?? "—")}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{String(row.exchange ?? "—")}</td>
                        <td className="px-3 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">{String(row.vouchernumber ?? "—")}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-red-400 whitespace-nowrap">{debit > 0 ? `₹${debit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-emerald-400 whitespace-nowrap">{credit > 0 ? `₹${credit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"}</td>
                        <td className={`px-3 py-2 text-right font-mono text-xs whitespace-nowrap ${balance >= 0 ? "text-foreground" : "text-red-400"}`}>₹{balance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          TAB: TRADER DIARY
      ══════════════════════════════════════════════════════════════════════════ */}
      {activeTab === "diary" && (
        <div className="space-y-4">
          {/* Header with period switcher */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                <span className="text-base">📓</span>
                <span>Trader's Diary for</span>
              </div>
              <h2 className="text-xl font-bold text-foreground tracking-tight">RAJESH ALGO</h2>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
              {(["weekly", "monthly", "yearly"] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setDiaryPeriod(p)}
                  className={cn(
                    "px-3 py-1 rounded-md text-sm font-medium capitalize transition-all",
                    diaryPeriod === p
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Stats banner */}
          <div className="rounded-xl border border-border bg-gradient-to-r from-emerald-500/5 to-primary/5 p-4">
            {isDiaryLoading ? (
              <div className="flex gap-6"><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /><Skeleton className="h-10 w-40" /></div>
            ) : (
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                    <span>📈</span> Net Realised P&L:
                  </div>
                  <div className={cn("font-bold text-lg font-mono", periodNetPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                    {formatCurrency(periodNetPnl)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{diaryPeriod === "weekly" ? `${totalWeeks} Weeks of ${fyLabel(diaryFYYear)}` : periodLabel}</div>
                </div>
                {bestDay && (
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                      <span>🏆</span> Most Profitable (this period):
                    </div>
                    <div className={cn("font-bold text-lg font-mono", bestDay.overallPnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {formatCurrency(bestDay.overallPnl)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">on {formatDisplayDate(bestDay.date)}</div>
                  </div>
                )}
                {allTimeBestDay && (
                  <div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
                      <span>🎯</span> Most Profitable (of all time):
                    </div>
                    <div className={cn("font-bold text-lg font-mono", allTimeBestDay.pnl >= 0 ? "text-emerald-500" : "text-red-500")}>
                      {formatCurrency(allTimeBestDay.pnl)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">on {formatDisplayDate(allTimeBestDay.date)}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stat chips */}
          <div className="flex items-center gap-3 flex-wrap">
            {[
              { label: "Trading Days", value: tradingDaysTotal, color: "border-yellow-400/40 text-yellow-400 bg-yellow-400/10" },
              { label: "Traded On", value: tradedOn, color: "border-yellow-400/40 text-yellow-400 bg-yellow-400/10" },
              { label: "In-Profit Days", value: inProfitDays, color: "border-yellow-400/40 text-yellow-400 bg-yellow-400/10" },
              { label: "Winning Streak", value: winningStreak, color: "border-blue-400/40 text-blue-400 bg-blue-400/10" },
              { label: "Current Streak", value: sortedDays.length === 0 ? 0 : currentStreakCount, color: "border-blue-400/40 text-blue-400 bg-blue-400/10" },
            ].map(chip => (
              <div key={chip.label} className="flex flex-col items-center gap-1">
                <div className={cn("w-10 h-10 rounded-lg border-2 flex items-center justify-center font-bold text-lg", chip.color)}>
                  {isDiaryLoading ? "…" : chip.value}
                </div>
                <span className="text-[10px] text-muted-foreground text-center leading-tight">{chip.label}</span>
              </div>
            ))}
          </div>

          {/* Calendar Section */}
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => diaryPeriod === "monthly" ? setMonthOffset(o => o - 1) : setFyOffset(o => o - 1)}
                  className="p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <CardTitle className="text-sm">{periodTitle}</CardTitle>
                <button
                  onClick={() => diaryPeriod === "monthly" ? setMonthOffset(o => o + 1) : setFyOffset(o => o + 1)}
                  className="p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                  disabled={diaryPeriod === "monthly" ? monthOffset >= 0 : fyOffset >= 0}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isDiaryLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : (
                <>
                  {/* WEEKLY CALENDAR */}
                  {diaryPeriod === "weekly" && (
                    <div>
                      <div className="grid grid-cols-9 gap-1">
                        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(wk => {
                          const { from: wkFrom, to: wkTo } = weekRangeISO(wk, diaryFYYear);
                          const wkDays = Array.from(dayStatsMap.entries())
                            .filter(([d]) => d >= wkFrom && d <= wkTo)
                            .map(([, s]) => s);
                          const wkPnl = wkDays.reduce((s, d) => s + d.overallPnl, 0);
                          const hasData = wkDays.length > 0;
                          const isCurrentWk = todayStr >= wkFrom && todayStr <= wkTo;
                          return (
                            <div
                              key={wk}
                              className={cn(
                                "aspect-square flex items-center justify-center rounded-md border text-xs font-medium transition-colors",
                                hasData ? cellClass(wkPnl) : "bg-muted/10 border-border/30 text-muted-foreground",
                                isCurrentWk && "ring-2 ring-primary ring-offset-1 ring-offset-background font-bold"
                              )}
                              title={hasData ? `Week ${wk}: ${formatCurrency(wkPnl)}` : `Week ${wk}`}
                            >
                              {wk}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* MONTHLY CALENDAR */}
                  {diaryPeriod === "monthly" && (() => {
                    const year = diaryMonth.getFullYear();
                    const month = diaryMonth.getMonth();
                    const firstDay = new Date(year, month, 1);
                    const lastDate = new Date(year, month + 1, 0).getDate();
                    const startDOW = (firstDay.getDay() + 6) % 7; // Mon=0
                    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
                    const cells: (number | null)[] = [];
                    for (let i = 0; i < startDOW; i++) cells.push(null);
                    for (let d = 1; d <= lastDate; d++) cells.push(d);
                    while (cells.length % 7 !== 0) cells.push(null);
                    return (
                      <div>
                        <div className="grid grid-cols-7 gap-1 mb-1">
                          {DAYS.map(d => <div key={d} className="text-center text-[10px] text-muted-foreground font-medium py-1">{d}</div>)}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {cells.map((day, i) => {
                            if (!day) return <div key={i} className="aspect-square" />;
                            const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                            const stats = dayStatsMap.get(dateStr);
                            const isToday = dateStr === todayStr;
                            return (
                              <div
                                key={i}
                                className={cn(
                                  "aspect-square flex items-center justify-center rounded-md border text-xs font-medium transition-colors",
                                  stats ? cellClass(stats.overallPnl) : "bg-muted/10 border-border/20 text-muted-foreground",
                                  isToday && "ring-2 ring-primary ring-offset-1 ring-offset-background font-bold"
                                )}
                                title={stats ? `${dateStr}: ${formatCurrency(stats.overallPnl)} (${stats.tradeCount} trades)` : dateStr}
                              >
                                {day}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* YEARLY CALENDAR */}
                  {diaryPeriod === "yearly" && (() => {
                    const months = [
                      { label: "Apr", idx: 3 }, { label: "May", idx: 4 }, { label: "Jun", idx: 5 },
                      { label: "Jul", idx: 6 }, { label: "Aug", idx: 7 }, { label: "Sep", idx: 8 },
                      { label: "Oct", idx: 9 }, { label: "Nov", idx: 10 }, { label: "Dec", idx: 11 },
                      { label: "Jan", idx: 0 }, { label: "Feb", idx: 1 }, { label: "Mar", idx: 2 },
                    ];
                    return (
                      <div>
                        <div className="grid grid-cols-9 gap-1 mb-1">
                          {months.slice(0, 9).map(m => {
                            const year = m.idx >= 3 ? diaryFYYear : diaryFYYear + 1;
                            const monthFrom = `${year}-${String(m.idx + 1).padStart(2, "0")}-01`;
                            const lastDay = new Date(year, m.idx + 1, 0).getDate();
                            const monthTo = `${year}-${String(m.idx + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
                            const mDays = Array.from(dayStatsMap.entries()).filter(([d]) => d >= monthFrom && d <= monthTo).map(([, s]) => s);
                            const mPnl = mDays.reduce((s, d) => s + d.overallPnl, 0);
                            const hasData = mDays.length > 0;
                            const isCurMonth = todayStr >= monthFrom && todayStr <= monthTo;
                            return (
                              <div key={m.label} className={cn(
                                "py-3 flex items-center justify-center rounded-md border text-xs font-medium transition-colors",
                                hasData ? cellClass(mPnl) : "bg-muted/10 border-border/30 text-muted-foreground",
                                isCurMonth && "ring-2 ring-primary ring-offset-1 ring-offset-background font-bold"
                              )} title={hasData ? `${m.label}: ${formatCurrency(mPnl)}` : m.label}>
                                {m.label}
                              </div>
                            );
                          })}
                        </div>
                        <div className="grid grid-cols-9 gap-1">
                          {months.slice(9).map(m => {
                            const year = m.idx >= 3 ? diaryFYYear : diaryFYYear + 1;
                            const monthFrom = `${year}-${String(m.idx + 1).padStart(2, "0")}-01`;
                            const lastDay = new Date(year, m.idx + 1, 0).getDate();
                            const monthTo = `${year}-${String(m.idx + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
                            const mDays = Array.from(dayStatsMap.entries()).filter(([d]) => d >= monthFrom && d <= monthTo).map(([, s]) => s);
                            const mPnl = mDays.reduce((s, d) => s + d.overallPnl, 0);
                            const hasData = mDays.length > 0;
                            const isCurMonth = todayStr >= monthFrom && todayStr <= monthTo;
                            return (
                              <div key={m.label} className={cn(
                                "py-3 flex items-center justify-center rounded-md border text-xs font-medium transition-colors",
                                hasData ? cellClass(mPnl) : "bg-muted/10 border-border/30 text-muted-foreground",
                                isCurMonth && "ring-2 ring-primary ring-offset-1 ring-offset-background font-bold"
                              )} title={hasData ? `${m.label}: ${formatCurrency(mPnl)}` : m.label}>
                                {m.label}
                              </div>
                            );
                          })}
                          {/* spacer cells to align with 9-column grid */}
                          {Array.from({ length: 6 }).map((_, i) => <div key={`sp-${i}`} />)}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </CardContent>
          </Card>

          {/* Profitable days summary */}
          <p className="text-sm">
            🔥 Total Number of days you are profitable for:{" "}
            <span className="font-semibold text-primary">{inProfitDays}/{tradedOn} Traded days</span>
          </p>

          {/* Period Summary */}
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">
                {diaryPeriod === "weekly" ? "Weekly" : diaryPeriod === "monthly" ? "Monthly" : "Yearly"} Summary{" "}
                <span className="text-xs font-normal text-muted-foreground">for {periodTitle}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isDiaryLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-4">
                    {[
                      { label: "Overall P&L", value: periodOverallPnl, isAmount: true },
                      { label: "Net P&L", value: periodNetPnl, isAmount: true },
                      { label: "Total Trades", value: periodTrades, isAmount: false },
                      { label: "Brokerage", value: periodBrokerage, isAmount: true },
                    ].map(col => (
                      <div key={col.label}>
                        <p className="text-xs text-muted-foreground mb-1">{col.label}</p>
                        {col.isAmount ? (
                          <p className={cn("font-mono font-semibold text-sm", (col.value as number) >= 0 ? "text-emerald-500" : "text-red-500")}>
                            {formatCurrency(col.value as number)}
                          </p>
                        ) : (
                          <p className="font-mono font-semibold text-sm text-foreground">{col.value}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground border-t border-border/50 pt-2">
                    Charges include GST, Securities Transaction Tax, SEBI Fees, Exchange Transaction Charges, Stamp Duty and other charges as mandated by the government and regulatory bodies.
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Trade breakdown table */}
          {diaryDays.length > 0 && (
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm">
                  Trades {diaryPeriod === "yearly" ? "by Month" : "for " + (diaryPeriod === "weekly" ? "Period" : "Month")}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-left">Name</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">No. of Trades</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Overall P&L</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Net P&L</th>
                        <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground text-right">Brokerage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diaryPeriod === "yearly" ? (
                        // Group by month for yearly view
                        (() => {
                          const monthGroups = new Map<string, DayStats[]>();
                          for (const d of diaryDays) {
                            const key = d.date.slice(0, 7);
                            if (!monthGroups.has(key)) monthGroups.set(key, []);
                            monthGroups.get(key)!.push(d);
                          }
                          return Array.from(monthGroups.entries())
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([monthKey, days]) => {
                              const [y, m] = monthKey.split("-").map(Number);
                              const label = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
                              const total = { trades: days.reduce((s, d) => s + d.tradeCount, 0), overall: days.reduce((s, d) => s + d.overallPnl, 0), net: days.reduce((s, d) => s + d.netPnl, 0), brk: days.reduce((s, d) => s + d.brokerage, 0) };
                              return (
                                <tr key={monthKey} className="border-b border-border/50 hover:bg-muted/20">
                                  <td className="px-4 py-2.5 text-xs">{label}</td>
                                  <td className="px-4 py-2.5 text-xs text-right font-mono">{total.trades}</td>
                                  <td className={cn("px-4 py-2.5 text-xs text-right font-mono font-semibold", total.overall >= 0 ? "text-emerald-500" : "text-red-500")}>{formatCurrency(total.overall)}</td>
                                  <td className={cn("px-4 py-2.5 text-xs text-right font-mono font-semibold", total.net >= 0 ? "text-emerald-500" : "text-red-500")}>{formatCurrency(total.net)}</td>
                                  <td className="px-4 py-2.5 text-xs text-right font-mono text-muted-foreground">{formatCurrency(total.brk)}</td>
                                </tr>
                              );
                            });
                        })()
                      ) : (
                        // Day-by-day for weekly/monthly
                        diaryDays.map(d => (
                          <tr key={d.date} className="border-b border-border/50 hover:bg-muted/20">
                            <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{formatDisplayDate(d.date)}</td>
                            <td className="px-4 py-2.5 text-xs text-right font-mono">{d.tradeCount}</td>
                            <td className={cn("px-4 py-2.5 text-xs text-right font-mono font-semibold", d.overallPnl >= 0 ? "text-emerald-500" : "text-red-500")}>{formatCurrency(d.overallPnl)}</td>
                            <td className={cn("px-4 py-2.5 text-xs text-right font-mono font-semibold", d.netPnl >= 0 ? "text-emerald-500" : "text-red-500")}>{formatCurrency(d.netPnl)}</td>
                            <td className="px-4 py-2.5 text-xs text-right font-mono text-muted-foreground">{formatCurrency(d.brokerage)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {diaryDays.length === 0 && !isDiaryLoading && (
            <Card className="border-dashed">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No trade history found for this period.
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
