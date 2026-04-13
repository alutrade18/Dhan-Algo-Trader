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
  { key: "orderFilled",             label: "Order Filled",                  desc: "When an order is fully executed" },
  { key: "targetHit",               label: "Target Hit",                    desc: "When profit target is reached" },
  { key: "stopLossHit",             label: "Stop Loss Hit",                 desc: "When stop loss is triggered" },
  { key: "killSwitchTriggered",     label: "Kill Switch Triggered",         desc: "Emergency halt events" },
  { key: "tokenExpiry",             label: "Token About to Expire",         desc: "4 hours before API token expiry" },
  { key: "strategyPausedActivated", label: "Strategy State Changed",        desc: "Strategy paused or activated" },
  { key: "autoSquareOff",           label: "Auto Square-Off Executed",      desc: "When positions are auto-squared off" },
  { key: "dailyPnlSummary",         label: "Daily P&L Summary",            desc: "End-of-day summary report" },
];

const WIDGET_ITEMS = [
  { key: "todayPnl",         label: "Today's P&L",                   desc: "Live intraday profit/loss" },
  { key: "totalPnl",         label: "Total P&L (30D Net)",           desc: "30-day net performance" },
  { key: "availableBalance", label: "Available Balance",             desc: "Live margin balance from Dhan" },
  { key: "activeStrategies", label: "Active Strategies & Win Rate",  desc: "Running strategies and stats" },
  { key: "equityCurve",      label: "Equity Curve Chart",           desc: "Historical account value chart" },
];

function Panel({ accent, icon, title, subtitle, children }: {
  accent: string; icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className={`flex items-start gap-3 px-5 py-4 border-b border-border/40 ${accent}`}>
        <div className="mt-0.5">{icon}</div>
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function Row({ label, hint, children, last = false }: { label: string; hint?: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-3 ${!last ? "border-b border-border/30" : ""}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-none">{label}</p>
        {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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
    return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-52 w-full rounded-xl" />)}</div>;
  }

  const pushGranted = pushEnabled && "Notification" in window && Notification.permission === "granted";

  return (
    <div className="space-y-4 max-w-4xl">

      {/* ── Telegram Notification Preferences ── */}
      <Panel accent="bg-violet-500/5" icon={<Bell className="w-4 h-4 text-violet-400" />} title="Telegram Alert Preferences" subtitle="Choose which events send a Telegram message">
        <div className="space-y-0">
          {NOTIF_ITEMS.map((item, i) => (
            <Row key={item.key} label={item.label} hint={item.desc} last={i === NOTIF_ITEMS.length - 1}>
              <Switch checked={notifPrefs[item.key] ?? false} onCheckedChange={val => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))} />
            </Row>
          ))}
        </div>
        <div className="pt-3">
          <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ notificationPreferences: notifPrefs }).then(() => toast({ title: "Preferences saved" })); }}>
            <Save className="w-3 h-3" />Save Preferences
          </Button>
        </div>
      </Panel>

      {/* ── Row: Push Notifications + Refresh Interval ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel accent="bg-sky-500/5" icon={<Smartphone className="w-4 h-4 text-sky-400" />} title="Browser Push Notifications" subtitle="Alerts even when the browser tab is in the background">
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3 mb-4 mt-1" style={{ borderColor: pushGranted ? "rgb(34 197 94 / 0.3)" : "var(--border)", backgroundColor: pushGranted ? "rgb(34 197 94 / 0.05)" : "var(--muted)" }}>
            {pushGranted
              ? <><CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" /><span className="text-sm text-green-400">Push notifications are enabled</span></>
              : <><XCircle className="w-4 h-4 text-muted-foreground shrink-0" /><span className="text-sm text-muted-foreground">Push notifications are disabled</span></>}
          </div>
          <p className="text-xs text-muted-foreground mb-4">Accept the browser permission prompt to receive alerts when the app is not in focus.</p>
          <div className="flex gap-2">
            <Button size="sm" className="gap-1.5 h-8 flex-1" onClick={() => void requestPushPermission()} disabled={pushGranted}>
              <Bell className="w-3 h-3" />Enable Alerts
            </Button>
            {pushEnabled && (
              <Button size="sm" variant="outline" className="h-8" onClick={sendTestPushNotification}>Test</Button>
            )}
          </div>
          {!("Notification" in window) && <p className="text-xs text-destructive mt-3">Your browser does not support push notifications.</p>}
        </Panel>

        <Panel accent="bg-teal-500/5" icon={<RefreshCw className="w-4 h-4 text-teal-400" />} title="Refresh Interval" subtitle="How often positions and balance auto-refresh">
          <Row label="Refresh Every" hint="Applies to positions, P&L and balance polling" last>
            <Select value={String(refreshInterval)} onValueChange={v => setRefreshInterval(Number(v))}>
              <SelectTrigger className="w-44 h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="5">Every 5 seconds</SelectItem>
                <SelectItem value="10">Every 10 seconds</SelectItem>
                <SelectItem value="15">Every 15 seconds (default)</SelectItem>
                <SelectItem value="30">Every 30 seconds</SelectItem>
                <SelectItem value="60">Every 60 seconds</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <div className="pt-3">
            <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ refreshIntervalSeconds: refreshInterval }).then(() => toast({ title: `Refresh set to ${refreshInterval}s` })); }}>
              <Save className="w-3 h-3" />Save Interval
            </Button>
          </div>
        </Panel>
      </div>

      {/* ── Dashboard Widgets ── */}
      <Panel accent="bg-indigo-500/5" icon={<LayoutDashboard className="w-4 h-4 text-indigo-400" />} title="Dashboard Widgets" subtitle="Show or hide cards on the Dashboard page">
        <div className="space-y-0">
          {WIDGET_ITEMS.map((item, i) => (
            <Row key={item.key} label={item.label} hint={item.desc} last={i === WIDGET_ITEMS.length - 1}>
              <Switch checked={dashWidgets[item.key] ?? true} onCheckedChange={val => setDashWidgets(prev => ({ ...prev, [item.key]: val }))} />
            </Row>
          ))}
        </div>
        <div className="pt-3">
          <Button size="sm" className="gap-1.5 h-8" onClick={() => { void genericSaveMutation.mutateAsync({ dashboardWidgets: dashWidgets }).then(() => { toast({ title: "Widgets saved" }); queryClient.invalidateQueries({ queryKey: ["dashboard-widgets"] }); }); }}>
            <Save className="w-3 h-3" />Save Widgets
          </Button>
        </div>
      </Panel>

    </div>
  );
}
