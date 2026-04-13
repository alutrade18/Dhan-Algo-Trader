import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Bell, Smartphone, LayoutDashboard, RefreshCw, Save } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface SettingsData {
  id: number;
  notificationPreferences: Record<string, boolean>;
  pushNotificationsEnabled: boolean;
  dashboardWidgets: Record<string, boolean>;
  refreshIntervalSeconds: number;
}

const NOTIF_ITEMS = [
  { key: "orderFilled",            label: "Order Filled",                  desc: "When an order is fully executed" },
  { key: "targetHit",              label: "Target Hit",                    desc: "When profit target is reached" },
  { key: "stopLossHit",            label: "Stop Loss Hit",                 desc: "When stop loss is triggered" },
  { key: "killSwitchTriggered",    label: "Kill Switch Triggered",         desc: "Emergency halt events" },
  { key: "tokenExpiry",            label: "Token About to Expire",         desc: "4 hours before expiry" },
  { key: "strategyPausedActivated",label: "Strategy Paused / Activated",  desc: "Strategy state changes" },
  { key: "autoSquareOff",          label: "Auto Square-Off Executed",      desc: "When positions auto-squared off" },
  { key: "dailyPnlSummary",        label: "Daily P&L Summary",            desc: "End-of-day summary" },
];

const WIDGET_ITEMS = [
  { key: "todayPnl",         label: "Today's P&L" },
  { key: "totalPnl",         label: "Total P&L (30D Net)" },
  { key: "availableBalance", label: "Available Balance" },
  { key: "activeStrategies", label: "Active Strategies & Win Rate" },
  { key: "equityCurve",      label: "Equity Curve Chart" },
];

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
    const res = await fetch(`${BASE}api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
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
      toast({ title: "Push notifications not supported", description: "Your browser does not support push notifications", variant: "destructive" });
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setPushEnabled(true);
      void genericSaveMutation.mutateAsync({ pushNotificationsEnabled: true });
      toast({ title: "Push notifications enabled", description: "You'll receive browser alerts even when the tab is in background" });
    } else {
      toast({ title: "Permission denied", description: "Enable notifications in your browser settings", variant: "destructive" });
    }
  }

  function sendTestPushNotification() {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      toast({ title: "Notifications not enabled" });
      return;
    }
    new Notification("Rajesh Algo Test", { body: "Browser push notifications are working!", icon: "/favicon.ico" });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 w-full">

      {/* ── Row 1 — Notification Preferences + Browser Push ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

        {/* Notification Preferences */}
        <Card className="h-full">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />Notification Preferences
            </CardTitle>
            <CardDescription className="text-xs">Choose which events fire Telegram alerts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {NOTIF_ITEMS.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.desc}</p>
                </div>
                <Switch
                  checked={notifPrefs[item.key] ?? false}
                  onCheckedChange={val => setNotifPrefs(prev => ({ ...prev, [item.key]: val }))}
                />
              </div>
            ))}
            <Button
              size="sm" className="gap-2 w-full mt-2"
              onClick={() => {
                void genericSaveMutation.mutateAsync({ notificationPreferences: notifPrefs }).then(() =>
                  toast({ title: "Notification preferences saved" })
                );
              }}
            >
              <Save className="w-3.5 h-3.5" />Save Preferences
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Browser Push Notifications */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-primary" />Browser Push Notifications
              </CardTitle>
              <CardDescription className="text-xs">Receive alerts even when the browser tab is in the background or minimised</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className={`rounded-md border px-3 py-2.5 text-sm flex items-center gap-2 ${
                pushEnabled && "Notification" in window && Notification.permission === "granted"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-muted bg-muted/20 text-muted-foreground"
              }`}>
                {pushEnabled && "Notification" in window && Notification.permission === "granted"
                  ? "✅ Browser push notifications are enabled"
                  : "🔕 Browser push notifications are disabled"}
              </div>
              <p className="text-xs text-muted-foreground">
                Click the button below and accept the browser permission prompt. Notifications appear even when the app is not in focus.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm" className="gap-2 flex-1"
                  onClick={() => void requestPushPermission()}
                  disabled={pushEnabled && "Notification" in window && Notification.permission === "granted"}
                >
                  <Bell className="w-3.5 h-3.5" />Enable Push Alerts
                </Button>
                {pushEnabled && (
                  <Button size="sm" variant="outline" className="gap-2" onClick={sendTestPushNotification}>
                    Test Notification
                  </Button>
                )}
              </div>
              {!("Notification" in window) && (
                <p className="text-xs text-destructive">Your browser does not support push notifications.</p>
              )}
            </CardContent>
          </Card>

          {/* Refresh Interval */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-primary" />Refresh Interval
              </CardTitle>
              <CardDescription className="text-xs">How often positions and balance auto-refresh in the background</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={String(refreshInterval)} onValueChange={v => setRefreshInterval(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">Every 5 seconds</SelectItem>
                  <SelectItem value="10">Every 10 seconds</SelectItem>
                  <SelectItem value="15">Every 15 seconds (default)</SelectItem>
                  <SelectItem value="30">Every 30 seconds</SelectItem>
                  <SelectItem value="60">Every 60 seconds</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm" className="gap-2 w-full"
                onClick={() => {
                  void genericSaveMutation.mutateAsync({ refreshIntervalSeconds: refreshInterval }).then(() =>
                    toast({ title: `Refresh interval set to ${refreshInterval}s` })
                  );
                }}
              >
                <Save className="w-3.5 h-3.5" />Save Interval
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Row 2 — Dashboard Widgets (full width) ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutDashboard className="w-4 h-4 text-primary" />Dashboard Widgets
          </CardTitle>
          <CardDescription className="text-xs">Show or hide cards on the Dashboard page</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {WIDGET_ITEMS.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2.5 bg-muted/10">
                <span className="text-sm">{item.label}</span>
                <Switch
                  checked={dashWidgets[item.key] ?? true}
                  onCheckedChange={val => setDashWidgets(prev => ({ ...prev, [item.key]: val }))}
                />
              </div>
            ))}
          </div>
          <Button
            size="sm" className="gap-2"
            onClick={() => {
              void genericSaveMutation.mutateAsync({ dashboardWidgets: dashWidgets }).then(() => {
                toast({ title: "Dashboard widgets saved" });
                queryClient.invalidateQueries({ queryKey: ["dashboard-widgets"] });
              });
            }}
          >
            <Save className="w-3.5 h-3.5" />Save Widget Visibility
          </Button>
        </CardContent>
      </Card>

    </div>
  );
}
