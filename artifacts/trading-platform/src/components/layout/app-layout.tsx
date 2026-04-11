import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Sidebar } from "./sidebar";
import { useHealthCheck, useGetFundLimits } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Moon, Sun, RefreshCw, Menu } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/orders": "Orders",
  "/positions": "Positions",
  "/strategies": "Strategies",
  "/backtesting": "Backtesting",
  "/paper-trading": "Paper Trading",
  "/settings": "Settings",
};

function isNSEMarketOpen(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const dayOfWeek = istNow.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const totalMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  return totalMinutes >= 9 * 60 && totalMinutes < 15 * 60 + 30;
}

function formatCurrency(val?: number | null) {
  if (val == null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );

  const { data: health, isLoading: isHealthLoading, refetch: refetchHealth } = useHealthCheck({ query: { refetchInterval: 30000 } });
  const { data: funds, isLoading: isFundsLoading, isRefetching: isFundsRefetching, refetch: refetchFunds } = useGetFundLimits({ query: { refetchInterval: 60000 } });
  const { resolvedTheme, toggleTheme } = useTheme();

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [location]);

  const marketOpen = isNSEMarketOpen();
  const brokerConnected = health?.brokerConnected ?? false;
  const systemOnline = marketOpen && brokerConnected;

  const fundsData = funds as (typeof funds & { availableBalance?: number | null }) | undefined;
  const availableBalance = fundsData?.availableBalance;
  const isRefreshing = isFundsLoading || isFundsRefetching;

  const handleRefreshBalance = async () => {
    await Promise.all([refetchFunds(), refetchHealth()]);
  };

  const pageTitle = PAGE_TITLES[location] ?? "Dashboard";

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-3 md:px-6 shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setSidebarOpen((o) => !o)}
              title="Toggle sidebar"
            >
              <Menu className="w-4 h-4" />
            </Button>
            <h2 className="font-semibold text-base md:text-lg tracking-tight truncate">{pageTitle}</h2>
          </div>

          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
              <span className="text-foreground/60">BAL:</span>
              <span className="font-semibold text-foreground min-w-[56px]">
                {isRefreshing
                  ? <span className="animate-pulse text-muted-foreground">···</span>
                  : availableBalance != null
                    ? formatCurrency(availableBalance)
                    : <span className="text-muted-foreground/50">—</span>
                }
              </span>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRefreshBalance}
              disabled={isRefreshing}
              title="Refresh balance"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")} />
            </Button>

            <div className="hidden sm:block h-4 w-[1px] bg-border" />

            <div className="flex items-center gap-1.5">
              <span className="hidden sm:inline text-xs text-muted-foreground font-mono">Status:</span>
              {isHealthLoading ? (
                <Badge variant="outline" className="text-muted-foreground rounded-sm text-[10px]">···</Badge>
              ) : systemOnline ? (
                <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1 rounded-sm text-[10px] px-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  ONLINE
                </Badge>
              ) : brokerConnected ? (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 bg-yellow-500/10 gap-1 rounded-sm text-[10px] px-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  CONNECTED
                </Badge>
              ) : (
                <Badge variant="destructive" className="rounded-sm text-[10px] px-1.5">OFFLINE</Badge>
              )}
            </div>

            <div className="hidden sm:block h-4 w-[1px] bg-border" />

            <div className="hidden md:flex items-center gap-1.5">
              <Activity className={cn("w-4 h-4", marketOpen ? "text-success" : "text-muted-foreground")} />
              <span className={cn("text-xs font-mono", marketOpen ? "text-success" : "text-muted-foreground")}>
                NSE: {marketOpen ? "OPEN" : "CLOSED"}
              </span>
            </div>

            <div className="hidden md:block h-4 w-[1px] bg-border" />

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
              title={resolvedTheme === "dark" ? "Switch to Light mode" : "Switch to Dark mode"}
            >
              {resolvedTheme === "dark" ? (
                <Sun className="w-4 h-4" />
              ) : (
                <Moon className="w-4 h-4" />
              )}
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
