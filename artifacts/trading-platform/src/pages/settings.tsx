import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut,
  Bell, AlertTriangle, Send, Server, Copy, RefreshCw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({ clientId: z.string(), accessToken: z.string() });
const TELEGRAM_TOKEN_REGEX = /^\d{8,12}:[A-Za-z0-9_-]{35,}$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?\d+$/;
const telegramSchema = z.object({
  telegramBotToken: z.string().refine(v => !v || v.startsWith("*") || TELEGRAM_TOKEN_REGEX.test(v), "Invalid token format"),
  telegramChatId: z.string().refine(v => !v || v.startsWith("*") || TELEGRAM_CHAT_ID_REGEX.test(v), "Must be numeric"),
});

interface FundDetails { dhanClientId?: string; availableBalance?: number; sodLimit?: number; utilizedAmount?: number; withdrawableBalance?: number }
interface ConnectResult extends FundDetails { success: boolean; errorCode?: string; errorMessage?: string }
interface SettingsData {
  id: number; dhanClientId: string; dhanAccessToken: string; apiConnected: boolean;
  telegramBotToken: string; telegramChatId: string;
  hasTelegramToken: boolean; hasTelegramChatId: boolean;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function useTokenInfo() {
  const [info, setInfo] = useState<{ hasToken: boolean; tokenGeneratedAt?: string | null } | null>(null);
  const load = () => {
    fetch(`${BASE}api/broker/token-info`).then(r => r.json()).then(setInfo).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  return { info, reload: load };
}

function useServerIp() {
  const [ip, setIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    fetch(`${BASE}api/broker/server-ip`).then(r => r.json()).then((d: { ip: string | null }) => { setIp(d.ip); setLoading(false); }).catch(() => { setLoading(false); });
  };
  useEffect(() => { load(); }, []);
  return { ip, loading, reload: load };
}

function TokenExpiryBanner({ onReconnect }: { onReconnect: () => void }) {
  const { info, reload } = useTokenInfo();
  const { toast } = useToast();
  const [renewing, setRenewing] = useState(false);

  if (!info?.hasToken || !info.tokenGeneratedAt) return null;
  const expiresAt = new Date(new Date(info.tokenGeneratedAt).getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 4) return null;

  const expired = hoursLeft <= 0;

  const handleRenew = async () => {
    setRenewing(true);
    try {
      const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" });
      const d = await res.json() as { success?: boolean };
      if (d.success) {
        toast({ title: "Token renewed successfully" });
        reload();
      } else {
        toast({ title: "Auto-renew not available", description: "Dhan does not support API token renewal. Paste a fresh token in the Broker Connection form.", variant: "destructive" });
        onReconnect();
      }
    } finally {
      setRenewing(false);
    }
  };

  return (
    <div className={`col-span-2 flex items-start justify-between gap-3 rounded-2xl border px-5 py-3.5 ${expired ? "border-destructive/40 bg-destructive/8" : "border-warning/40 bg-warning/8"}`}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${expired ? "text-destructive" : "text-warning"}`} />
        <div>
          <p className={`text-sm font-semibold ${expired ? "text-destructive" : "text-warning"}`}>
            {expired ? "Access token expired — orders will fail" : `Token expires in ~${Math.max(0, Math.floor(hoursLeft))}h ${Math.floor((hoursLeft % 1) * 60)}m`}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Dhan tokens are valid for 24 hours. Generate a new token from <span className="font-semibold">Dhan Web → My Profile → Access Token</span> and paste it below.
          </p>
        </div>
      </div>
      <button
        disabled={renewing}
        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap shrink-0 ${expired ? "border-destructive/50 text-destructive hover:bg-destructive/15" : "border-warning/50 text-warning hover:bg-warning/15"}`}
        onClick={() => void handleRenew()}
      >
        {renewing ? "Trying…" : expired ? "Reconnect Now" : "Reconnect"}
      </button>
    </div>
  );
}

function ServerIpInfo() {
  const { ip, loading, reload } = useServerIp();
  const { toast } = useToast();
  const [setting, setSetting] = useState<"PRIMARY" | "SECONDARY" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 10_000);
    return () => clearTimeout(t);
  }, [result]);

  const copy = () => {
    if (!ip) return;
    void navigator.clipboard.writeText(ip).then(() => toast({ title: "IP copied to clipboard" }));
  };

  const setIp = async (flag: "PRIMARY" | "SECONDARY") => {
    setSetting(flag);
    setResult(null);
    try {
      const res = await fetch(`${BASE}api/broker/set-ip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipFlag: flag }),
      });
      const d = (await res.json()) as { success: boolean; message?: string; error?: string };
      if (d.success) {
        setResult({ ok: true, msg: d.message ?? "IP whitelisted successfully" });
        toast({ title: `${flag} IP set — orders should work now` });
      } else {
        setResult({ ok: false, msg: d.error ?? "Dhan rejected the request" });
      }
    } catch {
      setResult({ ok: false, msg: "Network error — could not reach API" });
    } finally {
      setSetting(null);
    }
  };

  return (
    <div className="col-span-2 rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
      <div className="px-5 py-3.5 border-b border-border/30 bg-muted/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
            <Server className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Your Server's IP</p>
          </div>
        </div>
        <button onClick={reload} className="text-muted-foreground hover:text-foreground transition-colors" title="Refresh IP">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* IP display + whitelist buttons */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">Server IP Address</p>
            <div className="flex items-center gap-2">
              {loading ? (
                <div className="h-9 w-44 rounded-lg bg-muted/30 animate-pulse" />
              ) : ip ? (
                <>
                  <code className="font-mono text-base font-bold text-foreground bg-muted/20 border border-border/40 px-3 py-1.5 rounded-lg select-all">{ip}</code>
                  <button onClick={copy} className="text-muted-foreground hover:text-primary transition-colors" title="Copy IP">
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">Unable to detect — check network</span>
              )}
            </div>
          </div>

          {/* One-click whitelist buttons */}
          {ip && (
            <div className="flex items-center gap-2 shrink-0">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mr-1">Whitelist via API</p>
              <Button
                size="sm"
                className="h-9 gap-1.5 text-xs"
                disabled={!!setting}
                onClick={() => void setIp("PRIMARY")}
              >
                {setting === "PRIMARY" ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Setting…</> : <>Whitelist IP - Primary Recommend</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-xs"
                disabled={!!setting}
                onClick={() => void setIp("SECONDARY")}
              >
                {setting === "SECONDARY" ? <><span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />Setting…</> : <>Set as Secondary</>}
              </Button>
            </div>
          )}
        </div>

        {/* Result banner — auto-hides after 10s */}
        {result && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-xs ${result.ok ? "border-success/30 bg-success/8 text-success" : "border-destructive/30 bg-destructive/8 text-destructive"}`}>
            {result.ok
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span>{result.msg}</span>
          </div>
        )}

        {/* Caveat */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px] space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Important notes</p>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Once set, the same IP <span className="text-foreground font-medium">cannot be changed for 7 days</span></li>
              <li>You can have one Primary and one Secondary IP</li>
              <li>Broker must be connected before whitelisting</li>
              <li>DH-905 on order APIs = IP not whitelisted yet</li>
            </ul>
          </div>
          <div className="flex-1 min-w-[200px] space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Manual fallback</p>
            <p className="text-xs text-muted-foreground">If the button fails, whitelist manually:</p>
            <ol className="text-xs text-muted-foreground space-y-0.5 list-decimal list-inside">
              <li>Dhan Web → My Profile → Manage App</li>
              <li>Select your app → Whitelist IP</li>
              <li>Paste <span className="font-mono font-semibold text-foreground">{ip ?? "…"}</span></li>
            </ol>
          </div>
        </div>
      </div>
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

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";
  const maskedAccessToken = settingsData?.dhanAccessToken ?? "";

  const { data: brokerStatus } = useQuery<FundDetails & { connected: boolean }>({
    queryKey: ["broker-status"], enabled: isConnected, refetchInterval: 4_000, staleTime: 0, gcTime: 0,
    queryFn: async () => { const r = await fetch(`${BASE}api/broker/status`); if (!r.ok) return { connected: false }; return r.json(); },
  });

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
    if (settingsData) telegramForm.reset({
      telegramBotToken: settingsData.telegramBotToken ?? "",
      telegramChatId: settingsData.telegramChatId ?? "",
    });
  }, [settingsData?.id, settingsData?.telegramBotToken, settingsData?.telegramChatId]);

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
    mutationFn: async (data: { telegramBotToken: string; telegramChatId: string }) => {
      const payload: Record<string, string> = {};
      if (data.telegramBotToken && !data.telegramBotToken.startsWith("*")) payload.telegramBotToken = data.telegramBotToken;
      if (data.telegramChatId && !data.telegramChatId.startsWith("*")) payload.telegramChatId = data.telegramChatId;
      if (Object.keys(payload).length === 0) throw new Error("NO_CHANGE");
      const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data: { telegramBotToken?: string; telegramChatId?: string }) => {
      telegramForm.reset({ telegramBotToken: data.telegramBotToken ?? "", telegramChatId: data.telegramChatId ?? "" });
      toast({ title: "Telegram settings saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: (e: Error) => {
      if (e.message === "NO_CHANGE") { toast({ title: "No changes — enter a new token to update" }); return; }
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });
  const telegramResetMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegramBotToken: null, telegramChatId: null }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { telegramForm.reset({ telegramBotToken: "", telegramChatId: "" }); toast({ title: "Telegram credentials removed" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to reset", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 w-full">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});

  return (
    <div className="grid grid-cols-2 gap-4 w-full items-stretch">
      <TokenExpiryBanner onReconnect={() => brokerForm.setFocus("accessToken")} />

      {/* ── Broker Connection ── */}
      <div className={`flex flex-col rounded-2xl border overflow-hidden shadow-sm transition-colors ${isConnected ? "border-success/30 bg-card" : "border-border/50 bg-card"}`}>

        {/* Header */}
        <div className={`px-5 py-3.5 flex items-center justify-between border-b ${isConnected ? "bg-success/8 border-success/20" : "bg-muted/10 border-border/30"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isConnected ? "bg-success/15" : "bg-muted/30"}`}>
              {isConnected ? <Wifi className="w-4 h-4 text-success" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
            </div>
            <div>
              <p className="text-sm font-semibold">Broker Connection</p>
              <p className={`text-[10px] font-medium ${isConnected ? "text-success" : "text-muted-foreground"}`}>
                {isConnected ? "Connected" : "Not connected to Dhan"}
              </p>
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[10px] font-semibold text-success uppercase tracking-wider">Live</span>
            </div>
          )}
        </div>

        {/* Balance row */}
        {isConnected && funds.availableBalance !== undefined && (
          <div className="px-5 py-2.5 flex items-center gap-1.5 border-b border-border/25 bg-muted/5 text-xs flex-wrap">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-semibold text-success tabular-nums">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-border/60 mx-1">·</span>
            <span className="text-muted-foreground">Margin Used:</span>
            <span className="font-semibold text-warning tabular-nums">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <span className="text-border/60 mx-1">·</span>
            <span className="text-muted-foreground">Withdrawable:</span>
            <span className="font-semibold text-primary tabular-nums">₹{(funds.withdrawableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))} className="flex-1 flex flex-col px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <SectionLabel>Client ID</SectionLabel>
            <Input className="h-10 bg-background/60" {...brokerForm.register("clientId")} />
          </div>
          <div className="space-y-1.5">
            <SectionLabel>Access Token</SectionLabel>
            <div className="relative">
              <Input type={showToken ? "text" : "password"} className="h-10 pr-10 bg-background/60" autoComplete="current-password" {...brokerForm.register("accessToken")} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowToken(!showToken)}>
                {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {connectResult && !connectResult.success && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/8 text-destructive text-xs">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span><span className="font-semibold">{connectResult.errorCode}:</span> {connectResult.errorMessage}</span>
            </div>
          )}
          <div className="flex gap-2.5 mt-auto pt-1">
            <Button type="submit" size="sm" className="h-10 gap-1.5 flex-1" disabled={connectMutation.isPending}>
              {connectMutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting…</>
                : <><Wifi className="w-3.5 h-3.5" />{isConnected ? "Reconnect" : "Save & Connect"}</>}
            </Button>
            {isConnected && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5 h-10 border-destructive/40 text-destructive hover:bg-destructive/8" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
                <LogOut className="w-3.5 h-3.5" />{disconnectMutation.isPending ? "…" : "Disconnect"}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* ── Telegram Alerts ── */}
      <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">

        <div className="px-5 py-3.5 flex items-center justify-between border-b border-border/30 bg-muted/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
              <Send className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Telegram Alerts</p>
              <p className="text-[10px] text-muted-foreground">
                {settingsData?.hasTelegramToken ? "Notifications active" : "Not configured"}
              </p>
            </div>
          </div>
          {settingsData?.hasTelegramToken && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-success" />
              <span className="text-[10px] font-semibold text-success">Active</span>
            </div>
          )}
        </div>

        <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="flex-1 flex flex-col px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <SectionLabel>Bot Token</SectionLabel>
            <div className="relative">
              <Input type={showBotToken ? "text" : "password"} className="h-10 font-mono text-xs pr-10 bg-background/60" autoComplete="off" {...telegramForm.register("telegramBotToken")} />
              <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowBotToken(!showBotToken)}>
                {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {telegramForm.formState.errors.telegramBotToken && <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramBotToken.message}</p>}
          </div>
          <div className="space-y-1.5">
            <SectionLabel>Chat ID</SectionLabel>
            <Input type="text" className="h-10 font-mono bg-background/60" autoComplete="off" {...telegramForm.register("telegramChatId")} />
            {telegramForm.formState.errors.telegramChatId && <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>}
          </div>
          <div className="flex gap-2.5 mt-auto pt-1">
            <Button type="submit" size="sm" className="h-10 gap-1.5 flex-1" disabled={telegramMutation.isPending}>
              {telegramMutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                : <><Bell className="w-3.5 h-3.5" />{settingsData?.hasTelegramToken ? "Update Telegram" : "Save Telegram"}</>}
            </Button>
            {(settingsData?.hasTelegramToken || settingsData?.hasTelegramChatId) && (
              <Button type="button" variant="outline" size="sm" className="h-10 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/8" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                <XCircle className="w-3.5 h-3.5" />Reset
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* ── Server IP Whitelist ── */}
      <ServerIpInfo />

    </div>
  );
}
