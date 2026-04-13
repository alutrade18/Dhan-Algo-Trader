import { useQuery } from "@tanstack/react-query";
import { Users, ShoppingCart, Cpu, AlertTriangle, RefreshCw, TrendingUp, Shield, Activity } from "lucide-react";
import { apiFetch, type AdminStats } from "@/lib/api";

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  sub,
}: {
  title: string;
  value: number | string;
  icon: React.ElementType;
  color: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-card-border rounded-lg p-5 flex items-start gap-4">
      <div className={`rounded-lg p-2.5 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{title}</p>
        <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading, refetch, isFetching } = useQuery<AdminStats>({
    queryKey: ["admin-stats"],
    queryFn: () => apiFetch("/admin/stats"),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Platform Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time stats for Rajesh Algo SaaS</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg p-5 h-28 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Users"
            value={stats?.totalUsers ?? 0}
            icon={Users}
            color="bg-primary/10 text-primary"
            sub="Registered accounts"
          />
          <StatCard
            title="Super Orders"
            value={stats?.totalSuperOrders ?? 0}
            icon={ShoppingCart}
            color="bg-success/10 text-success"
            sub="All time placed"
          />
          <StatCard
            title="Broker Configs"
            value={stats?.configuredBrokers ?? 0}
            icon={Cpu}
            color="bg-chart-4/10 text-chart-4"
            sub="Dhan accounts linked"
          />
          <StatCard
            title="Error Logs"
            value={stats?.recentErrors ?? 0}
            icon={AlertTriangle}
            color="bg-destructive/10 text-destructive"
            sub="Total error entries"
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-card border border-card-border rounded-lg p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            Platform Health
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Pricing Plans</span>
              <div className="flex gap-2">
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Monthly ₹2,999</span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">3-Month ₹6,999</span>
                <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Annual ₹26,999</span>
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Broker Integration</span>
              <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">Dhan API v2</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Super Order Target</span>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">15% profit / 10% SL</span>
            </div>
            <div className="flex items-center justify-between py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">Order Type</span>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">INTRADAY only</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Markets Supported</span>
              <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full">NSE / BSE</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            Admin Info
          </h2>
          <div className="space-y-3 text-sm">
            <div className="p-3 bg-primary/5 rounded-md border border-primary/20">
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="font-semibold text-foreground">Rajesh Algo SaaS</p>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Data Source</p>
              <p className="font-medium text-foreground">P&L always from Dhan API</p>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Auth</p>
              <p className="font-medium text-foreground">Clerk multi-tenant</p>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <p className="text-xs text-muted-foreground">Exchange</p>
              <p className="font-medium text-foreground">NSE / BSE / NFO / BFO</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-lg p-5">
        <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <a href="#/users" className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-center">
            <Users className="w-5 h-5 text-primary" />
            <span className="text-xs font-medium">View Users</span>
          </a>
          <a href="#/orders" className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-center">
            <ShoppingCart className="w-5 h-5 text-primary" />
            <span className="text-xs font-medium">Super Orders</span>
          </a>
          <a href="#/logs" className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-center">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <span className="text-xs font-medium">Error Logs</span>
          </a>
          <a href="/" className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors text-center">
            <Activity className="w-5 h-5 text-success" />
            <span className="text-xs font-medium">Trading App</span>
          </a>
        </div>
      </div>
    </div>
  );
}
