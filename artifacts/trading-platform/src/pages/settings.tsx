import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut, RefreshCw, User,
  Bell, Power, Calendar, Settings2, Lock, Trash2, Save, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});
const TELEGRAM_TOKEN_REGEX = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;
const telegramSchema = z.object({
  telegramBotToken: z.string().min(1, "Bot Token is required").regex(TELEGRAM_TOKEN_REGEX, "Invalid format — like: 1234567890:ABCDefgh…"),
  telegramChatId: z.string().min(1, "Chat ID is required").regex(TELEGRAM_CHAT_ID_REGEX, "Chat ID must be a number"),
});
const pnlExitSchema = z.object({
  profitValue: z.coerce.number().min(1), lossValue: z.coerce.number().min(1), enableKillSwitch: z.boolean().default(false),
});

interface FundDetails { dhanClientId?: string; availableBalance?: number; sodLimit?: number; utilizedAmount?: number; withdrawableBalance?: number }
interface ConnectResult extends FundDetails { success: boolean; errorCode?: string; errorMessage?: string }
interface SettingsData {
  id: number; dhanClientId: string; apiConnected: boolean;
  maxDailyLoss: number | null; killSwitchEnabled: boolean;
  telegramBotToken: string; telegramChatId: string; updatedAt: string;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  maxTradesPerDay: number | null; maxPositionSizeValue: number | null; maxPositionSizeType: string;
  instrumentBlacklist: string[]; notificationPreferences: Record<string, boolean>;
  pushNotificationsEnabled: boolean; defaultProductType: string; defaultOrderType: string;
  defaultQuantity: number | null; dashboardWidgets: Record<string, boolean>;
  refreshIntervalSeconds: number; tradingHoursStart: string; tradingHoursEnd: string; hasKillSwitchPin: boolean;
}
interface KillSwitchStatus { killSwitchStatus?: string; isActive?: boolean; canDeactivateToday?: boolean; deactivationsUsed?: number }

function Panel({ accent, icon, title, subtitle, children, className = "" }: {
  accent: string; icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card overflow-hidden ${className}`}>
      <div className={`flex items-start gap-3 px-5 py-4 border-b border-border/40 ${accent}`}>
        <div className="mt-0.5">{icon}</div>
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-0">{children}</div>
    </div>
  );
}

function Row({ label, hint, children, last = false }: { label: string; hint?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-3.5 ${!last ? "border-b border-border/30" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function TokenExpiryWarning() {
  const [info, setInfo] = useState<{ hasToken: boolean; tokenUpdatedAt?: string } | null>(null);
  useEffect(() => { fetch(`${BASE}api/broker/token-info`).then(r => r.json()).then(setInfo).catch(() => {}); }, []);
  if (!info?.hasToken || !info.tokenUpdatedAt) return null;
  const expiresAt = new Date(new Date(info.tokenUpdatedAt).getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 4) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /><p className="text-xs text-amber-400">Token expires in ~{Math.max(0, Math.floor(hoursLeft))}h {Math.floor((hoursLeft % 1) * 60)}m. Renew now.</p></div>
      <button className="text-xs text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-md hover:bg-amber-500/20 transition-colors whitespace-nowrap" onClick={async () => { const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" }); const d = await res.json(); alert(d.success ? "Token renewed!" : "Renewal failed. Generate a new token from Dhan web."); }}>Renew Token</button>
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
  const [optimisticKsActive, setOptimisticKsActive] = useState<boolean | null>(null);
  const [defaultProductType, setDefaultProductType] = useState("INTRA");
  const [defaultOrderType, setDefaultOrderType] = useState("MARKET");
  const [defaultQuantity, setDefaultQuantity] = useState<string>("");
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinDialogFor, setPinDialogFor] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState("");

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";

  useEffect(() => {
    if (!settingsData) return;
    setDefaultProductType(settingsData.defaultProductType ?? "INTRA");
    setDefaultOrderType(settingsData.defaultOrderType ?? "MARKET");
    setDefaultQuantity(settingsData.defaultQuantity != null ? String(settingsData.defaultQuantity) : "");
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

  const brokerForm = useForm<z.infer<typeof brokerSchema>>({ resolver: zodResolver(brokerSchema), defaultValues: { clientId: "", accessToken: "" } });
  const telegramForm = useForm<z.infer<typeof telegramSchema>>({ resolver: zodResolver(telegramSchema), defaultValues: { telegramBotToken: "", telegramChatId: "" } });

  useEffect(() => {
    if (settingsData) telegramForm.reset({ telegramBotToken: settingsData.telegramBotToken ?? "", telegramChatId: settingsData.telegramChatId ?? "" });
  }, [settingsData?.id]);

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
      } else toast({ title: `Connection failed: ${result.errorCode}`, description: result.errorMessage, variant: "destructive" });
    },
    onError: () => toast({ title: "Network error", variant: "destructive" }),
  });
  const disconnectMutation = useMutation({
    mutationFn: async () => { const r = await fetch(`${BASE}api/broker/disconnect`, { method: "POST" }); if (!r.ok) throw new Error("Failed"); return r.json(); },
    onSuccess: () => { setConnectResult(null); brokerForm.reset({ clientId: "", accessToken: "" }); toast({ title: "Disconnected from broker" }); queryClient.invalidateQueries({ queryKey: ["healthz"] }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
  });
  const refreshMutation = useMutation({
    mutationFn: async () => { const r = await fetch(`${BASE}api/broker/status`); if (!r.ok) throw new Error("Failed"); return r.json() as Promise<FundDetails & { connected: boolean }>; },
    onSuccess: (data) => { if (data.connected) { setConnectResult(prev => prev ? { ...prev, ...data, success: true } : null); toast({ title: "Balance refreshed" }); } },
    onError: () => toast({ title: "Failed to refresh balance", variant: "destructive" }),
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
  const genericSaveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  function handleKillSwitchAction(status: "ACTIVATE" | "DEACTIVATE") {
    if (settingsData?.hasKillSwitchPin) setPinDialogFor(status);
    else killSwitchMutation.mutate(status);
  }
  async function verifyPinAndProceed() {
    if (!pinDialogFor) return;
    const res = await fetch(`${BASE}api/settings/verify-pin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pinVerifyInput }) });
    const data = await res.json() as { valid: boolean; error?: string };
    if (data.valid) { killSwitchMutation.mutate(pinDialogFor as "ACTIVATE" | "DEACTIVATE"); setPinDialogFor(null); setPinVerifyInput(""); }
    else toast({ title: "Incorrect PIN", description: "Kill switch action blocked", variant: "destructive" });
  }

  if (isLoading) {
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}</div>;
  }

  const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});

  return (
    <div className="space-y-4 max-w-4xl">
      <TokenExpiryWarning />

      {/* PIN Verification Dialog */}
      {pinDialogFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl p-6 w-80 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2"><Lock className="w-5 h-5 text-warning" /><h3 className="font-semibold">Kill Switch PIN Required</h3></div>
            <p className="text-xs text-muted-foreground">Enter your 4-digit PIN to {pinDialogFor === "ACTIVATE" ? "activate" : "deactivate"} the kill switch.</p>
            <Input type="password" placeholder="••••" maxLength={4} value={pinVerifyInput} onChange={e => setPinVerifyInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void verifyPinAndProceed(); }} className="text-center text-xl tracking-widest font-mono" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setPinDialogFor(null); setPinVerifyInput(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1" onClick={() => void verifyPinAndProceed()} disabled={pinVerifyInput.length < 4}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Broker Connection ── */}
      <Panel accent="bg-blue-500/5" icon={isConnected ? <Wifi className="w-4 h-4 text-blue-400" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />} title="Broker Connection" subtitle={isConnected ? `Connected as ${maskedClientId} · Dhan API` : "Enter your Dhan credentials to enable live trading"}>
        {isConnected && (
          <div className="flex items-center justify-between py-3 border-b border-border/30">
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="outline" className="text-green-400 border-green-500/30 bg-green-500/10 gap-1.5 text-xs"><CheckCircle2 className="w-3 h-3" />Connected</Badge>
              <span className="font-mono text-xs text-muted-foreground flex items-center gap-1"><User className="w-3 h-3" />{funds.dhanClientId ?? maskedClientId}</span>
            </div>
            <div className="flex items-center gap-4 text-xs flex-wrap">
              {funds.availableBalance !== undefined && <>
                <span className="text-muted-foreground">Balance <span className="text-green-400 font-semibold">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></span>
                <span className="text-muted-foreground">Margin <span className="font-semibold">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span></span>
              </>}
              <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1 text-muted-foreground" disabled={refreshMutation.isPending} onClick={() => { refreshMutation.mutate(); void refetchBrokerStatus(); }}>
                <RefreshCw className={`w-3 h-3 ${refreshMutation.isPending ? "animate-spin" : ""}`} />Refresh
              </Button>
            </div>
          </div>
        )}
        <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))}>
          <Row label="Client ID" hint="Your Dhan account client identifier">
            <div className="w-52">
              <Input placeholder="Enter Client ID" className="h-8 text-sm" {...brokerForm.register("clientId")} />
              {brokerForm.formState.errors.clientId && <p className="text-[10px] text-destructive mt-1">{brokerForm.formState.errors.clientId.message}</p>}
            </div>
          </Row>
          <Row label="Access Token" hint="Generated from Dhan web · expires every 24h">
            <div className="w-52 relative">
              <Input type={showToken ? "text" : "password"} placeholder="Paste access token" className="h-8 text-sm pr-8" autoComplete="current-password" {...brokerForm.register("accessToken")} />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
              {brokerForm.formState.errors.accessToken && <p className="text-[10px] text-destructive mt-1">{brokerForm.formState.errors.accessToken.message}</p>}
            </div>
          </Row>
          {connectResult && !connectResult.success && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-xs mb-3">
              <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>{connectResult.errorCode}: {connectResult.errorMessage}</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-3">
            <Button type="submit" size="sm" disabled={connectMutation.isPending} className="gap-1.5 h-8"><Wifi className="w-3.5 h-3.5" />{connectMutation.isPending ? "Connecting…" : "Save & Connect"}</Button>
            {isConnected && <Button type="button" variant="outline" size="sm" className="gap-1.5 h-8 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}><LogOut className="w-3.5 h-3.5" />{disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}</Button>}
          </div>
        </form>
      </Panel>

      {/* ── Row: Telegram + Kill Switch ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel accent="bg-violet-500/5" icon={<Bell className="w-4 h-4 text-violet-400" />} title="Telegram Alerts" subtitle="Receive trade notifications via bot">
          <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))}>
            <Row label="Bot Token" hint="Format: 1234567890:ABCDefgh…">
              <div className="w-44 relative">
                <Input type={showBotToken ? "text" : "password"} className="h-8 text-xs font-mono pr-8" autoComplete="off" {...telegramForm.register("telegramBotToken")} />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowBotToken(!showBotToken)}>{showBotToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}</button>
                {telegramForm.formState.errors.telegramBotToken && <p className="text-[10px] text-destructive mt-1">{telegramForm.formState.errors.telegramBotToken.message}</p>}
              </div>
            </Row>
            <Row label="Chat ID" hint="Your personal or group chat ID">
              <div className="w-44">
                <Input type="text" className="h-8 text-xs font-mono" autoComplete="off" {...telegramForm.register("telegramChatId")} />
                {telegramForm.formState.errors.telegramChatId && <p className="text-[10px] text-destructive mt-1">{telegramForm.formState.errors.telegramChatId.message}</p>}
              </div>
            </Row>
            <div className="flex items-center gap-2 pt-3">
              <Button type="submit" size="sm" className="gap-1.5 h-8" disabled={telegramMutation.isPending}><Bell className="w-3 h-3" />{telegramMutation.isPending ? "Saving…" : "Save"}</Button>
              {(settingsData?.telegramBotToken || settingsData?.telegramChatId) && (
                <Button type="button" variant="outline" size="sm" className="gap-1.5 h-8 text-destructive border-destructive/30" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}><XCircle className="w-3 h-3" />Reset</Button>
              )}
              {settingsData?.telegramChatId && <span className="text-xs text-green-400 ml-auto">✓ Active</span>}
            </div>
          </form>
        </Panel>

        <Panel accent={killSwitchActive ? "bg-destructive/10" : "bg-muted/20"} icon={<Power className={`w-4 h-4 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />} title="Emergency Kill Switch" subtitle="Instantly block all order placement · 1 reset/day">
          {!isConnected ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><WifiOff className="w-3.5 h-3.5" />Connect broker first to use the kill switch.</div>
          ) : (
            <>
              <Row label="Current Status" hint={ksStatus?.deactivationsUsed === 0 ? "1 manual reset available today" : "Daily reset used — auto-resets 8:30 AM IST"}>
                <div className="flex items-center gap-2">
                  {settingsData?.hasKillSwitchPin && <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 gap-1"><Lock className="w-2.5 h-2.5" />PIN</Badge>}
                  {killSwitchActive
                    ? <Badge variant="destructive" className="text-[10px]">ACTIVE</Badge>
                    : <Badge variant="outline" className="text-[10px] text-green-400 border-green-500/30">INACTIVE</Badge>}
                </div>
              </Row>
              <Row label={killSwitchActive ? "All order placement is blocked" : "Trading is allowed normally"} last>
                <div className="flex items-center gap-2">
                  {ksStatus?.deactivationsUsed !== undefined && <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="w-3 h-3" />{ksStatus.deactivationsUsed === 0 ? "1 reset left" : "0 resets"}</span>}
                  {killSwitchActive
                    ? <Button variant="outline" size="sm" className={`gap-1.5 h-8 ${canDeactivate ? "border-green-500/40 text-green-400 hover:bg-green-500/10" : "opacity-50"}`} disabled={killSwitchMutation.isPending || !canDeactivate} onClick={() => canDeactivate && handleKillSwitchAction("DEACTIVATE")}><Power className="w-3 h-3" />{killSwitchMutation.isPending ? "…" : "Deactivate"}</Button>
                    : <Button variant="destructive" size="sm" className="gap-1.5 h-8" disabled={killSwitchMutation.isPending} onClick={() => handleKillSwitchAction("ACTIVATE")}><Power className="w-3 h-3" />{killSwitchMutation.isPending ? "…" : "Activate"}</Button>}
                </div>
              </Row>
            </>
          )}
        </Panel>
      </div>

      {/* ── Row: Trading Defaults + Kill Switch PIN ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel accent="bg-teal-500/5" icon={<Settings2 className="w-4 h-4 text-teal-400" />} title="Trading Defaults" subtitle="Pre-fill values across all order panels">
          <Row label="Default Product Type" hint="Applied when creating new orders">
            <Select value={defaultProductType} onValueChange={setDefaultProductType}>
              <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="INTRA">INTRADAY</SelectItem>
                <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                <SelectItem value="MARGIN">MARGIN</SelectItem>
                <SelectItem value="MTF">MTF</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Default Order Type" hint="Market, Limit or Stop-Loss">
            <Select value={defaultOrderType} onValueChange={setDefaultOrderType}>
              <SelectTrigger className="w-40 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKET">MARKET</SelectItem>
                <SelectItem value="LIMIT">LIMIT</SelectItem>
                <SelectItem value="SL">STOP LOSS</SelectItem>
                <SelectItem value="SLM">SL-MARKET</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row label="Default Quantity" hint="Pre-fills the lot/quantity field" last>
            <Input type="number" min={1} placeholder="e.g. 1" className="w-40 h-8 text-sm" value={defaultQuantity} onChange={e => setDefaultQuantity(e.target.value)} />
          </Row>
          <div className="pt-3">
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ defaultProductType, defaultOrderType, defaultQuantity: defaultQuantity ? Number(defaultQuantity) : null }).then(() => toast({ title: "Trading defaults saved" })); }}><Save className="w-3 h-3" />Save Defaults</Button>
          </div>
        </Panel>

        <Panel accent="bg-amber-500/5" icon={<Lock className="w-4 h-4 text-amber-400" />} title="Kill Switch PIN" subtitle="Require a 4-digit PIN before toggling the kill switch">
          {settingsData?.hasKillSwitchPin && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2 mb-2">
              <Lock className="w-3 h-3" />PIN is set. Enter a new PIN below to change it.
            </div>
          )}
          <Row label="New PIN" hint="4 digits only — stored hashed">
            <div className="w-40 relative">
              <Input type={showPin ? "text" : "password"} placeholder="••••" maxLength={4} className="h-8 text-sm text-center font-mono tracking-widest pr-8" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))} />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPin(!showPin)}>{showPin ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}</button>
            </div>
          </Row>
          <Row label="Confirm PIN" hint={pinInput && pinConfirm && pinInput !== pinConfirm ? "PINs do not match" : undefined} last>
            <Input type="password" placeholder="••••" maxLength={4} className={`w-40 h-8 text-sm text-center font-mono tracking-widest ${pinInput && pinConfirm && pinInput !== pinConfirm ? "border-destructive" : ""}`} value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </Row>
          <div className="flex gap-2 pt-3">
            <Button size="sm" className="gap-1.5 h-8" disabled={pinInput.length !== 4 || pinInput !== pinConfirm} onClick={() => { void genericSaveMutation.mutateAsync({ killSwitchPin: pinInput }).then(() => { toast({ title: "Kill Switch PIN set" }); setPinInput(""); setPinConfirm(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}><Lock className="w-3 h-3" />Set PIN</Button>
            {settingsData?.hasKillSwitchPin && (
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-destructive border-destructive/30" onClick={() => { if (confirm("Remove kill switch PIN?")) void genericSaveMutation.mutateAsync({ clearKillSwitchPin: true }).then(() => { toast({ title: "PIN removed" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}><Trash2 className="w-3 h-3" />Remove</Button>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
