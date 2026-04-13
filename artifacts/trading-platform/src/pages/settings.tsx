import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut, User,
  Bell, Power, Lock, Trash2, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({
  clientId: z.string(),
  accessToken: z.string(),
});
const TELEGRAM_TOKEN_REGEX = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;
const telegramSchema = z.object({
  telegramBotToken: z.string().min(1, "Required").regex(TELEGRAM_TOKEN_REGEX, "Invalid format"),
  telegramChatId: z.string().min(1, "Required").regex(TELEGRAM_CHAT_ID_REGEX, "Must be a number"),
});

interface FundDetails { dhanClientId?: string; availableBalance?: number; sodLimit?: number; utilizedAmount?: number; withdrawableBalance?: number }
interface ConnectResult extends FundDetails { success: boolean; errorCode?: string; errorMessage?: string }
interface SettingsData {
  id: number; dhanClientId: string; dhanAccessToken: string; apiConnected: boolean;
  maxDailyLoss: number | null; killSwitchEnabled: boolean;
  telegramBotToken: string; telegramChatId: string; hasKillSwitchPin: boolean;
}
interface KillSwitchStatus { killSwitchStatus?: string; isActive?: boolean; canDeactivateToday?: boolean; deactivationsUsed?: number }

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm ${className}`}>{children}</div>;
}

function CardHeader({ icon, iconBg, title, badge }: { icon: React.ReactNode; iconBg: string; title: string; badge?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border/40">
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>{icon}</div>
        <span className="font-semibold text-sm tracking-tight">{title}</span>
      </div>
      {badge}
    </div>
  );
}

function Field({ label, children, noBorder }: { label: string; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${noBorder ? "" : "border-b border-border/25"}`}>
      <span className="text-sm text-muted-foreground">{label}</span>
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
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 col-span-3">
      <div className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /><p className="text-xs text-amber-400">Token expires in ~{Math.max(0, Math.floor(hoursLeft))}h {Math.floor((hoursLeft % 1) * 60)}m. Renew now.</p></div>
      <button className="text-xs text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-md hover:bg-amber-500/20 transition-colors whitespace-nowrap" onClick={async () => { const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" }); const d = await res.json(); alert(d.success ? "Token renewed!" : "Renewal failed."); }}>Renew Token</button>
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
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinDialogFor, setPinDialogFor] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState("");

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";
  const maskedAccessToken = settingsData?.dhanAccessToken ?? "";

  const { data: brokerStatus } = useQuery<FundDetails & { connected: boolean }>({
    queryKey: ["broker-status"], enabled: isConnected, refetchInterval: 4_000, staleTime: 0, gcTime: 0,
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
    if (isConnected) {
      if (maskedClientId) brokerForm.setValue("clientId", maskedClientId, { shouldValidate: false });
      if (maskedAccessToken) brokerForm.setValue("accessToken", maskedAccessToken, { shouldValidate: false });
    } else {
      brokerForm.reset({ clientId: "", accessToken: "" });
    }
  }, [isConnected, maskedClientId, maskedAccessToken]);

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
  const telegramMutation = useMutation({
    mutationFn: (data: { telegramBotToken: string; telegramChatId: string }) => saveSettings(data),
    onSuccess: () => { toast({ title: "Telegram settings saved" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
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
      toast({ title: status === "ACTIVATE" ? "Kill Switch Activated" : "Kill Switch Deactivated", variant: status === "ACTIVATE" ? "destructive" : "default", description: status === "ACTIVATE" ? `All order placement blocked. ${data.canDeactivateToday ? "1 reset available today." : ""}` : "Trading resumed." });
    },
    onError: (err: { message?: string; code?: string }) => {
      if (err.code === "DAILY_LIMIT_REACHED") toast({ title: "Daily Limit Reached", description: "Auto-resets at midnight IST — fresh trading resumes next day.", variant: "destructive" });
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
    const data = await res.json() as { valid: boolean };
    if (data.valid) { killSwitchMutation.mutate(pinDialogFor as "ACTIVATE" | "DEACTIVATE"); setPinDialogFor(null); setPinVerifyInput(""); }
    else toast({ title: "Incorrect PIN", variant: "destructive" });
  }

  if (isLoading) {
    return (
      <div className="space-y-4 w-full">
        <Skeleton className="h-36 rounded-2xl w-full" />
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
        <Skeleton className="h-24 rounded-2xl w-full" />
      </div>
    );
  }

  const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});

  return (
    <div className="w-full space-y-4">

      {/* PIN Dialog */}
      {pinDialogFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-2xl p-6 w-80 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2"><Lock className="w-5 h-5 text-amber-400" /><h3 className="font-semibold">Kill Switch PIN Required</h3></div>
            <p className="text-xs text-muted-foreground">Enter your 4-digit PIN to {pinDialogFor === "ACTIVATE" ? "activate" : "deactivate"} the kill switch.</p>
            <Input type="password" placeholder="••••" maxLength={4} value={pinVerifyInput} onChange={e => setPinVerifyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && void verifyPinAndProceed()} className="text-center text-xl tracking-widest font-mono" />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1" onClick={() => { setPinDialogFor(null); setPinVerifyInput(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1" onClick={() => void verifyPinAndProceed()} disabled={pinVerifyInput.length < 4}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 items-start">
        <TokenExpiryWarning />

        {/* ── Broker Connection (full width) ── */}
        <Card className={`col-span-3 ${isConnected ? "border-green-500/20" : "border-border/50"}`}>
          <CardHeader
            icon={isConnected ? <Wifi className="w-3.5 h-3.5 text-green-400" /> : <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />}
            iconBg={isConnected ? "bg-green-500/15" : "bg-muted/20"}
            title="Broker Connection"
            badge={
              isConnected ? (
                <div className="flex items-center gap-3 text-xs flex-wrap">
                  <Badge className="h-5 gap-1.5 bg-green-500/15 text-green-400 border border-green-500/25 shadow-none">
                    <CheckCircle2 className="w-3 h-3" />Connected
                  </Badge>
                  <span className="font-mono text-muted-foreground flex items-center gap-1 text-[11px]">
                    <User className="w-3 h-3" />{funds.dhanClientId ?? maskedClientId}
                  </span>
                  {funds.availableBalance !== undefined && (
                    <>
                      <span className="text-muted-foreground text-[11px]">Bal <span className="text-foreground font-semibold">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      <span className="text-muted-foreground text-[11px]">Margin <span className="text-foreground font-semibold">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                      <span className="text-muted-foreground text-[11px]">Withdrawable <span className="text-foreground font-semibold">₹{(funds.withdrawableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></span>
                    </>
                  )}
                </div>
              ) : (
                <Badge variant="outline" className="text-[10px] h-5 text-destructive border-destructive/30">Disconnected</Badge>
              )
            }
          />
          <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))} className="px-5 py-4">
            <div className="grid grid-cols-2 gap-5 mb-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Client ID</label>
                <Input placeholder="" className="h-10" {...brokerForm.register("clientId")} />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Access Token</label>
                <div className="relative">
                  <Input type={showToken ? "text" : "password"} placeholder="" className="h-10 pr-10" autoComplete="current-password" {...brokerForm.register("accessToken")} />
                  <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowToken(!showToken)}>
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            {connectResult && !connectResult.success && (
              <div className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-xs mb-4">
                <XCircle className="w-3.5 h-3.5 shrink-0" />{connectResult.errorCode}: {connectResult.errorMessage}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" className="h-9 px-5" disabled={connectMutation.isPending}>
                {connectMutation.isPending ? "Connecting…" : "Save & Connect"}
              </Button>
              {isConnected && (
                <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
                  <LogOut className="w-3.5 h-3.5" />{disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* ── Telegram Alerts ── */}
        <Card className="col-span-1">
          <CardHeader
            icon={<Bell className="w-3.5 h-3.5 text-violet-400" />}
            iconBg="bg-violet-500/15"
            title="Telegram Alerts"
            badge={settingsData?.telegramChatId ? <span className="text-[10px] font-semibold text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Active</span> : undefined}
          />
          <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="px-5 pt-3 pb-5 space-y-0">
            <Field label="Bot Token">
              <div className="relative">
                <Input type={showBotToken ? "text" : "password"} className="h-8 text-xs font-mono pr-8 w-44" autoComplete="off" {...telegramForm.register("telegramBotToken")} />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowBotToken(!showBotToken)}>
                  {showBotToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </Field>
            {telegramForm.formState.errors.telegramBotToken && <p className="text-[10px] text-destructive -mt-2 mb-1">{telegramForm.formState.errors.telegramBotToken.message}</p>}
            <Field label="Chat ID" noBorder>
              <Input type="text" className="h-8 text-xs font-mono w-44" autoComplete="off" {...telegramForm.register("telegramChatId")} />
            </Field>
            {telegramForm.formState.errors.telegramChatId && <p className="text-[10px] text-destructive mt-1">{telegramForm.formState.errors.telegramChatId.message}</p>}
            <div className="flex items-center gap-2 pt-4">
              <Button type="submit" size="sm" className="h-9 flex-1 gap-1.5" disabled={telegramMutation.isPending}>
                <Bell className="w-3.5 h-3.5" />{telegramMutation.isPending ? "Saving…" : "Save"}
              </Button>
              {(settingsData?.telegramBotToken || settingsData?.telegramChatId) && (
                <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                  <XCircle className="w-3.5 h-3.5" />Reset
                </Button>
              )}
            </div>
          </form>
        </Card>

        {/* ── Emergency Kill Switch ── */}
        <Card className={`col-span-1 ${killSwitchActive ? "border-destructive/40" : ""}`}>
          <CardHeader
            icon={<Power className={`w-3.5 h-3.5 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />}
            iconBg={killSwitchActive ? "bg-destructive/20" : "bg-muted/20"}
            title="Emergency Kill Switch"
            badge={
              <div className="flex items-center gap-1.5">
                {settingsData?.hasKillSwitchPin && (
                  <Badge variant="outline" className="text-[10px] h-5 text-amber-400 border-amber-500/30 gap-1">
                    <Lock className="w-2.5 h-2.5" />PIN
                  </Badge>
                )}
                {killSwitchActive
                  ? <Badge className="text-[10px] h-5 bg-destructive/20 text-destructive border border-destructive/30 shadow-none">ACTIVE</Badge>
                  : <Badge variant="outline" className="text-[10px] h-5 text-green-400 border-green-500/30">INACTIVE</Badge>
                }
              </div>
            }
          />
          <div className="px-5 py-5 flex flex-col items-center justify-center min-h-[120px]">
            {!isConnected ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <WifiOff className="w-3.5 h-3.5" />Connect broker first.
              </div>
            ) : killSwitchActive ? (
              <div className="w-full space-y-2">
                <div className="flex items-center justify-center gap-2 py-2 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs font-medium">
                  <Power className="w-3.5 h-3.5" />All trading blocked
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={`w-full h-9 gap-1.5 ${canDeactivate ? "border-green-500/40 text-green-400 hover:bg-green-500/10" : "opacity-40 cursor-not-allowed"}`}
                  disabled={killSwitchMutation.isPending || !canDeactivate}
                  onClick={() => canDeactivate && handleKillSwitchAction("DEACTIVATE")}
                >
                  <Power className="w-3.5 h-3.5" />{killSwitchMutation.isPending ? "…" : "Deactivate"}
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="w-full h-10 gap-1.5 text-sm"
                disabled={killSwitchMutation.isPending}
                onClick={() => handleKillSwitchAction("ACTIVATE")}
              >
                <Power className="w-4 h-4" />{killSwitchMutation.isPending ? "…" : "Activate Kill Switch"}
              </Button>
            )}
          </div>
        </Card>

        {/* ── Kill Switch PIN ── */}
        <Card className="col-span-1">
          <CardHeader
            icon={<Lock className="w-3.5 h-3.5 text-amber-400" />}
            iconBg="bg-amber-500/15"
            title="Kill Switch PIN"
            badge={settingsData?.hasKillSwitchPin ? <Badge variant="outline" className="text-[10px] h-5 text-amber-400 border-amber-500/30 gap-1"><Lock className="w-2.5 h-2.5" />Set</Badge> : undefined}
          />
          <div className="px-5 pt-3 pb-5">
            {settingsData?.hasKillSwitchPin && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 mb-3">
                <Lock className="w-3 h-3 shrink-0" />PIN active — enter new to change.
              </div>
            )}
            <Field label="New PIN">
              <div className="relative">
                <Input type={showPin ? "text" : "password"} placeholder="••••" maxLength={4} className="h-8 text-sm text-center font-mono tracking-widest pr-8 w-28" value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))} />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPin(!showPin)}>
                  {showPin ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </Field>
            <Field label="Confirm PIN" noBorder>
              <Input type="password" placeholder="••••" maxLength={4} className={`h-8 text-sm text-center font-mono tracking-widest w-28 ${pinInput && pinConfirm && pinInput !== pinConfirm ? "border-destructive" : ""}`} value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            </Field>
            {pinInput && pinConfirm && pinInput !== pinConfirm && <p className="text-[10px] text-destructive mt-1">PINs do not match</p>}
            <div className="flex gap-2 pt-4">
              <Button size="sm" className="h-9 flex-1 gap-1.5" disabled={pinInput.length !== 4 || pinInput !== pinConfirm} onClick={() => { void genericSaveMutation.mutateAsync({ killSwitchPin: pinInput }).then(() => { toast({ title: "PIN set" }); setPinInput(""); setPinConfirm(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}>
                <Lock className="w-3.5 h-3.5" />Set PIN
              </Button>
              {settingsData?.hasKillSwitchPin && (
                <Button size="sm" variant="outline" className="h-9 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => { if (confirm("Remove kill switch PIN?")) void genericSaveMutation.mutateAsync({ clearKillSwitchPin: true }).then(() => { toast({ title: "PIN removed" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </Card>

      </div>
    </div>
  );
}
