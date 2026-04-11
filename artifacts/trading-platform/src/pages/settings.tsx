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
  ShieldAlert, Bell, TrendingUp, TrendingDown, Power,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});

const riskSchema = z.object({
  maxDailyLoss: z.coerce.number().min(0, "Must be ≥ 0").optional(),
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
  killSwitchStatus?: "ACTIVATE" | "ACTIVATED" | "DEACTIVATE" | "INACTIVE";
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

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";

  const { data: ksStatus, refetch: refetchKs } = useQuery<KillSwitchStatus>({
    queryKey: ["killswitch-status"],
    queryFn: async () => {
      if (!isConnected) return {};
      const res = await fetch(`${BASE}api/risk/killswitch`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: isConnected,
    refetchInterval: 30000,
  });

  const killSwitchActive = ksStatus?.killSwitchStatus === "ACTIVATE" || ksStatus?.killSwitchStatus === "ACTIVATED";

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
    defaultValues: { profitValue: 1500, lossValue: 500, enableKillSwitch: false },
  });

  useEffect(() => {
    if (settingsData) {
      riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
      telegramForm.reset({
        telegramBotToken: settingsData.telegramBotToken ?? "",
        telegramChatId: settingsData.telegramChatId ?? "",
      });
    }
  }, [settingsData]);

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

  const updateSettingsMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`${BASE}api/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    },
  });

  const killSwitchMutation = useMutation({
    mutationFn: async (status: "ACTIVATE" | "DEACTIVATE") => {
      const res = await fetch(`${BASE}api/risk/killswitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: (_data, status) => {
      void refetchKs();
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      toast({
        title: status === "ACTIVATE" ? "Kill Switch Activated" : "Kill Switch Deactivated",
        description: status === "ACTIVATE" ? "All order placement is now blocked via Dhan." : "Trading resumed normally.",
        variant: status === "ACTIVATE" ? "destructive" : "default",
      });
    },
    onError: (err: Error) => toast({ title: "Kill switch error", description: err.message, variant: "destructive" }),
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
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setPnlActive(true);
      toast({ title: "P&L Exit Activated", description: "Dhan will auto-exit positions when thresholds are hit." });
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
      toast({ title: "P&L Exit Stopped", description: "Auto-exit rules have been disabled." });
    },
    onError: (err: Error) => toast({ title: "Failed to stop P&L exit", description: err.message, variant: "destructive" }),
  });

  const saveRisk = (values: z.infer<typeof riskSchema>) => {
    updateSettingsMutation.mutate({ maxDailyLoss: values.maxDailyLoss }, {
      onSuccess: () => toast({ title: "Risk settings saved" }),
      onError: () => toast({ title: "Failed to save", variant: "destructive" }),
    });
  };

  const saveTelegram = (values: z.infer<typeof telegramSchema>) => {
    updateSettingsMutation.mutate(
      { telegramBotToken: values.telegramBotToken, telegramChatId: values.telegramChatId },
      {
        onSuccess: () => toast({ title: "Telegram settings saved", description: "Alerts will now be sent to your bot." }),
        onError: () => toast({ title: "Failed to save", variant: "destructive" }),
      },
    );
  };

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
    <div className="space-y-4 max-w-5xl">
      {/* Row 1 — Broker Connection (full width) */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-destructive" />}
                Broker Connection
              </CardTitle>
              <CardDescription>
                {isConnected ? `Connected as ${maskedClientId}` : "Enter your Dhan credentials to enable live trading"}
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={isConnected ? "text-success border-success/30 bg-success/10" : "text-destructive border-destructive/30 bg-destructive/10"}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
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

            {connectResult?.success && (
              <div className="rounded-lg border border-success/30 bg-success/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-success/20 bg-success/10 flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold text-sm">Account Connected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3.5 h-3.5" />
                      <span className="font-mono font-medium">{connectResult.dhanClientId ?? "—"}</span>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground" disabled={refreshMutation.isPending} onClick={() => refreshMutation.mutate()}>
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border/50">
                  {[
                    { label: "Available Balance", value: connectResult.availableBalance, highlight: true },
                    { label: "Withdrawable", value: connectResult.withdrawableBalance },
                    { label: "Used Margin", value: connectResult.utilizedAmount },
                    { label: "SOD Limit", value: connectResult.sodLimit },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} className={`px-4 py-3 space-y-0.5 ${highlight ? "bg-success/5" : ""}`}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`text-sm font-semibold tabular-nums ${highlight ? "text-success" : ""}`}>
                        ₹{(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}
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

      {/* Row 2 — Risk Management + Telegram Alerts side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Risk Management */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" />
              Risk Management
            </CardTitle>
            <CardDescription className="text-xs">Auto-reject orders when daily loss limit is hit</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={riskForm.handleSubmit(saveRisk)} className="space-y-4">
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
                  <Button type="submit" variant="outline" disabled={updateSettingsMutation.isPending}>Save</Button>
                </div>
                {riskForm.formState.errors.maxDailyLoss && (
                  <p className="text-xs text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Telegram Alerts */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              Telegram Alerts
            </CardTitle>
            <CardDescription className="text-xs">Create a bot via @BotFather and get your Chat ID via @userinfobot</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={telegramForm.handleSubmit(saveTelegram)} className="space-y-4">
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
                <Input
                  type="text"
                  placeholder=""
                  autoComplete="off"
                  {...telegramForm.register("telegramChatId")}
                />
                {telegramForm.formState.errors.telegramChatId && (
                  <p className="text-xs text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Button type="submit" variant="outline" size="sm" className="gap-2" disabled={updateSettingsMutation.isPending}>
                  <Bell className="w-3.5 h-3.5" />
                  {updateSettingsMutation.isPending ? "Saving..." : "Save"}
                </Button>
                {settingsData?.telegramChatId && (
                  <span className="text-xs text-success">✓ Alerts active</span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — Kill Switch + P&L Based Exit side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kill Switch */}
        <Card className={killSwitchActive ? "border-destructive/40" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Power className={`w-4 h-4 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />
              Emergency Kill Switch
              {killSwitchActive && <Badge variant="destructive" className="text-[10px] ml-1">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Instantly block all order placement via Dhan broker
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>Connect your broker account first to use the kill switch.</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className={`rounded-md border p-3 text-sm ${killSwitchActive ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-muted bg-muted/20 text-muted-foreground"}`}>
                  {killSwitchActive
                    ? "⛔ Kill switch is ACTIVE — all orders are blocked on Dhan."
                    : "✅ Kill switch is inactive — trading is allowed normally."}
                </div>
                <div className="flex gap-2">
                  {killSwitchActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-success/40 text-success hover:bg-success/10"
                      disabled={killSwitchMutation.isPending}
                      onClick={() => killSwitchMutation.mutate("DEACTIVATE")}
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* P&L Based Exit */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              P&L Based Exit
              {pnlActive && <Badge variant="outline" className="text-[10px] ml-1 text-primary border-primary/30">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">
              Auto-exit all positions when profit or loss threshold is reached (resets daily)
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
                    <Input
                      type="number"
                      min={1}
                      step={100}
                      placeholder="1500"
                      {...pnlForm.register("profitValue")}
                    />
                    {pnlForm.formState.errors.profitValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.profitValue.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                      Loss Limit (₹)
                    </label>
                    <Input
                      type="number"
                      min={1}
                      step={100}
                      placeholder="500"
                      {...pnlForm.register("lossValue")}
                    />
                    {pnlForm.formState.errors.lossValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.lossValue.message}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Apply to</label>
                  <div className="flex gap-4">
                    {["INTRADAY", "DELIVERY"].map(type => (
                      <label key={type} className="flex items-center gap-2 cursor-pointer text-sm">
                        <Checkbox
                          checked={pnlProductTypes.includes(type)}
                          onCheckedChange={() => toggleProductType(type)}
                        />
                        {type}
                      </label>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <Checkbox
                    checked={pnlForm.watch("enableKillSwitch")}
                    onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)}
                  />
                  <span>Also activate kill switch when triggered</span>
                </label>

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
