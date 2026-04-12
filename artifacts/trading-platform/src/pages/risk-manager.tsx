import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  ShieldAlert, TrendingUp, TrendingDown, Clock, Ban, Save, XCircle, Plus, WifiOff,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

const riskSchema = z.object({
  maxDailyLoss: z.coerce.number().min(0, "Must be ≥ 0"),
});

const pnlExitSchema = z.object({
  profitValue: z.coerce.number().min(1, "Must be > 0"),
  lossValue: z.coerce.number().min(1, "Must be > 0"),
  enableKillSwitch: z.boolean().default(false),
});

interface SettingsData {
  id: number;
  apiConnected: boolean;
  maxDailyLoss: number | null;
  autoSquareOffEnabled: boolean;
  autoSquareOffTime: string;
  maxTradesPerDay: number | null;
  maxPositionSizeValue: number | null;
  maxPositionSizeType: string;
  instrumentBlacklist: string[];
  tradingHoursStart: string;
  tradingHoursEnd: string;
}

interface PnlExitStatus {
  pnlExitStatus?: string;
  profit?: string;
  loss?: string;
  productType?: string[];
  enable_kill_switch?: boolean;
}

export default function RiskManager() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsData = settings as SettingsData | undefined;
  const isConnected = settingsData?.apiConnected ?? false;

  /* ── State ── */
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

  /* ── Seed state from settings ── */
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

  /* ── Forms ── */
  const riskForm = useForm<z.infer<typeof riskSchema>>({
    resolver: zodResolver(riskSchema),
    defaultValues: { maxDailyLoss: 5000 },
  });
  const pnlForm = useForm<z.infer<typeof pnlExitSchema>>({
    resolver: zodResolver(pnlExitSchema),
    defaultValues: { profitValue: undefined, lossValue: undefined, enableKillSwitch: false },
  });

  useEffect(() => {
    if (settingsData) {
      riskForm.reset({ maxDailyLoss: settingsData.maxDailyLoss ?? 5000 });
    }
  }, [settingsData?.id]);

  /* ── P&L Exit Status ── */
  const { data: pnlStatus, refetch: refetchPnl } = useQuery<PnlExitStatus>({
    queryKey: ["pnl-exit-status"],
    enabled: isConnected,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => {
      if (!isConnected) return {};
      const r = await fetch(`${BASE}api/risk/pnl-exit`, { cache: "no-store" });
      if (!r.ok) return {};
      return r.json();
    },
  });

  useEffect(() => {
    if (pnlStatus && !pnlLoaded) {
      const isActive = pnlStatus.pnlExitStatus === "ACTIVE";
      setPnlActive(isActive);
      if (isActive) {
        if (pnlStatus.productType?.length) setPnlProductTypes(pnlStatus.productType);
        pnlForm.reset({
          profitValue: pnlStatus.profit ? Number(pnlStatus.profit) : undefined,
          lossValue: pnlStatus.loss ? Number(pnlStatus.loss) : undefined,
          enableKillSwitch: pnlStatus.enable_kill_switch ?? false,
        });
      }
      setPnlLoaded(true);
    }
  }, [pnlStatus]);

  /* ── Helpers ── */
  async function saveSettings(data: Record<string, unknown>) {
    const res = await fetch(`${BASE}api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  }

  /* ── Mutations ── */
  const riskMutation = useMutation({
    mutationFn: (maxDailyLoss: number) => saveSettings({ maxDailyLoss }),
    onSuccess: () => {
      toast({ title: "Daily loss limit saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const genericSaveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const pnlExitMutation = useMutation({
    mutationFn: async (values: z.infer<typeof pnlExitSchema>) => {
      const res = await fetch(`${BASE}api/risk/pnl-exit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profitValue: values.profitValue,
          lossValue: values.lossValue,
          productType: pnlProductTypes,
          enableKillSwitch: values.enableKillSwitch,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string; errorMessage?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Request rejected by broker");
      }
      return res.json();
    },
    onSuccess: (_data, values) => {
      setPnlActive(true);
      void refetchPnl();
      toast({ title: "P&L Exit Activated", description: `Exit at ₹${values.profitValue} profit or ₹${values.lossValue} loss.` });
    },
    onError: (err: Error) => toast({ title: "Failed to set P&L exit", description: err.message, variant: "destructive" }),
  });

  const stopPnlExitMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}api/risk/pnl-exit`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      setPnlActive(false);
      setPnlLoaded(false);
      void refetchPnl();
      toast({ title: "P&L Exit Stopped" });
    },
    onError: (err: Error) => toast({ title: "Failed to stop P&L exit", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">

      {/* ── Row 1 — Risk Management + P&L Based Exit ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Risk Management */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" />Risk Management
            </CardTitle>
            <CardDescription className="text-xs">Auto-reject orders when daily loss limit is hit</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={riskForm.handleSubmit(v => riskMutation.mutate(v.maxDailyLoss))} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Daily Loss Limit (₹)</label>
                <p className="text-xs text-muted-foreground">Orders blocked when today's total loss exceeds this</p>
                <div className="flex gap-2">
                  <Input type="number" min={0} step={500} placeholder="5000" {...riskForm.register("maxDailyLoss")} />
                  <Button type="submit" variant="outline" disabled={riskMutation.isPending}>
                    {riskMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
                {riskForm.formState.errors.maxDailyLoss && (
                  <p className="text-xs text-destructive">{riskForm.formState.errors.maxDailyLoss.message}</p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {/* P&L Based Exit */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />P&L Based Exit
              {pnlActive && <Badge variant="outline" className="text-[10px] text-primary border-primary/40">ACTIVE</Badge>}
            </CardTitle>
            <CardDescription className="text-xs">Auto-exit positions at profit/loss threshold · Resets daily</CardDescription>
          </CardHeader>
          <CardContent>
            {!isConnected ? (
              <div className="rounded-md border border-muted bg-muted/30 p-3 text-xs text-muted-foreground flex items-start gap-2">
                <WifiOff className="w-3.5 h-3.5 mt-0.5 shrink-0" /><span>Connect broker first.</span>
              </div>
            ) : (
              <form onSubmit={pnlForm.handleSubmit(v => pnlExitMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-success" />Profit Target (₹)
                    </label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 1500" {...pnlForm.register("profitValue")} />
                    {pnlForm.formState.errors.profitValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.profitValue.message}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-destructive" />Loss Limit (₹)
                    </label>
                    <Input type="number" min={1} step={1} placeholder="e.g. 500" {...pnlForm.register("lossValue")} />
                    {pnlForm.formState.errors.lossValue && (
                      <p className="text-xs text-destructive">{pnlForm.formState.errors.lossValue.message}</p>
                    )}
                  </div>
                </div>
                {pnlActive && pnlStatus?.pnlExitStatus === "ACTIVE" && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1">
                    <p className="font-semibold text-primary">Currently Active on Dhan</p>
                    <div className="flex gap-4 text-muted-foreground flex-wrap">
                      <span>Profit: <span className="text-success font-medium">₹{pnlStatus.profit}</span></span>
                      <span>Loss: <span className="text-destructive font-medium">₹{pnlStatus.loss}</span></span>
                      <span>Kill Switch: <span className="font-medium">{pnlStatus.enable_kill_switch ? "Yes" : "No"}</span></span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-6 flex-wrap">
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={pnlProductTypes.includes("INTRADAY")}
                      onCheckedChange={() =>
                        setPnlProductTypes(prev =>
                          prev.includes("INTRADAY") ? prev.filter(t => t !== "INTRADAY") : [...prev, "INTRADAY"]
                        )
                      }
                    />
                    INTRADAY
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox
                      checked={pnlForm.watch("enableKillSwitch")}
                      onCheckedChange={v => pnlForm.setValue("enableKillSwitch", !!v)}
                    />
                    Also activate kill switch
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button type="submit" size="sm" className="gap-2" disabled={pnlExitMutation.isPending || !pnlProductTypes.length}>
                    <TrendingUp className="w-3.5 h-3.5" />
                    {pnlExitMutation.isPending ? "Activating..." : pnlActive ? "Update P&L Exit" : "Activate P&L Exit"}
                  </Button>
                  {pnlActive && (
                    <Button
                      type="button" variant="outline" size="sm"
                      className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={stopPnlExitMutation.isPending}
                      onClick={() => stopPnlExitMutation.mutate()}
                    >
                      {stopPnlExitMutation.isPending ? "Stopping..." : "Stop P&L Exit"}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Row 2 — Trading Guards + Auto Square-Off ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Trading Guards */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-warning" />Trading Guards
            </CardTitle>
            <CardDescription className="text-xs">Caps on trades per day, position size, and trading hours</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Max Trades Per Day</label>
              <p className="text-xs text-muted-foreground">Block new orders after this many trades. Leave empty to disable.</p>
              <Input
                type="number" min={1} step={1} placeholder="e.g. 10"
                value={maxTradesPerDay}
                onChange={e => setMaxTradesPerDay(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Max Position Size</label>
              <div className="flex gap-2">
                <Input
                  type="number" min={1} placeholder="Value"
                  value={maxPosValue}
                  onChange={e => setMaxPosValue(e.target.value)}
                />
                <Select value={maxPosType} onValueChange={setMaxPosType}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">₹ Fixed</SelectItem>
                    <SelectItem value="PERCENT">% Capital</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {maxPosType === "FIXED" ? "Block orders where value exceeds ₹" : "Block orders exceeding % of available capital"}
                {maxPosValue ? ` ${maxPosValue}${maxPosType === "PERCENT" ? "%" : ""}` : ""}
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Trading Hours Override</label>
              <div className="flex items-center gap-2">
                <input
                  type="time" value={tradingStart} onChange={e => setTradingStart(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <input
                  type="time" value={tradingEnd} onChange={e => setTradingEnd(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <p className="text-xs text-muted-foreground">Strategies will only place orders within these hours (IST)</p>
            </div>
            <Button
              size="sm" className="gap-2 w-full"
              onClick={() => {
                void genericSaveMutation.mutateAsync({
                  maxTradesPerDay: maxTradesPerDay ? Number(maxTradesPerDay) : null,
                  maxPositionSizeValue: maxPosValue ? Number(maxPosValue) : null,
                  maxPositionSizeType: maxPosType,
                  tradingHoursStart: tradingStart,
                  tradingHoursEnd: tradingEnd,
                }).then(() => toast({ title: "Trading guards saved" }));
              }}
            >
              <Save className="w-3.5 h-3.5" />Save Guards
            </Button>
          </CardContent>
        </Card>

        {/* Auto Square-Off Timer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />Auto Square-Off Timer
            </CardTitle>
            <CardDescription className="text-xs">Auto-exit all intraday positions at the set time · Runs Mon–Fri only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Enable Auto Square-Off</p>
                <p className="text-xs text-muted-foreground">Automatically squares off all open intraday positions</p>
              </div>
              <Switch checked={autoSquareOffEnabled} onCheckedChange={setAutoSquareOffEnabled} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Square-Off Time (IST)</label>
              <p className="text-xs text-muted-foreground">Default: 3:14 PM — set slightly before 3:15 PM to avoid last-minute congestion</p>
              <input
                type="time"
                value={autoSquareOffTime}
                onChange={e => setAutoSquareOffTime(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
            <Button
              size="sm" className="gap-2 w-full"
              onClick={() => {
                void genericSaveMutation.mutateAsync({ autoSquareOffEnabled, autoSquareOffTime }).then(() =>
                  toast({ title: autoSquareOffEnabled ? `Auto square-off set for ${autoSquareOffTime} IST` : "Auto square-off disabled" })
                );
              }}
            >
              <Save className="w-3.5 h-3.5" />Save Auto Square-Off
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Row 3 — Instrument Blacklist (full width) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Ban className="w-4 h-4 text-destructive" />Instrument Blacklist
          </CardTitle>
          <CardDescription className="text-xs">Orders for these symbols will always be blocked regardless of strategy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. ADANIENT, RELIANCE"
              value={blacklistInput}
              onChange={e => setBlacklistInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && blacklistInput.trim()) {
                  const sym = blacklistInput.trim().toUpperCase();
                  if (!blacklist.includes(sym)) setBlacklist(prev => [...prev, sym]);
                  setBlacklistInput("");
                }
              }}
            />
            <Button
              type="button" size="sm" variant="outline" className="gap-1 shrink-0"
              onClick={() => {
                const sym = blacklistInput.trim().toUpperCase();
                if (sym && !blacklist.includes(sym)) { setBlacklist(prev => [...prev, sym]); setBlacklistInput(""); }
              }}
            >
              <Plus className="w-3.5 h-3.5" />Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 min-h-[40px]">
            {blacklist.length === 0 && (
              <span className="text-xs text-muted-foreground">No symbols blacklisted</span>
            )}
            {blacklist.map(sym => (
              <span
                key={sym}
                className="inline-flex items-center gap-1 text-xs bg-destructive/10 text-destructive border border-destructive/20 rounded px-2 py-0.5 font-mono"
              >
                {sym}
                <button onClick={() => setBlacklist(prev => prev.filter(s => s !== sym))} className="hover:text-destructive/60 transition-colors">
                  <XCircle className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <Button
            size="sm" className="gap-2 w-full"
            onClick={() => {
              void genericSaveMutation.mutateAsync({ instrumentBlacklist: blacklist }).then(() =>
                toast({ title: `Blacklist saved — ${blacklist.length} symbol(s)` })
              );
            }}
          >
            <Save className="w-3.5 h-3.5" />Save Blacklist
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
