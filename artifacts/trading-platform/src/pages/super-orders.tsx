import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRefreshInterval } from "@/hooks/use-refresh-interval";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Plus, X, TrendingUp, TrendingDown, WifiOff, AlertTriangle, Loader2 } from "lucide-react";
import { SymbolSearch, type InstrumentResult } from "@/components/symbol-search";

const BASE = import.meta.env.BASE_URL;

const TARGET_PCT  = 15;
const SL_PCT      = 10;
const DEFAULT_QTY = 5;

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

interface FormState {
  security_id: string;
  exchange_segment: string;
  transaction_type: string;
  order_type: string;
  quantity: string;
  price: string;
  target_price: string;
  stop_loss_price: string;
}

const BLANK_FORM: FormState = {
  security_id: "",
  exchange_segment: "NSE_EQ",
  transaction_type: "BUY",
  order_type: "LIMIT",
  quantity: String(DEFAULT_QTY),
  price: "",
  target_price: "",
  stop_loss_price: "",
};

const TERMINAL_STATUSES = new Set([
  // Dhan API super order statuses
  "CLOSED", "REJECTED", "CANCELLED",
  // Internal statuses set by our super-order monitor
  "TARGET_HIT", "STOP_LOSS_HIT", "COMPLETED",
]);

function statusColor(status: string) {
  const s = status?.toUpperCase();
  // Success: fully executed or target hit
  if (s === "TRADED" || s === "TARGET_HIT" || s === "COMPLETED" || s === "CLOSED")
    return "text-success border-success/30 bg-success/10";
  // Partial fill
  if (s === "PART_TRADED")
    return "text-amber-400 border-amber-400/30 bg-amber-400/10";
  // Error / loss
  if (s === "STOP_LOSS_HIT" || s === "REJECTED")
    return "text-destructive border-destructive/30 bg-destructive/10";
  // Cancelled
  if (s === "CANCELLED")
    return "text-muted-foreground border-muted/50 bg-muted/10";
  // Active exit in flight
  if (s === "TRIGGERED")
    return "text-warning border-warning/30 bg-warning/10";
  // Awaiting entry execution
  if (s === "PENDING" || s === "TRANSIT" || s === "OPEN")
    return "text-blue-400 border-blue-400/30 bg-blue-400/10";
  return "text-muted-foreground border-muted";
}

function segToExch(exchSeg: string): string {
  return exchSeg.split("_")[0];
}

export default function SuperOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [selectedInstrument, setSelectedInstrument] = useState<InstrumentResult | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [ltpLoading, setLtpLoading] = useState(false);
  const [ltpUnavailable, setLtpUnavailable] = useState(false);

  const { data: fundsData } = useQuery<{ availableBalance?: number; availabelBalance?: number }>({
    queryKey: ["funds-limit"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/funds`);
      if (!res.ok) throw new Error("Failed");
      return res.json() as Promise<{ availableBalance?: number; availabelBalance?: number }>;
    },
    refetchInterval: 30000,
    staleTime: 20000,
  });
  const availableBalance = Number(fundsData?.availableBalance ?? fundsData?.availabelBalance ?? 0);

  const entryPrice  = parseFloat(form.price)            || 0;
  const qty         = parseInt(form.quantity, 10)        || 0;
  const marginRequired = entryPrice * qty;
  const shortfall      = marginRequired - availableBalance;
  const insufficientFunds = marginRequired > 0 && availableBalance > 0 && shortfall > 0;

  function applyDefaults(price: number) {
    const target = parseFloat((price * (1 + TARGET_PCT / 100)).toFixed(2));
    const sl     = parseFloat((price * (1 - SL_PCT    / 100)).toFixed(2));
    setForm(p => ({ ...p, price: String(price), target_price: String(target), stop_loss_price: String(sl) }));
  }

  function handlePriceChange(raw: string) {
    const price = parseFloat(raw) || 0;
    const target = price > 0 ? parseFloat((price * (1 + TARGET_PCT / 100)).toFixed(2)) : 0;
    const sl     = price > 0 ? parseFloat((price * (1 - SL_PCT    / 100)).toFixed(2)) : 0;
    setForm(p => ({
      ...p,
      price: raw,
      target_price: price > 0 ? String(target) : p.target_price,
      stop_loss_price: price > 0 ? String(sl) : p.stop_loss_price,
    }));
  }

  const fetchLtp = useCallback(async (exchSeg: string, secId: string) => {
    if (!secId) return;
    setLtpLoading(true);
    setLtpUnavailable(false);
    try {
      const res = await fetch(`${BASE}api/market/ltp?exchSeg=${encodeURIComponent(exchSeg)}&secId=${encodeURIComponent(secId)}`);
      if (!res.ok) {
        setLtpUnavailable(true);
        return;
      }
      const data = await res.json() as { ltp?: number };
      if (data.ltp && data.ltp > 0) {
        applyDefaults(parseFloat(data.ltp.toFixed(2)));
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
      setLtpUnavailable(false);
      setForm(p => ({
        ...p,
        security_id: String(inst.securityId),
        exchange_segment: exchSeg,
        quantity: defaultQty,
        price: "",
        target_price: "",
        stop_loss_price: "",
      }));
      void fetchLtp(exchSeg, String(inst.securityId));
    } else {
      setLtpUnavailable(false);
      setForm(BLANK_FORM);
    }
  }

  const refreshInterval = useRefreshInterval(15);

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
    refetchInterval: refreshInterval,
    staleTime: refreshInterval * 0.66,
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
        const err = await res.json().catch(() => ({})) as { errorMessage?: string; error?: string };
        throw new Error(err.errorMessage ?? err.error ?? "Order failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Super Order Placed", description: `${selectedInstrument?.symbolName ?? ""} order placed successfully` });
      setShowForm(false);
      setSelectedInstrument(null);
      setForm(BLANK_FORM);
      void queryClient.invalidateQueries({ queryKey: ["super-orders"] });
    },
    onError: (e: Error) => toast({ title: "Order Failed", description: e.message, variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      const res = await fetch(`${BASE}api/super-orders/${orderId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Cancel failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Super Order Cancelled" });
      void queryClient.invalidateQueries({ queryKey: ["super-orders"] });
    },
    onError: (e: Error) => toast({ title: "Cancel Failed", description: e.message, variant: "destructive" }),
  });

  const notConnected = (error as Error | null)?.message === "Broker not connected";
  const canPlace = !insufficientFunds && !!form.security_id && !!form.quantity && !!form.price && !placeMutation.isPending && !ltpLoading;

  function handlePlaceOrder() {
    const ep = parseFloat(form.price);
    const tp = parseFloat(form.target_price);
    const sl = parseFloat(form.stop_loss_price);
    const isBuy = form.transaction_type === "BUY";

    if (form.target_price && !isNaN(tp)) {
      if (isBuy && tp <= ep) {
        toast({ title: "Invalid Target Price", description: "For BUY orders, target must be above entry price.", variant: "destructive" });
        return;
      }
      if (!isBuy && tp >= ep) {
        toast({ title: "Invalid Target Price", description: "For SELL orders, target must be below entry price.", variant: "destructive" });
        return;
      }
    }
    if (form.stop_loss_price && !isNaN(sl)) {
      if (isBuy && sl >= ep) {
        toast({ title: "Invalid Stop Loss", description: "For BUY orders, stop loss must be below entry price.", variant: "destructive" });
        return;
      }
      if (!isBuy && sl <= ep) {
        toast({ title: "Invalid Stop Loss", description: "For SELL orders, stop loss must be above entry price.", variant: "destructive" });
        return;
      }
    }
    placeMutation.mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm font-bold text-foreground">
          Entry, Target, Stop Loss All Cover In Single Order
        </p>
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
              Place Super Order
              <Badge variant="outline" className="ml-auto text-[10px] text-warning border-warning/30 bg-warning/10">INTRADAY</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Search Symbol</label>
              <SymbolSearch
                value={selectedInstrument}
                onChange={handleInstrumentSelect}
                placeholder=""
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Symbol</label>
                <div className="px-3 py-2 rounded-md border border-border bg-muted/30 text-xs font-mono min-h-[34px] flex items-center">
                  {selectedInstrument
                    ? <span className="font-semibold">{selectedInstrument.symbolName}</span>
                    : <span className="text-muted-foreground">—</span>
                  }
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
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={form.quantity}
                  onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5 relative">
                <label className="text-xs font-medium">
                  Entry Price ₹
                  {ltpLoading && <span className="text-muted-foreground font-normal ml-1">(fetching...)</span>}
                  {!ltpLoading && ltpUnavailable && <span className="text-warning font-normal ml-1">(enter manually)</span>}
                  {!ltpLoading && !ltpUnavailable && form.price && <span className="text-success font-normal ml-1">(live)</span>}
                </label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.05"
                    placeholder="0.00"
                    value={form.price}
                    onChange={e => handlePriceChange(e.target.value)}
                    className="font-mono text-xs pr-8"
                  />
                  {ltpLoading && (
                    <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {ltpUnavailable && (
                  <p className="text-[10px] text-warning/80">
                    Live price unavailable — market may be closed or symbol not found. Enter price manually.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-success">Target ₹ <span className="text-muted-foreground font-normal">({TARGET_PCT}%)</span></label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="0.00"
                  value={form.target_price}
                  onChange={e => setForm(p => ({ ...p, target_price: e.target.value }))}
                  className="font-mono text-xs border-success/30 focus-visible:ring-success/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-destructive">Stop Loss ₹ <span className="text-muted-foreground font-normal">({SL_PCT}%)</span></label>
                <Input
                  type="number"
                  step="0.05"
                  placeholder="0.00"
                  value={form.stop_loss_price}
                  onChange={e => setForm(p => ({ ...p, stop_loss_price: e.target.value }))}
                  className="font-mono text-xs border-destructive/30 focus-visible:ring-destructive/50"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-primary">Margin Required ₹</label>
                <div className={`px-3 py-2 rounded-md border text-xs font-mono min-h-[34px] flex items-center font-semibold ${
                  insufficientFunds
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : "border-primary/30 bg-primary/10 text-primary"
                }`}>
                  {marginRequired > 0
                    ? `₹${marginRequired.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "—"
                  }
                </div>
              </div>
            </div>

            {insufficientFunds && (
              <div className="flex items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="text-xs text-destructive">
                  <p className="font-semibold">Insufficient Balance — Cannot Place Order</p>
                  <p className="mt-0.5 text-destructive/80">
                    Available: ₹{availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })} · 
                    Required: ₹{marginRequired.toLocaleString("en-IN", { minimumFractionDigits: 2 })} · 
                    Shortfall: <span className="font-semibold">₹{shortfall.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span> — Please add funds to place this trade.
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2 items-center">
              <Button
                size="sm"
                className={form.transaction_type === "SELL" ? "bg-red-500 hover:bg-red-600" : ""}
                onClick={handlePlaceOrder}
                disabled={!canPlace}
                title={insufficientFunds ? "Insufficient balance" : ""}
              >
                {placeMutation.isPending
                  ? "Placing..."
                  : ltpLoading
                  ? "Loading price..."
                  : `Place ${form.transaction_type}`}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setShowForm(false); setSelectedInstrument(null); setForm(BLANK_FORM); }}>Cancel</Button>
              {availableBalance > 0 && (
                <span className="text-xs text-muted-foreground ml-2">
                  Available: ₹{availableBalance.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </span>
              )}
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
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Exchange</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Side</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Qty</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Entry</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Target</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">SL</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Margin</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => {
                const id = String(o.orderId ?? o.orderNo ?? i);
                const side = String(o.transactionType ?? o.TxnType ?? "");
                const entryP = Number(o.price ?? 0);
                const orderQty = Number(o.quantity ?? 0);
                const orderMargin = entryP * orderQty;
                return (
                  <tr key={id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold">{o.tradingSymbol ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{o.exchangeSegment ? segToExch(String(o.exchangeSegment)) : "—"}</td>
                    <td className="px-3 py-2.5">
                      {side === "BUY"
                        ? <span className="flex items-center gap-1 text-success text-xs font-medium"><TrendingUp className="w-3 h-3" />BUY</span>
                        : <span className="flex items-center gap-1 text-destructive text-xs font-medium"><TrendingDown className="w-3 h-3" />SELL</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{o.quantity ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">₹{entryP.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-success">₹{Number(o.targetPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-destructive">₹{Number(o.stopLossPrice ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-blue-400">
                      {orderMargin > 0 ? `₹${orderMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className={`text-[10px] ${statusColor(String(o.orderStatus ?? ""))}`}>
                        {o.orderStatus ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!TERMINAL_STATUSES.has(String(o.orderStatus ?? "").toUpperCase()) && (
                        <Button
                          variant="ghost" size="sm"
                          className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => cancelMutation.mutate(id)}
                          disabled={cancelMutation.isPending}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
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
