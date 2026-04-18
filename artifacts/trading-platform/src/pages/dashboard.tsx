import { type ElementType } from "react";
import {
  useGetFundLimits,
  getGetFundLimitsQueryKey,
  useGetSettings,
  getGetSettingsQueryKey,
  useHealthCheck,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  IndianRupee,
  TrendingUp,
  Briefcase,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarketIndexCards } from "@/components/market-index-cards";
import { WatchlistWidget } from "@/components/watchlist-widget";

const BASE = import.meta.env.BASE_URL;

const formatCurrency = (val?: number | null) =>
  val !== undefined && val !== null
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(val)
    : "—";

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
  icon: ElementType;
  isLoading?: boolean;
  valueClass?: string;
}) {
  return (
    <Card className="bg-card">
      <CardContent className="p-3 md:p-4">
        <div className="flex items-start justify-between mb-1.5 gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground font-medium leading-tight">
              {title}
            </p>
            {inlineTag && (
              <p className="text-[10px] text-muted-foreground font-mono mt-0.5 leading-tight">
                {inlineTag}
              </p>
            )}
          </div>
          <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
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

interface DashboardSummary {
  totalPnl?: number;
  activeStrategies?: number;
  winRate?: number;
  killSwitchEnabled?: boolean;
  maxDailyLoss?: number;
  availableBalance?: number;
  usedMargin?: number;
}

interface DhanPosition {
  realizedProfit?: number;
  unrealizedProfit?: number;
  positionType?: string;
  netQty?: number | string;
}

export default function Dashboard() {
  const { data: settingsRaw } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey(), staleTime: 60_000 } });
  const settings = settingsRaw as (typeof settingsRaw & { dashboardWidgets?: Record<string, boolean> }) | undefined;
  const widgets = {
    todayPnl: settings?.dashboardWidgets?.todayPnl !== false,
    availableBalance: settings?.dashboardWidgets?.availableBalance !== false,
    activeStrategies: settings?.dashboardWidgets?.activeStrategies !== false,
  };

  // Shared health check — same cache as app-layout (no extra request).
  // Used to gate position/killswitch polling: when market is fully closed
  // (weekend, holiday, after-hours) we stop hammering Dhan's API.
  const { data: healthRaw } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), staleTime: 25_000 } });
  const healthForGate = healthRaw as unknown as { nseOpen?: boolean; mcxOpen?: boolean } | undefined;
  const anyMarketOpen = (healthForGate?.nseOpen ?? false) || (healthForGate?.mcxOpen ?? false);

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
    // Only poll killswitch during market hours — pointless + wasteful to check outside
    refetchInterval: anyMarketOpen ? 15_000 : false,
    staleTime: 0,
    gcTime: 0,
  });

  // Shared positions cache — same queryKey as Positions page, so no extra Dhan API call.
  // todayPnl is computed here instead of being fetched from the summary endpoint.
  // Only auto-refresh during market hours; outside hours the data doesn't change.
  const { data: positions = [], isLoading: isPositionsLoading } = useQuery<DhanPosition[]>({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/positions`);
      if (!res.ok) throw new Error("Failed");
      const raw = await res.json();
      return Array.isArray(raw) ? raw : [];
    },
    refetchInterval: anyMarketOpen ? 5_000 : false,
    staleTime: 3_000,
  });

  // today P&L — computed live from the shared positions cache (no extra API call)
  const todayPnlFromPositions = positions.reduce(
    (s, p) => s + Number(p.realizedProfit ?? 0) + Number(p.unrealizedProfit ?? 0),
    0,
  );
  // dailyLossAmount = negative portion of todayPnl only
  const dailyLossAmountFromPositions = Math.abs(Math.min(0, todayPnlFromPositions));

  // Kill switch: ONLY trust real-time Dhan API (from dedicated /risk/killswitch endpoint)
  const dhanKillActive =
    ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE" || ksStatus?.killSwitchStatus === "ACTIVATE";
  // Daily loss trigger: maxDailyLoss from summary (settings DB), loss amount from positions.
  // Guard: maxDailyLoss must be > 0 to be meaningful — 0 means "not configured".
  const dailyLossTriggered =
    summary?.maxDailyLoss != null &&
    summary.maxDailyLoss > 0 &&
    dailyLossAmountFromPositions >= summary.maxDailyLoss;
  const killTriggered = dhanKillActive || dailyLossTriggered;

  const todayPnl = todayPnlFromPositions;
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
                ? `Dhan kill switch is active. ${ksStatus?.canDeactivateToday ? "Go to Settings to deactivate (1 reset remaining today)." : "Auto-resets at midnight IST — fresh trading resumes next day."}`
                : `Daily loss limit of ${formatCurrency(summary?.maxDailyLoss)} reached (loss: ${formatCurrency(dailyLossAmountFromPositions)}). Trading blocked for today.`}
            </p>
          </div>
          <Badge variant="destructive" className="text-xs">
            HALTED
          </Badge>
        </div>
      )}

      {(widgets.todayPnl || widgets.availableBalance || widgets.activeStrategies) && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {widgets.todayPnl && (
            <StatCard
              title="Today P&L"
              value={formatCurrency(todayPnl)}
              inlineTag="Realized + Unrealized"
              icon={TrendingUp}
              isLoading={isPositionsLoading}
              valueClass={todayPnl > 0 ? "text-success" : todayPnl < 0 ? "text-destructive" : ""}
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

      <MarketIndexCards />

      {/* Watchlist inline on dashboard */}
      <WatchlistWidget
        onOpenPanel={() => window.dispatchEvent(new Event("watchlist:open"))}
      />
    </div>
  );
}
