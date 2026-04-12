import { useState } from "react";
import { useGetDashboardSummary, useGetFundLimits } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { IndianRupee, TrendingUp, Briefcase, Activity, ShieldAlert, AlertTriangle, Search, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const BASE = import.meta.env.BASE_URL;

const formatCurrency = (val?: number) =>
  val !== undefined
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val)
    : "₹0";

function StatCard({ title, value, subValue, icon: Icon, isLoading, valueClass }: {
  title: string; value: string; subValue?: string; icon: React.ElementType; isLoading?: boolean; valueClass?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-muted-foreground font-medium leading-tight">{title}</span>
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
        {isLoading ? (
          <Skeleton className="h-6 w-[100px] mt-1" />
        ) : (
          <>
            <div className={cn("text-lg font-bold font-mono tracking-tight leading-none", valueClass)}>{value}</div>
            {subValue && <p className="text-[10px] text-muted-foreground mt-1 leading-tight">{subValue}</p>}
          </>
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

type DateMode = "7d" | "30d" | "custom";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

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
      let url = `${BASE}api/dashboard/equity-curve`;
      if (activeQuery.mode === "7d") url += "?days=7";
      else if (activeQuery.mode === "30d") url += "?days=30";
      else url += `?fromDate=${activeQuery.from}&toDate=${activeQuery.to}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 60000,
  });

  const { data: recentActivity } = useQuery<Array<{ id: string; type: string; action: string; symbol: string; quantity: number; price: number; status: string; timestamp: string; details?: string }>>({
    queryKey: ["recent-activity"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/dashboard/recent-activity?limit=5`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const dhanKillActive = ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE";
  const killTriggered = dhanKillActive || summaryExt?.killSwitchTriggered;

  const equityData = equityCurve?.map(p => ({
    ...p,
    date: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  }));
  const minEquity = Math.min(...(equityData?.map(p => p.cumulative) ?? [0])) - 500;
  const maxEquity = Math.max(...(equityData?.map(p => p.cumulative) ?? [0])) + 500;

  function handlePreset(mode: "7d" | "30d") {
    const days = mode === "7d" ? 6 : 29;
    const from = daysAgoStr(days);
    const to = todayStr();
    setDateMode(mode);
    setFromDate(from);
    setToDate(to);
    setActiveQuery({ mode, from, to });
  }

  function handleSearch() {
    setActiveQuery({ mode: "custom", from: fromDate, to: toDate });
  }

  function handleReset() {
    setDateMode("7d");
    setFromDate(daysAgoStr(6));
    setToDate(todayStr());
    setActiveQuery({ mode: "7d", from: daysAgoStr(6), to: todayStr() });
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
          title="Today P&L (Realized + Unrealized)"
          value={formatCurrency(summaryExt?.todayPnl)}
          icon={TrendingUp}
          isLoading={isSummaryLoading}
          valueClass={summaryExt?.todayPnl !== undefined
            ? summaryExt.todayPnl >= 0 ? "text-success" : "text-destructive"
            : ""}
        />
        <StatCard
          title="Total P&L (All Time)"
          value={formatCurrency(summaryExt?.totalPnl)}
          icon={Activity}
          isLoading={isSummaryLoading}
          valueClass={summaryExt?.totalPnl !== undefined
            ? summaryExt.totalPnl >= 0 ? "text-success" : "text-destructive"
            : ""}
        />
        <StatCard
          title="Available Balance"
          value={formatCurrency(fundsData?.availableBalance)}
          subValue={`Used Margin: ${formatCurrency(fundsData?.utilizedAmount)}`}
          icon={IndianRupee}
          isLoading={isFundsLoading}
        />
        <StatCard
          title="Active Strategies"
          value={summaryExt?.activeStrategies?.toString() ?? "0"}
          subValue={`Win Rate: ${summaryExt?.winRate?.toFixed(1) ?? "0.0"}%`}
          icon={Briefcase}
          isLoading={isSummaryLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <CardTitle className="text-sm">Equity Curve</CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Button
                  variant={activeQuery.mode === "7d" ? "default" : "outline"}
                  size="sm" className="h-6 px-2 text-xs"
                  onClick={() => handlePreset("7d")}
                >7D</Button>
                <Button
                  variant={activeQuery.mode === "30d" ? "default" : "outline"}
                  size="sm" className="h-6 px-2 text-xs"
                  onClick={() => handlePreset("30d")}
                >30D</Button>
                <div className="flex items-center gap-1">
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
                  <Button size="sm" className="h-6 px-2 text-xs gap-1" onClick={handleSearch}>
                    <Search className="h-3 w-3" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={handleReset} title="Reset to last 7 days">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {isEquityLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : equityData && equityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={equityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                    domain={[minEquity, maxEquity]}
                    width={48}
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
                    strokeWidth={2}
                    fill="url(#equityGrad)"
                    dot={{ fill: "hsl(var(--primary))", r: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
                No trade history for this period
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-sm">Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {recentActivity && recentActivity.length > 0 ? (
              <div className="space-y-1.5">
                {recentActivity.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2">
                    <AlertTriangle className={cn("h-3 w-3 mt-0.5 flex-shrink-0", a.status === "success" ? "text-success" : a.status === "failed" ? "text-destructive" : "text-muted-foreground")} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{a.symbol} — {a.action} {a.quantity}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(a.timestamp).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                      </p>
                    </div>
                    <Badge variant={a.status === "success" ? "default" : a.status === "failed" ? "destructive" : "secondary"} className="text-[10px] flex-shrink-0">
                      {a.status}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No recent activity
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
