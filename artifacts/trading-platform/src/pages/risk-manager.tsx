import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  ShieldAlert, TrendingUp, TrendingDown, Clock, Save, WifiOff,
  Power, Lock, Eye, EyeOff, Trash2, CheckCircle2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const riskSchema = z.object({ maxDailyLoss: z.coerce.number().min(0) });
const pnlExitSchema = z.object({
  profitValue: z.coerce.number().min(1),
  lossValue: z.coerce.number().min(1),
  enableKillSwitch: z.boolean().default(false),
});

interface SettingsData {
  id: number; apiConnected: boolean; maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  hasKillSwitchPin: boolean;
}
interface PnlExitStatus { pnlExitStatus?: string; profit?: string; loss?: string; productType?: string[]; enable_kill_switch?: boolean }
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
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function RiskManager() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;

  const [autoSquareOffEnabled, setAutoSquareOffEnabled] = useState(false);
  const [autoSquareOffTime, setAutoSquareOffTime] = useState("15:14");
  const [pnlProductTypes, setPnlProductTypes] = useState<string[]>(["INTRADAY"]);
  const [pnlActive, setPnlActive] = useState(false);
  const [pnlLoaded, setPnlLoaded] = useState(false);

  const [optimisticKsActive, setOptimisticKsActive] = useState<boolean | null>(null);
  const [pinDialogFor, setPinDialogFor] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState("");

  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);

  const [deleteStep, setDeleteStep] = useState<"idle" | "confirming">("idle");
  const [deletePinEntry, setDeletePinEntry] = useState("");
  const [deletePinConfirm, setDeletePinConfirm] = useState("");
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [showDeleteConfirmPin, setShowDeleteConfirmPin] = useState(false);

  useEffect(() => {
    if (!settingsData) return;
    setAutoSquareOffEnabled(settingsData.autoSquareOffEnabled ?? false);
    setAutoSquareOffTime(settingsData.autoSquareOffTime ?? "15:14");
  }, [settingsData?.id]);

  const riskForm = useForm<z.infer<typeof riskSchema>>({ resolver: zodResolver(riskSchema), defaultValues: { maxDailyLoss: 5000 } });
  const pnlForm = useForm<z.infer<typeof pnlExitSchema>>({ resolver: zodResolver(pnlExitSchema), defaultValues: { profitValue: undefined, lossValue: undefined, enableKillSwitch: false } });

  useEffect(() => {
    if (settingsData) riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
  }, [settingsData?.id]);

  const { data: pnlStatus, refetch: refetchPnl } = useQuery<PnlExitStatus>({
    queryKey: ["pnl-exit-status"], enabled: isConnected, staleTime: 0, gcTime: 0, refetchInterval: 15_000,
    queryFn: async () => { if (!isConnected) return {}; const r = await fetch(`${BASE}api/risk/pnl-exit`, { cache: "no-store" }); if (!r.ok) return {}; return r.json(); },
  });
  const { data: ksStatus, refetch: refetchKs } = useQuery<KillSwitchStatus>({
    queryKey: ["killswitch-status"], enabled: isConnected, refetchInterval: 15000, staleTime: 0, gcTime: 0,
    queryFn: async () => { if (!isConnected) return {}; const r = await fetch(`${BASE}api/risk/killswitch`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }); if (!r.ok) return {}; return r.json(); },
  });

  const killSwitchActive = optimisticKsActive !== null ? optimisticKsActive
    : (ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE" || ksStatus?.killSwitchStatus === "ACTIVATE");
  const canDeactivate = ksStatus?.canDeactivateToday !== false;

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

  const riskMutation = useMutation({
    mutationFn: (maxDailyLoss: number) => saveSettings({ maxDailyLoss }),
    onSuccess: () => { toast({ title: "Daily loss limit saved" }); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });
  const genericSaveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
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
    onError: (err: Error) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });
  const killSwitchMutation = useMutation({
    mutationFn: async (status: "ACTIVATE" | "DEACTIVATE") => {
      const res = await fetch(`${BASE}api/risk/killswitch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const json = await res.json() as KillSwitchStatus & { error?: string; code?: string };
      if (!res.ok) throw { message: json.error ?? "Failed", code: (json as Record<string, unknown>).code };
      return json;
    },
    onSuccess: (_data, status) => {
      setOptimisticKsActive(status === "ACTIVATE");
      setTimeout(() => { setOptimisticKsActive(null); void refetchKs(); }, 2000);
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      toast({ title: status === "ACTIVATE" ? "Kill Switch Activated" : "Kill Switch Deactivated", variant: status === "ACTIVATE" ? "destructive" : "default", description: status === "ACTIVATE" ? "All order placement blocked." : "Trading resumed." });
    },
    onError: (err: { message?: string; code?: string }) => {
      if (err.code === "DAILY_LIMIT_REACHED") toast({ title: "Daily Limit Reached", description: "Auto-resets at midnight IST.", variant: "destructive" });
      else toast({ title: "Kill switch error", description: err.message ?? "Failed", variant: "destructive" });
    },
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

  function resetDeleteFlow() {
    setDeleteStep("idle");
    setDeletePinEntry("");
    setDeletePinConfirm("");
    setShowDeletePin(false);
    setShowDeleteConfirmPin(false);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 w-full">
        <div className="grid grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="col-span-2 h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">

      {/* PIN Verify Dialog */}
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

      {/* ── Row 1: Risk Management | P&L Based Exit | Auto Square-Off ── */}
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* Risk Management */}
        <Card>
          <CardHeader
            icon={<ShieldAlert className="w-3.5 h-3.5 text-orange-400" />}
            iconBg="bg-orange-500/15"
            title="Risk Management"
          />
          <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="px-5 pt-4 pb-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Daily Loss Limit (₹)</label>
              <Input type="number" min={0} step={500} className="h-10 text-base font-medium" {...riskForm.register("maxDailyLoss")} />
              {riskForm.formState.errors.maxDailyLoss && <p className="text-[10px] text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>}
            </div>
            <Button type="submit" size="sm" className="w-full h-9" disabled={riskMutation.isPending}>
              <Save className="w-3.5 h-3.5 mr-1.5" />{riskMutation.isPending ? "Saving…" : "Save Loss Limit"}
            </Button>
          </form>
        </Card>

        {/* P&L Based Exit */}
        <Card className={pnlActive ? "border-primary/40" : ""}>
          <CardHeader
            icon={<TrendingUp className="w-3.5 h-3.5 text-primary" />}
            iconBg={pnlActive ? "bg-primary/20" : "bg-primary/10"}
            title="P&L Based Exit"
            badge={pnlActive ? <Badge className="text-[10px] h-5 bg-primary/20 text-primary border border-primary/30 shadow-none">ACTIVE</Badge> : undefined}
          />
          <div className="px-5 pt-3 pb-5">
            {!isConnected ? (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <WifiOff className="w-3.5 h-3.5" />Connect broker first.
              </div>
            ) : (
              <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))} className="space-y-0">
                {pnlActive && pnlStatus?.pnlExitStatus === "ACTIVE" && (
                  <div className="flex gap-4 text-xs bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 mb-3">
                    <span>Target <span className="text-green-400 font-semibold">₹{pnlStatus.profit}</span></span>
                    <span>Stop <span className="text-destructive font-semibold">₹{pnlStatus.loss}</span></span>
                    <span>KS <span className="font-semibold">{pnlStatus.enable_kill_switch ? "Yes" : "No"}</span></span>
                  </div>
                )}
                <Field label="Profit Target (₹)">
                  <div>
                    <Input type="number" min={1} className="h-8 text-sm w-28" {...pnlForm.register("profitValue")} />
                    {pnlForm.formState.errors.profitValue && <p className="text-[10px] text-destructive mt-0.5">Required</p>}
                  </div>
                </Field>
                <Field label="Loss Limit (₹)">
                  <div>
                    <Input type="number" min={1} className="h-8 text-sm w-28" {...pnlForm.register("lossValue")} />
                    {pnlForm.formState.errors.lossValue && <p className="text-[10px] text-destructive mt-0.5">Required</p>}
                  </div>
                </Field>
                <Field label="Product Types">
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={pnlProductTypes.includes("INTRADAY")} onCheckedChange={() => setPnlProductTypes(prev => prev.includes("INTRADAY") ? prev.filter(t => t !== "INTRADAY") : [...prev, "INTRADAY"])} />
                      INTRADAY
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox checked={pnlProductTypes.includes("DELIVERY")} onCheckedChange={() => setPnlProductTypes(prev => prev.includes("DELIVERY") ? prev.filter(t => t !== "DELIVERY") : [...prev, "DELIVERY"])} />
                      DELIVERY (CNC)
                    </label>
                  </div>
                </Field>
                <Field label="Also activate kill switch" noBorder>
                  <Checkbox checked={pnlForm.watch("enableKillSwitch")} onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)} />
                </Field>
                <div className="flex gap-2 pt-4">
                  <Button type="submit" size="sm" className="h-9 flex-1 gap-1.5" disabled={pnlExitMutation.isPending || !pnlProductTypes.length}>
                    <TrendingUp className="w-3.5 h-3.5" />{pnlExitMutation.isPending ? "Activating…" : pnlActive ? "Update" : "Activate"}
                  </Button>
                  {pnlActive && (
                    <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={stopPnlExitMutation.isPending} onClick={() => stopPnlExitMutation.mutate()}>
                      <TrendingDown className="w-3.5 h-3.5" />{stopPnlExitMutation.isPending ? "…" : "Stop"}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </div>
        </Card>

        {/* Auto Square-Off Timer */}
        <Card>
          <CardHeader
            icon={<Clock className="w-3.5 h-3.5 text-blue-400" />}
            iconBg="bg-blue-500/15"
            title="Auto Square-Off Timer"
            badge={
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${autoSquareOffEnabled ? "bg-blue-500/15 text-blue-400 border-blue-500/30" : "bg-muted/30 text-muted-foreground border-border/50"}`}>
                {autoSquareOffEnabled ? "ON" : "OFF"}
              </span>
            }
          />
          <div className="px-5 pt-3 pb-5 space-y-4">
            <Field label="Enable Auto Square-Off">
              <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
            </Field>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Square-Off Time (IST)</label>
              <input
                type="time"
                value={autoSquareOffTime}
                onChange={e => setAutoSquareOffTime(e.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button size="sm" className="w-full h-9" onClick={() => { void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() => toast({ title: autoSquareOffEnabled ? `Square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })); }}>
              <Save className="w-3.5 h-3.5 mr-1.5" />Save Timer
            </Button>
          </div>
        </Card>

      </div>

      {/* ── Row 2: Emergency Kill Switch (2-wide) | Kill Switch PIN (1-wide) ── */}
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* Emergency Kill Switch */}
        <Card className={`col-span-2 ${killSwitchActive ? "border-destructive/40" : ""}`}>
          <CardHeader
            icon={<Power className={`w-3.5 h-3.5 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />}
            iconBg={killSwitchActive ? "bg-destructive/20" : "bg-muted/20"}
            title="Emergency Kill Switch"
            badge={
              <div className="flex items-center gap-2">
                {settingsData?.hasKillSwitchPin && (
                  <Badge variant="outline" className="text-[10px] h-5 text-amber-400 border-amber-500/30 gap-1">
                    <Lock className="w-2.5 h-2.5" />PIN Protected
                  </Badge>
                )}
                {killSwitchActive
                  ? <Badge className="text-[10px] h-5 bg-destructive/20 text-destructive border border-destructive/30 shadow-none">ACTIVE</Badge>
                  : <Badge variant="outline" className="text-[10px] h-5 text-green-400 border-green-500/30">INACTIVE</Badge>
                }
              </div>
            }
          />
          <div className="px-6 py-6">
            {!isConnected ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <WifiOff className="w-3.5 h-3.5" />Connect broker first to use kill switch.
              </div>
            ) : killSwitchActive ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 py-3 px-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
                  <Power className="w-4 h-4 shrink-0" />
                  <span>All order placement is currently blocked.</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className={`h-10 gap-2 px-6 ${canDeactivate ? "border-green-500/40 text-green-400 hover:bg-green-500/10" : "opacity-40 cursor-not-allowed"}`}
                  disabled={killSwitchMutation.isPending || !canDeactivate}
                  onClick={() => canDeactivate && handleKillSwitchAction("DEACTIVATE")}
                >
                  <Power className="w-4 h-4" />{killSwitchMutation.isPending ? "Deactivating…" : "Deactivate Kill Switch"}
                </Button>
                {!canDeactivate && <p className="text-[11px] text-muted-foreground">Daily deactivation limit reached. Resets at midnight IST.</p>}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Instantly halts all new order placement across all strategies. Use in emergencies only.</p>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-10 gap-2 px-6 text-sm"
                  disabled={killSwitchMutation.isPending}
                  onClick={() => handleKillSwitchAction("ACTIVATE")}
                >
                  <Power className="w-4 h-4" />{killSwitchMutation.isPending ? "Activating…" : "Activate Kill Switch"}
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Kill Switch PIN */}
        <Card>
          <CardHeader
            icon={<Lock className="w-3.5 h-3.5 text-amber-400" />}
            iconBg="bg-amber-500/15"
            title="Kill Switch PIN"
            badge={
              settingsData?.hasKillSwitchPin
                ? <Badge variant="outline" className="text-[10px] h-5 text-amber-400 border-amber-500/30 gap-1"><Lock className="w-2.5 h-2.5" />Set</Badge>
                : <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground border-border/50">Not Set</Badge>
            }
          />
          <div className="px-5 pt-3 pb-5 space-y-3">

            {/* Set / Change PIN */}
            {settingsData?.hasKillSwitchPin && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <Lock className="w-3 h-3 shrink-0" />PIN active — enter new PIN below to change.
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {settingsData?.hasKillSwitchPin ? "New PIN" : "Set PIN"}
              </label>
              <div className="relative">
                <Input
                  type={showPin ? "text" : "password"}
                  placeholder="••••"
                  maxLength={4}
                  className="h-9 text-center font-mono tracking-widest pr-9"
                  value={pinInput}
                  onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
                <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowPin(!showPin)}>
                  {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Confirm PIN</label>
              <Input
                type="password"
                placeholder="••••"
                maxLength={4}
                className={`h-9 text-center font-mono tracking-widest ${pinInput && pinConfirm && pinInput !== pinConfirm ? "border-destructive" : ""}`}
                value={pinConfirm}
                onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              {pinInput && pinConfirm && pinInput !== pinConfirm && <p className="text-[10px] text-destructive">PINs do not match</p>}
            </div>
            <Button
              size="sm"
              className="w-full h-9 gap-1.5"
              disabled={pinInput.length !== 4 || pinInput !== pinConfirm || genericSaveMutation.isPending}
              onClick={() => { void genericSaveMutation.mutateAsync({ killSwitchPin: pinInput }).then(() => { toast({ title: settingsData?.hasKillSwitchPin ? "PIN updated" : "PIN set" }); setPinInput(""); setPinConfirm(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}
            >
              <Lock className="w-3.5 h-3.5" />{settingsData?.hasKillSwitchPin ? "Update PIN" : "Set PIN"}
            </Button>

            {/* Delete PIN — requires re-entering PIN */}
            {settingsData?.hasKillSwitchPin && (
              <div className="border-t border-border/30 pt-3 space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Delete PIN</label>

                {deleteStep === "idle" && (
                  <>
                    <div className="relative">
                      <Input
                        type={showDeletePin ? "text" : "password"}
                        placeholder="Enter current PIN"
                        maxLength={4}
                        className="h-9 text-center font-mono tracking-widest pr-9"
                        value={deletePinEntry}
                        onChange={e => setDeletePinEntry(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowDeletePin(!showDeletePin)}>
                        {showDeletePin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {deletePinEntry.length === 4 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-9 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                        onClick={() => setDeleteStep("confirming")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />Delete PIN
                      </Button>
                    )}
                  </>
                )}

                {deleteStep === "confirming" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      <Trash2 className="w-3 h-3 shrink-0" />Enter the same PIN again to confirm deletion.
                    </div>
                    <div className="relative">
                      <Input
                        type={showDeleteConfirmPin ? "text" : "password"}
                        placeholder="Re-enter PIN to confirm"
                        maxLength={4}
                        className={`h-9 text-center font-mono tracking-widest pr-9 ${deletePinConfirm.length === 4 && deletePinConfirm !== deletePinEntry ? "border-destructive" : ""}`}
                        value={deletePinConfirm}
                        onChange={e => setDeletePinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
                        autoFocus
                      />
                      <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setShowDeleteConfirmPin(!showDeleteConfirmPin)}>
                        {showDeleteConfirmPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    {deletePinConfirm.length === 4 && deletePinConfirm !== deletePinEntry && (
                      <p className="text-[10px] text-destructive">PINs do not match</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-9 text-xs"
                        onClick={resetDeleteFlow}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-9 gap-1.5 text-xs"
                        disabled={deletePinConfirm.length !== 4 || deletePinConfirm !== deletePinEntry || genericSaveMutation.isPending}
                        onClick={() => { void genericSaveMutation.mutateAsync({ clearKillSwitchPin: true }).then(() => { toast({ title: "PIN removed" }); resetDeleteFlow(); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />Confirm Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

      </div>
    </div>
  );
}
