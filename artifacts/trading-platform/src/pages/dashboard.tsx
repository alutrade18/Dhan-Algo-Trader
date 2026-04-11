import { useGetDashboardSummary, useGetRecentActivity, useGetFundLimits } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityItem } from "@workspace/api-zod/src/generated/types";
import { IndianRupee, TrendingUp, Briefcase, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({ title, value, subValue, icon: Icon, isLoading, valueClass }: any) {
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
  const { data: activity, isLoading: isActivityLoading } = useGetRecentActivity({ limit: 10 });
  const { data: funds, isLoading: isFundsLoading } = useGetFundLimits();

  const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';
  
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Today's P&L" 
          value={formatCurrency(summary?.todayPnl)} 
          subValue="Realized + Unrealized"
          icon={TrendingUp}
          isLoading={isSummaryLoading}
          valueClass={summary?.todayPnl && summary.todayPnl >= 0 ? "text-success" : summary?.todayPnl && summary.todayPnl < 0 ? "text-destructive" : ""}
        />
        <StatCard 
          title="Total P&L" 
          value={formatCurrency(summary?.totalPnl)} 
          subValue="All time"
          icon={Activity}
          isLoading={isSummaryLoading}
          valueClass={summary?.totalPnl && summary.totalPnl >= 0 ? "text-success" : summary?.totalPnl && summary.totalPnl < 0 ? "text-destructive" : ""}
        />
        <StatCard 
          title="Available Balance" 
          value={formatCurrency(funds?.availableBalance)} 
          subValue={`Used Margin: ${formatCurrency(funds?.utilizedAmount)}`}
          icon={IndianRupee}
          isLoading={isFundsLoading}
        />
        <StatCard 
          title="Active Strategies" 
          value={summary?.activeStrategies?.toString() || '0'} 
          subValue={`Win Rate: ${summary?.winRate ? summary.winRate + '%' : '0%'}`}
          icon={Briefcase}
          isLoading={isSummaryLoading}
        />
      </div>

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle className="text-sm">Recent Activity Feed</CardTitle>
          </CardHeader>
          <CardContent>
            {isActivityLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="space-y-4">
                {activity.map((item: ActivityItem) => (
                  <div key={item.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-card/50">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn(
                          "text-[10px] px-1 py-0",
                          item.action.toUpperCase() === 'BUY' ? "border-success text-success" : "border-destructive text-destructive"
                        )}>
                          {item.action}
                        </Badge>
                        <span className="font-mono font-medium text-sm">{item.symbol}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {item.quantity} Qty @ {formatCurrency(item.price)}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant="secondary" className="text-[10px]">{item.status}</Badge>
                      <div className="text-xs text-muted-foreground mt-1">{new Date(item.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center border rounded-md border-dashed">No recent activity</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
