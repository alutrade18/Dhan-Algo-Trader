import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  ShieldAlert, Clock, Save, WifiOff,
  Power, Lock, Eye, EyeOff, Trash2, CheckCircle2, AlertTriangle,
  IndianRupee, Timer,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const riskSchema = z.object({ maxDailyLoss: z.coerce.number().min(0) });

interface SettingsData {
  id: number; apiConnected: boolean; maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  hasKillSwitchPin: boolean;
}
interface KillSwitchStatus { killSwitchStatus?: string; isActive?: boolean; canDeactivateToday?: boolean; deactivationsUsed?: number }

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</p>;
}

export default function RiskManager() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;

  const [autoSquareOffEnabled, setAutoSquareOffEnabled] = useState(false);
  const [autoSquareOffTime, setAutoSquareOffTime] = useState("15:14");

  const [optimisticKsActive, setOptimisticKsActive] = useState<boolean | null>(null);
  const [pinDialogFor, setPinDialogFor] = useState<string | null>(null);
  const [pinVerifyInput, setPinVerifyInput] = useState("");

  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePinStep, setDeletePinStep] = useState<"enter" | "confirm">("enter");
  const [deletePinFirst, setDeletePinFirst] = useState("");
  const [deletePinSecond, setDeletePinSecond] = useState("");
  const [showDeleteFirst, setShowDeleteFirst] = useState(false);
  const [showDeleteSecond, setShowDeleteSecond] = useState(false);

  useEffect(() => {
    if (!settingsData) return;
    setAutoSquareOffEnabled(settingsData.autoSquareOffEnabled ?? false);
    setAutoSquareOffTime(settingsData.autoSquareOffTime ?? "15:14");
  }, [settingsData?.id]);

  const riskForm = useForm<z.infer<typeof riskSchema>>({ resolver: zodResolver(riskSchema), defaultValues: { maxDailyLoss: 0 } });

  useEffect(() => {
    if (settingsData) riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 0 });
  }, [settingsData?.id]);

  const { data: ksStatus, refetch: refetchKs } = useQuery<KillSwitchStatus>({
    queryKey: ["killswitch-status"], enabled: isConnected, refetchInterval: 15000, staleTime: 0, gcTime: 0,
    queryFn: async () => { if (!isConnected) return {}; const r = await fetch(`${BASE}api/risk/killswitch`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } }); if (!r.ok) return {}; return r.json(); },
  });

  const killSwitchActive = optimisticKsActive !== null ? optimisticKsActive
    : (ksStatus?.isActive === true || ksStatus?.killSwitchStatus === "ACTIVE" || ksStatus?.killSwitchStatus === "ACTIVATE");
  const canDeactivate = ksStatus?.canDeactivateToday !== false;

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

  function closeDeleteModal() {
    setShowDeleteModal(false);
    setDeletePinStep("enter");
    setDeletePinFirst("");
    setDeletePinSecond("");
    setShowDeleteFirst(false);
    setShowDeleteSecond(false);
  }

  async function handleConfirmDelete() {
    await genericSaveMutation.mutateAsync({ clearKillSwitchPin: true });
    toast({ title: "PIN removed" });
    closeDeleteModal();
    queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
  }

  if (isLoading) {
    return (
      <div className="space-y-4 w-full">
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-56 rounded-2xl" />
          <Skeleton className="h-56 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-52 rounded-2xl" />
          <Skeleton className="h-52 rounded-2xl" />
        </div>
        <Skeleton className="h-44 rounded-2xl w-full" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">

      {/* ── Kill Switch PIN verify dialog ── */}
      {pinDialogFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-background border border-border rounded-2xl p-7 w-[340px] space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
                <Lock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">PIN Required</h3>
                <p className="text-[11px] text-muted-foreground">
                  {pinDialogFor === "ACTIVATE" ? "Activate" : "Deactivate"} kill switch
                </p>
              </div>
            </div>
            <Input type="password" placeholder="• • • •" maxLength={4} value={pinVerifyInput} onChange={e => setPinVerifyInput(e.target.value)} onKeyDown={e => e.key === "Enter" && void verifyPinAndProceed()} className="text-center text-2xl tracking-[0.5em] font-mono h-12" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => { setPinDialogFor(null); setPinVerifyInput(""); }}>Cancel</Button>
              <Button size="sm" className="flex-1 h-9" onClick={() => void verifyPinAndProceed()} disabled={pinVerifyInput.length < 4}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete PIN modal ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
          <div className="bg-background border border-border rounded-2xl p-7 w-[340px] shadow-2xl space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Delete Kill Switch PIN</h3>
                <p className="text-[11px] text-muted-foreground">
                  {deletePinStep === "enter" ? "Step 1 of 2 — Enter current PIN" : "Step 2 of 2 — Confirm deletion"}
                </p>
              </div>
            </div>

            {deletePinStep === "enter" && (
              <>
                <p className="text-xs text-muted-foreground">Enter your 4-digit PIN to continue.</p>
                <div className="relative">
                  <Input type={showDeleteFirst ? "text" : "password"} placeholder="• • • •" maxLength={4}
                    className="text-center text-2xl tracking-[0.5em] font-mono h-12 pr-12"
                    value={deletePinFirst} onChange={e => setDeletePinFirst(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    autoFocus onKeyDown={e => { if (e.key === "Enter" && deletePinFirst.length === 4) setDeletePinStep("confirm"); }}
                  />
                  <button type="button" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowDeleteFirst(v => !v)}>
                    {showDeleteFirst ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 h-9" onClick={closeDeleteModal}>Cancel</Button>
                  <Button size="sm" variant="destructive" className="flex-1 h-9" disabled={deletePinFirst.length !== 4} onClick={() => setDeletePinStep("confirm")}>Next →</Button>
                </div>
              </>
            )}

            {deletePinStep === "confirm" && (
              <>
                <div className="flex items-start gap-2.5 rounded-xl bg-destructive/10 border border-destructive/25 px-4 py-3 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Re-enter the same PIN to permanently delete it. This cannot be undone.</span>
                </div>
                <div className="relative">
                  <Input type={showDeleteSecond ? "text" : "password"} placeholder="• • • •" maxLength={4}
                    className={`text-center text-2xl tracking-[0.5em] font-mono h-12 pr-12 ${deletePinSecond.length === 4 && deletePinSecond !== deletePinFirst ? "border-destructive ring-1 ring-destructive/50" : ""}`}
                    value={deletePinSecond} onChange={e => setDeletePinSecond(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    autoFocus onKeyDown={e => { if (e.key === "Enter" && deletePinSecond === deletePinFirst) void handleConfirmDelete(); }}
                  />
                  <button type="button" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowDeleteSecond(v => !v)}>
                    {showDeleteSecond ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {deletePinSecond.length === 4 && deletePinSecond !== deletePinFirst && (
                  <p className="text-[11px] text-destructive font-medium">PINs do not match</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 h-9" onClick={() => { setDeletePinStep("enter"); setDeletePinSecond(""); setShowDeleteSecond(false); }}>← Back</Button>
                  <Button size="sm" variant="destructive" className="flex-1 h-9 gap-1.5"
                    disabled={deletePinSecond.length !== 4 || deletePinSecond !== deletePinFirst || genericSaveMutation.isPending}
                    onClick={() => void handleConfirmDelete()}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {genericSaveMutation.isPending ? "Deleting…" : "Confirm Delete"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Row 1: Risk Management | Auto Square-Off ── */}
      <div className="grid grid-cols-2 gap-4 items-stretch">

        {/* Risk Management */}
        <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-border/30 bg-muted/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                <ShieldAlert className="w-4 h-4 text-primary" />
              </div>
              <p className="font-semibold text-sm">Risk Management</p>
            </div>
          </div>
          <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="flex-1 flex flex-col px-5 py-4 space-y-4">
            {settingsData?.maxDailyLoss != null && (
              <div className="flex items-center justify-between rounded-xl bg-muted/20 border border-border/30 px-4 py-3">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5"><ShieldAlert className="w-3 h-3 text-muted-foreground" />Current limit</span>
                <span className="text-lg font-bold text-foreground tabular-nums">₹{Number(settingsData.maxDailyLoss).toLocaleString("en-IN")}</span>
              </div>
            )}
            <div className="space-y-1.5">
              <SectionLabel>Daily Loss Limit (₹)</SectionLabel>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input type="number" min={0} step={500} className="h-11 pl-8 text-base font-semibold tabular-nums bg-background/60" {...riskForm.register("maxDailyLoss")} />
              </div>
              {riskForm.formState.errors.maxDailyLoss && <p className="text-[10px] text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>}
            </div>
            <Button type="submit" size="sm" className="w-full h-10 gap-1.5 mt-auto" disabled={riskMutation.isPending}>
              {riskMutation.isPending ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : <><Save className="w-3.5 h-3.5" />Save Limit</>}
            </Button>
          </form>
        </div>

        {/* Auto Square-Off Timer */}
        <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-border/30 bg-muted/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                <Timer className="w-4 h-4 text-primary" />
              </div>
              <p className="font-semibold text-sm">Auto Square-Off</p>
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full border ${autoSquareOffEnabled ? "bg-primary/15 text-primary border-primary/30" : "bg-muted/20 text-muted-foreground border-border/40"}`}>
              {autoSquareOffEnabled ? "ON" : "OFF"}
            </span>
          </div>
          <div className="flex-1 flex flex-col px-5 py-4 space-y-4">
            <div className="flex items-center justify-between rounded-xl bg-muted/20 border border-border/30 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <Clock className="w-3.5 h-3.5 text-primary" />
                <span className="text-sm font-medium">Enable Square-Off</span>
              </div>
              <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
            </div>
            <div className="space-y-1.5">
              <SectionLabel>Square-Off Time (IST)</SectionLabel>
              <input
                type="time"
                value={autoSquareOffTime}
                onChange={e => setAutoSquareOffTime(e.target.value)}
                className="h-11 w-full rounded-xl border border-input bg-background/60 px-4 text-base font-mono font-semibold focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring tabular-nums"
              />
            </div>
            <Button size="sm" className="w-full h-10 gap-1.5 mt-auto" onClick={() => { void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() => toast({ title: autoSquareOffEnabled ? `Square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })); }}>
              <Save className="w-3.5 h-3.5" />Save Timer
            </Button>
          </div>
        </div>
      </div>

      {/* ── Row 2: Emergency Kill Switch | Kill Switch PIN ── */}
      <div className="grid grid-cols-2 gap-4 items-stretch">

        {/* Emergency Kill Switch */}
        <div className={`flex flex-col rounded-2xl border overflow-hidden shadow-sm transition-all ${killSwitchActive ? "border-destructive/50 bg-destructive/5" : "border-border/50 bg-card"}`}>
          <div className={`px-5 py-3.5 border-b flex items-center justify-between ${killSwitchActive ? "border-destructive/30 bg-destructive/10" : "border-border/30 bg-muted/5"}`}>
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${killSwitchActive ? "bg-destructive/25" : "bg-muted/25"}`}>
                <Power className={`w-4 h-4 ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`} />
              </div>
              <p className="font-semibold text-sm">Emergency Kill Switch</p>
            </div>
            <div className="flex items-center gap-2.5">
              {settingsData?.hasKillSwitchPin && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-primary/10 border border-primary/25 px-2 py-0.5 rounded-full">
                  <Lock className="w-2.5 h-2.5" />PIN
                </span>
              )}
              {killSwitchActive ? (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-destructive uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />ACTIVE
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-[10px] font-bold text-success uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />INACTIVE
                </span>
              )}
            </div>
          </div>
          <div className="flex-1 flex flex-col px-5 py-5 gap-4">

            {/* Status placeholder — real-time from API */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${killSwitchActive ? "bg-destructive/10 border-destructive/30" : "bg-muted/15 border-border/30"}`}>
              <Power className={`w-4 h-4 shrink-0 ${killSwitchActive ? "text-destructive" : "text-muted-foreground/50"}`} />
              <span className={`text-sm font-semibold ${killSwitchActive ? "text-destructive" : "text-muted-foreground"}`}>
                {!isConnected ? "Broker not connected" : killSwitchActive ? "Kill Switch Activated" : "Not Activated"}
              </span>
            </div>

            {/* Action buttons */}
            <div className="mt-auto">
              {!isConnected ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <WifiOff className="w-3.5 h-3.5 shrink-0" />Connect broker first to use kill switch.
                </div>
              ) : killSwitchActive ? (
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    className={`w-full h-10 gap-2 ${canDeactivate ? "border-success/40 text-success hover:bg-success/8" : "opacity-40 cursor-not-allowed"}`}
                    disabled={killSwitchMutation.isPending || !canDeactivate}
                    onClick={() => canDeactivate && handleKillSwitchAction("DEACTIVATE")}
                  >
                    <Power className="w-4 h-4" />{killSwitchMutation.isPending ? "Deactivating…" : "Deactivate Kill Switch"}
                  </Button>
                  {!canDeactivate && <p className="text-[11px] text-muted-foreground text-center">Resets at midnight IST</p>}
                </div>
              ) : !settingsData?.hasKillSwitchPin ? (
                <div className="space-y-2.5">
                  <Button variant="destructive" className="w-full h-10 gap-2 font-semibold opacity-40 cursor-not-allowed" disabled>
                    <Power className="w-4 h-4" />Activate Kill Switch
                  </Button>
                  <div className="flex items-start gap-2 rounded-xl bg-warning/8 border border-warning/30 px-3 py-2.5">
                    <Lock className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                    <p className="text-[11px] text-warning font-medium leading-snug">Set a 4-digit PIN first to enable the Kill Switch.</p>
                  </div>
                </div>
              ) : (
                <Button variant="destructive" className="w-full h-10 gap-2 font-semibold" disabled={killSwitchMutation.isPending} onClick={() => handleKillSwitchAction("ACTIVATE")}>
                  <Power className="w-4 h-4" />{killSwitchMutation.isPending ? "Activating…" : "Activate Kill Switch"}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Kill Switch PIN */}
        <div className="flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-border/30 bg-muted/5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center">
                <Lock className="w-4 h-4 text-primary" />
              </div>
              <p className="font-semibold text-sm">Kill Switch PIN</p>
            </div>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${settingsData?.hasKillSwitchPin ? "bg-primary/12 text-primary border-primary/30" : "bg-muted/20 text-muted-foreground border-border/40"}`}>
              {settingsData?.hasKillSwitchPin ? "SET" : "NOT SET"}
            </span>
          </div>
          <div className="flex-1 flex flex-col px-5 py-4 space-y-3">
            {settingsData?.hasKillSwitchPin && (
              <div className="flex items-center gap-2 text-xs text-primary bg-primary/8 border border-primary/20 rounded-xl px-3 py-2.5">
                <Lock className="w-3 h-3 shrink-0" />Active — enter new PIN to change.
              </div>
            )}
            <div className="space-y-1.5">
              <SectionLabel>{settingsData?.hasKillSwitchPin ? "New PIN" : "Set PIN"}</SectionLabel>
              <div className="relative">
                <Input type={showPin ? "text" : "password"} placeholder="• • • •" maxLength={4}
                  className="h-10 text-center font-mono tracking-[0.4em] text-lg pr-10 bg-background/60"
                  value={pinInput} onChange={e => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setShowPin(!showPin)}>
                  {showPin ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <SectionLabel>Confirm PIN</SectionLabel>
              <Input type="password" placeholder="• • • •" maxLength={4}
                className={`h-10 text-center font-mono tracking-[0.4em] text-lg bg-background/60 ${pinInput && pinConfirm && pinInput !== pinConfirm ? "border-destructive ring-1 ring-destructive/40" : ""}`}
                value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
              {pinInput && pinConfirm && pinInput !== pinConfirm && <p className="text-[10px] text-destructive font-medium">PINs do not match</p>}
            </div>
            <div className="mt-auto space-y-2">
              <Button size="sm" className="w-full h-10 gap-1.5"
                disabled={pinInput.length !== 4 || pinInput !== pinConfirm || genericSaveMutation.isPending}
                onClick={() => { void genericSaveMutation.mutateAsync({ killSwitchPin: pinInput }).then(() => { toast({ title: settingsData?.hasKillSwitchPin ? "PIN updated" : "PIN set" }); setPinInput(""); setPinConfirm(""); queryClient.invalidateQueries({ queryKey: ["/api/settings"] }); }); }}
              >
                <Lock className="w-3.5 h-3.5" />{settingsData?.hasKillSwitchPin ? "Update PIN" : "Set PIN"}
              </Button>
              {settingsData?.hasKillSwitchPin && (
                <Button size="sm" variant="outline" className="w-full h-10 gap-1.5 border-destructive/35 text-destructive hover:bg-destructive/8"
                  onClick={() => { setDeletePinStep("enter"); setShowDeleteModal(true); }}
                >
                  <Trash2 className="w-3.5 h-3.5" />Delete PIN
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
