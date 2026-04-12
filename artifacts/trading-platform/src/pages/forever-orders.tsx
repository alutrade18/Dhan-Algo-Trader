import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, X, TrendingUp, TrendingDown, WifiOff, Loader2 } from "lucide-react";
import { SymbolSearch, type InstrumentResult } from "@/components/symbol-search";

const BASE = import.meta.env.BASE_URL;
const DEFAULT_QTY = 5;

const EQUITY_FNO_INSTRUMENTS = ["EQUITY", "FUTSTK", "OPTSTK"];

interface ForeverOrder {
  orderId?: string;
  orderNo?: string;
  tradingSymbol?: string;
  transactionType?: string;
  TxnType?: string;
  orderType?: string;
  price?: number;
  triggerPrice?: number;
  price1?: number;
  triggerPrice1?: number;
  quantity?: number;
  orderStatus?: string;
  legName?: string;
  exchangeSegment?: string;
  [key: string]: unknown;
}

interface FormState {
  security_id: string;
  exchange_segment: string;
  transaction_type: string;
  product_type: string;
  order_type: string;
  quantity: string;
  price: string;
  trigger_price: string;
  price1: string;
  trigger_price1: string;
}

const BLANK_FORM: FormState = {
  security_id: "",
  exchange_segment: "NSE_EQ",
  transaction_type: "BUY",
  product_type: "INTRADAY",
  order_type: "SINGLE",
  quantity: String(DEFAULT_QTY),
  price: "",
  trigger_price: "",
  price1: "",
  trigger_price1: "",
};

function statusColor(status: string) {
  const s = status?.toUpperCase();
  if (s === "TRADED") return "text-emerald-400 border-emerald-400/30 bg-emerald-400/10";
  if (s === "PENDING" || s === "TRANSIT") return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  if (s === "REJECTED" || s === "CANCELLED") return "text-red-400 border-red-400/30 bg-red-400/10";
  return "text-muted-foreground border-muted";
}

export default function ForeverOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentResult | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [ltpLoading, setLtpLoading] = useState(false);
  const [ltpUnavailable, setLtpUnavailable] = useState(false);

  const fetchLtp = useCallback(async (exchSeg: string, secId: string) => {
    if (!secId) return;
    setLtpLoading(true);
    setLtpUnavailable(false);
    try {
      const res = await fetch(`${BASE}api/market/ltp?exchSeg=${encodeURIComponent(exchSeg)}&secId=${encodeURIComponent(secId)}`);
      if (!res.ok) { setLtpUnavailable(true); return; }
      const data = await res.json() as { ltp?: number };
      if (data.ltp && data.ltp > 0) {
        setForm(p => ({ ...p, price: String(parseFloat(data.ltp!.toFixed(2))), trigger_price: String(parseFloat(data.ltp!.toFixed(2))) }));
        setLtpUnavailable(false);
      } else {
        setLtpUnavailable(true);
      }
    } catch {
      setLtpUnavailable(true);
    } finally {
      setLtpLoading(false);
    }
  }, []);

  function handleInstrumentSelect(inst: InstrumentResult | null) {
    setSelectedInstrument(inst);
    setLtpUnavailable(false);
    if (inst) {
      const segMap: Record<string, string> = {
        E: `${inst.exchId}_EQ`,
        F: `${inst.exchId}_FNO`,
        I: `IDX_I`,
        D: `${inst.exchId}_CURR`,
        C: `${inst.exchId}_COMM`,
      };
      const exchSeg = segMap[inst.segment] ?? `${inst.exchId}_${inst.segment}`;
      const defaultQty = inst.lotSize && inst.lotSize > 1 ? String(inst.lotSize) : String(DEFAULT_QTY);
      setForm(p => ({
        ...p,
        security_id: String(inst.securityId),
        exchange_segment: exchSeg,
        quantity: defaultQty,
        price: "",
        trigger_price: "",
        price1: "",
        trigger_price1: "",
      }));
      void fetchLtp(exchSeg, String(inst.securityId));
    } else {
      setForm(BLANK_FORM);
    }
  }

  const { data: orders = [], isLoading, error, refetch, isFetching } = useQuery<ForeverOrder[]>({
    queryKey: ["forever-orders"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/forever-orders`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed");
      }
      return res.json() as Promise<ForeverOrder[]>;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const placeMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        security_id: form.security_id,
        exchange_segment: form.exchange_segment,
        transaction_type: form.transaction_type,
        order_type: form.order_type,
        product_type: form.product_type,
        quantity: Number(form.quantity),
        price: Number(form.price),
        trigger_price: Number(form.trigger_price),
      };
      if (form.order_type === "OCO") {
        body.price1 = Number(form.price1);
        body.trigger_price1 = Number(form.trigger_price1);
      }
      const res = await fetch(`${BASE}api/forever-orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { errorMessage?: string; error?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Order failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Forever Order Placed", description: `${selectedInstrument?.symbolName ?? ""} order placed successfully` });
      setShowForm(false);
      setSelectedInstrument(null);
      setForm(BLANK_FORM);
      void queryClient.invalidateQueries({ queryKey: ["forever-orders"] });
    },
    onError: (e: Error) => toast({ title: "Order Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`${BASE}api/forever-orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Cancel failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Forever Order Cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["forever-orders"] });
    },
    onError: () => toast({ title: "Cancel Failed", variant: "destructive" }),
  });

  const notConnected = (error as Error | null)?.message === "Broker not connected";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm font-bold text-foreground">
          GTT (Good Till Triggered) and OCO orders — Equity &amp; F&amp;O only
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setShowForm(v => !v)}>
            <Plus className="w-3.5 h-3.5" /> New Forever Order
          </Button>
        </div>
      </div>

      {notConnected && (
        <Card className="border-muted">
          <CardContent className="flex items-center gap-3 py-6 text-muted-foreground">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span className="text-sm">Connect your Dhan account in Settings to use Forever Orders.</span>
          </CardContent>
        </Card>
      )}

      {showForm && !notConnected && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Plus className="w-4 h-4" /> Place Forever Order
              <Badge variant="outline" className={`ml-auto text-[10px] ${form.product_type === "CNC" ? "text-blue-400 border-blue-400/30 bg-blue-400/10" : "text-amber-400 border-amber-400/30 bg-amber-400/10"}`}>
                {form.product_type}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs">GTT order — fires once trigger is hit · SINGLE or OCO · Equity &amp; F&amp;O only</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Search Symbol</label>
              <SymbolSearch
                value={selectedInstrument}
                onChange={handleInstrumentSelect}
                placeholder="Search symbol..."
                filterInstruments={EQUITY_FNO_INSTRUMENTS}
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Symbol</label>
                <div className="px-3 py-2 rounded-md border border-border bg-muted/30 text-xs font-mono min-h-[34px] flex items-center">
                  {selectedInstrument
                    ? <span className="font-semibold">{selectedInstrument.symbolName}</span>
                    : <span className="text-muted-foreground">—</span>}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Exchange</label>
                <div className="px-3 py-2 rounded-md border border-border bg-muted/30 text-xs font-mono min-h-[34px] flex items-center">
                  <span className={selectedInstrument ? "font-semibold" : "text-muted-foreground"}>
                    {selectedInstrument ? form.exchange_segment : "—"}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Product</label>
                <Select value={form.product_type} onValueChange={v => setForm(p => ({ ...p, product_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INTRADAY">INTRADAY</SelectItem>
                    <SelectItem value="CNC">CNC</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Order Type</label>
                <Select value={form.order_type} onValueChange={v => setForm(p => ({ ...p, order_type: v }))}>
                  <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SINGLE">SINGLE (GTT)</SelectItem>
                    <SelectItem value="OCO">OCO (Target+SL)</SelectItem>
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
                <Input type="number" min={1} step={1} value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} className="font-mono text-xs" />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Price ₹
                  {ltpLoading && <span className="text-muted-foreground font-normal ml-1">(fetching...)</span>}
                  {!ltpLoading && ltpUnavailable && <span className="text-amber-400 font-normal ml-1">(enter manually)</span>}
                  {!ltpLoading && !ltpUnavailable && form.price && <span className="text-emerald-400 font-normal ml-1">(live)</span>}
                </label>
                <div className="relative">
                  <Input type="number" step="0.05" placeholder="0.00" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} className="font-mono text-xs pr-8" />
                  {ltpLoading && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                </div>
                {ltpUnavailable && <p className="text-[10px] text-amber-400/80">Live price unavailable — enter manually</p>}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-amber-400">Trigger Price ₹</label>
                <Input type="number" step="0.05" placeholder="0.00" value={form.trigger_price} onChange={e => setForm(p => ({ ...p, trigger_price: e.target.value }))} className="font-mono text-xs border-amber-400/30 focus-visible:ring-amber-400/50" />
              </div>

              {form.order_type === "OCO" && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-red-400">SL Price ₹</label>
                    <Input type="number" step="0.05" placeholder="0.00" value={form.price1} onChange={e => setForm(p => ({ ...p, price1: e.target.value }))} className="font-mono text-xs border-red-400/30 focus-visible:ring-red-400/50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-red-400">SL Trigger ₹</label>
                    <Input type="number" step="0.05" placeholder="0.00" value={form.trigger_price1} onChange={e => setForm(p => ({ ...p, trigger_price1: e.target.value }))} className="font-mono text-xs border-red-400/30 focus-visible:ring-red-400/50" />
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                className={form.transaction_type === "SELL" ? "bg-red-500 hover:bg-red-600" : ""}
                onClick={() => placeMutation.mutate()}
                disabled={placeMutation.isPending || !form.security_id || !form.quantity || ltpLoading}
              >
                {placeMutation.isPending ? "Placing..." : "Place Order"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setSelectedInstrument(null); setForm(BLANK_FORM); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : orders.length === 0 && !notConnected ? (
        <Card className="border-dashed border-muted">
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            No forever orders. Create a GTT or OCO order above.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full table-auto text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["Symbol", "Side", "Product", "Type", "Qty", "Price", "Trigger", "Status", ""].map(h => (
                  <th key={h} className={`px-3 py-2.5 text-xs font-medium text-muted-foreground ${!h || h === "Qty" || h === "Price" || h === "Trigger" ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const id = String(o.orderId ?? o.orderNo ?? i);
                const side = String(o.transactionType ?? o.TxnType ?? "");
                return (
                  <tr key={id} className="border-b border-border/50 hover:bg-muted/20">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">{o.tradingSymbol ?? "—"}</td>
                    <td className="px-3 py-2.5">
                      {side === "BUY"
                        ? <span className="flex items-center gap-1 text-emerald-400 text-xs font-medium"><TrendingUp className="w-3 h-3" />BUY</span>
                        : <span className="flex items-center gap-1 text-red-400 text-xs font-medium"><TrendingDown className="w-3 h-3" />SELL</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{String(o.productType ?? "—")}</td>
                    <td className="px-3 py-2.5 text-xs">{String(o.legName ?? o.orderType ?? "GTT")}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{o.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">₹{Number(o.price ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-amber-400">₹{Number(o.triggerPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${statusColor(String(o.orderStatus ?? ""))}`}>
                        {o.orderStatus ?? "PENDING"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs hover:text-destructive" onClick={() => cancelMutation.mutate(id)} disabled={cancelMutation.isPending}>
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
