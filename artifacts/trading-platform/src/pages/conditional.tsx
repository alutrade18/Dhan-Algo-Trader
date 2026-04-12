import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, Trash2, Zap, WifiOff } from "lucide-react";
import { SymbolSearch, type InstrumentResult } from "@/components/symbol-search";

const BASE = import.meta.env.BASE_URL;

interface ConditionalTrigger {
  alertId?: string;
  id?: string;
  tradingSymbol?: string;
  alertStatus?: string;
  transactionType?: string;
  orderType?: string;
  quantity?: number;
  price?: number;
  triggerPrice?: number;
  exchangeSegment?: string;
  [key: string]: unknown;
}

function statusColor(s: string) {
  if (s === "ACTIVE") return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
  if (s === "TRIGGERED") return "text-blue-400 border-blue-400/30 bg-blue-400/10";
  if (s === "INACTIVE" || s === "EXPIRED") return "text-muted-foreground border-muted";
  return "text-amber-400 border-amber-400/30 bg-amber-400/10";
}

export default function Conditional() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentResult | null>(null);
  const [form, setForm] = useState({
    security_id: "", exchange_segment: "NSE_EQ",
    transaction_type: "BUY", order_type: "LIMIT",
    quantity: "", price: "", trigger_price: "",
  });

  function handleInstrumentSelect(inst: InstrumentResult | null) {
    setSelectedInstrument(inst);
    if (inst) {
      setForm(p => ({
        ...p,
        security_id: String(inst.securityId),
        exchange_segment: `${inst.exchId}_${inst.segment === "E" ? "EQ" : inst.segment === "F" ? "FNO" : inst.segment}`,
        quantity: inst.lotSize && inst.lotSize > 1 ? String(inst.lotSize) : p.quantity,
      }));
    }
  }

  const { data: triggers = [], isLoading, error, refetch, isFetching } = useQuery<ConditionalTrigger[]>({
    queryKey: ["conditional-triggers"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/conditional`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json() as Promise<ConditionalTrigger[]>;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/conditional`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          security_id: form.security_id,
          exchange_segment: form.exchange_segment,
          transaction_type: form.transaction_type,
          order_type: form.order_type,
          product_type: "INTRADAY",
          quantity: Number(form.quantity),
          price: Number(form.price),
          trigger_price: Number(form.trigger_price),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { errorMessage?: string };
        throw new Error(err.errorMessage ?? "Failed to create trigger");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Conditional Trigger Created" });
      setShowForm(false);
      setSelectedInstrument(null);
      setForm({ security_id: "", exchange_segment: "NSE_EQ", transaction_type: "BUY", order_type: "LIMIT", quantity: "", price: "", trigger_price: "" });
      void queryClient.invalidateQueries({ queryKey: ["conditional-triggers"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const res = await fetch(`${BASE}api/conditional/${alertId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Trigger Deleted" });
      void queryClient.invalidateQueries({ queryKey: ["conditional-triggers"] });
    },
    onError: () => toast({ title: "Delete Failed", variant: "destructive" }),
  });

  const notConnected = (error as Error | null)?.message === "Broker not connected";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Conditional Triggers
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Price-based auto order alerts — fire when conditions are met</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> New Trigger
          </Button>
        </div>
      </div>

      {notConnected && (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span className="text-sm">Connect your Dhan account in Settings to use Conditional Triggers.</span>
          </CardContent>
        </Card>
      )}

      {showForm && !notConnected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Conditional Trigger
            </CardTitle>
            <CardDescription className="text-xs">Order fires automatically when the trigger price is reached</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Symbol</label>
              <SymbolSearch value={selectedInstrument} onChange={handleInstrumentSelect} placeholder="Search by name or security ID..." />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Security ID</label>
                <Input placeholder="e.g. 1333" value={form.security_id} onChange={e => setForm(p => ({ ...p, security_id: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Exchange</label>
                <Select value={form.exchange_segment} onValueChange={v => setForm(p => ({ ...p, exchange_segment: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["NSE_EQ", "NSE_FNO", "BSE_EQ", "BSE_FNO", "MCX_COMM"].map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Side</label>
                <Select value={form.transaction_type} onValueChange={v => setForm(p => ({ ...p, transaction_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUY">BUY</SelectItem>
                    <SelectItem value="SELL">SELL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Order Type</label>
                <Select value={form.order_type} onValueChange={v => setForm(p => ({ ...p, order_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LIMIT">LIMIT</SelectItem>
                    <SelectItem value="MARKET">MARKET</SelectItem>
                    <SelectItem value="STOP_LOSS">STOP_LOSS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Qty</label>
                <Input type="number" placeholder="0" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Limit Price ₹</label>
                <Input type="number" placeholder="0.00" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-amber-400">Trigger Price ₹</label>
                <Input type="number" placeholder="0.00" value={form.trigger_price} onChange={e => setForm(p => ({ ...p, trigger_price: e.target.value }))} className="font-mono text-xs border-amber-400/30 focus-visible:ring-amber-400/50" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.security_id || !form.quantity || !form.trigger_price}>
                {createMutation.isPending ? "Creating..." : "Create Trigger"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : triggers.length === 0 && !notConnected ? (
        <Card className="border-dashed border-muted">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No conditional triggers. Create one above to auto-place orders at a target price.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full table-auto text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Symbol", "Side", "Order Type", "Qty", "Limit Price", "Trigger Price", "Status", ""].map(h => (
                  <th key={h} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${!h || h === "Qty" || h === "Limit Price" || h === "Trigger Price" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {triggers.map((t, i) => {
                const id = String(t.alertId ?? t.id ?? i);
                const side = String(t.transactionType ?? "");
                return (
                  <tr key={id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">{t.tradingSymbol ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-medium ${side === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{side || "—"}</span>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{String(t.orderType ?? "LIMIT")}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{t.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">₹{Number(t.price ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-amber-400">₹{Number(t.triggerPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${statusColor(String(t.alertStatus ?? "ACTIVE"))}`}>
                        {t.alertStatus ?? "ACTIVE"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs hover:text-destructive" onClick={() => deleteMutation.mutate(id)} disabled={deleteMutation.isPending}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
