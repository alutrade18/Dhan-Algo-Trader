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
  Bell, AlertTriangle,
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
  telegramBotToken: string; telegramChatId: string;
}

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

function TokenExpiryWarning() {
  const [info, setInfo] = useState<{ hasToken: boolean; tokenUpdatedAt?: string } | null>(null);
  useEffect(() => { fetch(`${BASE}api/broker/token-info`).then(r => r.json()).then(setInfo).catch(() => {}); }, []);
  if (!info?.hasToken || !info.tokenUpdatedAt) return null;
  const expiresAt = new Date(new Date(info.tokenUpdatedAt).getTime() + 24 * 60 * 60 * 1000);
  const hoursLeft = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursLeft > 4) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 col-span-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <p className="text-xs text-amber-400">Token expires in ~{Math.max(0, Math.floor(hoursLeft))}h {Math.floor((hoursLeft % 1) * 60)}m. Renew now.</p>
      </div>
      <button className="text-xs text-amber-400 border border-amber-500/40 px-2.5 py-1 rounded-md hover:bg-amber-500/20 transition-colors whitespace-nowrap" onClick={async () => { const res = await fetch(`${BASE}api/broker/renew-token`, { method: "POST" }); const d = await res.json(); alert(d.success ? "Token renewed!" : "Renewal failed."); }}>
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
      <div className="space-y-4 w-full">
        <Skeleton className="h-36 rounded-2xl w-full" />
        <Skeleton className="h-40 rounded-2xl w-full" />
      </div>
    );
  }

  const funds: FundDetails = connectResult?.success ? connectResult : (brokerStatus?.connected ? brokerStatus : {});

  return (
    <div className="w-full space-y-4">
      <TokenExpiryWarning />

      {/* ── Broker Connection ── */}
      <Card className={isConnected ? "border-green-500/20" : "border-border/50"}>
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
      <Card>
        <CardHeader
          icon={<Bell className="w-3.5 h-3.5 text-violet-400" />}
          iconBg="bg-violet-500/15"
          title="Telegram Alerts"
          badge={settingsData?.telegramChatId
            ? <span className="text-[10px] font-semibold text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Active</span>
            : undefined}
        />
        <form onSubmit={telegramForm.handleSubmit(v => telegramMutation.mutate(v))} className="px-5 py-4">
          <div className="grid grid-cols-2 gap-5 mb-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Bot Token</label>
              <div className="relative">
                <Input type={showBotToken ? "text" : "password"} className="h-10 font-mono pr-10" autoComplete="off" {...telegramForm.register("telegramBotToken")} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowBotToken(!showBotToken)}>
                  {showBotToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {telegramForm.formState.errors.telegramBotToken && <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramBotToken.message}</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Chat ID</label>
              <Input type="text" className="h-10 font-mono" autoComplete="off" {...telegramForm.register("telegramChatId")} />
              {telegramForm.formState.errors.telegramChatId && <p className="text-[10px] text-destructive">{telegramForm.formState.errors.telegramChatId.message}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" className="h-9 px-5 gap-1.5" disabled={telegramMutation.isPending}>
              <Bell className="w-3.5 h-3.5" />{telegramMutation.isPending ? "Saving…" : "Save Telegram"}
            </Button>
            {(settingsData?.telegramBotToken || settingsData?.telegramChatId) && (
              <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" disabled={telegramResetMutation.isPending} onClick={() => { if (confirm("Remove saved Telegram credentials?")) telegramResetMutation.mutate(); }}>
                <XCircle className="w-3.5 h-3.5" />Reset
              </Button>
            )}
          </div>
        </form>
      </Card>

    </div>
  );
}
