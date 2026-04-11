import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff } from "lucide-react";

const settingsSchema = z.object({
  defaultProductType: z.string(),
  defaultOrderType: z.string(),
  defaultExchange: z.string(),
  maxOrderValue: z.coerce.number().optional(),
  maxDailyLoss: z.coerce.number().optional(),
  maxDailyProfit: z.coerce.number().optional(),
  riskPerTrade: z.coerce.number().optional(),
  enableAutoTrading: z.boolean(),
  enableNotifications: z.boolean(),
  theme: z.enum(["light", "dark", "system"]),
});

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});

interface ConnectResult {
  success: boolean;
  availableBalance?: number;
  utilizedAmount?: number;
  errorCode?: string;
  errorMessage?: string;
  message?: string;
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [connectResult, setConnectResult] = useState<ConnectResult | null>(null);
  const [showToken, setShowToken] = useState(false);

  const brokerForm = useForm<z.infer<typeof brokerSchema>>({
    resolver: zodResolver(brokerSchema),
    defaultValues: { clientId: "", accessToken: "" },
  });

  const connectMutation = useMutation({
    mutationFn: async (data: z.infer<typeof brokerSchema>) => {
      const res = await fetch("/api/broker/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Request failed");
      return res.json() as Promise<ConnectResult>;
    },
    onSuccess: (result) => {
      setConnectResult(result);
      if (result.success) {
        toast({ title: "Broker connected successfully", description: `Available balance: ₹${result.availableBalance?.toLocaleString("en-IN")}` });
        queryClient.invalidateQueries({ queryKey: ["healthz"] });
      } else {
        toast({
          title: `Connection failed: ${result.errorCode}`,
          description: result.errorMessage,
          variant: "destructive",
        });
      }
    },
    onError: () => {
      toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" });
    },
  });

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      defaultProductType: "INTRA",
      defaultOrderType: "MARKET",
      defaultExchange: "NSE",
      maxOrderValue: 0,
      maxDailyLoss: 0,
      maxDailyProfit: 0,
      riskPerTrade: 0,
      enableAutoTrading: false,
      enableNotifications: true,
      theme: "dark",
    },
  });

  useEffect(() => {
    if (settings) {
      form.reset({
        defaultProductType: settings.defaultProductType ?? "INTRA",
        defaultOrderType: settings.defaultOrderType ?? "MARKET",
        defaultExchange: settings.defaultExchange ?? "NSE",
        maxOrderValue: settings.maxOrderValue ?? 0,
        maxDailyLoss: settings.maxDailyLoss ?? 0,
        maxDailyProfit: settings.maxDailyProfit ?? 0,
        riskPerTrade: settings.riskPerTrade ?? 0,
        enableAutoTrading: settings.enableAutoTrading ?? false,
        enableNotifications: settings.enableNotifications ?? true,
        theme: (settings.theme as "light" | "dark" | "system") ?? "dark",
      });
    }
  }, [settings, form]);

  const onSubmit = (values: z.infer<typeof settingsSchema>) => {
    updateSettings.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Settings updated successfully" });
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to update settings", variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isConnected = settings?.apiConnected ?? false;
  const maskedClientId = settings?.dhanClientId ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your broker connection, trading preferences and risk limits.</p>
      </div>

      {/* Broker Connection Card */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {isConnected ? (
                  <Wifi className="w-4 h-4 text-success" />
                ) : (
                  <WifiOff className="w-4 h-4 text-destructive" />
                )}
                Broker Connection (Dhan)
              </CardTitle>
              <CardDescription>
                {isConnected
                  ? `Connected as ${maskedClientId}`
                  : "Enter your Dhan credentials to connect to live trading"}
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={isConnected
                ? "text-success border-success/30 bg-success/10"
                : "text-destructive border-destructive/30 bg-destructive/10"}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={brokerForm.handleSubmit((data) => connectMutation.mutate(data))}
            className="space-y-4"
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Dhan Client ID</label>
                <Input
                  placeholder="Enter your Client ID"
                  {...brokerForm.register("clientId")}
                />
                {brokerForm.formState.errors.clientId && (
                  <p className="text-xs text-destructive">{brokerForm.formState.errors.clientId.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Access Token</label>
                <div className="relative">
                  <Input
                    type={showToken ? "text" : "password"}
                    placeholder="Enter your Access Token"
                    className="pr-10"
                    {...brokerForm.register("accessToken")}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowToken(!showToken)}
                  >
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {brokerForm.formState.errors.accessToken && (
                  <p className="text-xs text-destructive">{brokerForm.formState.errors.accessToken.message}</p>
                )}
              </div>
            </div>

            {connectResult && (
              <div className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${
                connectResult.success
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}>
                {connectResult.success ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <div>
                  {connectResult.success ? (
                    <>
                      <p className="font-medium">Connected successfully</p>
                      <p className="text-xs opacity-80 mt-0.5">
                        Available Balance: ₹{connectResult.availableBalance?.toLocaleString("en-IN") ?? "0"}
                        {" · "}Used Margin: ₹{connectResult.utilizedAmount?.toLocaleString("en-IN") ?? "0"}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">Error: {connectResult.errorCode}</p>
                      <p className="text-xs opacity-80 mt-0.5">{connectResult.errorMessage}</p>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={connectMutation.isPending} className="gap-2">
                <Wifi className="w-4 h-4" />
                {connectMutation.isPending ? "Connecting..." : "Save & Connect"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Credentials are stored securely in memory and validated against Dhan API.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Order Defaults</CardTitle>
                <CardDescription>Default parameters for new orders</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="defaultProductType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select product type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="INTRA">Intraday (MIS)</SelectItem>
                          <SelectItem value="CNC">Delivery (CNC)</SelectItem>
                          <SelectItem value="MARGIN">Margin (NRML)</SelectItem>
                          <SelectItem value="BO">Bracket Order (BO)</SelectItem>
                          <SelectItem value="CO">Cover Order (CO)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultOrderType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Order Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select order type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="MARKET">Market</SelectItem>
                          <SelectItem value="LIMIT">Limit</SelectItem>
                          <SelectItem value="SL">Stop Loss</SelectItem>
                          <SelectItem value="SLM">Stop Loss Market</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="defaultExchange"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Exchange</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select exchange" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="NSE">NSE</SelectItem>
                          <SelectItem value="BSE">BSE</SelectItem>
                          <SelectItem value="MCX">MCX</SelectItem>
                          <SelectItem value="NFO">NFO</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Risk Management</CardTitle>
                <CardDescription>Global limits across all strategies</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="maxOrderValue"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Order Value (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxDailyLoss"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Daily Loss (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="maxDailyProfit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Daily Profit (₹) - Auto Pause</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="riskPerTrade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Default Risk Per Trade (₹)</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} value={field.value ?? 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card className="col-span-1 md:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg">System Preferences</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="enableAutoTrading"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Master Auto-Trading Switch</FormLabel>
                          <FormDescription>
                            Enable or disable ALL automated trading instantly.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            className={field.value ? "bg-success" : ""}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="enableNotifications"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">System Notifications</FormLabel>
                          <FormDescription>
                            Receive alerts for order execution and strategy signals.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="theme"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                        <div className="space-y-0.5">
                          <FormLabel className="text-base">Application Theme</FormLabel>
                          <FormDescription>
                            Select your preferred UI appearance. You can also toggle at the top right.
                          </FormDescription>
                        </div>
                        <FormControl>
                          <Select onValueChange={field.onChange} value={field.value ?? "dark"}>
                            <SelectTrigger className="w-[140px]">
                              <SelectValue placeholder="Theme" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="light">Light</SelectItem>
                              <SelectItem value="dark">Dark</SelectItem>
                              <SelectItem value="system">System</SelectItem>
                            </SelectContent>
                          </Select>
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
