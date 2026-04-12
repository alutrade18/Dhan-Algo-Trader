import { useState } from "react";
import { useGetDashboardSummary, useGetFundLimits } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IndianRupee, TrendingUp, Briefcase, Activity, ShieldAlert, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const BASE = import.meta.env.BASE_URL;

const formatCurrency = (val?: number) =>
  val !== undefined
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val)
    : "₹0";

function StatCard({ title, value, inlineTag, icon: Icon, isLoading, valueClass }: {
  title: string; value: string; inlineTag?: string; icon: React.ElementType; isLoading?: boolean; valueClass?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start justify-between mb-1.5 gap-1">
          <span className="text-xs text-muted-foreground font-medium leading-tight">{title}</span>
          <div className="flex items-center gap-1.5 shrink-0">
            {inlineTag && (
              <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">{inlineTag}</span>
            )}
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </div>
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-[100px] mt-1" />
        ) : (
          <div className={cn("text-lg font-bold font-mono tracking-tight leading-none", valueClass)}>{value}</div>
        )}
      </CardContent>
    </Card>
  );
}

interface EquityPoint { date: string; pnl: number; cumulative: number; }

interface DashboardSummaryExt {
  todayPnl?: number;
  totalPnl?: number;
  activeStrategies?: number;
  winRate?: number;
  killSwitchTriggered?: boolean;
  killSwitchEnabled?: boolean;
  dailyLossAmount?: number;
  maxDailyLoss?: number;
}

type DateMode = "7d" | "30d" | "365d" | "custom";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

const PRESETS: { label: string; mode: Exclude<DateMode, "custom">; days: number }[] = [
  { label: "7D",   mode: "7d",   days: 6   },
  { label: "30D",  mode: "30d",  days: 29  },
  { label: "365D", mode: "365d", days: 364 },
];

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: funds, isLoading: isFundsLoading } = useGetFundLimits();

  const summaryExt = summary as DashboardSummaryExt | undefined;
  const fundsData = funds as (typeof funds & { availableBalance?: number; utilizedAmount?: number }) | undefined;

  const [dateMode, setDateMode] = useState<DateMode>("7d");
  const [fromDate, setFromDate] = useState(daysAgoStr(6));
  const [toDate, setToDate] = useState(todayStr());
  const [activeQuery, setActiveQuery] = useState<{ mode: DateMode; from: string; to: string }>({
    mode: "7d", from: daysAgoStr(6), to: todayStr(),
  });

  const { data: ksStatus } = useQuery<{ isActive?: boolean; killSwitchStatus?: string; canDeactivateToday?: boolean }>({
    queryKey: ["killswitch-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/risk/killswitch`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store", "Pragma": "no-cache" },
      });
      if (!res.ok) return {};
      return res.json();
    },
    refetchInterval: 15000,
    staleTime: 0,
    gcTime: 0,
  });

  const equityQueryKey = ["equity-curve", activeQuery.mode, activeQuery.from, activeQuery.to];
  const { data: equityCurve, isLoading: isEquityLoading } = useQuery<EquityPoint[]>({
    queryKey: equityQueryKey,
    queryFn: async () => {
      let url = `${BASE}api/dashboard/equity-curve?source=dhan`;
      if (activeQuery.mode === "7d") url += "&days=7";
      else if (activeQuery.mode === "30d") url += "&days=30";
      else if (activeQuery.mode === "365d") url += "&days=365";
      else url += `&fromDate=${activeQuery.from}&toDate=${activeQuery.to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const dhanKillActive = ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE";
  const killTriggered = dhanKillActive || summaryExt?.killSwitchTriggered;

  const equityData = equityCurve
    ?.filter(p => p.pnl !== 0)
    .map(p => ({
      ...p,
      date: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    }));

  const allCumulative = equityData?.map(p => p.cumulative) ?? [];
  const dataMin = allCumulative.length > 0 ? Math.min(0, ...allCumulative) : 0;
  const dataMax = allCumulative.length > 0 ? Math.max(0, ...allCumulative) : 0;
  const padding = allCumulative.length > 0 ? Math.max(Math.abs(dataMax - dataMin) * 0.12, 200) : 500;
  const yDomain: [number, number] = [
    Math.floor((dataMin - padding) / 100) * 100,
    Math.ceil((dataMax + padding) / 100) * 100,
  ];

  function handlePreset(preset: typeof PRESETS[0]) {
    const from = daysAgoStr(preset.days);
    const to = todayStr();
    setDateMode(preset.mode);
    setFromDate(from);
    setToDate(to);
    setActiveQuery({ mode: preset.mode, from, to });
  }

  function handleSearch() {
    if (!fromDate || !toDate) return;
    setActiveQuery({ mode: "custom", from: fromDate, to: toDate });
    setDateMode("custom");
  }

  return (
    <div className="space-y-4">
      {killTriggered && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
          <ShieldAlert className="h-4 w-4 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">Kill Switch Active — Trading Halted</p>
            <p className="text-xs mt-0.5 text-destructive/80">
              {dhanKillActive
                ? `Dhan kill switch is active. ${ksStatus?.canDeactivateToday ? "Go to Settings to deactivate (1 reset remaining today)." : "Auto-resets at 8:30 AM IST tomorrow."}`
                : `Daily loss limit of ${formatCurrency(summaryExt?.maxDailyLoss)} reached (loss: ${formatCurrency(summaryExt?.dailyLossAmount)}). Trading blocked for today.`}
            </p>
          </div>
          <Badge variant="destructive" className="text-xs">HALTED</Badge>
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today P&L"
          value={formatCurrency(summaryExt?.todayPnl)}
          inlineTag="Realized + Unrealized"
          icon={TrendingUp}
          isLoading={isSummaryLoading}
          valueClass={summaryExt?.todayPnl !== undefined
            ? summaryExt.todayPnl >= 0 ? "text-success" : "text-destructive"
            : ""}
        />
        <StatCard
          title="Total P&L"
          value={formatCurrency(summaryExt?.totalPnl)}
          inlineTag="All Time"
          icon={Activity}
          isLoading={isSummaryLoading}
          valueClass={summaryExt?.totalPnl !== undefined
            ? summaryExt.totalPnl >= 0 ? "text-success" : "text-destructive"
            : ""}
        />
        <StatCard
          title="Available Balance"
          value={formatCurrency(fundsData?.availableBalance)}
          inlineTag={`Used: ${formatCurrency(fundsData?.utilizedAmount)}`}
          icon={IndianRupee}
          isLoading={isFundsLoading}
        />
        <StatCard
          title="Active Strategies"
          value={summaryExt?.activeStrategies?.toString() ?? "0"}
          inlineTag={`Win Rate: ${summaryExt?.winRate?.toFixed(1) ?? "0.0"}%`}
          icon={Briefcase}
          isLoading={isSummaryLoading}
        />
      </div>

      <Card>
        <CardHeader className="pb-2 pt-3 px-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <CardTitle className="text-sm">Equity Curve — Dhan Real-Time</CardTitle>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESETS.map(p => (
                <Button
                  key={p.mode}
                  variant={activeQuery.mode === p.mode ? "default" : "outline"}
                  size="sm" className="h-6 px-2.5 text-xs"
                  onClick={() => handlePreset(p)}
                >{p.label}</Button>
              ))}
              <div className="flex items-center gap-1 ml-1">
                <Input
                  type="date"
                  value={fromDate}
                  onChange={e => { setFromDate(e.target.value); setDateMode("custom"); }}
                  className="h-6 text-xs px-1.5 w-[118px]"
                />
                <span className="text-xs text-muted-foreground">—</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={e => { setToDate(e.target.value); setDateMode("custom"); }}
                  className="h-6 text-xs px-1.5 w-[118px]"
                />
                <Button
                  size="sm" className="h-6 px-2 text-xs gap-1"
                  onClick={handleSearch}
                  title="Search custom date range"
                >
                  <Search className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isEquityLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : equityData && equityData.length > 0 ? (
            <ResponsiveContainer width="100%" height={360}>
              <AreaChart data={equityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={v => {
                    const abs = Math.abs(v);
                    if (abs >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
                    if (abs >= 1000) return `₹${(v / 1000).toFixed(1)}k`;
                    return `₹${v}`;
                  }}
                  domain={yDomain}
                  width={60}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [formatCurrency(v), "Cumulative P&L"]}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                />
                <Area
                  type="monotone"
                  dataKey="cumulative"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                  fill="url(#equityGrad)"
                  dot={{ fill: "hsl(var(--primary))", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
              No trades found for this period — your Dhan trade history will appear here
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
