import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Bell, Smartphone, LayoutDashboard, RefreshCw, Save, CheckCircle2, XCircle } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface SettingsData {
  id: number;
  notificationPreferences: Record<string, boolean>;
  pushNotificationsEnabled: boolean;
  dashboardWidgets: Record<string, boolean>;
  refreshIntervalSeconds: number;
}

const NOTIF_ITEMS = [
  { key: "orderFilled",             label: "Order Filled",            desc: "When an order is fully executed" },
  { key: "targetHit",               label: "Target Hit",              desc: "When profit target is reached" },
  { key: "stopLossHit",             label: "Stop Loss Hit",           desc: "When stop loss is triggered" },
  { key: "killSwitchTriggered",     label: "Kill Switch Triggered",   desc: "Emergency halt events" },
  { key: "tokenExpiry",             label: "Token Expiry Warning",    desc: "4 hours before API token expiry" },
  { key: "strategyPausedActivated", label: "Strategy State Changed",  desc: "Strategy paused or activated" },
  { key: "autoSquareOff",           label: "Auto Square-Off",         desc: "When positions are auto-squared off" },
  { key: "dailyPnlSummary",         label: "Daily P&L Summary",       desc: "End-of-day summary report" },
];

const WIDGET_ITEMS = [
  { key: "todayPnl",         label: "Today's P&L",                desc: "Live intraday profit/loss" },
  { key: "totalPnl",         label: "Total P&L (30D Net)",        desc: "30-day net performance" },
  { key: "availableBalance", label: "Available Balance",          desc: "Live margin balance from Dhan" },
  { key: "activeStrategies", label: "Active Strategies",          desc: "Running strategies & win rate" },
  { key: "equityCurve",      label: "Equity Curve Chart",        desc: "Historical account value chart" },
];

function SectionHeader({ color, icon, title, subtitle }: { color: string; icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className={`flex items-start gap-2.5 px-5 py-3.5 border-b border-border/40 ${color}`}>
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div><p className="font-semibold text-sm">{title}</p><p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{subtitle}</p></div>
    </div>
  );
}

export default function SystemNotifications() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const settingsData = settings as SettingsData | undefined;

  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>({
    orderFilled: true, targetHit: true, stopLossHit: true, killSwitchTriggered: true,
    tokenExpiry: true, strategyPausedActivated: true, dailyPnlSummary: false, autoSquareOff: true,
  });
  const [pushEnabled, setPushEnabled] = useState(false);
  const [dashWidgets, setDashWidgets] = useState<Record<string, boolean>>({
    todayPnl: true, totalPnl: true, availableBalance: true, activeStrategies: true, equityCurve: true,
  });
  const [refreshInterval, setRefreshInterval] = useState(15);

  useEffect(() => {
    if (!settingsData) return;
    setNotifPrefs(settingsData.notificationPreferences ?? notifPrefs);
    setPushEnabled(settingsData.pushNotificationsEnabled ?? false);
    setDashWidgets(settingsData.dashboardWidgets ?? dashWidgets);
    setRefreshInterval(settingsData.refreshIntervalSeconds ?? 15);
  }, [settingsData?.id]);

  async function saveSettings(data: Record<string, unknown>) {
    const res = await fetch(`${BASE}api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error("Failed to save");
    return res.json();
  }

  const genericSaveMutation = useMutation({
    mutationFn: saveSettings,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/settings"] }),
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  async function requestPushPermission() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast({ title: "Push notifications not supported", variant: "destructive" }); return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushEnabled(true);
      void genericSaveMutation.mutateAsync({ pushNotificationsEnabled: true });
      toast({ title: "Push notifications enabled" });
    } else toast({ title: "Permission denied", description: "Enable notifications in browser settings", variant: "destructive" });
  }

  function sendTestPushNotification() {
    if (!("Notification" in window) || Notification.permission !== "granted") { toast({ title: "Notifications not enabled" }); return; }
    new Notification("Rajesh Algo Test", { body: "Browser push notifications are working!", icon: "/favicon.ico" });
  }

  if (isLoading) {
    return <div className="grid grid-cols-3 gap-4 w-full">{[...Array(4)].map((_, i) => <Skeleton key={i} className={`h-52 rounded-xl ${i === 0 || i === 3 ? "col-span-2" : "col-span-1"}`} />)}</div>;
  }

  const pushGranted = pushEnabled && "Notification" in window && Notification.permission === "granted";

  return (
    <div className="w-full">
      <div className="grid grid-cols-3 gap-4 items-start">

        {/* ══ ROW 1 — Telegram Prefs (2-col left, tall) + Push + Refresh (1-col right, stacked) ══ */}

        {/* Telegram Alert Preferences */}
        <div className="col-span-2 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-violet-500/5" icon={<Bell className="w-4 h-4 text-violet-400" />} title="Telegram Alert Preferences" subtitle="Choose which events send a Telegram message to your bot" />
          <div className="px-5 py-2">
            {NOTIF_ITEMS.map((item, i) => (
              <div key={item.key} className={`flex items-center justify-between gap-4 py-3 ${i < NOTIF_ITEMS.length - 1 ? "border-b border-border/25" : ""}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
                <Switch checked={notifPrefs[item.key] ?? false} onCheckedChange={val => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
              </div>
            ))}
          </div>
          <div className="px-5 pb-4 pt-1">
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ notificationPreferences: notifPrefs }).then(() => toast({ title: "Preferences saved" })); }}>
              <Save className="w-3 h-3" />Save Preferences
            </Button>
          </div>
        </div>

        {/* Right column: Push + Refresh stacked */}
        <div className="col-span-1 space-y-4">
          {/* Browser Push Notifications */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <SectionHeader color="bg-sky-500/5" icon={<Smartphone className="w-4 h-4 text-sky-400" />} title="Browser Push" subtitle="Alerts even when the tab is in the background" />
            <div className="px-5 py-4 space-y-3">
              <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${pushGranted ? "border-green-500/30 bg-green-500/5 text-green-400" : "border-border/40 bg-muted/20 text-muted-foreground"}`}>
                {pushGranted ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
                {pushGranted ? "Push notifications enabled" : "Push notifications disabled"}
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Accept the browser permission prompt to receive alerts when the app is not in focus.</p>
              <div className="flex gap-2">
                <Button size="sm" className="gap-1.5 h-8 flex-1" onClick={() => void requestPushPermission()} disabled={pushGranted}>
                  <Bell className="w-3 h-3" />Enable Alerts
                </Button>
                {pushEnabled && <Button size="sm" variant="outline" className="h-8 px-3" onClick={sendTestPushNotification}>Test</Button>}
              </div>
              {!("Notification" in window) && <p className="text-[11px] text-destructive">Your browser does not support push notifications.</p>}
            </div>
          </div>

          {/* Refresh Interval */}
          <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
            <SectionHeader color="bg-teal-500/5" icon={<RefreshCw className="w-4 h-4 text-teal-400" />} title="Refresh Interval" subtitle="How often positions and balance auto-refresh" />
            <div className="px-5 py-4 space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Refresh Every</label>
                <Select value={String(refreshInterval)} onValueChange={v => setRefreshInterval(Number(v))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">Every 5 seconds</SelectItem>
                    <SelectItem value="10">Every 10 seconds</SelectItem>
                    <SelectItem value="15">Every 15 seconds (default)</SelectItem>
                    <SelectItem value="30">Every 30 seconds</SelectItem>
                    <SelectItem value="60">Every 60 seconds</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Applies to positions, P&L and balance polling</p>
              </div>
              <Button size="sm" className="gap-1.5 h-8 w-full" onClick={() => { void genericSaveMutation.mutateAsync({ refreshIntervalSeconds: refreshInterval }).then(() => toast({ title: `Refresh set to ${refreshInterval}s` })); }}>
                <Save className="w-3 h-3" />Save Interval
              </Button>
            </div>
          </div>
        </div>

        {/* ══ ROW 2 — Dashboard Widgets (full width) ══ */}
        <div className="col-span-3 rounded-xl border border-border/60 bg-card overflow-hidden">
          <SectionHeader color="bg-indigo-500/5" icon={<LayoutDashboard className="w-4 h-4 text-indigo-400" />} title="Dashboard Widgets" subtitle="Show or hide individual cards on the Dashboard page" />
          <div className="px-5 py-4">
            <div className="grid grid-cols-5 gap-px bg-border/30 rounded-lg overflow-hidden border border-border/30 mb-4">
              {WIDGET_ITEMS.map((item) => (
                <div key={item.key} className="flex flex-col gap-3 p-4 bg-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-tight">{item.desc}</p>
                    </div>
                    <Switch checked={dashWidgets[item.key] ?? true} onCheckedChange={val => setDashWidgets(prev => ({ ...prev, [item.key]: val }))} />
                  </div>
                  <div className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded w-fit ${dashWidgets[item.key] ?? true ? "bg-green-500/15 text-green-400" : "bg-muted/40 text-muted-foreground"}`}>
                    {dashWidgets[item.key] ?? true ? "Visible" : "Hidden"}
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ dashboardWidgets: dashWidgets }).then(() => { toast({ title: "Widgets saved" }); queryClient.invalidateQueries({ queryKey: ["dashboard-widgets"] }); }); }}>
              <Save className="w-3 h-3" />Save Widget Visibility
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
