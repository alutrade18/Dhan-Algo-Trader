import { useState, useEffect, useRef } from "react";
import {
  useGetFundLimits,
  getGetFundLimitsQueryKey,
  useGetSettings,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  IndianRupee,
  TrendingUp,
  Briefcase,
  Activity,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const BASE = import.meta.env.BASE_URL;

const formatCurrency = (val?: number | null) =>
  val !== undefined && val !== null
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
      }).format(val)
    : "—";

function formatL(v: number) {
  const abs = Math.abs(v);
  if (abs >= 100_000) return `₹${(v / 100_000).toFixed(1)}L`;
  if (abs >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`;
  return `₹${v}`;
}

function toYMD(d: Date) {
  return d.toISOString().split("T")[0];
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Returns ms until the next 9:00 AM IST (UTC+5:30 = 3:30 AM UTC). */
function msUntilNext9amIST(): number {
  const now = new Date();
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const targetUTCMinutes = 3 * 60 + 30; // 9am IST = 3:30am UTC
  const minutesUntil =
    utcMinutes < targetUTCMinutes
      ? targetUTCMinutes - utcMinutes
      : 24 * 60 - utcMinutes + targetUTCMinutes;
  return minutesUntil * 60 * 1000;
}

function StatCard({
  title,
  value,
  inlineTag,
  icon: Icon,
  isLoading,
  valueClass,
}: {
  title: string;
  value: string;
  inlineTag?: string;
  icon: React.ElementType;
  isLoading?: boolean;
  valueClass?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start justify-between mb-1.5 gap-1">
          <span className="text-xs text-muted-foreground font-medium leading-tight">
            {title}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {inlineTag && (
              <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                {inlineTag}
              </span>
            )}
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-[100px] mt-1" />
        ) : (
          <div
            className={cn(
              "text-lg font-bold font-mono tracking-tight leading-none",
              valueClass,
            )}
          >
            {value}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface EquityPoint {
  date: string;
  pnl: number;
  cumulative: number;
  runbal?: number;
  type?: "DEPOSIT" | "WITHDRAWAL" | "PNL";
  label?: string;
}

interface DashboardSummary {
  todayPnl?: number;
  totalPnl?: number;
  activeStrategies?: number;
  winRate?: number;
  killSwitchTriggered?: boolean;
  dailyLossAmount?: number;
  maxDailyLoss?: number;
  availableBalance?: number;
  usedMargin?: number;
}

type DateMode = "alltime" | "7d" | "30d" | "365d" | "custom";

const PRESETS: {
  label: string;
  mode: Exclude<DateMode, "custom">;
  days: number | null;
}[] = [
  { label: "7 Days", mode: "7d", days: 6 },
  { label: "30 Days", mode: "30d", days: 29 },
  { label: "365 Days", mode: "365d", days: 364 },
  { label: "All-Time", mode: "alltime", days: null },
];

const AUTO_RESET_MS = 0.2 * 60 * 1000; // 1 minute

const Y_MAX = 1_500_000;
const Y_STEP = 150_000;
const Y_TICKS = Array.from(
  { length: Y_MAX / Y_STEP + 1 },
  (_, i) => i * Y_STEP,
);

function CustomDot(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as {
    cx: number;
    cy: number;
    payload: EquityPoint;
  };
  if (payload.type === "DEPOSIT")
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="#22c55e"
        stroke="#fff"
        strokeWidth={1.5}
      />
    );
  if (payload.type === "WITHDRAWAL")
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="#ef4444"
        stroke="#fff"
        strokeWidth={1.5}
      />
    );
  return (
    <circle cx={cx} cy={cy} r={3.5} fill="hsl(var(--primary))" stroke="none" />
  );
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: EquityPoint }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const typeLabel =
    d.type === "DEPOSIT"
      ? "Deposit"
      : d.type === "WITHDRAWAL"
        ? "Withdrawal"
        : "Profit & Loss";
  const typeBadgeClass =
    d.type === "DEPOSIT"
      ? "text-emerald-400 border-emerald-400/30"
      : d.type === "WITHDRAWAL"
        ? "text-red-400 border-red-400/30"
        : "text-primary border-primary/30";
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-xl text-xs space-y-1.5 min-w-[200px]">
      <p className="font-medium text-foreground">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <Badge
          variant="outline"
          className={cn("text-[10px] px-1.5 py-0", typeBadgeClass)}
        >
          {typeLabel}
        </Badge>
        <span
          className={cn(
            "font-mono font-semibold",
            d.pnl >= 0 ? "text-emerald-400" : "text-red-400",
          )}
        >
          {d.pnl >= 0 ? "+" : ""}
          {formatCurrency(d.pnl)}
        </span>
      </div>
      {d.runbal !== undefined && (
        <div className="flex justify-between items-center text-muted-foreground">
          <span>Balance</span>
          <span className="font-mono">{formatCurrency(d.runbal)}</span>
        </div>
      )}
      {d.label && (
        <p
          className="text-[10px] text-muted-foreground truncate max-w-[200px]"
          title={d.label}
        >
          {d.label}
        </p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { data: settingsRaw } = useGetSettings({ query: { staleTime: 60_000 } });
  const settings = settingsRaw as (typeof settingsRaw & { dashboardWidgets?: Record<string, boolean> }) | undefined;
  const widgets = {
    todayPnl: settings?.dashboardWidgets?.todayPnl !== false,
    totalPnl: settings?.dashboardWidgets?.totalPnl !== false,
    availableBalance: settings?.dashboardWidgets?.availableBalance !== false,
    activeStrategies: settings?.dashboardWidgets?.activeStrategies !== false,
    equityCurve: settings?.dashboardWidgets?.equityCurve !== false,
  };

  const { data: funds, isLoading: isFundsLoading } = useGetFundLimits({
    query: {
      queryKey: getGetFundLimitsQueryKey(),
      refetchInterval: 60_000,
      staleTime: 50_000,
    },
  });

  const { data: summary, isLoading: isSummaryLoading } =
    useQuery<DashboardSummary>({
      queryKey: ["dashboard-summary"],
      queryFn: async () => {
        const res = await fetch(`${BASE}api/dashboard/summary`);
        if (!res.ok) throw new Error("Failed");
        return res.json();
      },
      refetchInterval: 30_000,
      staleTime: 15_000,
    });

  const fundsData = funds as
    | (typeof funds & { availableBalance?: number; utilizedAmount?: number })
    | undefined;

  const [fromInput, setFromInput] = useState(toYMD(daysAgo(364)));
  const [toInput, setToInput] = useState(toYMD(new Date()));
  const [activeQuery, setActiveQuery] = useState<{
    mode: DateMode;
    from: string;
    to: string;
  }>({
    mode: "30d",
    from: toYMD(daysAgo(29)),
    to: toYMD(new Date()),
  });

  // Auto-reset to 30D after 1 minute of no period selection change
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function scheduleAutoReset() {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setActiveQuery((q) => (q.mode !== "30d" ? { ...q, mode: "30d", from: toYMD(daysAgo(29)), to: toYMD(new Date()) } : q));
    }, AUTO_RESET_MS);
  }
  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const { data: ksStatus } = useQuery<{
    isActive?: boolean;
    killSwitchStatus?: string;
    canDeactivateToday?: boolean;
  }>({
    queryKey: ["killswitch-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/risk/killswitch`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store", Pragma: "no-cache" },
      });
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 15_000,
    staleTime: 0,
    gcTime: 0,
  });

  const { data: equityCurve, isLoading: isEquityLoading } = useQuery<
    EquityPoint[]
  >({
    queryKey: [
      "equity-curve",
      activeQuery.mode,
      activeQuery.from,
      activeQuery.to,
    ],
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
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  // Period P&L — fetched live from backend.
  // Sums only trade/settlement entries in the ledger; deposits and withdrawals
  // are excluded so fund flows never appear as profit/loss.
  // Never stored in DB — always computed from Dhan API on demand.
  const presetDays =
    activeQuery.mode === "7d"
      ? 7
      : activeQuery.mode === "30d"
        ? 30
        : activeQuery.mode === "365d"
          ? 365
          : null;
  const { data: periodPnlData, isLoading: isPeriodPnlLoading } = useQuery<{
    periodPnl: number;
  }>({
    queryKey: ["period-pnl", presetDays],
    queryFn: async () => {
      const res = await fetch(
        `${BASE}api/dashboard/period-pnl?days=${presetDays}`,
      );
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: presetDays !== null,
    refetchInterval: 300_000,
    staleTime: 240_000,
  });

  const dhanKillActive =
    ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE";
  const killTriggered = dhanKillActive || summary?.killSwitchTriggered;

  // Total P&L card:
  //  • alltime / custom → show all-time P&L from summary API
  //  • 7d / 30d / 365d  → show period-specific P&L from period-pnl API
  // All values come from live Dhan API — nothing is persisted in DB.
  const isPeriodMode =
    activeQuery.mode === "7d" ||
    activeQuery.mode === "30d" ||
    activeQuery.mode === "365d";
  const displayPnl =
    isPeriodMode && periodPnlData !== undefined
      ? periodPnlData.periodPnl
      : (summary?.totalPnl ?? 0);
  const displayLabel =
    activeQuery.mode === "7d"
      ? "7D Net"
      : activeQuery.mode === "30d"
        ? "30D Net"
        : activeQuery.mode === "365d"
          ? "365D Net"
          : "All-Time Net";
  const isPnlLoading = isPeriodMode ? isPeriodPnlLoading : isSummaryLoading;

  const equityData = (equityCurve ?? [])
    .filter((p) => {
      if (!p.date || p.date.startsWith("1970")) return false;
      const lbl = (p.label ?? "").toLowerCase();
      if (lbl === "opening balance" || lbl === "closing balance") return false;
      return p.pnl !== 0 || (p.runbal !== undefined && p.runbal !== 0);
    })
    .map((p) => ({
      ...p,
      date: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      }),
    }));

  function handlePreset(preset: (typeof PRESETS)[0]) {
    if (preset.mode === "alltime") {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      setActiveQuery((q) => ({ ...q, mode: "alltime" }));
      return;
    }
    const from = daysAgo(preset.days!);
    const to = new Date();
    setFromInput(toYMD(from));
    setToInput(toYMD(to));
    setActiveQuery({ mode: preset.mode, from: toYMD(from), to: toYMD(to) });
    scheduleAutoReset();
  }

  function applyCustomRange() {
    if (!fromInput || !toInput || fromInput > toInput) return;
    setActiveQuery({ mode: "custom", from: fromInput, to: toInput });
    scheduleAutoReset();
  }

  const todayPnl = summary?.todayPnl ?? 0;
  const activeStrategies = summary?.activeStrategies ?? 0;
  const winRate = summary?.winRate ?? 0;
  const availBal = fundsData?.availableBalance ?? summary?.availableBalance;
  const usedMargin = fundsData?.utilizedAmount ?? summary?.usedMargin;

  return (
    <div className="space-y-4">
      {killTriggered && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">
              Kill Switch Active — Trading Halted
            </p>
            <p className="text-xs mt-0.5 text-destructive/80">
              {dhanKillActive
                ? `Dhan kill switch is active. ${ksStatus?.canDeactivateToday ? "Go to Settings to deactivate (1 reset remaining today)." : "Auto-resets at 8:30 AM IST tomorrow."}`
                : `Daily loss limit of ${formatCurrency(summary?.maxDailyLoss)} reached (loss: ${formatCurrency(summary?.dailyLossAmount)}). Trading blocked for today.`}
            </p>
          </div>
          <Badge variant="destructive" className="text-xs">
            HALTED
          </Badge>
        </div>
      )}

      {(widgets.todayPnl || widgets.totalPnl || widgets.availableBalance || widgets.activeStrategies) && (
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {widgets.todayPnl && (
            <StatCard
              title="Today P&L"
              value={formatCurrency(todayPnl)}
              inlineTag="Realized + Unrealized"
              icon={TrendingUp}
              isLoading={isSummaryLoading}
              valueClass={todayPnl > 0 ? "text-success" : todayPnl < 0 ? "text-destructive" : ""}
            />
          )}
          {widgets.totalPnl && (
            <StatCard
              title="Total P&L"
              value={formatCurrency(displayPnl)}
              inlineTag={displayLabel}
              icon={Activity}
              isLoading={isPnlLoading}
              valueClass={displayPnl > 0 ? "text-success" : displayPnl < 0 ? "text-destructive" : ""}
            />
          )}
          {widgets.availableBalance && (
            <StatCard
              title="Available Balance"
              value={availBal !== undefined && availBal !== null ? formatCurrency(availBal) : "—"}
              inlineTag={usedMargin !== undefined ? `Used: ${formatCurrency(usedMargin)}` : undefined}
              icon={IndianRupee}
              isLoading={isFundsLoading}
            />
          )}
          {widgets.activeStrategies && (
            <StatCard
              title="Active Strategies"
              value={String(activeStrategies)}
              inlineTag={`Win Rate: ${winRate.toFixed(1)}%`}
              icon={Briefcase}
              isLoading={isSummaryLoading}
            />
          )}
        </div>
      )}

      {widgets.equityCurve && (
      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between flex-wrap">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm shrink-0">Equity Curve</CardTitle>
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  Deposit
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  Withdrawal
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                  P&amp;L
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESETS.map((p) => (
                <Button
                  key={p.mode}
                  variant={activeQuery.mode === p.mode ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => handlePreset(p)}
                >
                  {p.label}
                </Button>
              ))}
              <div className="flex items-center gap-1 border border-border rounded-md px-2 py-1 bg-background">
                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                  From
                </span>
                <Input
                  type="date"
                  value={fromInput}
                  max={toInput}
                  onChange={(e) => {
                    setFromInput(e.target.value);
                  }}
                  className="h-6 border-0 p-0 text-xs w-[110px] bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <span className="text-[11px] text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={toInput}
                  min={fromInput}
                  max={toYMD(new Date())}
                  onChange={(e) => {
                    setToInput(e.target.value);
                  }}
                  className="h-6 border-0 p-0 text-xs w-[110px] bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={applyCustomRange}
                  disabled={!fromInput || !toInput || fromInput > toInput}
                >
                  Go
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isEquityLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={360}>
              <AreaChart
                data={equityData}
                margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  tickLine={false}
                />
                <YAxis
                  ticks={Y_TICKS}
                  domain={[0, Y_MAX]}
                  tickFormatter={(v) => formatL(v)}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  width={52}
                />
                <ReferenceLine
                  y={0}
                  stroke="hsl(var(--border))"
                  strokeDasharray="3 3"
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="runbal"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#equityGrad)"
                  dot={<CustomDot />}
                  activeDot={{
                    r: 7,
                    stroke: "hsl(var(--primary))",
                    strokeWidth: 2,
                    fill: "hsl(var(--card))",
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
              No ledger entries found for this period — your Dhan account ledger
              will appear here
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
