import { ReactNode, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Sidebar } from "./sidebar";
import { useHealthCheck, useGetFundLimits, getHealthCheckQueryKey, getGetFundLimitsQueryKey } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Moon, Sun, RefreshCw, Menu, PauseCircle, PlayCircle, ShieldAlert } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/orders": "Order Book",
  "/super-orders": "Super Orders",
  "/forever-orders": "Forever Orders",
  "/conditional": "Conditional Triggers",
  "/option-chain": "Option Chain",
  "/positions": "Positions",
  "/trade-history": "Ledger Statement",
  "/strategies": "Strategies",
  "/backtesting": "Backtesting",
  "/paper-trading": "Paper Trading",
  "/settings": "Settings",
  "/logs": "Logs",
};

type MarketStatus = { name: string; isOpen: boolean };

function getMarketStatus(): MarketStatus {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);
  const dayOfWeek = istNow.getUTCDay(); // 0=Sun 1=Mon … 5=Fri 6=Sat

  // Weekend — all markets closed
  if (dayOfWeek === 0 || dayOfWeek === 6) return { name: "NSE Market", isOpen: false };

  const mins = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
  const NSE_OPEN  = 9 * 60;        // 09:00 AM IST
  const NSE_CLOSE = 15 * 60 + 30;  // 03:30 PM IST
  const MCX_CLOSE = 23 * 60 + 30;  // 11:30 PM IST

  if (mins >= NSE_OPEN && mins < NSE_CLOSE) {
    return { name: "NSE Market", isOpen: true };
  } else if (mins >= NSE_CLOSE && mins < MCX_CLOSE) {
    return { name: "MCX Market", isOpen: true };
  } else {
    // Before NSE opens (midnight–9 AM) or after MCX closes (11:30 PM+)
    return { name: "NSE Market", isOpen: false };
  }
}

function formatCurrency(val?: number | null) {
  if (val == null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(val);
}

const BASE = import.meta.env.BASE_URL;

export function AppLayout({ children }: AppLayoutProps) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [staticIpError, setStaticIpError] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const handler = () => setStaticIpError(true);
    window.addEventListener("dhan:staticip-error", handler);
    return () => window.removeEventListener("dhan:staticip-error", handler);
  }, []);

  const { data: health, isLoading: isHealthLoading, refetch: refetchHealth } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });
  const { data: funds, isLoading: isFundsLoading, refetch: refetchFunds } = useGetFundLimits({ query: { queryKey: getGetFundLimitsQueryKey(), refetchInterval: 15000 } });
  const { resolvedTheme, toggleTheme } = useTheme();
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [location]);

  const [market, setMarket] = useState<MarketStatus>(getMarketStatus);
  useEffect(() => {
    // Re-evaluate every 30 seconds so transitions happen promptly
    const id = setInterval(() => setMarket(getMarketStatus()), 30_000);
    return () => clearInterval(id);
  }, []);

  const marketOpen = market.isOpen;
  const brokerConnected = health?.brokerConnected ?? false;
  const systemOnline = marketOpen && brokerConnected;

  const fundsData = funds as (typeof funds & { availableBalance?: number | null }) | undefined;
  const availableBalance = fundsData?.availableBalance;
  const isRefreshing = isFundsLoading || isManualRefreshing;

  const handleRefreshBalance = async () => {
    setIsManualRefreshing(true);
    try {
      await Promise.all([refetchFunds(), refetchHealth()]);
    } finally {
      setIsManualRefreshing(false);
    }
  };

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

  const [allPaused, setAllPaused] = useState(false);

  const pauseAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/strategies/pause-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      setAllPaused(true);
      toast({ title: "All strategies paused", description: "Click 'Activate All Strategy' to resume." });
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to pause strategies", variant: "destructive" }),
  });

  const activateAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/strategies/activate-all`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      setAllPaused(false);
      toast({ title: "All strategies activated", description: "All paused strategies are now active." });
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to activate strategies", variant: "destructive" }),
  });

  const emergencyStopMutation = useMutation({
    mutationFn: async () => {
      const [pauseRes, killRes] = await Promise.all([
        fetch(`${BASE}api/strategies/pause-all`, { method: "POST" }),
        fetch(`${BASE}api/risk/killswitch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ACTIVATE" }),
        }),
      ]);
      if (!pauseRes.ok || !killRes.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast({ title: "Emergency Stop Activated", description: "All strategies paused and Dhan kill switch enabled.", variant: "destructive" });
      queryClient.invalidateQueries({ queryKey: ["killswitch-status"] });
      queryClient.invalidateQueries({ queryKey: ["strategies"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => toast({ title: "Error", description: "Failed to activate emergency stop", variant: "destructive" }),
  });

  const dhanKillActive = ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE";
  const isDashboard = location === "/";

  const pageTitle = PAGE_TITLES[location] ?? "Dashboard";

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-sidebar-border bg-sidebar flex items-center justify-between px-3 md:px-6 shrink-0 gap-2">
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

            {isDashboard && (
              <div className="flex items-center gap-1.5 ml-2">
                {allPaused ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5 border-primary/50 text-primary hover:bg-primary/10 hidden sm:flex"
                    onClick={() => activateAllMutation.mutate()}
                    disabled={activateAllMutation.isPending}
                    title="Activate All Strategies"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Activate All Strategy</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5 border-primary/30 text-primary/70 hover:bg-primary/8 hover:text-primary hidden sm:flex"
                    onClick={() => pauseAllMutation.mutate()}
                    disabled={pauseAllMutation.isPending}
                    title="Pause All Strategies"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Pause All Strategy</span>
                  </Button>
                )}
                <Button
                  variant={dhanKillActive ? "secondary" : "destructive"}
                  size="sm"
                  className="h-7 px-2 text-xs gap-1.5"
                  onClick={() => emergencyStopMutation.mutate()}
                  disabled={emergencyStopMutation.isPending || dhanKillActive}
                  title="Emergency Stop — pause all strategies and activate Dhan kill switch"
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">
                    {dhanKillActive ? "Kill Switch Activated" : "Activate Kill Switch"}
                  </span>
                </Button>
              </div>
            )}
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
                <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10 gap-1 rounded-sm text-[10px] px-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
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
                {market.name}: {marketOpen ? "OPEN" : "CLOSED"}
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

        {staticIpError && (
          <div className="bg-destructive/10 border-b border-destructive/30 px-4 py-2.5 flex items-center justify-between gap-3">
            <p className="text-xs text-destructive font-medium">
              ⚠️ DH-911: Dhan API blocked — your server IP is not whitelisted. Add it in Dhan developer settings, then reconnect.
            </p>
            <button className="text-xs text-destructive underline underline-offset-2 hover:no-underline" onClick={() => setStaticIpError(false)}>
              Dismiss
            </button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
