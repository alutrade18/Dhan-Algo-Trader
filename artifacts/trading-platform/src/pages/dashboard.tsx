import { useGetDashboardSummary, useGetFundLimits } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IndianRupee, TrendingUp, Briefcase, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({ title, value, subValue, icon: Icon, isLoading, valueClass }: {
  title: string;
  value: string;
  subValue?: string;
  icon: React.ElementType;
  isLoading?: boolean;
  valueClass?: string;
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

export default function Dashboard() {
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary();
  const { data: funds, isLoading: isFundsLoading } = useGetFundLimits();

  const fundsData = funds as (typeof funds & { availableBalance?: number; utilizedAmount?: number }) | undefined;

  const formatCurrency = (val?: number) =>
    val !== undefined
      ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(val)
      : "₹0.00";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today's P&L"
          value={formatCurrency(summary?.todayPnl)}
          subValue="Realized + Unrealized"
          icon={TrendingUp}
          isLoading={isSummaryLoading}
          valueClass={
            summary?.todayPnl && summary.todayPnl >= 0
              ? "text-success"
              : summary?.todayPnl && summary.todayPnl < 0
                ? "text-destructive"
                : ""
          }
        />
        <StatCard
          title="Total P&L"
          value={formatCurrency(summary?.totalPnl)}
          subValue="All time"
          icon={Activity}
          isLoading={isSummaryLoading}
          valueClass={
            summary?.totalPnl && summary.totalPnl >= 0
              ? "text-success"
              : summary?.totalPnl && summary.totalPnl < 0
                ? "text-destructive"
                : ""
          }
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
          value={summary?.activeStrategies?.toString() || "0"}
          subValue={`Win Rate: ${summary?.winRate ? summary.winRate + "%" : "0%"}`}
          icon={Briefcase}
          isLoading={isSummaryLoading}
        />
      </div>
    </div>
  );
}
