import { useState } from "react";
import { useGetDashboardSummary, useGetFundLimits } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IndianRupee, TrendingUp, Briefcase, Activity, PauseCircle, ShieldAlert, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-[120px]" />
        ) : (
          <>
            <div className={cn("text-2xl font-bold font-mono tracking-tight", valueClass)}>{value}</div>
            {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
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

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: funds, isLoading: isFundsLoading } = useGetFundLimits();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const summaryExt = summary as DashboardSummaryExt | undefined;
  const fundsData = funds as (typeof funds & { availableBalance?: number; utilizedAmount?: number }) | undefined;

  const { data: equityCurve, isLoading: isEquityLoading } = useQuery<EquityPoint[]>({
    queryKey: ["equity-curve"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/dashboard/equity-curve?days=7`);
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

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/strategies/pause-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "All strategies paused", description: "All active strategies have been paused." });
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to pause strategies", variant: "destructive" }),
  });

  const emergencyStopMutation = useMutation({
    mutationFn: async () => {
      const [pauseRes, killRes] = await Promise.all([
        fetch(`${BASE}api/strategies/pause-all`, { method: "POST" }),
        fetch(`${BASE}api/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ killSwitchEnabled: true }),
        }),
      ]);
      if (!pauseRes.ok || !killRes.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast({ title: "Emergency Stop Activated", description: "All strategies paused and kill switch enabled.", variant: "destructive" });
      queryClient.invalidateQueries();
    },
    onError: () => toast({ title: "Error", description: "Failed to activate emergency stop", variant: "destructive" }),
  });

  const killTriggered = summaryExt?.killSwitchTriggered;

  const equityData = equityCurve?.map(p => ({
    ...p,
    date: new Date(p.date + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  }));
  const minEquity = Math.min(...(equityData?.map(p => p.cumulative) ?? [0])) - 500;
  const maxEquity = Math.max(...(equityData?.map(p => p.cumulative) ?? [0])) + 500;

  return (
    <div className="space-y-6">
      {killTriggered && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-destructive">
          <ShieldAlert className="h-5 w-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">Kill Switch Active — Trading Halted</p>
            <p className="text-xs mt-0.5 text-destructive/80">
              {summaryExt?.killSwitchEnabled
                ? "Emergency kill switch is enabled. Go to Settings to disable."
                : `Daily loss limit of ${formatCurrency(summaryExt?.maxDailyLoss)} reached (loss: ${formatCurrency(summaryExt?.dailyLossAmount)}). Trading is blocked for today.`}
            </p>
          </div>
          <Badge variant="destructive" className="text-xs">HALTED</Badge>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today's P&L"
          value={formatCurrency(summaryExt?.todayPnl)}
          subValue="Realized + Unrealized"
          icon={TrendingUp}
          isLoading={isSummaryLoading}
          valueClass={summaryExt?.todayPnl !== undefined
            ? summaryExt.todayPnl >= 0 ? "text-success" : "text-destructive"
            : ""}
        />
        <StatCard
          title="Total P&L"
          value={formatCurrency(summaryExt?.totalPnl)}
          subValue="All time"
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
          subValue={`Win Rate: ${summaryExt?.winRate?.toFixed(1) ?? "0"}%`}
          icon={Briefcase}
          isLoading={isSummaryLoading}
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => pauseAllMutation.mutate()}
          disabled={pauseAllMutation.isPending}
        >
          <PauseCircle className="h-4 w-4" />
          Pause All Strategies
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="gap-2"
          onClick={() => emergencyStopMutation.mutate()}
          disabled={emergencyStopMutation.isPending}
        >
          <ShieldAlert className="h-4 w-4" />
          Emergency Stop
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Equity Curve — Last 7 Days P&L</CardTitle>
          </CardHeader>
          <CardContent>
            {isEquityLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : equityData && equityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={equityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickFormatter={v => `₹${(v / 1000).toFixed(0)}k`}
                    domain={[minEquity, maxEquity]}
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
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                No trade history yet — execute strategies to see your equity curve
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity && recentActivity.length > 0 ? (
              <div className="space-y-2">
                {recentActivity.slice(0, 5).map(a => (
                  <div key={a.id} className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2">
                    <AlertTriangle className={cn("h-3.5 w-3.5 mt-0.5 flex-shrink-0", a.status === "success" ? "text-success" : a.status === "failed" ? "text-destructive" : "text-muted-foreground")} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{a.symbol} — {a.action} {a.quantity}</p>
                      <p className="text-[10px] text-muted-foreground">{a.details}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(a.timestamp).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                      </p>
                    </div>
                    <Badge variant={a.status === "success" ? "default" : a.status === "failed" ? "destructive" : "secondary"} className="text-[10px] ml-auto flex-shrink-0">
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
