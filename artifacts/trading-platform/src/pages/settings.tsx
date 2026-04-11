import { useGetSettings } from "@workspace/api-client-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { CheckCircle2, XCircle, Wifi, WifiOff, Eye, EyeOff, LogOut, RefreshCw, User } from "lucide-react";

const brokerSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  accessToken: z.string().min(10, "Access Token is required"),
});

interface FundDetails {
  dhanClientId?: string;
  availableBalance?: number;
  sodLimit?: number;
  collateralAmount?: number;
  receiveableAmount?: number;
  utilizedAmount?: number;
  blockedPayoutAmount?: number;
  withdrawableBalance?: number;
}

interface ConnectResult extends FundDetails {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
  message?: string;
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
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
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      } else {
        toast({ title: `Connection failed: ${result.errorCode}`, description: result.errorMessage, variant: "destructive" });
      }
    },
    onError: () => {
      toast({ title: "Network error", description: "Could not reach the server", variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      return res.json();
    },
    onSuccess: () => {
      setConnectResult(null);
      brokerForm.reset({ clientId: "", accessToken: "" });
      toast({ title: "Disconnected from broker", description: "Credentials have been cleared." });
      queryClient.invalidateQueries({ queryKey: ["healthz"] });
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
    onError: () => {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/status");
      if (!res.ok) throw new Error("Request failed");
      return res.json() as Promise<FundDetails & { connected: boolean }>;
    },
    onSuccess: (data) => {
      if (data.connected) {
        setConnectResult((prev) => prev ? { ...prev, ...data, success: true } : null);
        toast({ title: "Balance refreshed", description: `Available: ₹${data.availableBalance?.toLocaleString("en-IN")}` });
      }
    },
    onError: () => toast({ title: "Failed to refresh balance", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const isConnected = settings?.apiConnected ?? false;
  const maskedClientId = settings?.dhanClientId ?? "";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your broker connection.</p>
      </div>

      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {isConnected ? (
                  <Wifi className="w-4 h-4 text-success" />
                ) : (
                  <WifiOff className="w-4 h-4 text-destructive" />
                )}
                Broker Connection
              </CardTitle>
              <CardDescription>
                {isConnected
                  ? `Connected as ${maskedClientId}`
                  : "Enter your broker credentials to connect to live trading"}
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
                <label className="text-sm font-medium">Client ID</label>
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

            {connectResult && !connectResult.success && (
              <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-destructive text-sm">
                <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium">Error: {connectResult.errorCode}</p>
                  <p className="text-xs opacity-80 mt-0.5">{connectResult.errorMessage}</p>
                </div>
              </div>
            )}

            {connectResult?.success && (
              <div className="rounded-lg border border-success/30 bg-success/5 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-success/20 bg-success/10 flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold text-sm">Account Connected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3.5 h-3.5" />
                      <span className="font-mono font-medium">{connectResult.dhanClientId ?? "—"}</span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                      disabled={refreshMutation.isPending}
                      onClick={() => refreshMutation.mutate()}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-border/50">
                  {[
                    { label: "Available Balance", value: connectResult.availableBalance, highlight: true },
                    { label: "Withdrawable", value: connectResult.withdrawableBalance },
                    { label: "Used Margin", value: connectResult.utilizedAmount },
                    { label: "SOD Limit", value: connectResult.sodLimit },
                    { label: "Collateral", value: connectResult.collateralAmount },
                    { label: "Receiveable", value: connectResult.receiveableAmount },
                    { label: "Blocked Payout", value: connectResult.blockedPayoutAmount },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} className={`px-4 py-3 space-y-0.5 ${highlight ? "bg-success/5" : ""}`}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={`text-sm font-semibold tabular-nums ${highlight ? "text-success" : ""}`}>
                        ₹{(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              <Button type="submit" disabled={connectMutation.isPending} className="gap-2">
                <Wifi className="w-4 h-4" />
                {connectMutation.isPending ? "Connecting..." : "Save & Connect"}
              </Button>
              {isConnected && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={disconnectMutation.isPending}
                  onClick={() => disconnectMutation.mutate()}
                >
                  <LogOut className="w-4 h-4" />
                  {disconnectMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Credentials are validated and stored securely.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
