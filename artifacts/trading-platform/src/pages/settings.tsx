import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut, RefreshCw, User,
  ShieldAlert, Bell, TrendingUp, TrendingDown, Power, Calendar,
  Clock, Ban, LayoutDashboard, Settings2, History, Lock, Smartphone,
  ChevronRight, Trash2, Plus, Save,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});

const riskSchema = z.object({
  maxDailyLoss: z.coerce.number().min(0, "Must be ≥ 0"),
});

const TELEGRAM_TOKEN_REGEX = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;

const telegramSchema = z.object({
  telegramBotToken: z
    .string().min(1, "Bot Token is required")
    .regex(TELEGRAM_TOKEN_REGEX, "Invalid format — like: 1234567890:ABCDefgh…"),
  telegramChatId: z
    .string().min(1, "Chat ID is required")
    .regex(TELEGRAM_CHAT_ID_REGEX, "Chat ID must be a number"),
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
interface ConnectResult extends FundDetails { success: boolean; errorCode?: string; errorMessage?: string }
interface SettingsData {
  id: number; dhanClientId: string; apiConnected: boolean;
  maxDailyLoss: number | null; killSwitchEnabled: boolean;
  telegramBotToken: string; telegramChatId: string; updatedAt: string;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  maxTradesPerDay: number | null;
  maxPositionSizeValue: number | null; maxPositionSizeType: string;
  instrumentBlacklist: string[];
  notificationPreferences: Record<string, boolean>;
  pushNotificationsEnabled: boolean;
  defaultProductType: string; defaultOrderType: string; defaultQuantity: number | null;
  dashboardWidgets: Record<string, boolean>;
  refreshIntervalSeconds: number;
  tradingHoursStart: string; tradingHoursEnd: string;
  hasKillSwitchPin: boolean;
}
interface KillSwitchStatus { killSwitchStatus?: string; isActive?: boolean; canDeactivateToday?: boolean; deactivationsUsed?: number }
interface PnlExitStatus { pnlExitStatus?: string; profit?: string; loss?: string; productType?: string[]; enable_kill_switch?: boolean }
interface AuditEntry { id: number; action: string; field: string | null; oldValue: string | null; newValue: string | null; description: string | null; changedAt: string }

function TokenExpiryWarning() {
  const [info, setInfo] = useState<{ hasToken: boolean; tokenUpdatedAt?: string } | null>(null);
  useEffect(() => { fetch(`${BASE}api/broker/token-info`).then(r => r.json()).then(setInfo).catch(() => {}); }, []);
  if (!info?.hasToken || !info.tokenUpdatedAt) return null;
  const expiresAt = new Date(new Date(info.tokenUpdatedAt).getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 4) return null;
  return (
    <div className="mb-4 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3">
      <p className="text-xs text-amber-400">⚠️ Token expires in ~{Math.max(0, Math.floor(hoursLeft))}h {Math.floor((hoursLeft % 1) * 60)}m. Renew now to avoid disruption.</p>
      <button className="text-xs text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded hover:bg-amber-500/20 transition-colors"
        onClick={async () => { const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" }); const d = await res.json(); if (d.success) alert("Token renewed!"); else alert("Renewal failed. Generate a new token from Dhan web."); }}>
        Renew Token
      </button>
    </div>
  );
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
  const [pnlLoaded, setPnlLoaded] = useState(false);

  const [blacklistInput, setBlacklistInput] = useState("");
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    orderFilled: true, targetHit: true, stopLossHit: true, killSwitchTriggered: true,
    tokenExpiry: true, strategyPausedActivated: true, dailyPnlSummary: false, autoSquareOff: true,
  });
  const [dashWidgets, setDashWidgets] = useState<Record<string, boolean>>({
    todayPnl: true, totalPnl: true, availableBalance: true, activeStrategies: true, equityCurve: true,
  });
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [autoSquareOffEnabled, setAutoSquareOffEnabled] = useState(false);
  const [autoSquareOffTime, setAutoSquareOffTime] = useState("15:14");
  const [maxTradesPerDay, setMaxTradesPerDay] = useState<string>("");
  const [maxPosValue, setMaxPosValue] = useState<string>("");
  const [maxPosType, setMaxPosType] = useState<string>("FIXED");
  const [tradingStart, setTradingStart] = useState("09:00");
  const [tradingEnd, setTradingEnd] = useState("15:30");
  const [defaultProductType, setDefaultProductType] = useState("INTRA");
  const [defaultOrderType, setDefaultOrderType] = useState("MARKET");
  const [defaultQuantity, setDefaultQuantity] = useState<string>("");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinDialogFor, setPinDialogFor] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState("");
  const [pushEnabled, setPushEnabled] = useState(false);

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";

  useEffect(() => {
    if (!settingsData) return;
    setBlacklist(settingsData.instrumentBlacklist ?? []);
    setNotifPrefs(settingsData.notificationPreferences ?? notifPrefs);
    setDashWidgets(settingsData.dashboardWidgets ?? dashWidgets);
    setRefreshInterval(settingsData.refreshIntervalSeconds ?? 15);
    setAutoSquareOffEnabled(settingsData.autoSquareOffEnabled ?? false);
    setAutoSquareOffTime(settingsData.autoSquareOffTime ?? "15:14");
    setMaxTradesPerDay(settingsData.maxTradesPerDay != null ? String(settingsData.maxTradesPerDay) : "");
    setMaxPosValue(settingsData.maxPositionSizeValue != null ? String(settingsData.maxPositionSizeValue) : "");
    setMaxPosType(settingsData.maxPositionSizeType ?? "FIXED");
    setTradingStart(settingsData.tradingHoursStart ?? "09:00");
    setTradingEnd(settingsData.tradingHoursEnd ?? "15:30");
    setDefaultProductType(settingsData.defaultProductType ?? "INTRA");
    setDefaultOrderType(settingsData.defaultOrderType ?? "MARKET");
    setDefaultQuantity(settingsData.defaultQuantity != null ? String(settingsData.defaultQuantity) : "");
    setPushEnabled(settingsData.pushNotificationsEnabled ?? false);
  }, [settingsData?.id]);

  const { data: brokerStatus, refetch: refetchBrokerStatus } = useQuery<FundDetails & { connected: boolean }>({
    queryKey: ["broker-status"], enabled: isConnected, refetchInterval: 30000, staleTime: 0, gcTime: 0,
    queryFn: async () => { const r = await fetch(`${BASE}api/broker/status`); if (!r.ok) return { connected: false }; return r.json(); },
  });
  const { data: ksStatus, refetch: refetchKs } = useQuery<KillSwitchStatus>({
    queryKey: ["killswitch-status"], enabled: isConnected, refetchInterval: 15000, staleTime: 0, gcTime: 0,
    queryFn: async () => { if (!isConnected) return {}; const r = await fetch(`${BASE}api/risk/killswitch`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }); if (!r.ok) return {}; return r.json(); },
  });
  const killSwitchActive = optimisticKsActive !== null ? optimisticKsActive
    : (ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE" || ksStatus?.killSwitchStatus === "ACTIVATE");
  const canDeactivate = ksStatus?.canDeactivateToday !== false;

  const { data: pnlStatus, refetch: refetchPnl } = useQuery<PnlExitStatus>({
    queryKey: ["pnl-exit-status"], enabled: isConnected, staleTime: 0, gcTime: 0,
    queryFn: async () => { if (!isConnected) return {}; const r = await fetch(`${BASE}api/risk/pnl-exit`, { cache: "no-store" }); if (!r.ok) return {}; return r.json(); },
  });
  const { data: auditLogs } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log"], refetchInterval: 30000,
    queryFn: async () => { const r = await fetch(`${BASE}api/settings/audit-log`); if (!r.ok) return []; return r.json(); },
  });

  const brokerForm = useForm<z.infer<typeof brokerSchema>>({ resolver: zodResolver(brokerSchema), defaultValues: { clientId: "", accessToken: "" } });
  const riskForm = useForm<z.infer<typeof riskSchema>>({ resolver: zodResolver(riskSchema), defaultValues: { maxDailyLoss: 5000 } });
  const telegramForm = useForm<z.infer<typeof telegramSchema>>({ resolver: zodResolver(telegramSchema), defaultValues: { telegramBotToken: "", telegramChatId: "" } });
  const pnlForm = useForm<z.infer<typeof pnlExitSchema>>({ resolver: zodResolver(pnlExitSchema), defaultValues: { profitValue: undefined, lossValue: undefined, enableKillSwitch: false } });

  useEffect(() => {
    if (settingsData) {
      riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
      telegramForm.reset({ telegramBotToken: settingsData.telegramBotToken ?? "", telegramChatId: settingsData.telegramChatId ?? "" });
    }
  }, [settingsData?.id]);

  useEffect(() => {
    if (pnlStatus && !pnlLoaded) {
      const isActive = pnlStatus.pnlExitStatus === "ACTIVE";
      setPnlActive(isActive);
      if (isActive) {
        if (pnlStatus.productType?.length) setPnlProductTypes(pnlStatus.productType);
        pnlForm.reset({ profitValue: pnlStatus.profit ? Number(pnlStatus.profit) : undefined, lossValue: pnlStatus.loss ? Number(pnlStatus.loss) : undefined, enableKillSwitch: pnlStatus.enable_kill_switch ?? false });
      }
      setPnlLoaded(true);
    }
  }, [pnlStatus]);

  async function saveSettings(data: Record<string, unknown>) {
    const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  }

  const connectMutation = useMutation({
    mutationFn: async (data: z.infer<typeof brokerSchema>) => {
      const res = await fetch(`${BASE}api/broker/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error("Request failed");
      return res.json() as Promise<ConnectResult>;
    },
    onSuccess: (result) => {
      setConnectResult(result);
      if (result.success) {
        toast({ title: "Broker connected", description: `Available: ₹${result.availableBalance?.toLocaleString("en-IN")}` });
        queryClient.invalidateQueries({ queryKey: ["healthz"] });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
        queryClient.invalidateQueries({ queryKey: ["killswitch-status"] });
        queryClient.invalidateQueries({ queryKey: ["broker-status"] });
      } else {
        toast({ title: `Connection failed: ${result.errorCode}`, description: result.errorMessage, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Network error", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => { const r = await fetch(`${BASE}api/broker/disconnect`, { method: "POST" }); if (!r.ok) throw new Error("Failed"); return r.json(); },
    onSuccess: () => {
      setConnectResult(null); brokerForm.reset({ clientId: "", accessToken: "" });
      toast({ title: "Disconnected from broker" });
      queryClient.invalidateQueries({ queryKey: ["healthz"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
  });

  const refreshMutation = useMutation({
    mutationFn: async () => { const r = await fetch(`${BASE}api/broker/status`); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<FundDetails & { connected: boolean }>; },
    onSuccess: (data) => { if (data.connected) { setConnectResult(prev => prev ? { ...prev, ...data, success: true } : null); toast({ title: "Balance refreshed" }); } },
    onError: () => toast({ title: "Failed to refresh balance", variant: "destructive" }),
  });

  const riskMutation = useMutation({
    mutationFn: (maxDailyLoss: number) => saveSettings({ maxDailyLoss }),
    onSuccess: () => { toast({ title: "Daily loss limit saved" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const telegramMutation = useMutation({
    mutationFn: (data: { telegramBotToken: string; telegramChatId: string }) => saveSettings(data),
    onSuccess: () => { toast({ title: "Telegram settings saved" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to save Telegram settings", variant: "destructive" }),
  });

  const telegramResetMutation = useMutation({
    mutationFn: () => saveSettings({ telegramBotToken: null, telegramChatId: null }),
    onSuccess: () => { telegramForm.reset({ telegramBotToken: "", telegramChatId: "" }); toast({ title: "Telegram credentials removed" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to reset", variant: "destructive" }),
  });

  const killSwitchMutation = useMutation({
    mutationFn: async (status: "ACTIVATE" | "DEACTIVATE") => {
      const res = await fetch(`${BASE}api/risk/killswitch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const json = await res.json() as KillSwitchStatus & { error?: string; code?: string };
      if (!res.ok) throw { message: json.error ?? "Failed", code: (json as Record<string, unknown>).code };
      return json;
    },
    onSuccess: (data, status) => {
      setOptimisticKsActive(status === "ACTIVATE");
      setTimeout(() => { setOptimisticKsActive(null); void refetchKs(); }, 2000);
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      toast({ title: status === "ACTIVATE" ? "Kill Switch Activated" : "Kill Switch Deactivated", variant: status === "ACTIVATE" ? "destructive" : "default", description: status === "ACTIVATE" ? `All order placement blocked. ${data.canDeactivateToday ? "1 reset available today." : "0 resets today."}` : "Trading resumed." });
    },
    onError: (err: { message?: string; code?: string }) => {
      if (err.code === "DAILY_LIMIT_REACHED") toast({ title: "Daily Limit Reached", description: "Auto-resets at 8:30 AM IST tomorrow.", variant: "destructive" });
      else toast({ title: "Kill switch error", description: err.message ?? "Failed", variant: "destructive" });
    },
  });

  const pnlExitMutation = useMutation({
    mutationFn: async (values: z.infer<typeof pnlExitSchema>) => {
      const res = await fetch(`${BASE}api/risk/pnl-exit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profitValue: values.profitValue, lossValue: values.lossValue, productType: pnlProductTypes, enableKillSwitch: values.enableKillSwitch }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string }; throw new Error(err.errorMessage ?? err.error ?? "Request rejected by broker"); }
      return res.json();
    },
    onSuccess: (_data, values) => { setPnlActive(true); void refetchPnl(); toast({ title: "P&L Exit Activated", description: `Exit at ₹${values.profitValue} profit or ₹${values.lossValue} loss.` }); },
    onError: (err: Error) => toast({ title: "Failed to set P&L exit", description: err.message, variant: "destructive" }),
  });

  const stopPnlExitMutation = useMutation({
    mutationFn: async () => { const r = await fetch(`${BASE}api/risk/pnl-exit`, { method: "DELETE" }); if (!r.ok) throw new Error("Failed"); return r.json(); },
    onSuccess: () => { setPnlActive(false); setPnlLoaded(false); void refetchPnl(); toast({ title: "P&L Exit Stopped" }); },
    onError: (err: Error) => toast({ title: "Failed to stop P&L exit", description: err.message, variant: "destructive" }),
  });

  const genericSaveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); queryClient.invalidateQueries({ queryKey: ["audit-log"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  function handleKillSwitchAction(status: "ACTIVATE" | "DEACTIVATE") {
    if (settingsData?.hasKillSwitchPin) {
      setPinDialogFor(status);
    } else {
      killSwitchMutation.mutate(status);
    }
  }

  async function verifyPinAndProceed() {
    if (!pinDialogFor) return;
    const res = await fetch(`${BASE}api/settings/verify-pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinVerifyInput }) });
    const data = await res.json() as { valid: boolean; error?: string };
    if (data.valid) {
      killSwitchMutation.mutate(pinDialogFor as "ACTIVATE" | "DEACTIVATE");
      setPinDialogFor(null);
      setPinVerifyInput("");
    } else {
      toast({ title: "Incorrect PIN", description: "Kill switch action blocked", variant: "destructive" });
    }
  }

  async function requestPushPermission() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast({ title: "Push notifications not supported", description: "Your browser does not support push notifications", variant: "destructive" });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushEnabled(true);
      void genericSaveMutation.mutateAsync({ pushNotificationsEnabled: true });
      toast({ title: "Push notifications enabled", description: "You'll receive browser alerts even when the tab is in background" });
    } else {
      toast({ title: "Permission denied", description: "Enable notifications in your browser settings", variant: "destructive" });
    }
  }

  function sendTestPushNotification() {
    if (!("Notification" in window) || Notification.permission !== "granted") { toast({ title: "Notifications not enabled" }); return; }
    new Notification("Rajesh Algo Test", { body: "Browser push notifications are working!", icon: "/favicon.ico" });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">
      <TokenExpiryWarning />

      {/* PIN Verification Dialog */}
      {pinDialogFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl p-6 w-80 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-warning" />
              <h3 className="font-semibold">Kill Switch PIN Required</h3>
            </div>
            <p className="text-xs text-muted-foreground">Enter your 4-digit PIN to {pinDialogFor === "ACTIVATE" ? "activate" : "deactivate"} the kill switch.</p>
            <Input type="password" placeholder="••••" maxLength={4} value={pinVerifyInput} onChange={e => setPinVerifyInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void verifyPinAndProceed(); }} className="text-center text-xl tracking-widest font-mono" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setPinDialogFor(null); setPinVerifyInput(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1" onClick={() => void verifyPinAndProceed()} disabled={pinVerifyInput.length < 4}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Row 1 — Broker Connection ── */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {isConnected ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-destructive" />}
                Broker Connection
              </CardTitle>
              <CardDescription>{isConnected ? `Connected as ${maskedClientId}` : "Enter your Dhan credentials to enable live trading"}</CardDescription>
            </div>
            {isConnected ? (() => {
              const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});
              return (
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <Badge variant="outline" className="text-success border-success/30 bg-success/10 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Account Connected</Badge>
                    <span className="font-mono text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{funds.dhanClientId ?? maskedClientId}</span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-muted-foreground" disabled={refreshMutation.isPending} onClick={() => { refreshMutation.mutate(); void refetchBrokerStatus(); }}>
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} /> Refresh
                    </Button>
                  </div>
                  {funds.availableBalance !== undefined && (
                    <div className="flex gap-4 text-xs flex-wrap justify-end">
                      <span className="text-muted-foreground">Balance: <span className="font-semibold text-success">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                      <span className="text-muted-foreground">Withdrawable: <span className="font-semibold">₹{(funds.withdrawableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                      <span className="text-muted-foreground">Used Margin: <span className="font-semibold">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
                    </div>
                  )}
                </div>
              );
            })() : <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10">Disconnected</Badge>}
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Client ID</label>
                <Input placeholder="Enter your Client ID" {...brokerForm.register("clientId")} />
                {brokerForm.formState.errors.clientId && <p className="text-xs text-destructive">{brokerForm.formState.errors.clientId.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Access Token</label>
                <div className="relative">
                  <Input type={showToken ? "text" : "password"} placeholder="Enter your Access Token" className="pr-10" autoComplete="current-password" {...brokerForm.register("accessToken")} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowToken(!showToken)}>
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {brokerForm.formState.errors.accessToken && <p className="text-xs text-destructive">{brokerForm.formState.errors.accessToken.message}</p>}
              </div>
            </div>
            {connectResult && !connectResult.success && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div><p className="font-medium">Error: {connectResult.errorCode}</p><p className="text-xs opacity-80">{connectResult.errorMessage}</p></div>
              </div>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              <Button type="submit" disabled={connectMutation.isPending} className="gap-2">
                <Wifi className="w-4 h-4" />
                {connectMutation.isPending ? "Connecting..." : "Save & Connect"}
              </Button>
              {isConnected && (
                <Button type="button" variant="outline" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
                  <LogOut className="w-4 h-4" />
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* ── Row 2 — Risk Management + Telegram ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-warning" />Risk Management</CardTitle>
            <CardDescription className="text-xs">Auto-reject orders when daily loss limit is hit</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Daily Loss Limit (₹)</label>
                <p className="text-xs text-muted-foreground">Orders blocked when today's total loss exceeds this</p>
                <div className="flex gap-2">
                  <Input type="number" min={0} step={500} placeholder="5000" {...riskForm.register("maxDailyLoss")} />
                  <Button type="submit" variant="outline" disabled={riskMutation.isPending}>{riskMutation.isPending ? "Saving..." : "Save"}</Button>
                </div>
                {riskForm.formState.errors.maxDailyLoss && <p className="text-xs text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />Telegram Alerts</CardTitle>
            <CardDescription className="text-xs">Receive trade alerts on Telegram</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Bot Token</label>
                <div className="relative">
                  <Input type={showBotToken ? "text" : "password"} className="pr-10 font-mono text-xs" autoComplete="off" {...telegramForm.register("telegramBotToken")} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowBotToken(!showBotToken)}>
                    {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {telegramForm.formState.errors.telegramBotToken && <p className="text-xs text-destructive">{telegramForm.formState.errors.telegramBotToken.message}</p>}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Chat ID</label>
                <Input type="text" autoComplete="off" className="font-mono text-xs" {...telegramForm.register("telegramChatId")} />
                {telegramForm.formState.errors.telegramChatId && <p className="text-xs text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button type="submit" size="sm" className="gap-2" disabled={telegramMutation.isPending}><Bell className="w-3.5 h-3.5" />{telegramMutation.isPending ? "Saving..." : "Save Credentials"}</Button>
                {(settingsData?.telegramBotToken || settingsData?.telegramChatId) && (
                  <Button type="button" variant="outline" size="sm" className="gap-2 text-destructive border-destructive/30" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                    <XCircle className="w-3.5 h-3.5" />{telegramResetMutation.isPending ? "Removing..." : "Reset"}
                  </Button>
                )}
                {settingsData?.telegramChatId && <span className="text-xs text-success ml-auto">✓ Alerts active</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3 — Kill Switch + P&L Exit ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className={killSwitchActive ? "border-destructive/50 bg-destructive/5" : ""}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Power className={`w-4 h-4 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />
              Emergency Kill Switch
              {killSwitchActive && <Badge variant="destructive" className="text-[10px]">ACTIVE</Badge>}
              {settingsData?.hasKillSwitchPin && <Badge variant="outline" className="text-[10px] text-warning border-warning/40 gap-1"><Lock className="w-2.5 h-2.5" />PIN Protected</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">Instantly block all order placement · 1 reset/day · Auto-resets 8:30 AM IST</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>Connect broker first.</span>
              </div>
            ) : (
              <>
                <div className={`rounded-md border px-3 py-2.5 text-sm ${killSwitchActive ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-muted bg-muted/20 text-muted-foreground"}`}>
                  {killSwitchActive ? "⛔ Kill switch ACTIVE — all order placement blocked." : "✅ Kill switch inactive — trading allowed normally."}
                </div>
                {ksStatus?.deactivationsUsed !== undefined && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{ksStatus.deactivationsUsed === 0 ? "1 manual reset available today" : "Daily reset used — auto-resets at 8:30 AM IST"}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  {killSwitchActive ? (
                    <Button variant="outline" size="sm" className={`gap-2 ${canDeactivate ? "border-success/40 text-success hover:bg-success/10" : "opacity-50"}`} disabled={killSwitchMutation.isPending || !canDeactivate} onClick={() => canDeactivate && handleKillSwitchAction("DEACTIVATE")}>
                      <Power className="w-3.5 h-3.5" />{killSwitchMutation.isPending ? "Deactivating..." : "Deactivate"}
                    </Button>
                  ) : (
                    <Button variant="destructive" size="sm" className="gap-2" disabled={killSwitchMutation.isPending} onClick={() => handleKillSwitchAction("ACTIVATE")}>
                      <Power className="w-3.5 h-3.5" />{killSwitchMutation.isPending ? "Activating..." : "Activate Kill Switch"}
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
              <TrendingUp className="w-4 h-4 text-primary" />P&L Based Exit
              {pnlActive && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">Auto-exit positions at profit/loss threshold · Resets daily</CardDescription>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2"><WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>Connect broker first.</span></div>
            ) : (
              <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5 text-success" />Profit Target (₹)</label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 1500" {...pnlForm.register("profitValue")} />
                    {pnlForm.formState.errors.profitValue && <p className="text-xs text-destructive">{pnlForm.formState.errors.profitValue.message}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5 text-destructive" />Loss Limit (₹)</label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 500" {...pnlForm.register("lossValue")} />
                    {pnlForm.formState.errors.lossValue && <p className="text-xs text-destructive">{pnlForm.formState.errors.lossValue.message}</p>}
                  </div>
                </div>
                {pnlActive && pnlStatus?.pnlExitStatus === "ACTIVE" && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1">
                    <p className="font-semibold text-primary">Currently Active on Dhan</p>
                    <div className="flex gap-4 text-muted-foreground flex-wrap">
                      <span>Profit: <span className="text-success font-medium">₹{pnlStatus.profit}</span></span>
                      <span>Loss: <span className="text-destructive font-medium">₹{pnlStatus.loss}</span></span>
                      <span>Kill Switch: <span className="font-medium">{pnlStatus.enable_kill_switch ? "Yes" : "No"}</span></span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-6 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={pnlProductTypes.includes("INTRADAY")} onCheckedChange={() => setPnlProductTypes(prev => prev.includes("INTRADAY") ? prev.filter(t => t !== "INTRADAY") : [...prev, "INTRADAY"])} />
                    INTRADAY
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={pnlForm.watch("enableKillSwitch")} onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)} />
                    Also activate kill switch
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button type="submit" size="sm" className="gap-2" disabled={pnlExitMutation.isPending || !pnlProductTypes.length}>
                    <TrendingUp className="w-3.5 h-3.5" />{pnlExitMutation.isPending ? "Activating..." : pnlActive ? "Update P&L Exit" : "Activate P&L Exit"}
                  </Button>
                  {pnlActive && (
                    <Button type="button" variant="outline" size="sm" className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={stopPnlExitMutation.isPending} onClick={() => stopPnlExitMutation.mutate()}>
                      {stopPnlExitMutation.isPending ? "Stopping..." : "Stop P&L Exit"}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 4 — Auto Square-Off + Trading Guards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-primary" />Auto Square-Off Timer</CardTitle>
            <CardDescription className="text-xs">Auto-exit all intraday positions at the set time · Runs Mon–Fri only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable Auto Square-Off</p>
                <p className="text-xs text-muted-foreground">Automatically squares off all open intraday positions</p>
              </div>
              <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Square-Off Time (IST)</label>
              <p className="text-xs text-muted-foreground">Default: 3:14 PM — set slightly before 3:15 PM to avoid last-minute congestion</p>
              <input
                type="time"
                value={autoSquareOffTime}
                onChange={e => setAutoSquareOffTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button size="sm" className="gap-2 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() => toast({ title: autoSquareOffEnabled ? `Auto square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })); }}>
              <Save className="w-3.5 h-3.5" />Save Auto Square-Off
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-warning" />Trading Guards</CardTitle>
            <CardDescription className="text-xs">Caps on trades per day, position size, and trading hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Max Trades Per Day</label>
              <p className="text-xs text-muted-foreground">Block new orders after this many trades. Leave empty to disable.</p>
              <Input type="number" min={1} step={1} placeholder="e.g. 10" value={maxTradesPerDay} onChange={e => setMaxTradesPerDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Max Position Size</label>
              <div className="flex gap-2">
                <Input type="number" min={1} placeholder="Value" value={maxPosValue} onChange={e => setMaxPosValue(e.target.value)} />
                <Select value={maxPosType} onValueChange={setMaxPosType}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">₹ Fixed</SelectItem>
                    <SelectItem value="PERCENT">% Capital</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">{maxPosType === "FIXED" ? "Block orders where value exceeds ₹" : "Block orders exceeding % of available capital"}{maxPosValue ? ` ${maxPosValue}${maxPosType === "PERCENT" ? "%" : ""}` : ""}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Trading Hours Override</label>
              <div className="flex items-center gap-2">
                <input type="time" value={tradingStart} onChange={e => setTradingStart(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                <span className="text-muted-foreground text-sm">to</span>
                <input type="time" value={tradingEnd} onChange={e => setTradingEnd(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              </div>
              <p className="text-xs text-muted-foreground">Strategies will only place orders within these hours (IST)</p>
            </div>
            <Button size="sm" className="gap-2 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ maxTradesPerDay: maxTradesPerDay ? Number(maxTradesPerDay) : null, maxPositionSizeValue: maxPosValue ? Number(maxPosValue) : null, maxPositionSizeType: maxPosType, tradingHoursStart: tradingStart, tradingHoursEnd: tradingEnd }).then(() => toast({ title: "Trading guards saved" })); }}>
              <Save className="w-3.5 h-3.5" />Save Guards
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 5 — Instrument Blacklist + Notification Preferences ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Ban className="w-4 h-4 text-destructive" />Instrument Blacklist</CardTitle>
            <CardDescription className="text-xs">Orders for these symbols will always be blocked regardless of strategy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="e.g. ADANIENT, RELIANCE" value={blacklistInput} onChange={e => setBlacklistInput(e.target.value)} onKeyDown={e => {
                if (e.key === "Enter" && blacklistInput.trim()) {
                  const sym = blacklistInput.trim().toUpperCase();
                  if (!blacklist.includes(sym)) setBlacklist(prev => [...prev, sym]);
                  setBlacklistInput("");
                }
              }} />
              <Button type="button" size="sm" variant="outline" className="gap-1 shrink-0" onClick={() => {
                const sym = blacklistInput.trim().toUpperCase();
                if (sym && !blacklist.includes(sym)) { setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); }
              }}><Plus className="w-3.5 h-3.5" />Add</Button>
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[40px]">
              {blacklist.length === 0 && <span className="text-xs text-muted-foreground">No symbols blacklisted</span>}
              {blacklist.map(sym => (
                <span key={sym} className="inline-flex items-center gap-1 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded px-2 py-0.5 font-mono">
                  {sym}
                  <button onClick={() => setBlacklist(prev => prev.filter(s => s !== sym))} className="hover:text-destructive/60 transition-colors"><XCircle className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
            <Button size="sm" className="gap-2 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ instrumentBlacklist: blacklist }).then(() => toast({ title: `Blacklist saved — ${blacklist.length} symbol(s)` })); }}>
              <Save className="w-3.5 h-3.5" />Save Blacklist
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4 text-primary" />Notification Preferences</CardTitle>
            <CardDescription className="text-xs">Choose which events fire Telegram alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "orderFilled", label: "Order Filled", desc: "When an order is fully executed" },
              { key: "targetHit", label: "Target Hit", desc: "When profit target is reached" },
              { key: "stopLossHit", label: "Stop Loss Hit", desc: "When stop loss is triggered" },
              { key: "killSwitchTriggered", label: "Kill Switch Triggered", desc: "Emergency halt events" },
              { key: "tokenExpiry", label: "Token About to Expire", desc: "4 hours before expiry" },
              { key: "strategyPausedActivated", label: "Strategy Paused / Activated", desc: "Strategy state changes" },
              { key: "autoSquareOff", label: "Auto Square-Off Executed", desc: "When positions auto-squared off" },
              { key: "dailyPnlSummary", label: "Daily P&L Summary", desc: "End-of-day summary (if implemented)" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch checked={notifPrefs[item.key] ?? false} onCheckedChange={val => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
              </div>
            ))}
            <Button size="sm" className="gap-2 w-full mt-2" onClick={() => { void genericSaveMutation.mutateAsync({ notificationPreferences: notifPrefs }).then(() => toast({ title: "Notification preferences saved" })); }}>
              <Save className="w-3.5 h-3.5" />Save Preferences
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 6 — Trading Defaults + Browser Push ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" />Trading Defaults</CardTitle>
            <CardDescription className="text-xs">Pre-fill values across Super Orders, Forever Orders, and Conditional Triggers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Default Product Type</label>
              <Select value={defaultProductType} onValueChange={setDefaultProductType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTRA">INTRADAY</SelectItem>
                  <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                  <SelectItem value="MARGIN">MARGIN</SelectItem>
                  <SelectItem value="MTF">MTF</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Default Order Type</label>
              <Select value={defaultOrderType} onValueChange={setDefaultOrderType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MARKET">MARKET</SelectItem>
                  <SelectItem value="LIMIT">LIMIT</SelectItem>
                  <SelectItem value="SL">STOP LOSS (SL)</SelectItem>
                  <SelectItem value="SLM">STOP LOSS MARKET (SLM)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Default Quantity / Lot Size</label>
              <p className="text-xs text-muted-foreground">Pre-fills the quantity field when creating new orders</p>
              <Input type="number" min={1} step={1} placeholder="e.g. 1" value={defaultQuantity} onChange={e => setDefaultQuantity(e.target.value)} />
            </div>
            <Button size="sm" className="gap-2 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ defaultProductType, defaultOrderType, defaultQuantity: defaultQuantity ? Number(defaultQuantity) : null }).then(() => toast({ title: "Trading defaults saved" })); }}>
              <Save className="w-3.5 h-3.5" />Save Defaults
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Smartphone className="w-4 h-4 text-primary" />Browser Push Notifications</CardTitle>
            <CardDescription className="text-xs">Receive alerts even when the browser tab is in the background or minimised</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`rounded-md border px-3 py-2.5 text-sm flex items-center gap-2 ${pushEnabled && "Notification" in window && Notification.permission === "granted" ? "border-success/30 bg-success/10 text-success" : "border-muted bg-muted/20 text-muted-foreground"}`}>
              {pushEnabled && "Notification" in window && Notification.permission === "granted" ? "✅ Browser push notifications are enabled" : "🔕 Browser push notifications are disabled"}
            </div>
            <p className="text-xs text-muted-foreground">Click the button below and accept the browser permission prompt. Notifications appear even when the app is not in focus.</p>
            <div className="flex gap-2">
              <Button size="sm" className="gap-2 flex-1" onClick={() => void requestPushPermission()} disabled={pushEnabled && "Notification" in window && Notification.permission === "granted"}>
                <Bell className="w-3.5 h-3.5" />Enable Push Alerts
              </Button>
              {pushEnabled && (
                <Button size="sm" variant="outline" className="gap-2" onClick={sendTestPushNotification}>
                  Test Notification
                </Button>
              )}
            </div>
            {!("Notification" in window) && <p className="text-xs text-destructive">Your browser does not support push notifications.</p>}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 7 — Dashboard Widgets + Kill Switch PIN ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><LayoutDashboard className="w-4 h-4 text-primary" />Dashboard Widgets</CardTitle>
            <CardDescription className="text-xs">Show or hide cards on the Dashboard page</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "todayPnl", label: "Today's P&L" },
              { key: "totalPnl", label: "Total P&L (30D Net)" },
              { key: "availableBalance", label: "Available Balance" },
              { key: "activeStrategies", label: "Active Strategies & Win Rate" },
              { key: "equityCurve", label: "Equity Curve Chart" },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="text-sm">{item.label}</span>
                <Switch checked={dashWidgets[item.key] ?? true} onCheckedChange={val => setDashWidgets(prev => ({ ...prev, [item.key]: val }))} />
              </div>
            ))}
            <Button size="sm" className="gap-2 w-full mt-2" onClick={() => { void genericSaveMutation.mutateAsync({ dashboardWidgets: dashWidgets }).then(() => { toast({ title: "Dashboard widgets saved" }); queryClient.invalidateQueries({ queryKey: ["dashboard-widgets"] }); }); }}>
              <Save className="w-3.5 h-3.5" />Save Widget Visibility
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><RefreshCw className="w-4 h-4 text-primary" />Refresh Interval</CardTitle>
              <CardDescription className="text-xs">How often positions and balance auto-refresh in the background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={String(refreshInterval)} onValueChange={v => setRefreshInterval(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">Every 5 seconds</SelectItem>
                  <SelectItem value="10">Every 10 seconds</SelectItem>
                  <SelectItem value="15">Every 15 seconds (default)</SelectItem>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every 60 seconds</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" className="gap-2 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ refreshIntervalSeconds: refreshInterval }).then(() => toast({ title: `Refresh interval set to ${refreshInterval}s` })); }}>
                <Save className="w-3.5 h-3.5" />Save Interval
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Lock className="w-4 h-4 text-warning" />Kill Switch PIN</CardTitle>
              <CardDescription className="text-xs">Require a 4-digit PIN to activate or deactivate the kill switch</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {settingsData?.hasKillSwitchPin && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5" />PIN is currently set. Enter a new PIN to change it.
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">New PIN (4 digits)</label>
                <div className="relative">
                  <Input type={showPin ? "text" : "password"} placeholder="••••" maxLength={4} className="text-center tracking-widest font-mono pr-10" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Confirm PIN</label>
                <Input type="password" placeholder="••••" maxLength={4} className="text-center tracking-widest font-mono" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                {pinInput && pinConfirm && pinInput !== pinConfirm && <p className="text-xs text-destructive">PINs do not match</p>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="gap-2 flex-1" disabled={pinInput.length !== 4 || pinInput !== pinConfirm} onClick={() => { void genericSaveMutation.mutateAsync({ killSwitchPin: pinInput }).then(() => { toast({ title: "Kill Switch PIN set" }); setPinInput(""); setPinConfirm(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}>
                  <Lock className="w-3.5 h-3.5" />Set PIN
                </Button>
                {settingsData?.hasKillSwitchPin && (
                  <Button size="sm" variant="outline" className="gap-2 text-destructive border-destructive/30" onClick={() => { if (confirm("Remove kill switch PIN protection?")) void genericSaveMutation.mutateAsync({ clearKillSwitchPin: true }).then(() => { toast({ title: "PIN removed" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}>
                    <Trash2 className="w-3.5 h-3.5" />Remove PIN
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Row 8 — Audit Log ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><History className="w-4 h-4 text-primary" />Audit Log</CardTitle>
          <CardDescription className="text-xs">Last 50 settings changes with timestamps</CardDescription>
        </CardHeader>
        <CardContent>
          {!auditLogs || auditLogs.length === 0 ? (
            <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">No changes recorded yet. Save any setting to start the log.</div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full table-auto text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["Time (IST)", "Action", "Field", "Old Value", "New Value"].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(log => (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono text-muted-foreground whitespace-nowrap">
                        {new Date(log.changedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
                      </td>
                      <td className="px-3 py-2 font-mono"><Badge variant="outline" className="text-[10px]">{log.action}</Badge></td>
                      <td className="px-3 py-2 text-foreground">{log.field ?? "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-[120px] truncate" title={log.oldValue ?? ""}>{log.oldValue ?? "—"}</td>
                      <td className="px-3 py-2 text-foreground max-w-[120px] truncate" title={log.newValue ?? ""}>{log.newValue ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
