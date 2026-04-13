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
const riskSchema = z.object({ maxDailyLoss: z.coerce.number().min(0) });
const pnlExitSchema = z.object({ profitValue: z.coerce.number().min(1), lossValue: z.coerce.number().min(1), enableKillSwitch: z.boolean().default(false) });

interface SettingsData {
  id: number; apiConnected: boolean; maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean; autoSquareOffTime: string;
  maxTradesPerDay: number | null; maxPositionSizeValue: number | null; maxPositionSizeType: string;
  instrumentBlacklist: string[]; tradingHoursStart: string; tradingHoursEnd: string;
}
interface PnlExitStatus { pnlExitStatus?: string; profit?: string; loss?: string; productType?: string[]; enable_kill_switch?: boolean }

function SectionHeader({ color, icon, title, subtitle, badge }: { color: string; icon: React.ReactNode; title: string; subtitle: string; badge?: React.ReactNode }) {
  return (
    <div className={`flex items-start justify-between gap-3 px-5 py-3.5 border-b border-border/40 ${color}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div><p className="font-semibold text-sm">{title}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</p></div>
      </div>
      {badge}
    </div>
  );
}

function FR({ label, hint, ctrl, last = false }: { label: string; hint?: string; ctrl: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-3 py-3 ${!last ? "border-b border-border/25" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{hint}</p>}
      </div>
      <div className="shrink-0">{ctrl}</div>
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
    return <div className="grid grid-cols-3 gap-4 w-full">{[...Array(5)].map((_, i) => <Skeleton key={i} className={`h-44 rounded-xl ${i === 4 ? "col-span-3" : "col-span-1"}`} />)}</div>;
  }

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* ══ ROW 1 — Risk Management | P&L Based Exit | Auto Square-Off ══ */}

        {/* Risk Management */}
        <div className="col-span-1 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-orange-500/5" icon={<ShieldAlert className="w-4 h-4 text-orange-400" />} title="Risk Management" subtitle="Auto-reject orders when daily loss limit is hit" />
          <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="px-5 py-4">
            <div className="space-y-1.5 mb-4">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily Loss Limit (₹)</label>
              <Input type="number" min={0} step={500} placeholder="e.g. 5000" className="h-9" {...riskForm.register("maxDailyLoss")} />
              <p className="text-[11px] text-muted-foreground">Orders are blocked when today's total loss exceeds this amount</p>
              {riskForm.formState.errors.maxDailyLoss && <p className="text-[10px] text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>}
            </div>
            <Button type="submit" size="sm" className="gap-1.5 h-8 w-full" disabled={riskMutation.isPending}><Save className="w-3 h-3" />{riskMutation.isPending ? "Saving…" : "Save Loss Limit"}</Button>
          </form>
        </div>

        {/* P&L Based Exit */}
        <div className="col-span-1 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader
            color={pnlActive ? "bg-primary/5" : "bg-muted/10"}
            icon={<TrendingUp className="w-4 h-4 text-primary" />}
            title="P&L Based Exit"
            subtitle="Auto-exit all positions at profit or loss threshold"
            badge={pnlActive ? <Badge variant="outline" className="text-[10px] text-primary border-primary/40">ACTIVE</Badge> : undefined}
          />
          <div className="px-5 py-4">
            {!isConnected ? (
              <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground"><WifiOff className="w-3.5 h-3.5" />Connect broker first.</div>
            ) : (
              <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))}>
                {pnlActive && pnlStatus?.pnlExitStatus === "ACTIVE" && (
                  <div className="flex gap-4 text-xs bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 mb-3">
                    <span>Target <span className="text-green-400 font-semibold">₹{pnlStatus.profit}</span></span>
                    <span>Stop <span className="text-destructive font-semibold">₹{pnlStatus.loss}</span></span>
                    <span>KS <span className="font-semibold">{pnlStatus.enable_kill_switch ? "Yes" : "No"}</span></span>
                  </div>
                )}
                <FR label="Profit Target (₹)" hint="Exit all when cumulative profit hits this" ctrl={
                  <div className="w-32">
                    <Input type="number" min={1} placeholder="e.g. 1500" className="h-8 text-sm" {...pnlForm.register("profitValue")} />
                    {pnlForm.formState.errors.profitValue && <p className="text-[10px] text-destructive mt-0.5">Required</p>}
                  </div>
                } />
                <FR label="Loss Limit (₹)" hint="Exit all when cumulative loss hits this" ctrl={
                  <div className="w-32">
                    <Input type="number" min={1} placeholder="e.g. 500" className="h-8 text-sm" {...pnlForm.register("lossValue")} />
                    {pnlForm.formState.errors.lossValue && <p className="text-[10px] text-destructive mt-0.5">Required</p>}
                  </div>
                } />
                <FR label="Product Type" hint="Apply exit to INTRADAY positions" ctrl={
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={pnlProductTypes.includes("INTRADAY")} onCheckedChange={() => setPnlProductTypes(prev => prev.includes("INTRADAY") ? prev.filter(t => t !== "INTRADAY") : [...prev, "INTRADAY"])} />
                    INTRADAY
                  </label>
                } />
                <FR label="Also activate kill switch" hint="Trigger KS when threshold is hit" last ctrl={
                  <Checkbox checked={pnlForm.watch("enableKillSwitch")} onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)} />
                } />
                <div className="flex gap-2 pt-3">
                  <Button type="submit" size="sm" className="gap-1.5 h-8 flex-1" disabled={pnlExitMutation.isPending || !pnlProductTypes.length}>
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
          </div>
        </div>

        {/* Auto Square-Off Timer */}
        <div className="col-span-1 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-blue-500/5" icon={<Clock className="w-4 h-4 text-blue-400" />} title="Auto Square-Off Timer" subtitle="Exit all intraday positions at the set time · Mon–Fri" />
          <div className="px-5 py-4">
            <FR label="Enable Auto Square-Off" hint="Automatically exits all open intraday positions" ctrl={
              <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
            } />
            <FR label="Square-Off Time (IST)" hint="Recommended: 3:14 PM — just before market close" last ctrl={
              <input type="time" value={autoSquareOffTime} onChange={e => setAutoSquareOffTime(e.target.value)} className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
            } />
            <div className="pt-3">
              <Button size="sm" className="gap-1.5 h-8 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() => toast({ title: autoSquareOffEnabled ? `Square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })); }}>
                <Save className="w-3 h-3" />Save Timer
              </Button>
            </div>
          </div>
        </div>

        {/* ══ ROW 2 — Trading Guards (2-col) | Blacklist (1-col) ══ */}

        {/* Trading Guards */}
        <div className="col-span-2 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-orange-500/5" icon={<ShieldAlert className="w-4 h-4 text-orange-400" />} title="Trading Guards" subtitle="Caps on maximum trades, position size, and trading hours" />
          <div className="px-5 py-4">
            <div className="grid grid-cols-3 gap-5 mb-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Max Trades Per Day</label>
                <Input type="number" min={1} step={1} placeholder="e.g. 10" className="h-9" value={maxTradesPerDay} onChange={e => setMaxTradesPerDay(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Block new orders after this count. Empty = disabled.</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Max Position Size</label>
                <div className="flex gap-2">
                  <Input type="number" min={1} placeholder="Value" className="h-9 flex-1" value={maxPosValue} onChange={e => setMaxPosValue(e.target.value)} />
                  <Select value={maxPosType} onValueChange={setMaxPosType}>
                    <SelectTrigger className="w-28 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FIXED">₹ Fixed</SelectItem>
                      <SelectItem value="PERCENT">% Capital</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-[11px] text-muted-foreground">Block if order exceeds this value</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Trading Hours (IST)</label>
                <div className="flex items-center gap-2">
                  <input type="time" value={tradingStart} onChange={e => setTradingStart(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                  <span className="text-xs text-muted-foreground shrink-0">–</span>
                  <input type="time" value={tradingEnd} onChange={e => setTradingEnd(e.target.value)} className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                </div>
                <p className="text-[11px] text-muted-foreground">Orders only placed within this window</p>
              </div>
            </div>
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ maxTradesPerDay: maxTradesPerDay ? Number(maxTradesPerDay) : null, maxPositionSizeValue: maxPosValue ? Number(maxPosValue) : null, maxPositionSizeType: maxPosType, tradingHoursStart: tradingStart, tradingHoursEnd: tradingEnd }).then(() => toast({ title: "Trading guards saved" })); }}>
              <Save className="w-3 h-3" />Save Guards
            </Button>
          </div>
        </div>

        {/* Instrument Blacklist */}
        <div className="col-span-1 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-red-500/5" icon={<Ban className="w-4 h-4 text-red-400" />} title="Instrument Blacklist" subtitle="These symbols are always blocked, regardless of strategy" />
          <div className="px-5 py-4 space-y-3">
            <div className="flex gap-2">
              <Input placeholder="e.g. ADANIENT" className="h-8 text-sm font-mono flex-1" value={blacklistInput} onChange={e => setBlacklistInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && blacklistInput.trim()) { const sym = blacklistInput.trim().toUpperCase(); if (!blacklist.includes(sym)) setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); } }} />
              <Button type="button" size="sm" variant="outline" className="h-8 gap-1 shrink-0" onClick={() => { const sym = blacklistInput.trim().toUpperCase(); if (sym && !blacklist.includes(sym)) { setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); } }}><Plus className="w-3.5 h-3.5" />Add</Button>
            </div>
            {blacklist.length === 0 ? (
              <p className="text-xs text-muted-foreground">No symbols blacklisted</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {blacklist.map(sym => (
                  <span key={sym} className="inline-flex items-center gap-1 text-xs bg-red-500/10 text-red-400 border border-red-500/20 rounded-md px-2 py-1 font-mono">
                    {sym}
                    <button onClick={() => setBlacklist(prev => prev.filter(s => s !== sym))} className="hover:text-red-300 ml-0.5"><XCircle className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <Button size="sm" className="gap-1.5 h-8 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ instrumentBlacklist: blacklist }).then(() => toast({ title: `Blacklist saved — ${blacklist.length} symbol(s)` })); }}>
              <Save className="w-3 h-3" />Save Blacklist
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
