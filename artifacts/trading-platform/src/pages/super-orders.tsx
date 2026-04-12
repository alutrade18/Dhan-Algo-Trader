import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, X, Layers, TrendingUp, TrendingDown, WifiOff } from "lucide-react";
import { SymbolSearch, type InstrumentResult } from "@/components/symbol-search";

const BASE = import.meta.env.BASE_URL;

interface SuperOrder {
  orderId?: string;
  orderNo?: string;
  tradingSymbol?: string;
  transactionType?: string;
  orderType?: string;
  productType?: string;
  quantity?: number;
  price?: number;
  targetPrice?: number;
  stopLossPrice?: number;
  orderStatus?: string;
  exchangeSegment?: string;
  [key: string]: unknown;
}

function statusColor(status: string) {
  const s = status?.toUpperCase();
  if (s === "TRADED" || s === "PARTIALLY_TRADED") return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
  if (s === "PENDING" || s === "TRANSIT") return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  if (s === "REJECTED" || s === "CANCELLED") return "text-red-400 border-red-400/30 bg-red-400/10";
  return "text-muted-foreground border-muted";
}

export default function SuperOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentResult | null>(null);
  const [form, setForm] = useState({
    security_id: "", exchange_segment: "NSE_EQ", transaction_type: "BUY",
    order_type: "LIMIT", quantity: "", price: "", target_price: "", stop_loss_price: "",
  });

  function handleInstrumentSelect(inst: InstrumentResult | null) {
    setSelectedInstrument(inst);
    if (inst) {
      const segMap: Record<string, string> = { E: "NSE_EQ", F: "NSE_FNO", I: "IDX_I", D: "NSE_CURR", C: "NSE_COMM" };
      const exchSeg = `${inst.exchId}_${inst.segment === "E" ? "EQ" : inst.segment === "F" ? "FNO" : inst.segment}`;
      setForm(p => ({
        ...p,
        security_id: String(inst.securityId),
        exchange_segment: segMap[inst.segment] ?? exchSeg,
        quantity: inst.lotSize && inst.lotSize > 1 ? String(inst.lotSize) : p.quantity,
      }));
    }
  }

  const { data: orders = [], isLoading, error, refetch, isFetching } = useQuery<SuperOrder[]>({
    queryKey: ["super-orders"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/super-orders`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json() as Promise<SuperOrder[]>;
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const placeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/super-orders`, {
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
          target_price: Number(form.target_price),
          stop_loss_price: Number(form.stop_loss_price),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { errorMessage?: string };
        throw new Error(err.errorMessage ?? "Order failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Super Order Placed" });
      setShowForm(false);
      setSelectedInstrument(null);
      setForm({ security_id: "", exchange_segment: "NSE_EQ", transaction_type: "BUY", order_type: "LIMIT", quantity: "", price: "", target_price: "", stop_loss_price: "" });
      void queryClient.invalidateQueries({ queryKey: ["super-orders"] });
    },
    onError: (e: Error) => toast({ title: "Order Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ orderId, leg }: { orderId: string; leg: string }) => {
      const res = await fetch(`${BASE}api/super-orders/${orderId}?leg=${leg}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Cancel failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Super Order Cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["super-orders"] });
    },
    onError: () => toast({ title: "Cancel Failed", variant: "destructive" }),
  });

  const notConnected = (error as Error | null)?.message === "Broker not connected";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" /> Super Orders
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Entry + Target + Stop-Loss in a single order</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> New Super Order
          </Button>
        </div>
      </div>

      {notConnected && (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span className="text-sm">Connect your Dhan account in Settings to use Super Orders.</span>
          </CardContent>
        </Card>
      )}

      {showForm && !notConnected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="w-4 h-4" /> Place Super Order
              <Badge variant="outline" className="ml-auto text-[10px]">INTRADAY</Badge>
            </CardTitle>
            <CardDescription className="text-xs">Bracket order with automatic target and stop-loss</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Symbol</label>
              <SymbolSearch
                value={selectedInstrument}
                onChange={handleInstrumentSelect}
                placeholder="Search by name or security ID..."
              />
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
                <label className="text-xs font-medium">Qty</label>
                <Input type="number" placeholder="0" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Entry Price ₹</label>
                <Input type="number" placeholder="0.00" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className="font-mono text-xs" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-emerald-400">Target ₹</label>
                <Input type="number" placeholder="0.00" value={form.target_price} onChange={e => setForm(p => ({ ...p, target_price: e.target.value }))} className="font-mono text-xs border-emerald-400/30 focus-visible:ring-emerald-400/50" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-red-400">Stop Loss ₹</label>
                <Input type="number" placeholder="0.00" value={form.stop_loss_price} onChange={e => setForm(p => ({ ...p, stop_loss_price: e.target.value }))} className="font-mono text-xs border-red-400/30 focus-visible:ring-red-400/50" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => placeMutation.mutate()} disabled={placeMutation.isPending || !form.security_id || !form.quantity}>
                {placeMutation.isPending ? "Placing..." : `Place ${form.transaction_type}`}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : orders.length === 0 && !notConnected ? (
        <Card className="border-dashed border-muted">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No super orders found. Place your first bracket order above.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full table-auto text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Symbol</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Side</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Qty</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Target</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">SL</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const id = String(o.orderId ?? o.orderNo ?? i);
                const side = String(o.transactionType ?? o.TxnType ?? "");
                return (
                  <tr key={id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">{o.tradingSymbol ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {side === "BUY"
                        ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium"><TrendingUp className="w-3 h-3" />BUY</span>
                        : <span className="flex items-center gap-1 text-red-400 text-xs font-medium"><TrendingDown className="w-3 h-3" />SELL</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{o.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">₹{Number(o.price ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">₹{Number(o.targetPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-red-400">₹{Number(o.stopLossPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${statusColor(String(o.orderStatus ?? ""))}`}>
                        {o.orderStatus ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => cancelMutation.mutate({ orderId: id, leg: "ENTRY_LEG" })}
                        disabled={cancelMutation.isPending}
                      >
                        <X className="w-3 h-3" />
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
