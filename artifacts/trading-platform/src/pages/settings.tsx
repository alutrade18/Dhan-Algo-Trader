import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut,
  Bell, AlertTriangle, Send, Server, Copy, RefreshCw, KeyRound, Clock,
  ShieldAlert, Zap, Timer, MessageCircle,
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
interface TelegramAlerts {
  orderFills: boolean; killSwitch: boolean;
  autoSquareOff: boolean; criticalErrors: boolean;
}
interface SettingsData {
  id: number; dhanClientId: string; dhanAccessToken: string; apiConnected: boolean;
  tokenExpired: boolean; telegramBotToken: string; telegramChatId: string;
  hasTelegramToken: boolean; hasTelegramChatId: boolean; telegramAlerts: TelegramAlerts;
}

const DEFAULT_TELEGRAM_ALERTS: TelegramAlerts = {
  orderFills: true, killSwitch: true, autoSquareOff: true, criticalErrors: true,
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function useServerIp() {
  const [ip, setIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    fetch(`${BASE}api/broker/server-ip`)
      .then(r => r.json())
      .then((d: { ip: string | null }) => { setIp(d.ip); setLoading(false); })
      .catch(() => { setLoading(false); });
  };
  useEffect(() => { load(); }, []);
  return { ip, loading, reload: load };
}

// ─── Server IP Card ───────────────────────────────────────────────────────────
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

  const setIpFlag = async (flag: "PRIMARY" | "SECONDARY") => {
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
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-border/30 bg-muted/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Server className="w-4 h-4 text-primary" />
          </div>
          <p className="text-sm font-semibold">Your Server IP</p>
        </div>
        <button onClick={reload} className="text-muted-foreground hover:text-foreground transition-colors p-1" title="Refresh IP">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-5 py-4 space-y-4 flex-1">
        {/* IP Address display row */}
        <div>
          <SectionLabel>Server IP Address</SectionLabel>
          <div className="flex items-center gap-2 mt-1.5">
            {loading ? (
              <div className="h-9 w-full max-w-[180px] rounded-lg bg-muted/30 animate-pulse" />
            ) : ip ? (
              <>
                <code className="font-mono text-sm font-bold text-foreground bg-muted/20 border border-border/40 px-3 py-1.5 rounded-lg select-all">
                  {ip}
                </code>
                <button onClick={copy} className="text-muted-foreground hover:text-primary transition-colors shrink-0 p-1" title="Copy IP">
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Unable to detect — check network</span>
            )}
          </div>
        </div>

        {/* Whitelist buttons — full width, always stacked */}
        {ip && (
          <div className="space-y-2">
            <SectionLabel>Whitelist this IP in Dhan</SectionLabel>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                size="sm"
                className="h-9 gap-1.5 text-xs flex-1"
                disabled={!!setting}
                onClick={() => void setIpFlag("PRIMARY")}
              >
                {setting === "PRIMARY"
                  ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Setting…</>
                  : <>Set as Primary (Recommend)</>}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-xs flex-1"
                disabled={!!setting}
                onClick={() => void setIpFlag("SECONDARY")}
              >
                {setting === "SECONDARY"
                  ? <><span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />Setting…</>
                  : <>Set as Secondary</>}
              </Button>
            </div>
          </div>
        )}

        {/* Result feedback */}
        {result && (
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-2.5 text-xs ${result.ok ? "border-success/30 bg-success/8 text-success" : "border-destructive/30 bg-destructive/8 text-destructive"}`}>
            {result.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
            <span>{result.msg}</span>
          </div>
        )}

        {/* Notes section — stacks on mobile, side-by-side on lg */}
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 space-y-1.5">
            <SectionLabel>Important notes</SectionLabel>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>Once set, the same IP <span className="text-foreground font-medium">cannot be changed for 7 days</span></li>
              <li>You can have one Primary and one Secondary IP</li>
              <li>Broker must be connected before whitelisting</li>
              <li>DH-905 on order APIs = IP not whitelisted yet</li>
            </ul>
          </div>
          <div className="flex-1 space-y-1.5">
            <SectionLabel>Manual fallback</SectionLabel>
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

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function Settings() {
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 30_000, staleTime: 0 },
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showBotToken, setShowBotToken] = useState(false);
  const [totpPin, setTotpPin] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [generateResult, setGenerateResult] = useState<{ success: boolean; error?: string; dhanClientName?: string; expiryTime?: string } | null>(null);
  const accessTokenRef = useRef<HTMLInputElement | null>(null);

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;
  const tokenExpired = settingsData?.tokenExpired ?? false;
  const maskedClientId = settingsData?.dhanClientId ?? "";
  const maskedAccessToken = settingsData?.dhanAccessToken ?? "";

  const { data: brokerStatus } = useQuery<FundDetails & { connected: boolean }>({
    queryKey: ["broker-status"], enabled: isConnected, refetchInterval: 30_000, staleTime: 0, gcTime: 0,
    queryFn: async () => { const r = await fetch(`${BASE}api/broker/status`); if (!r.ok) return { connected: false }; return r.json(); },
  });

  const brokerForm = useForm<z.infer<typeof brokerSchema>>({ resolver: zodResolver(brokerSchema), defaultValues: { clientId: "", accessToken: "" } });
  const telegramForm = useForm<z.infer<typeof telegramSchema>>({ resolver: zodResolver(telegramSchema), defaultValues: { telegramBotToken: "", telegramChatId: "" } });

  useEffect(() => {
    if (isConnected) {
      if (maskedClientId) brokerForm.setValue("clientId", maskedClientId, { shouldValidate: false });
      if (maskedAccessToken) brokerForm.setValue("accessToken", maskedAccessToken, { shouldValidate: false });
    } else {
      brokerForm.setValue("clientId", maskedClientId || "", { shouldValidate: false });
      brokerForm.setValue("accessToken", "", { shouldValidate: false });
    }
  }, [isConnected, maskedClientId, maskedAccessToken]);

  useEffect(() => {
    if (settingsData) telegramForm.reset({
      telegramBotToken: settingsData.telegramBotToken ?? "",
      telegramChatId: settingsData.telegramChatId ?? "",
    });
  }, [settingsData?.id, settingsData?.telegramBotToken, settingsData?.telegramChatId]);

  useEffect(() => {
    if (tokenExpired && accessTokenRef.current) {
      setTimeout(() => { accessTokenRef.current?.focus(); }, 300);
    }
  }, [tokenExpired]);

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
    onSuccess: () => {
      setConnectResult(null);
      brokerForm.reset({ clientId: "", accessToken: "" });
      toast({ title: "Disconnected from broker" });
      queryClient.invalidateQueries({ queryKey: ["healthz"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const rawClientId = brokerForm.getValues("clientId").trim();
      const clientId = rawClientId.includes("*") ? "" : rawClientId;
      const res = await fetch(`${BASE}api/broker/generate-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: totpPin, totp: totpCode, clientId }),
      });
      return res.json() as Promise<{ success: boolean; error?: string; dhanClientName?: string; expiryTime?: string; availableBalance?: number }>;
    },
    onSuccess: (result) => {
      setGenerateResult(result);
      if (result.success) {
        setTotpPin(""); setTotpCode("");
        toast({ title: "Token generated & connected", description: result.dhanClientName ? `Welcome, ${result.dhanClientName}` : "Broker connected successfully" });
        queryClient.invalidateQueries({ queryKey: ["healthz"] });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
        queryClient.invalidateQueries({ queryKey: ["broker-status"] });
      } else {
        toast({ title: "Token generation failed", description: result.error, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Network error during token generation", variant: "destructive" }),
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

  const [alertToggles, setAlertToggles] = useState<TelegramAlerts>(DEFAULT_TELEGRAM_ALERTS);
  useEffect(() => {
    if (settingsData?.telegramAlerts) setAlertToggles(settingsData.telegramAlerts);
  }, [settingsData?.telegramAlerts]);

  const alertToggleMutation = useMutation({
    mutationFn: async (alerts: TelegramAlerts) => {
      const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegramAlerts: alerts }) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onError: () => {
      if (settingsData?.telegramAlerts) setAlertToggles(settingsData.telegramAlerts);
      toast({ title: "Failed to save alert preference", variant: "destructive" });
    },
  });

  const [testMsgState, setTestMsgState] = useState<"idle" | "sending" | "ok" | "fail">("idle");
  const sendTestMessage = async () => {
    setTestMsgState("sending");
    try {
      const res = await fetch(`${BASE}api/telegram/test`, { method: "POST" });
      const d = await res.json() as { ok: boolean; error?: string };
      if (d.ok) { setTestMsgState("ok"); toast({ title: "Test message sent!", description: "Check your Telegram chat." }); }
      else { setTestMsgState("fail"); toast({ title: "Failed to send", description: d.error, variant: "destructive" }); }
    } catch { setTestMsgState("fail"); toast({ title: "Network error", variant: "destructive" }); }
    finally { setTimeout(() => setTestMsgState("idle"), 3000); }
  };

  function toggleAlert(key: keyof TelegramAlerts) {
    const next = { ...alertToggles, [key]: !alertToggles[key] };
    setAlertToggles(next);
    alertToggleMutation.mutate(next);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});
  const needsReconnect = tokenExpired || (!isConnected && !tokenExpired);

  const brokerCardCls = isConnected
    ? "border-success/30"
    : tokenExpired
    ? "border-destructive/40"
    : "border-border/50";

  return (
    /* Centered, max-width container — responsive padding handled by layout */
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">

      {/* ══ BROKER CONNECTION ══════════════════════════════════════════════════ */}
      <div className={`rounded-2xl border bg-card overflow-hidden shadow-sm ${brokerCardCls}`}>

        {/* Status header */}
        <div className={`px-4 sm:px-5 py-4 flex items-center justify-between border-b gap-3 ${
          isConnected ? "bg-success/8 border-success/20"
          : tokenExpired ? "bg-destructive/8 border-destructive/20"
          : "bg-muted/10 border-border/30"
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isConnected ? "bg-success/15" : tokenExpired ? "bg-destructive/10" : "bg-muted/30"
            }`}>
              {isConnected ? <Wifi className="w-5 h-5 text-success" />
                : tokenExpired ? <Clock className="w-5 h-5 text-destructive" />
                : <WifiOff className="w-5 h-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Broker Connection</p>
              <p className={`text-xs mt-0.5 truncate ${isConnected ? "text-success" : tokenExpired ? "text-destructive" : "text-muted-foreground"}`}>
                {isConnected ? "Connected"
                  : tokenExpired ? "Token expired"
                  : "Disconnected"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isConnected && (
              <><div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-[11px] font-bold text-success uppercase tracking-wider hidden sm:inline">Live</span></>
            )}
            {!isConnected && !tokenExpired && (
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider hidden sm:inline">Disconnected</span>
            )}
          </div>
        </div>


        {/* Balance row when connected */}
        {isConnected && funds.availableBalance !== undefined && (
          <div className="px-4 sm:px-5 py-2.5 flex items-center gap-2 border-b border-border/25 bg-muted/5 text-xs flex-wrap">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-semibold text-success tabular-nums">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span className="text-border/60 mx-0.5">·</span>
            <span className="text-muted-foreground">Margin Used:</span>
            <span className="font-semibold text-warning tabular-nums">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            <span className="text-border/60 mx-0.5 hidden sm:inline">·</span>
            <span className="text-muted-foreground hidden sm:inline">Withdrawable:</span>
            <span className="font-semibold text-primary tabular-nums hidden sm:inline">₹{(funds.withdrawableBalance ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={brokerForm.handleSubmit(d => connectMutation.mutate(d))} className="px-4 sm:px-5 py-5 space-y-4">

          {/* Client ID + Access Token — stack on mobile, 2-col on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <SectionLabel>Dhan Client ID</SectionLabel>
              <Input
                className="h-10 bg-background/60"
                placeholder="Your Dhan Client ID"
                {...brokerForm.register("clientId")}
              />
            </div>
            <div className="space-y-1.5">
              <SectionLabel>Access Token</SectionLabel>
              <div className="relative">
                {(() => {
                  const { ref: rhfRef, ...rest } = brokerForm.register("accessToken");
                  return (
                    <Input
                      type={showToken ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder={tokenExpired ? "Paste new token here…" : "Your Dhan Access Token"}
                      className={`h-10 pr-10 bg-background/60 transition-all ${
                        tokenExpired ? "border-destructive ring-2 ring-destructive/30" : ""
                      }`}
                      {...rest}
                      ref={e => { rhfRef(e); accessTokenRef.current = e; }}
                    />
                  );
                })()}
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {tokenExpired && !totpPin && (
                <p className="text-[10px] text-destructive font-bold flex items-center gap-1">
                  Token Expired - Enter New Token
                </p>
              )}
            </div>
          </div>

          {/* Connection error */}
          {connectResult && !connectResult.success && (
            <div className="flex items-center gap-2 p-3 rounded-xl border border-destructive/30 bg-destructive/8 text-destructive text-xs">
              <XCircle className="w-3.5 h-3.5 shrink-0" />
              <span><span className="font-semibold">{connectResult.errorCode}:</span> {connectResult.errorMessage}</span>
            </div>
          )}

          {/* TOTP Generator */}
          <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Generate Token via TOTP</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <SectionLabel>Dhan PIN</SectionLabel>
                <Input
                  type="password" inputMode="numeric" maxLength={6} placeholder="••••••"
                  className="h-9 font-mono text-center tracking-widest bg-background/60"
                  value={totpPin}
                  onChange={e => { setTotpPin(e.target.value.replace(/\D/g, "").slice(0, 6)); setGenerateResult(null); }}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <SectionLabel>TOTP Code</SectionLabel>
                <Input
                  type="text" inputMode="numeric" maxLength={6} placeholder="000000"
                  className="h-9 font-mono text-center tracking-widest bg-background/60"
                  value={totpCode}
                  onChange={e => { setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setGenerateResult(null); }}
                  autoComplete="one-time-code"
                />
              </div>
            </div>
            {generateResult && !generateResult.success && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl border border-destructive/30 bg-destructive/8 text-destructive text-xs">
                <XCircle className="w-3.5 h-3.5 shrink-0" /><span>{generateResult.error}</span>
              </div>
            )}
            {generateResult?.success && (
              <div className="flex items-center gap-2 p-2.5 rounded-xl border border-success/30 bg-success/8 text-success text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>Token generated — broker connected{generateResult.expiryTime ? ` · expires ${generateResult.expiryTime.replace("T", " ")}` : ""}</span>
              </div>
            )}
            <Button
              type="button" variant="outline" size="sm"
              className="h-9 gap-1.5 w-full border-primary/30 text-primary hover:bg-primary/8"
              disabled={generateMutation.isPending || totpPin.length !== 6 || totpCode.length !== 6}
              onClick={() => generateMutation.mutate()}
            >
              {generateMutation.isPending
                ? <><span className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />Generating…</>
                : <>Generate Token & Broker Connect</>}
            </Button>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col sm:flex-row gap-2.5">
            <Button type="submit" size="sm" className="h-10 gap-1.5 flex-1" disabled={connectMutation.isPending}>
              {connectMutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting…</>
                : <><Zap className="w-3.5 h-3.5" />{isConnected ? "Reconnect" : "Save & Connect"}</>}
            </Button>
            {isConnected && (
              <Button
                type="button" variant="outline" size="sm"
                className="gap-1.5 h-10 border-destructive/40 text-destructive hover:bg-destructive/8"
                disabled={disconnectMutation.isPending}
                onClick={() => disconnectMutation.mutate()}
              >
                <LogOut className="w-3.5 h-3.5" />{disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* ══ BOTTOM SECTION — 2 columns on lg+, stacked on mobile/tablet ═══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── Telegram Alerts ── */}
        <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <div className="px-4 sm:px-5 py-3.5 flex items-center justify-between border-b border-border/30 bg-muted/5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
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
              <div className="flex items-center gap-1.5 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                <span className="text-[10px] font-semibold text-success">Active</span>
              </div>
            )}
          </div>

          <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="flex-1 flex flex-col px-4 sm:px-5 py-4 gap-4">
            <div className="space-y-1.5">
              <SectionLabel>Bot Token</SectionLabel>
              <div className="relative">
                <Input
                  type={showBotToken ? "text" : "password"}
                  className="h-10 font-mono text-xs pr-10 bg-background/60"
                  autoComplete="off"
                  {...telegramForm.register("telegramBotToken")}
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowBotToken(!showBotToken)}>
                  {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {telegramForm.formState.errors.telegramBotToken && (
                <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramBotToken.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <SectionLabel>Chat ID</SectionLabel>
              <Input type="text" className="h-10 font-mono bg-background/60" autoComplete="off" {...telegramForm.register("telegramChatId")} />
              {telegramForm.formState.errors.telegramChatId && (
                <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>
              )}
            </div>

            {settingsData?.hasTelegramToken && (
              <button
                type="button" onClick={sendTestMessage} disabled={testMsgState === "sending"}
                className={`w-full flex items-center justify-center gap-2 h-9 rounded-xl border text-xs font-semibold transition-all
                  ${testMsgState === "ok" ? "border-success/40 bg-success/10 text-success"
                  : testMsgState === "fail" ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-border/50 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground"}`}
              >
                {testMsgState === "sending" ? <><span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />Sending…</>
                  : testMsgState === "ok" ? <><CheckCircle2 className="w-3.5 h-3.5" />Message Delivered</>
                  : testMsgState === "fail" ? <><XCircle className="w-3.5 h-3.5" />Send Failed</>
                  : <><MessageCircle className="w-3.5 h-3.5" />Send Test Message</>}
              </button>
            )}

            <div className="space-y-1">
              <SectionLabel>Notify me for</SectionLabel>
              <div className="rounded-xl border border-border/40 bg-muted/10 divide-y divide-border/30 overflow-hidden">
                {([
                  { key: "orderFills",     icon: Zap,          label: "Order fills & rejections" },
                  { key: "killSwitch",     icon: ShieldAlert,   label: "Kill switch activated / deactivated" },
                  { key: "autoSquareOff",  icon: Timer,         label: "Auto square-off executed" },
                  { key: "criticalErrors", icon: AlertTriangle, label: "Critical errors (token expired, IP blocked)" },
                ] as const).map(({ key, icon: Icon, label }) => (
                  <button
                    key={key} type="button" onClick={() => toggleAlert(key)}
                    className="w-full flex items-center gap-3 px-3.5 py-2.5 hover:bg-muted/20 transition-colors text-left"
                  >
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${alertToggles[key] ? "text-primary" : "text-muted-foreground/50"}`} />
                    <span className={`flex-1 text-xs ${alertToggles[key] ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
                    <span
                      className={`relative inline-flex items-center rounded-full transition-colors duration-200 shrink-0 ${alertToggles[key] ? "bg-primary" : "bg-muted-foreground/25"}`}
                      style={{ height: "18px", width: "32px" }}
                    >
                      <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${alertToggles[key] ? "translate-x-[16px]" : "translate-x-[2px]"}`} />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 mt-auto">
              <Button type="submit" size="sm" className="h-10 gap-1.5 flex-1" disabled={telegramMutation.isPending}>
                {telegramMutation.isPending
                  ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                  : <><Bell className="w-3.5 h-3.5" />{settingsData?.hasTelegramToken ? "Update Telegram" : "Save Telegram"}</>}
              </Button>
              {(settingsData?.hasTelegramToken || settingsData?.hasTelegramChatId) && (
                <Button type="button" variant="outline" size="sm"
                  className="h-10 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/8"
                  disabled={telegramResetMutation.isPending}
                  onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                  <XCircle className="w-3.5 h-3.5" />Reset
                </Button>
              )}
            </div>
          </form>
        </div>

        {/* ── Server IP ── */}
        <ServerIpInfo />
      </div>
    </div>
  );
}
