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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { ShieldAlert, TrendingUp, TrendingDown, Clock, Ban, Save, XCircle, Plus, WifiOff } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const riskSchema = z.object({ maxDailyLoss: z.coerce.number().min(0, "Must be ≥ 0") });
const pnlExitSchema = z.object({
  profitValue: z.coerce.number().min(1, "Must be > 0"),
  lossValue: z.coerce.number().min(1, "Must be > 0"),
  enableKillSwitch: z.boolean().default(false),
});

interface SettingsData {
  id: number; apiConnected: boolean; maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  maxTradesPerDay: number | null; maxPositionSizeValue: number | null; maxPositionSizeType: string;
  instrumentBlacklist: string[]; tradingHoursStart: string; tradingHoursEnd: string;
}
interface PnlExitStatus { pnlExitStatus?: string; profit?: string; loss?: string; productType?: string[]; enable_kill_switch?: boolean }

function Panel({ accent, icon, title, subtitle, children, badge }: {
  accent: string; icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode; badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className={`flex items-start justify-between gap-3 px-5 py-4 border-b border-border/40 ${accent}`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{icon}</div>
          <div>
            <p className="font-semibold text-sm text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      <div className="px-5 py-4">{children}</div>
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

export default function RiskManager() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;

  const [autoSquareOffEnabled, setAutoSquareOffEnabled] = useState(false);
  const [autoSquareOffTime, setAutoSquareOffTime] = useState("15:14");
  const [maxTradesPerDay, setMaxTradesPerDay] = useState<string>("");
  const [maxPosValue, setMaxPosValue] = useState<string>("");
  const [maxPosType, setMaxPosType] = useState<string>("FIXED");
  const [tradingStart, setTradingStart] = useState("09:00");
  const [tradingEnd, setTradingEnd] = useState("15:30");
  const [blacklistInput, setBlacklistInput] = useState("");
  const [blacklist, setBlacklist] = useState<string[]>([]);
  const [pnlProductTypes, setPnlProductTypes] = useState<string[]>(["INTRADAY"]);
  const [pnlActive, setPnlActive] = useState(false);
  const [pnlLoaded, setPnlLoaded] = useState(false);

  useEffect(() => {
    if (!settingsData) return;
    setAutoSquareOffEnabled(settingsData.autoSquareOffEnabled ?? false);
    setAutoSquareOffTime(settingsData.autoSquareOffTime ?? "15:14");
    setMaxTradesPerDay(settingsData.maxTradesPerDay != null ? String(settingsData.maxTradesPerDay) : "");
    setMaxPosValue(settingsData.maxPositionSizeValue != null ? String(settingsData.maxPositionSizeValue) : "");
    setMaxPosType(settingsData.maxPositionSizeType ?? "FIXED");
    setTradingStart(settingsData.tradingHoursStart ?? "09:00");
    setTradingEnd(settingsData.tradingHoursEnd ?? "15:30");
    setBlacklist(settingsData.instrumentBlacklist ?? []);
  }, [settingsData?.id]);

  const riskForm = useForm<z.infer<typeof riskSchema>>({ resolver: zodResolver(riskSchema), defaultValues: { maxDailyLoss: 5000 } });
  const pnlForm = useForm<z.infer<typeof pnlExitSchema>>({ resolver: zodResolver(pnlExitSchema), defaultValues: { profitValue: undefined, lossValue: undefined, enableKillSwitch: false } });

  useEffect(() => {
    if (settingsData) riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
  }, [settingsData?.id]);

  const { data: pnlStatus, refetch: refetchPnl } = useQuery<PnlExitStatus>({
    queryKey: ["pnl-exit-status"], enabled: isConnected, staleTime: 0, gcTime: 0,
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
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl">

      {/* ── Row 1: Risk Management + P&L Exit ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel accent="bg-orange-500/5" icon={<ShieldAlert className="w-4 h-4 text-orange-400" />} title="Risk Management" subtitle="Auto-reject orders when daily loss limit is hit">
          <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))}>
            <Row label="Daily Loss Limit (₹)" hint="Orders blocked when today's total loss exceeds this" last>
              <div className="flex gap-2 items-start">
                <div className="w-36">
                  <Input type="number" min={0} step={500} placeholder="5000" className="h-8 text-sm" {...riskForm.register("maxDailyLoss")} />
                  {riskForm.formState.errors.maxDailyLoss && <p className="text-[10px] text-destructive mt-1">{riskForm.formState.errors.maxDailyLoss.message}</p>}
                </div>
                <Button type="submit" size="sm" className="h-8" disabled={riskMutation.isPending}>{riskMutation.isPending ? "…" : "Save"}</Button>
              </div>
            </Row>
          </form>
        </Panel>

        <Panel
          accent={pnlActive ? "bg-primary/5" : "bg-muted/10"}
          icon={<TrendingUp className="w-4 h-4 text-primary" />}
          title="P&L Based Exit"
          subtitle="Auto-exit all positions at threshold · Resets daily"
          badge={pnlActive ? <Badge variant="outline" className="text-[10px] text-primary border-primary/40">ACTIVE</Badge> : undefined}
        >
          {!isConnected ? (
            <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground"><WifiOff className="w-3.5 h-3.5" />Connect broker first.</div>
          ) : (
            <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))}>
              {pnlActive && pnlStatus?.pnlExitStatus === "ACTIVE" && (
                <div className="flex gap-4 text-xs bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5 mb-3">
                  <span>Target <span className="text-green-400 font-semibold">₹{pnlStatus.profit}</span></span>
                  <span>Stop <span className="text-destructive font-semibold">₹{pnlStatus.loss}</span></span>
                  <span>KS <span className="font-semibold">{pnlStatus.enable_kill_switch ? "Yes" : "No"}</span></span>
                </div>
              )}
              <Row label="Profit Target (₹)" hint="Exit when cumulative profit hits this">
                <div className="w-36">
                  <Input type="number" min={1} step={1} placeholder="e.g. 1500" className="h-8 text-sm" {...pnlForm.register("profitValue")} />
                  {pnlForm.formState.errors.profitValue && <p className="text-[10px] text-destructive mt-1">Required</p>}
                </div>
              </Row>
              <Row label="Loss Limit (₹)" hint="Exit when cumulative loss hits this">
                <div className="w-36">
                  <Input type="number" min={1} step={1} placeholder="e.g. 500" className="h-8 text-sm" {...pnlForm.register("lossValue")} />
                  {pnlForm.formState.errors.lossValue && <p className="text-[10px] text-destructive mt-1">Required</p>}
                </div>
              </Row>
              <Row label="Product Type" hint="Apply exit to these position types">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={pnlProductTypes.includes("INTRADAY")} onCheckedChange={() => setPnlProductTypes(prev => prev.includes("INTRADAY") ? prev.filter(t => t !== "INTRADAY") : [...prev, "INTRADAY"])} />
                  INTRADAY
                </label>
              </Row>
              <Row label="Also activate kill switch" hint="Trigger kill switch when threshold is hit" last>
                <Checkbox checked={pnlForm.watch("enableKillSwitch")} onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)} />
              </Row>
              <div className="flex gap-2 pt-3">
                <Button type="submit" size="sm" className="gap-1.5 h-8" disabled={pnlExitMutation.isPending || !pnlProductTypes.length}>
                  <TrendingUp className="w-3 h-3" />{pnlExitMutation.isPending ? "Activating…" : pnlActive ? "Update" : "Activate"}
                </Button>
                {pnlActive && (
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10" disabled={stopPnlExitMutation.isPending} onClick={() => stopPnlExitMutation.mutate()}>
                    <TrendingDown className="w-3 h-3" />{stopPnlExitMutation.isPending ? "…" : "Stop"}
                  </Button>
                )}
              </div>
            </form>
          )}
        </Panel>
      </div>

      {/* ── Row 2: Trading Guards + Auto Square-Off ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel accent="bg-orange-500/5" icon={<ShieldAlert className="w-4 h-4 text-orange-400" />} title="Trading Guards" subtitle="Caps on trades, position size, and trading hours">
          <Row label="Max Trades Per Day" hint="Block orders after this count. Empty = disabled.">
            <Input type="number" min={1} step={1} placeholder="e.g. 10" className="w-32 h-8 text-sm" value={maxTradesPerDay} onChange={e => setMaxTradesPerDay(e.target.value)} />
          </Row>
          <Row label="Max Position Size" hint={maxPosType === "FIXED" ? "Block if order value exceeds ₹" + (maxPosValue || "—") : "Block if order exceeds " + (maxPosValue || "—") + "% of capital"}>
            <div className="flex gap-2">
              <Input type="number" min={1} placeholder="Value" className="w-24 h-8 text-sm" value={maxPosValue} onChange={e => setMaxPosValue(e.target.value)} />
              <Select value={maxPosType} onValueChange={setMaxPosType}>
                <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED">₹ Fixed</SelectItem>
                  <SelectItem value="PERCENT">% Capital</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </Row>
          <Row label="Trading Hours (IST)" hint="Orders placed only within this window" last>
            <div className="flex items-center gap-2">
              <input type="time" value={tradingStart} onChange={e => setTradingStart(e.target.value)} className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="time" value={tradingEnd} onChange={e => setTradingEnd(e.target.value)} className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            </div>
          </Row>
          <div className="pt-3">
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ maxTradesPerDay: maxTradesPerDay ? Number(maxTradesPerDay) : null, maxPositionSizeValue: maxPosValue ? Number(maxPosValue) : null, maxPositionSizeType: maxPosType, tradingHoursStart: tradingStart, tradingHoursEnd: tradingEnd }).then(() => toast({ title: "Trading guards saved" })); }}>
              <Save className="w-3 h-3" />Save Guards
            </Button>
          </div>
        </Panel>

        <Panel accent="bg-blue-500/5" icon={<Clock className="w-4 h-4 text-blue-400" />} title="Auto Square-Off Timer" subtitle="Exit all intraday positions at the set time · Mon–Fri only">
          <Row label="Enable Auto Square-Off" hint="Automatically exits all open intraday positions">
            <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
          </Row>
          <Row label="Square-Off Time (IST)" hint="Recommended: 3:14 PM — 1 min before market close" last>
            <input type="time" value={autoSquareOffTime} onChange={e => setAutoSquareOffTime(e.target.value)} className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </Row>
          <div className="pt-3">
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() => toast({ title: autoSquareOffEnabled ? `Square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })); }}>
              <Save className="w-3 h-3" />Save Timer
            </Button>
          </div>
        </Panel>
      </div>

      {/* ── Instrument Blacklist ── */}
      <Panel accent="bg-red-500/5" icon={<Ban className="w-4 h-4 text-red-400" />} title="Instrument Blacklist" subtitle="Orders for these symbols are always blocked, regardless of strategy">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Symbol e.g. ADANIENT" className="h-8 text-sm font-mono" value={blacklistInput} onChange={e => setBlacklistInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && blacklistInput.trim()) { const sym = blacklistInput.trim().toUpperCase(); if (!blacklist.includes(sym)) setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); } }} />
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 shrink-0" onClick={() => { const sym = blacklistInput.trim().toUpperCase(); if (sym && !blacklist.includes(sym)) { setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); } }}>
              <Plus className="w-3.5 h-3.5" />Add
            </Button>
          </div>
          {blacklist.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">No symbols blacklisted</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {blacklist.map(sym => (
                <span key={sym} className="inline-flex items-center gap-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-md px-2 py-1 font-mono">
                  {sym}
                  <button onClick={() => setBlacklist(prev => prev.filter(s => s !== sym))} className="hover:text-red-300 ml-0.5"><XCircle className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
          <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ instrumentBlacklist: blacklist }).then(() => toast({ title: `Blacklist saved — ${blacklist.length} symbol(s)` })); }}>
            <Save className="w-3 h-3" />Save Blacklist
          </Button>
        </div>
      </Panel>
    </div>
  );
}
