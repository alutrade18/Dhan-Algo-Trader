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
import { ShieldAlert, TrendingUp, TrendingDown, Clock, Save, WifiOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL;
const riskSchema = z.object({ maxDailyLoss: z.coerce.number().min(0) });
const pnlExitSchema = z.object({ profitValue: z.coerce.number().min(1), lossValue: z.coerce.number().min(1), enableKillSwitch: z.boolean().default(false) });

interface SettingsData {
  id: number; apiConnected: boolean; maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
}
interface PnlExitStatus { pnlExitStatus?: string; profit?: string; loss?: string; productType?: string[]; enable_kill_switch?: boolean }

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

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 gap-4 w-full">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="w-full">
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
    </div>
  );
}
