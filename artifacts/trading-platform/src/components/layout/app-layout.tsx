import { ReactNode, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Sidebar } from "./sidebar";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Activity, Moon, Sun, Menu, PauseCircle, PlayCircle, ShieldAlert, Wifi, Lock, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";


interface AppLayoutProps {
  children: ReactNode;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/": "Dashboard",
  "/charts": "Live Charts",
  "/orders": "Order Book",
  "/option-chain": "Option Chain",
  "/positions": "Positions",
  "/trade-history": "Ledger Statement",
  "/strategies": "Strategies",
  "/settings": "Settings",
  "/risk-manager": "Risk Manager",
  "/logs": "Logs",
};

// Market status comes from the backend /healthz endpoint which checks
// weekends AND the official NSE/MCX holiday calendar — not just clock time.
// This avoids the bug where the UI showed "NSE OPEN" on public holidays.
interface HealthData {
  marketOpen: boolean;
  marketName: string;
  marketClosedReason?: string;
  nseOpen: boolean;
  mcxOpen: boolean;
  mcxSession: "morning" | "evening" | "closed";
  brokerConnected: boolean;
  systemOnline: boolean;
}

function formatCurrency(val?: number | null) {
  if (val == null) return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

const BASE = import.meta.env.BASE_URL;

export function AppLayout({ children }: AppLayoutProps) {
  const [location, navigate] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 768 : true
  );
  const [staticIpError, setStaticIpError] = useState(false);
  const [rateLimitMsg, setRateLimitMsg] = useState<string | null>(null);
  const rateLimitDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    const handler = () => setStaticIpError(true);
    window.addEventListener("dhan:staticip-error", handler);
    return () => window.removeEventListener("dhan:staticip-error", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { retryAfterMs, message } = (e as CustomEvent<{ retryAfterMs: number; message?: string }>).detail;
      const sec = Math.ceil(retryAfterMs / 1000);
      setRateLimitMsg(message ?? `Dhan API rate limit — request throttled. Retrying in ${sec}s…`);
      if (rateLimitDismissTimer.current) clearTimeout(rateLimitDismissTimer.current);
      rateLimitDismissTimer.current = setTimeout(() => setRateLimitMsg(null), retryAfterMs + 2000);
    };
    window.addEventListener("dhan:rate-limit", handler);
    return () => {
      window.removeEventListener("dhan:rate-limit", handler);
      if (rateLimitDismissTimer.current) clearTimeout(rateLimitDismissTimer.current);
    };
  }, []);

  const { data: health, isLoading: isHealthLoading } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 30000 } });

  // Derive market state to gate kill switch polling interval.
  const _healthForLayout = health as unknown as { nseOpen?: boolean; mcxOpen?: boolean } | undefined;
  const _anyMarketOpenLayout = (_healthForLayout?.nseOpen ?? false) || (_healthForLayout?.mcxOpen ?? false);

  const { data: brokerStatus, isLoading: isBrokerStatusLoading } = useQuery<{ connected: boolean; maskedClientId?: string | null }>({
    queryKey: ["broker-status"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/broker/status`, { cache: "no-store" });
      if (!res.ok) return { connected: false };
      return res.json();
    },
    refetchInterval: 30000,
    staleTime: 0,
  });

  const { resolvedTheme, toggleTheme } = useTheme();

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [location]);

  // Market status is derived from the backend health check (already polls every 30s).
  // The backend uses the official NSE/MCX holiday calendar, handles public holidays
  // correctly, and distinguishes NSE-only vs MCX-only closures.
  const healthData  = health as unknown as HealthData | undefined;
  const marketOpen  = healthData?.marketOpen ?? false;
  const marketName  = healthData?.marketName ?? "NSE";
  const nseOpen     = healthData?.nseOpen ?? false;
  const mcxOpen     = healthData?.mcxOpen ?? false;
  const mcxSession  = healthData?.mcxSession ?? "closed";
  const brokerConnected = healthData?.brokerConnected ?? false;
  const systemOnline = marketOpen && brokerConnected;

  const isBrokerConnected = isBrokerStatusLoading ? null : (brokerStatus?.connected ?? false);
  const BROKER_BANNER_PAGES = ["/", "/dashboard"];
  const showBrokerBanner = isBrokerConnected === false && BROKER_BANNER_PAGES.includes(location);

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
    // Always poll — kill switch can be toggled from Dhan app at any time,
    // faster during market hours, slower otherwise so we don't waste calls
    refetchInterval: _anyMarketOpenLayout ? 10_000 : 30_000,
    staleTime: 0,
    gcTime: 0,
  });

  // ── Settings — needed for PIN check on kill switch ───────────────────────────
  const { data: appSettings } = useQuery<{ hasKillSwitchPin?: boolean }>({
    queryKey: ["/api/settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings`);
      if (!r.ok) return {};
      return r.json();
    },
    staleTime: 30_000,
  });
  const hasPin = appSettings?.hasKillSwitchPin ?? false;

  // Kill switch header confirmation + PIN states
  const [showKsConfirm, setShowKsConfirm] = useState(false);
  const [showKsPin, setShowKsPin] = useState(false);
  const [ksPinInput, setKsPinInput] = useState("");
  const [ksPinPending, setKsPinPending] = useState(false);

  async function handleKsPinVerify() {
    setKsPinPending(true);
    try {
      const res = await fetch(`${BASE}api/settings/verify-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: ksPinInput }),
      });
      const data = await res.json() as { valid: boolean };
      if (data.valid) {
        setShowKsPin(false);
        setKsPinInput("");
        emergencyStopMutation.mutate();
      } else {
        toast({ title: "Incorrect PIN", description: "Kill switch not activated.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setKsPinPending(false);
    }
  }

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

  // isActive is set by our backend from the real-time Dhan API response
  // Also check killSwitchStatus directly as Dhan returns "ACTIVATE" (not "ACTIVE")
  const dhanKillActive =
    ksStatus?.isActive === true ||
    ksStatus?.killSwitchStatus === "ACTIVATE" ||
    ksStatus?.killSwitchStatus === "ACTIVE";
  const isDashboard = location === "/" || location === "/dashboard";

  const pageTitle = PAGE_TITLES[location] ?? PAGE_TITLES[location.replace(/\/$/, "")] ?? "Rajesh Algo";

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} brokerConnected={isBrokerConnected} />

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
                {!hasPin ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled
                    title="Set a Kill Switch PIN in Risk Manager first"
                    className="h-7 px-2 text-xs gap-1.5 opacity-50 cursor-not-allowed border-muted-foreground/30 text-muted-foreground"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Set PIN First</span>
                  </Button>
                ) : (
                  <Button
                    variant={dhanKillActive ? "secondary" : "destructive"}
                    size="sm"
                    className="h-7 px-2 text-xs gap-1.5"
                    onClick={() => { if (!dhanKillActive) setShowKsConfirm(true); }}
                    disabled={emergencyStopMutation.isPending || dhanKillActive}
                    title={dhanKillActive ? "Kill switch is already active — deactivate in Risk Manager" : "Emergency Stop — confirm + PIN required"}
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">
                      {dhanKillActive ? "Kill Switch Activated" : "Activate Kill Switch"}
                    </span>
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
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

            <div className="hidden md:flex items-center gap-2">
              <Activity className={cn("w-4 h-4", marketOpen ? "text-success" : "text-muted-foreground")} />
              {/* When NSE and MCX have different statuses, show both */}
              {nseOpen !== mcxOpen ? (
                <span className="text-xs font-mono text-muted-foreground flex items-center gap-1.5">
                  <span>
                    NSE:{" "}
                    <span className={cn("font-bold", nseOpen ? "text-success" : "text-destructive")}>
                      {nseOpen ? "OPEN" : "CLOSED"}
                    </span>
                  </span>
                  <span className="text-muted-foreground/40">|</span>
                  <span>
                    MCX:{" "}
                    <span className={cn("font-bold", mcxOpen ? "text-success" : "text-destructive")}>
                      {mcxOpen ? "OPEN" : "CLOSED"}
                    </span>
                  </span>
                </span>
              ) : (
                <span className="text-xs font-mono text-muted-foreground">
                  {marketName} Market:{" "}
                  <span className={cn("font-bold", marketOpen ? "text-success" : "text-destructive")}>
                    {marketOpen ? "OPEN" : "CLOSED"}
                  </span>
                </span>
              )}
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
        {rateLimitMsg && (
          <div className="bg-warning/10 border-b border-warning/30 px-4 py-2 flex items-center justify-between gap-3">
            <p className="text-xs text-warning font-medium">
              ⏱ {rateLimitMsg}
            </p>
            <button className="text-xs text-warning underline underline-offset-2 hover:no-underline" onClick={() => setRateLimitMsg(null)}>
              Dismiss
            </button>
          </div>
        )}
        {showBrokerBanner && (
          <div className="bg-warning/10 border-b border-warning/30 px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <Wifi className="w-3.5 h-3.5 text-warning shrink-0" />
              <p className="text-xs text-warning font-medium truncate">
                Broker not connected — enter your Dhan Client ID and Access Token to start trading
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs shrink-0 border-warning/40 text-warning hover:bg-warning/10 hover:border-warning/60"
              onClick={() => navigate("/settings")}
            >
              Connect
            </Button>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-3 md:p-6">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>

      {/* ── Kill Switch: Confirmation dialog ─────────────────────────────────── */}
      {showKsConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-background border border-destructive/40 rounded-2xl p-7 w-[360px] shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Activate Kill Switch?</h3>
                <p className="text-[11px] text-muted-foreground">This will pause all strategies and block all order placement.</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/25 px-4 py-3 text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>All active strategies will be paused and new orders will be blocked on Dhan immediately.</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 h-9"
                onClick={() => setShowKsConfirm(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="flex-1 h-9 gap-1.5 font-semibold"
                onClick={() => {
                  setShowKsConfirm(false);
                  setShowKsPin(true);
                  setKsPinInput("");
                }}>
                <Lock className="w-3.5 h-3.5" />
                Continue — Enter PIN
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Kill Switch: PIN dialog ───────────────────────────────────────────── */}
      {showKsPin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-background border border-border rounded-2xl p-7 w-[340px] space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <Lock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">PIN Required</h3>
                <p className="text-[11px] text-muted-foreground">Enter your 4-digit kill switch PIN to activate.</p>
              </div>
            </div>
            <Input
              type="password"
              placeholder="• • • •"
              maxLength={4}
              value={ksPinInput}
              onChange={e => setKsPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={e => { if (e.key === "Enter" && ksPinInput.length === 4) void handleKsPinVerify(); }}
              className="text-center text-2xl tracking-[0.5em] font-mono h-12"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 h-9"
                onClick={() => { setShowKsPin(false); setKsPinInput(""); }}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" className="flex-1 h-9 gap-1.5 font-semibold"
                disabled={ksPinInput.length < 4 || ksPinPending}
                onClick={() => void handleKsPinVerify()}>
                {ksPinPending
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Verifying…</>
                  : <><ShieldAlert className="w-3.5 h-3.5" />Activate</>}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
