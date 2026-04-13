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
  Bell, AlertTriangle, DollarSign, Send,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const brokerSchema = z.object({ clientId: z.string(), accessToken: z.string() });
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
  telegramBotToken: string; telegramChatId: string;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

function TokenExpiryWarning() {
  const [info, setInfo] = useState<{ hasToken: boolean; tokenUpdatedAt?: string } | null>(null);
  useEffect(() => { fetch(`${BASE}api/broker/token-info`).then(r => r.json()).then(setInfo).catch(() => {}); }, []);
  if (!info?.hasToken || !info.tokenUpdatedAt) return null;
  const expiresAt = new Date(new Date(info.tokenUpdatedAt).getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 4) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/10 to-amber-400/5 px-5 py-3 col-span-2">
      <div className="flex items-center gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-xs font-medium text-amber-300">
          Access token expires in <span className="font-bold">~{Math.max(0, Math.floor(hoursLeft))}h {Math.floor((hoursLeft % 1) * 60)}m</span> — renew to stay connected.
        </p>
      </div>
      <button
        className="text-xs font-semibold text-amber-400 border border-amber-500/50 px-3 py-1.5 rounded-lg hover:bg-amber-500/15 transition-colors whitespace-nowrap"
        onClick={async () => { const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" }); const d = await res.json(); alert(d.success ? "Token renewed!" : "Renewal failed."); }}
      >
        Renew Now
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
    if (settingsData) telegramForm.reset({ telegramBotToken: settingsData.telegramBotToken ?? "", telegramChatId: settingsData.telegramChatId ?? "" });
  }, [settingsData?.id]);

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
      const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => { toast({ title: "Telegram settings saved" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
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
      <TokenExpiryWarning />

      {/* ── Broker Connection ── */}
      <div className={`flex flex-col rounded-2xl border overflow-hidden shadow-sm transition-colors ${isConnected ? "border-green-500/30 bg-card" : "border-border/50 bg-card"}`}>

        {/* Status Banner */}
        <div className={`px-5 py-3.5 flex items-center justify-between ${isConnected ? "bg-green-500/8 border-b border-green-500/20" : "bg-muted/10 border-b border-border/30"}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isConnected ? "bg-green-500/15" : "bg-muted/30"}`}>
              {isConnected ? <Wifi className="w-4 h-4 text-green-400" /> : <WifiOff className="w-4 h-4 text-muted-foreground" />}
            </div>
            <div>
              <p className="text-sm font-semibold">Broker Connection</p>
              <p className={`text-[10px] font-medium ${isConnected ? "text-green-400" : "text-muted-foreground"}`}>
                {isConnected ? "Connected · Dhan Broker API" : "Not connected to Dhan"}
              </p>
            </div>
          </div>
          {isConnected && (
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-green-400 uppercase tracking-wider">Live</span>
            </div>
          )}
        </div>

        {/* Balance Stats — single inline row */}
        {isConnected && funds.availableBalance !== undefined && (
          <div className="px-5 py-2.5 flex items-center gap-1.5 border-b border-border/25 bg-muted/5 text-xs flex-wrap">
            <span className="text-muted-foreground">Available:</span>
            <span className="font-semibold text-green-400 tabular-nums">₹{(funds.availableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
            <span className="text-border/60 mx-1">·</span>
            <span className="text-muted-foreground">Margin Used:</span>
            <span className="font-semibold text-amber-400 tabular-nums">₹{(funds.utilizedAmount ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
            <span className="text-border/60 mx-1">·</span>
            <span className="text-muted-foreground">Withdrawable:</span>
            <span className="font-semibold text-blue-400 tabular-nums">₹{(funds.withdrawableBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
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
          <div className="flex items-center gap-2.5 pt-1">
            <Button type="submit" size="sm" className="h-9 px-6 gap-1.5 flex-1" disabled={connectMutation.isPending}>
              {connectMutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting…</>
                : <><DollarSign className="w-3.5 h-3.5" />{isConnected ? "Reconnect" : "Save & Connect"}</>}
            </Button>
            {isConnected && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5 h-9 border-destructive/40 text-destructive hover:bg-destructive/8" disabled={disconnectMutation.isPending} onClick={() => disconnectMutation.mutate()}>
                <LogOut className="w-3.5 h-3.5" />{disconnectMutation.isPending ? "…" : "Disconnect"}
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* ── Telegram Alerts ── */}
      <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">

        <div className="px-5 py-3.5 flex items-center justify-between border-b border-border/30 bg-violet-500/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
              <Send className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold">Telegram Alerts</p>
              <p className="text-[10px] text-muted-foreground">
                {settingsData?.telegramChatId ? "Notifications active" : "Not configured"}
              </p>
            </div>
          </div>
          {settingsData?.telegramChatId && (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[10px] font-semibold text-green-400">Active</span>
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
          <div className="flex items-center gap-2.5 pt-1">
            <Button type="submit" size="sm" className="h-9 px-6 gap-1.5 flex-1 bg-violet-600 hover:bg-violet-700 text-white" disabled={telegramMutation.isPending}>
              {telegramMutation.isPending
                ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>
                : <><Bell className="w-3.5 h-3.5" />Save Telegram</>}
            </Button>
            {(settingsData?.telegramBotToken || settingsData?.telegramChatId) && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/8" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                <XCircle className="w-3.5 h-3.5" />Reset
              </Button>
            )}
          </div>
        </form>
      </div>

    </div>
  );
}
