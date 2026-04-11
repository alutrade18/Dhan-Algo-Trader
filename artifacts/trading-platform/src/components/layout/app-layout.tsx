import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { useHealthCheck, useGetFundLimits } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Moon, Sun, RefreshCw } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

function isNSEMarketOpen(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  const dayOfWeek = istNow.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const hours = istNow.getUTCHours();
  const minutes = istNow.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60;
  const marketClose = 15 * 60 + 30;

  return totalMinutes >= marketOpen && totalMinutes < marketClose;
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
  const { data: health, isLoading: isHealthLoading, refetch: refetchHealth } = useHealthCheck({ query: { refetchInterval: 30000 } });
  const { data: funds, isLoading: isFundsLoading, refetch: refetchFunds } = useGetFundLimits({ query: { refetchInterval: 60000 } });
  const { resolvedTheme, toggleTheme } = useTheme();

  const marketOpen = isNSEMarketOpen();
  const brokerConnected = health?.brokerConnected ?? false;
  const systemOnline = marketOpen && brokerConnected;

  const availableBalance = funds?.availableBalance;

  const handleRefreshBalance = () => {
    refetchFunds();
    refetchHealth();
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-6 shrink-0">
          <h2 className="font-semibold text-lg tracking-tight">Market Overview</h2>

          <div className="flex items-center gap-3">
            {availableBalance != null && (
              <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                <span className="text-foreground/60">BAL:</span>
                <span className="font-semibold text-foreground">
                  {isFundsLoading ? "..." : formatCurrency(availableBalance)}
                </span>
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={handleRefreshBalance}
              title="Refresh balance"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>

            <div className="h-4 w-[1px] bg-border" />

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">SYSTEM:</span>
              {isHealthLoading ? (
                <Badge variant="outline" className="text-muted-foreground rounded-sm text-[10px]">CHECKING</Badge>
              ) : systemOnline ? (
                <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1.5 rounded-sm text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  ONLINE
                </Badge>
              ) : brokerConnected ? (
                <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 bg-yellow-500/10 gap-1.5 rounded-sm text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  CONNECTED
                </Badge>
              ) : (
                <Badge variant="destructive" className="rounded-sm text-[10px]">OFFLINE</Badge>
              )}
            </div>

            <div className="h-4 w-[1px] bg-border" />

            <div className="flex items-center gap-2">
              <Activity className={cn("w-4 h-4", marketOpen ? "text-success" : "text-muted-foreground")} />
              <span className={cn("text-sm font-mono tracking-tighter", marketOpen ? "text-success" : "text-muted-foreground")}>
                NSE: {marketOpen ? "OPEN" : "CLOSED"}
              </span>
            </div>

            <div className="h-4 w-[1px] bg-border" />

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
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
