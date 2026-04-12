import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut, RefreshCw, User,
  ShieldAlert, Bell, TrendingUp, TrendingDown, Power, Calendar,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});

const riskSchema = z.object({
  maxDailyLoss: z.coerce.number().min(0, "Must be ≥ 0"),
});

const telegramSchema = z.object({
  telegramBotToken: z.string().min(1, "Bot Token is required"),
  telegramChatId: z.string().min(1, "Chat ID is required"),
});

const pnlExitSchema = z.object({
  profitValue: z.coerce.number().min(1, "Must be > 0"),
  lossValue: z.coerce.number().min(1, "Must be > 0"),
  enableKillSwitch: z.boolean().default(false),
});

interface FundDetails {
  dhanClientId?: string;
  availableBalance?: number;
  sodLimit?: number;
  utilizedAmount?: number;
  withdrawableBalance?: number;
}

interface ConnectResult extends FundDetails {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

interface SettingsData {
  id: number;
  dhanClientId: string;
  apiConnected: boolean;
  maxDailyLoss: number | null;
  killSwitchEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  updatedAt: string;
}

interface KillSwitchStatus {
  dhanClientId?: string;
  killSwitchStatus?: string;
  isActive?: boolean;
  canDeactivateToday?: boolean;
  deactivationsUsed?: number;
  error?: string;
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [pnlProductTypes, setPnlProductTypes] = useState<string[]>(["INTRADAY"]);
  const [pnlActive, setPnlActive] = useState(false);
  const [optimisticKsActive, setOptimisticKsActive] = useState<boolean | null>(null);

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";

  const { data: ksStatus, refetch: refetchKs } = useQuery<KillSwitchStatus>({
    queryKey: ["killswitch-status"],
    queryFn: async () => {
      if (!isConnected) return {};
      const res = await fetch(`${BASE}api/risk/killswitch`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store", "Pragma": "no-cache" },
      });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: isConnected,
    refetchInterval: 15000,
    staleTime: 0,
    gcTime: 0,
  });

  const killSwitchActive = optimisticKsActive !== null
    ? optimisticKsActive
    : (ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE" || ksStatus?.killSwitchStatus === "ACTIVATE");

  const canDeactivate = ksStatus?.canDeactivateToday !== false;

  const brokerForm = useForm<z.infer<typeof brokerSchema>>({
    resolver: zodResolver(brokerSchema),
    defaultValues: { clientId: "", accessToken: "" },
  });

  const riskForm = useForm<z.infer<typeof riskSchema>>({
    resolver: zodResolver(riskSchema),
    defaultValues: { maxDailyLoss: 5000 },
  });

  const telegramForm = useForm<z.infer<typeof telegramSchema>>({
    resolver: zodResolver(telegramSchema),
    defaultValues: { telegramBotToken: "", telegramChatId: "" },
  });

  const pnlForm = useForm<z.infer<typeof pnlExitSchema>>({
    resolver: zodResolver(pnlExitSchema),
    defaultValues: { profitValue: undefined, lossValue: undefined, enableKillSwitch: false },
  });

  useEffect(() => {
    if (settingsData) {
      riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
      telegramForm.reset({
        telegramBotToken: settingsData.telegramBotToken ?? "",
        telegramChatId: settingsData.telegramChatId ?? "",
      });
    }
  }, [settingsData?.id]);

  const connectMutation = useMutation({
    mutationFn: async (data: z.infer<typeof brokerSchema>) => {
      const res = await fetch(`${BASE}api/broker/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Request failed");
      return res.json() as Promise<ConnectResult>;
    },
    onSuccess: (result) => {
      setConnectResult(result);
      if (result.success) {
        toast({ title: "Broker connected successfully", description: `Available balance: ₹${result.availableBalance?.toLocaleString("en-IN")}` });
        queryClient.invalidateQueries({ queryKey: ["healthz"] });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
        queryClient.invalidateQueries({ queryKey: ["killswitch-status"] });
      } else {
        toast({ title: `Connection failed: ${result.errorCode}`, description: result.errorMessage, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/broker/disconnect`, { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      return res.json();
    },
    onSuccess: () => {
      setConnectResult(null);
      brokerForm.reset({ clientId: "", accessToken: "" });
      toast({ title: "Disconnected from broker" });
      queryClient.invalidateQueries({ queryKey: ["healthz"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/broker/status`);
      if (!res.ok) throw new Error("Request failed");
      return res.json() as Promise<FundDetails & { connected: boolean }>;
    },
    onSuccess: (data) => {
      if (data.connected) {
        setConnectResult(prev => prev ? { ...prev, ...data, success: true } : null);
        toast({ title: "Balance refreshed", description: `Available: ₹${data.availableBalance?.toLocaleString("en-IN")}` });
      }
    },
    onError: () => toast({ title: "Failed to refresh balance", variant: "destructive" }),
  });

  const riskMutation = useMutation({
    mutationFn: async (maxDailyLoss: number) => {
      const res = await fetch(`${BASE}api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxDailyLoss }),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Daily loss limit saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const telegramMutation = useMutation({
    mutationFn: async (data: { telegramBotToken: string; telegramChatId: string }) => {
      const res = await fetch(`${BASE}api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Telegram settings saved", description: "Alerts will now be sent to your bot." });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => toast({ title: "Failed to save Telegram settings", variant: "destructive" }),
  });

  const killSwitchMutation = useMutation({
    mutationFn: async (status: "ACTIVATE" | "DEACTIVATE") => {
      const res = await fetch(`${BASE}api/risk/killswitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json() as KillSwitchStatus & { error?: string; code?: string };
      if (!res.ok) throw { message: json.error ?? "Failed", code: json.code };
      return json;
    },
    onSuccess: (data, status) => {
      setOptimisticKsActive(status === "ACTIVATE");
      setTimeout(() => {
        setOptimisticKsActive(null);
        void refetchKs();
      }, 2000);
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      toast({
        title: status === "ACTIVATE" ? "Kill Switch Activated" : "Kill Switch Deactivated",
        description: status === "ACTIVATE"
          ? `All Dhan order placement is now blocked. You have ${data.canDeactivateToday ? "1 reset available today" : "0 resets remaining today"}.`
          : "Trading resumed. Dhan kill switch is off.",
        variant: status === "ACTIVATE" ? "destructive" : "default",
      });
    },
    onError: (err: { message?: string; code?: string }) => {
      if (err.code === "DAILY_LIMIT_REACHED") {
        toast({
          title: "Daily Limit Reached",
          description: "You've used your 1 deactivation today. Kill switch will auto-reset at 8:30 AM IST tomorrow.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Kill switch error", description: err.message ?? "Failed", variant: "destructive" });
      }
    },
  });

  const pnlExitMutation = useMutation({
    mutationFn: async (values: z.infer<typeof pnlExitSchema>) => {
      const res = await fetch(`${BASE}api/risk/pnl-exit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profitValue: values.profitValue,
          lossValue: values.lossValue,
          productType: pnlProductTypes,
          enableKillSwitch: values.enableKillSwitch,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string; errorCode?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Request rejected by broker");
      }
      return res.json();
    },
    onSuccess: (_data, values) => {
      setPnlActive(true);
      toast({
        title: "P&L Exit Activated",
        description: `Dhan will exit positions at ₹${values.profitValue} profit or ₹${values.lossValue} loss.${values.enableKillSwitch ? " Kill switch will engage if triggered." : ""}`,
      });
    },
    onError: (err: Error) => toast({ title: "Failed to set P&L exit", description: err.message, variant: "destructive" }),
  });

  const stopPnlExitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/risk/pnl-exit`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setPnlActive(false);
      toast({ title: "P&L Exit Stopped", description: "Auto-exit rules disabled." });
    },
    onError: (err: Error) => toast({ title: "Failed to stop P&L exit", description: err.message, variant: "destructive" }),
  });

  const toggleProductType = (type: string) => {
    setPnlProductTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type],
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      {/* Row 1 — Broker Connection (full width) */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-destructive" />}
                Broker Connection
              </CardTitle>
              <CardDescription>
                {isConnected ? `Connected as ${maskedClientId}` : "Enter your Dhan credentials to enable live trading"}
              </CardDescription>
            </div>
            {connectResult?.success ? (
              <div className="flex flex-col items-end gap-2">
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Badge variant="outline" className="text-success border-success/30 bg-success/10 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Account Connected
                  </Badge>
                  <span className="font-mono text-xs text-muted-foreground flex items-center gap-1">
                    <User className="w-3 h-3" />{connectResult.dhanClientId ?? maskedClientId}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" disabled={refreshMutation.isPending} onClick={() => refreshMutation.mutate()}>
                    <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                    Refresh
                  </Button>
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="text-muted-foreground">Balance: <span className="font-semibold text-success">₹{(connectResult.availableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">Withdrawable: <span className="font-semibold">₹{(connectResult.withdrawableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">Used Margin: <span className="font-semibold">₹{(connectResult.utilizedAmount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                  <span className="text-muted-foreground">SOD Limit: <span className="font-semibold">₹{(connectResult.sodLimit ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                </div>
              </div>
            ) : (
              <Badge
                variant="outline"
                className={isConnected ? "text-success border-success/30 bg-success/10" : "text-destructive border-destructive/30 bg-destructive/10"}
              >
                {isConnected ? "Connected" : "Disconnected"}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Client ID</label>
                <Input placeholder="Enter your Client ID" {...brokerForm.register("clientId")} />
                {brokerForm.formState.errors.clientId && (
                  <p className="text-xs text-destructive">{brokerForm.formState.errors.clientId.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Access Token</label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    placeholder="Enter your Access Token"
                    className="pr-10"
                    autoComplete="current-password"
                    {...brokerForm.register("accessToken")}
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowToken(!showToken)}>
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {brokerForm.formState.errors.accessToken && (
                  <p className="text-xs text-destructive">{brokerForm.formState.errors.accessToken.message}</p>
                )}
              </div>
            </div>

            {connectResult && !connectResult.success && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Error: {connectResult.errorCode}</p>
                  <p className="text-xs opacity-80 mt-0.5">{connectResult.errorMessage}</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <Button type="submit" disabled={connectMutation.isPending} className="gap-2">
                <Wifi className="w-4 h-4" />
                {connectMutation.isPending ? "Connecting..." : "Save & Connect"}
              </Button>
              {isConnected && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  <LogOut className="w-4 h-4" />
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Row 2 — Risk Management + Telegram Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" />
              Risk Management
            </CardTitle>
            <CardDescription className="text-xs">Auto-reject orders when daily loss limit is hit</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Daily Loss Limit (₹)</label>
                <p className="text-xs text-muted-foreground">Orders blocked when today's total loss exceeds this</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={500}
                    placeholder="5000"
                    {...riskForm.register("maxDailyLoss")}
                  />
                  <Button type="submit" variant="outline" disabled={riskMutation.isPending}>
                    {riskMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
                {riskForm.formState.errors.maxDailyLoss && (
                  <p className="text-xs text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Telegram Alerts
            </CardTitle>
            <CardDescription className="text-xs">Create a bot via @BotFather · Get Chat ID via @userinfobot</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Bot Token</label>
                <div className="relative">
                  <Input
                    type={showBotToken ? "text" : "password"}
                    placeholder=""
                    className="pr-10"
                    autoComplete="off"
                    {...telegramForm.register("telegramBotToken")}
                  />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowBotToken(!showBotToken)}>
                    {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {telegramForm.formState.errors.telegramBotToken && (
                  <p className="text-xs text-destructive">{telegramForm.formState.errors.telegramBotToken.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Chat ID</label>
                <Input type="text" placeholder="" autoComplete="off" {...telegramForm.register("telegramChatId")} />
                {telegramForm.formState.errors.telegramChatId && (
                  <p className="text-xs text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Button type="submit" variant="outline" size="sm" className="gap-2" disabled={telegramMutation.isPending}>
                  <Bell className="w-3.5 h-3.5" />
                  {telegramMutation.isPending ? "Saving..." : "Save"}
                </Button>
                {settingsData?.telegramChatId && (
                  <span className="text-xs text-success">✓ Alerts active</span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — Kill Switch + P&L Based Exit */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className={killSwitchActive ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Power className={`w-4 h-4 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />
              Emergency Kill Switch
              {killSwitchActive && <Badge variant="destructive" className="text-[10px]">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Instantly block all Dhan order placement · 1 manual reset per day · Auto-resets 8:30 AM IST
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Connect your broker account first to use the kill switch.</span>
              </div>
            ) : (
              <>
                <div className={`rounded-md border px-3 py-2.5 text-sm ${killSwitchActive ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-muted bg-muted/20 text-muted-foreground"}`}>
                  {killSwitchActive
                    ? "⛔ Kill switch is ACTIVE on Dhan — all order placement blocked."
                    : "✅ Kill switch is inactive — trading is allowed normally."}
                </div>

                {ksStatus?.deactivationsUsed !== undefined && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {ksStatus.deactivationsUsed === 0
                        ? "1 manual reset available today"
                        : "Daily reset used — auto-resets at 8:30 AM IST tomorrow"}
                    </span>
                  </div>
                )}

                {!canDeactivate && killSwitchActive && (
                  <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-start gap-2">
                    <Calendar className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Daily deactivation limit reached. Kill switch will auto-reset at 8:30 AM IST tomorrow.</span>
                  </div>
                )}

                <div className="flex gap-2">
                  {killSwitchActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-2 ${canDeactivate ? "border-success/40 text-success hover:bg-success/10" : "opacity-50 cursor-not-allowed"}`}
                      disabled={killSwitchMutation.isPending || !canDeactivate}
                      onClick={() => canDeactivate && killSwitchMutation.mutate("DEACTIVATE")}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {killSwitchMutation.isPending ? "Deactivating..." : "Deactivate"}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-2"
                      disabled={killSwitchMutation.isPending}
                      onClick={() => killSwitchMutation.mutate("ACTIVATE")}
                    >
                      <Power className="w-3.5 h-3.5" />
                      {killSwitchMutation.isPending ? "Activating..." : "Activate Kill Switch"}
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              P&L Based Exit
              {pnlActive && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Dhan auto-exits positions when profit or loss threshold is reached · Resets daily
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Connect your broker account first to configure P&L exit.</span>
              </div>
            ) : (
              <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-success" />
                      Profit Target (₹)
                    </label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 1500" {...pnlForm.register("profitValue")} />
                    {pnlForm.formState.errors.profitValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.profitValue.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                      Loss Limit (₹)
                    </label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 500" {...pnlForm.register("lossValue")} />
                    {pnlForm.formState.errors.lossValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.lossValue.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Apply to</label>
                  <div className="flex items-center gap-6 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={pnlProductTypes.includes("INTRADAY")}
                        onCheckedChange={() => toggleProductType("INTRADAY")}
                      />
                      INTRADAY
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-sm">
                      <Checkbox
                        checked={pnlForm.watch("enableKillSwitch")}
                        onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)}
                      />
                      <span>Also activate kill switch when triggered</span>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    type="submit"
                    size="sm"
                    className="gap-2"
                    disabled={pnlExitMutation.isPending || !pnlProductTypes.length}
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    {pnlExitMutation.isPending ? "Activating..." : "Activate P&L Exit"}
                  </Button>
                  {pnlActive && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={stopPnlExitMutation.isPending}
                      onClick={() => stopPnlExitMutation.mutate()}
                    >
                      {stopPnlExitMutation.isPending ? "Stopping..." : "Stop P&L Exit"}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
