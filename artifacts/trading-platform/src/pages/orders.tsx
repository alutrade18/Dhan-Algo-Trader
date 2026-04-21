import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Download,
  AlertCircle,
  Settings,
  History,
  Search,
  CalendarDays,
} from "lucide-react";
const BASE = import.meta.env.BASE_URL;

function formatSegment(seg: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    NSE_EQ:       { label: "NSE EQ",  color: "bg-blue-500/15 text-blue-400" },
    NSE_FNO:      { label: "NSE F&O", color: "bg-purple-500/15 text-purple-400" },
    BSE_EQ:       { label: "BSE EQ",  color: "bg-sky-500/15 text-sky-400" },
    BSE_FNO:      { label: "BSE F&O", color: "bg-violet-500/15 text-violet-400" },
    MCX_COMM:     { label: "MCX",     color: "bg-orange-500/15 text-orange-400" },
    CDS_FX:       { label: "CDS FX",  color: "bg-teal-500/15 text-teal-400" },
    NSE_CURRENCY: { label: "NSE FX",  color: "bg-teal-500/15 text-teal-400" },
    IDX_I:        { label: "INDEX",   color: "bg-gray-500/15 text-gray-400" },
  };
  return map[seg] ?? { label: seg, color: "bg-muted text-muted-foreground" };
}

type OrderStatus =
  | "TRADED"
  | "PENDING"
  | "TRANSIT"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "PART_TRADED";
type TransactionType = "BUY" | "SELL";
type OrderType = "LIMIT" | "MARKET" | "STOP_LOSS" | "STOP_LOSS_MARKET";
type ProductType = "INTRADAY" | "CNC" | "MARGIN" | "MTF" | "CO" | "BO";
type Validity = "DAY" | "IOC";

interface DhanOrder {
  orderId: string;
  correlationId?: string;
  orderStatus: OrderStatus;
  transactionType: TransactionType;
  exchangeSegment: string;
  productType: ProductType;
  orderType: OrderType;
  validity: Validity;
  tradingSymbol: string;
  securityId: string;
  quantity: number;
  disclosedQuantity?: number;
  price: number;
  triggerPrice?: number;
  afterMarketOrder?: boolean;
  createTime: string;
  updateTime: string;
  exchangeTime?: string;
  omsErrorCode?: string;
  omsErrorDescription?: string;
  filledQty: number;
  tradedPrice: number;
  remainingQuantity?: number;
  legName?: string;
}

interface ModifyFormState {
  orderType: OrderType;
  quantity: string;
  price: string;
  triggerPrice: string;
  validity: Validity;
}

interface TradeHistoryEntry {
  orderId?: string;
  exchangeOrderId?: string;
  exchangeTradeId?: string;
  transactionType: TransactionType;
  exchangeSegment: string;
  productType: ProductType;
  orderType?: OrderType;
  tradingSymbol: string;
  customSymbol?: string;
  securityId?: string;
  tradedQuantity: number;
  tradedPrice: number;
  tradeValue?: number;
  createTime: string;
  updateTime?: string;
  exchangeTime?: string;
}

function formatTime(dt: string): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return dt;
  }
}

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function downloadCsv(rows: Record<string, unknown>[], filename: string): void {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const csv = [
    headers.map(escape).join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(",")),
  ].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; className: string }> = {
    TRADED: {
      label: "TRADED",
      className: "bg-success/15 text-success border border-success/30",
    },
    PENDING: {
      label: "PENDING",
      className: "bg-warning/15 text-warning border border-warning/30",
    },
    TRANSIT: {
      label: "TRANSIT",
      className: "bg-warning/15 text-warning border border-warning/30",
    },
    PART_TRADED: {
      label: "PART TRADED",
      className: "bg-primary/15 text-primary border border-primary/30",
    },
    REJECTED: {
      label: "REJECTED",
      className: "bg-destructive/15 text-destructive border border-destructive/30",
    },
    CANCELLED: {
      label: "CANCELLED",
      className: "bg-muted text-muted-foreground border border-border",
    },
    EXPIRED: {
      label: "EXPIRED",
      className: "bg-muted text-muted-foreground border border-border",
    },
  };
  const cfg = map[status] ?? {
    label: status,
    className: "bg-muted text-muted-foreground border border-border",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

function SideBadge({ side }: { side: TransactionType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        side === "BUY"
          ? "bg-success/15 text-success"
          : "bg-destructive/15 text-destructive"
      }`}
    >
      {side}
    </span>
  );
}

function ProductBadge({ product }: { product: ProductType }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground border border-border">
      {product}
    </span>
  );
}

interface ModifyOrderModalProps {
  order: DhanOrder | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ModifyOrderModal({
  order,
  open,
  onClose,
  onSuccess,
}: ModifyOrderModalProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [form, setForm] = useState<ModifyFormState>({
    orderType: "LIMIT",
    quantity: "",
    price: "",
    triggerPrice: "",
    validity: "DAY",
  });

  useEffect(() => {
    if (order) {
      setForm({
        orderType: order.orderType,
        quantity: String(order.quantity),
        price: String(order.price),
        triggerPrice: String(order.triggerPrice ?? ""),
        validity: order.validity,
      });
      setShowConfirm(false);
    }
  }, [order]);

  const priceRequired =
    form.orderType === "LIMIT" || form.orderType === "STOP_LOSS";
  const triggerRequired =
    form.orderType === "STOP_LOSS" || form.orderType === "STOP_LOSS_MARKET";

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    setShowConfirm(true);
  }

  async function handleConfirm() {
    if (!order) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        orderType: form.orderType,
        quantity: Number(form.quantity),
        validity: form.validity,
      };
      if (priceRequired) body.price = Number(form.price);
      if (triggerRequired) body.triggerPrice = Number(form.triggerPrice);

      const res = await fetch(`${BASE}api/orders/${order.orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        toast({
          title: "Modification failed",
          description:
            (data.omsErrorDescription as string) ||
            (data.errorMessage as string) ||
            "Could not modify order",
          variant: "destructive",
        });
        setShowConfirm(false);
        return;
      }
      toast({
        title: "Order modified successfully",
        description: String(data.message ?? `Order ${order.orderId} updated`),
      });
      onSuccess();
      onClose();
    } catch {
      toast({
        title: "Network error",
        description: "Could not reach server",
        variant: "destructive",
      });
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setShowConfirm(false); } }}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {showConfirm ? "Confirm Modification" : "Modify Order"}
          </DialogTitle>
        </DialogHeader>
        {order && !showConfirm && (
          <form onSubmit={(e) => void handleReview(e)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Order ID</span>
                <p className="font-mono mt-0.5 break-all">{order.orderId}</p>
              </div>
              <div>
                <span className="font-medium text-foreground">Symbol</span>
                <p className="font-mono mt-0.5">{order.tradingSymbol}</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Order Type</Label>
              <Select
                value={form.orderType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, orderType: v as OrderType }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIMIT">LIMIT</SelectItem>
                  <SelectItem value="MARKET">MARKET</SelectItem>
                  <SelectItem value="STOP_LOSS">STOP LOSS</SelectItem>
                  <SelectItem value="STOP_LOSS_MARKET">
                    STOP LOSS MARKET
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-sm"
                  value={form.quantity}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, quantity: e.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Price {!priceRequired && <span className="text-muted-foreground">(N/A)</span>}
                </Label>
                <Input
                  type="number"
                  step="0.05"
                  className="h-8 text-sm"
                  value={form.price}
                  disabled={!priceRequired}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price: e.target.value }))
                  }
                  required={priceRequired}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Trigger {!triggerRequired && <span className="text-muted-foreground">(N/A)</span>}
                </Label>
                <Input
                  type="number"
                  step="0.05"
                  className="h-8 text-sm"
                  value={form.triggerPrice}
                  disabled={!triggerRequired}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      triggerPrice: e.target.value,
                    }))
                  }
                  required={triggerRequired}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Validity</Label>
              <Select
                value={form.validity}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, validity: v as Validity }))
                }
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAY">DAY</SelectItem>
                  <SelectItem value="IOC">IOC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
              >
                Close
              </Button>
              <Button type="submit" size="sm">
                Review Changes
              </Button>
            </DialogFooter>
          </form>
        )}
        {order && showConfirm && (
          <div className="space-y-4">
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              Review the changes below. This will modify a live order on Dhan.
            </div>
            <div className="space-y-2 rounded-md bg-muted/40 px-3 py-3 text-xs">
              {[
                { label: "Symbol",     value: order.tradingSymbol },
                { label: "Order ID",   value: order.orderId },
                { label: "Order Type", value: form.orderType },
                { label: "Quantity",   value: form.quantity },
                ...(priceRequired   ? [{ label: "Price",         value: `₹${form.price}` }]        : []),
                ...(triggerRequired ? [{ label: "Trigger Price", value: `₹${form.triggerPrice}` }] : []),
                { label: "Validity",   value: form.validity },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium">{value}</span>
                </div>
              ))}
            </div>
            <DialogFooter className="pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirm(false)}
                disabled={loading}
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={loading}
                onClick={() => void handleConfirm()}
              >
                {loading ? "Modifying…" : "Confirm Modify"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface CancelConfirmProps {
  orderId: string;
  onConfirm: () => void;
  onDismiss: () => void;
  loading: boolean;
}

function CancelConfirm({
  orderId,
  onConfirm,
  onDismiss,
  loading,
}: CancelConfirmProps) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive whitespace-nowrap">
      <span>Cancel …{orderId.slice(-6)}?</span>
      <Button
        size="sm"
        variant="destructive"
        className="h-5 px-2 text-[10px]"
        onClick={onConfirm}
        disabled={loading}
      >
        {loading ? "…" : "Yes"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-2 text-[10px] text-muted-foreground"
        onClick={onDismiss}
        disabled={loading}
      >
        No
      </Button>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: string;
}

function StatCard({
  icon,
  label,
  value,
  color = "text-foreground",
}: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 flex items-center gap-2">
      <div className="shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground truncate leading-tight">{label}</p>
        <p className={`text-lg font-bold leading-tight ${color}`}>{value}</p>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<DhanOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [modifyOrder, setModifyOrder] = useState<DhanOrder | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const fetchOrders = useCallback(async (showRefreshSpin = false) => {
    if (showRefreshSpin) setOrdersRefreshing(true);
    try {
      const res = await fetch(`${BASE}api/orders`, { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        setOrdersError(
          (data.errorMessage as string) ||
            "Failed to fetch orders. Is broker connected?"
        );
        return;
      }
      const data = (await res.json()) as DhanOrder[];
      setOrders(Array.isArray(data) ? data : []);
      setOrdersError(null);
    } catch {
      setOrdersError("Network error — could not reach server.");
    } finally {
      setOrdersLoading(false);
      setOrdersRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    autoRefreshRef.current = setInterval(() => {
      void fetchOrders();
    }, 2000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchOrders]);

  function handleRefresh() {
    void fetchOrders(true);
  }

  async function handleCancel(orderId: string) {
    setCancelLoading(true);
    try {
      const res = await fetch(`${BASE}api/orders/${orderId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        toast({
          title: "Cancel failed",
          description:
            (data.omsErrorDescription as string) ||
            (data.errorMessage as string) ||
            "Could not cancel order",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Order cancelled",
        description: `Order …${orderId.slice(-8)} cancelled successfully`,
      });
      setCancelConfirmId(null);
      await fetchOrders();
    } catch {
      toast({
        title: "Network error",
        description: "Could not reach server",
        variant: "destructive",
      });
    } finally {
      setCancelLoading(false);
    }
  }

  // ── Previous orders (trade history) ─────────────────────────────────────
  function yesterdayISO(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }

  const [historyDate, setHistoryDate] = useState<string>(yesterdayISO());
  const [historyOrders, setHistoryOrders] = useState<TradeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFetched, setHistoryFetched] = useState(false);

  async function fetchHistory() {
    if (!historyDate) return;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryFetched(false);
    try {
      const res = await fetch(`${BASE}api/orders/history?date=${historyDate}`, { cache: "no-store" });
      const data = await res.json() as TradeHistoryEntry[] | { errorMessage?: string };
      if (!res.ok) {
        setHistoryError((data as { errorMessage?: string }).errorMessage ?? "Failed to fetch trade history.");
        setHistoryOrders([]);
        return;
      }
      setHistoryOrders(Array.isArray(data) ? data : []);
      setHistoryFetched(true);
    } catch {
      setHistoryError("Network error — could not reach server.");
      setHistoryOrders([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function exportHistory() {
    if (historyOrders.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }
    const rows = historyOrders.map((t) => ({
      "Order ID": t.orderId ?? "",
      "Trade ID": t.exchangeTradeId ?? "",
      Symbol: t.tradingSymbol,
      "Transaction Type": t.transactionType,
      Product: t.productType,
      "Traded Qty": t.tradedQuantity,
      "Traded Price": t.tradedPrice,
      "Trade Value": t.tradeValue ?? t.tradedQuantity * t.tradedPrice,
      Segment: t.exchangeSegment,
      "Create Time": t.createTime,
    }));
    const filename = `dhan-trade-history-${historyDate}.csv`;
    downloadCsv(rows, filename);
    toast({ title: `Exported ${rows.length} rows`, description: filename });
  }

  function exportTodayOrders() {
    if (orders.length === 0) {
      toast({
        title: "No data to export",
        description: "No orders to export",
        variant: "destructive",
      });
      return;
    }
    const rows = orders.map((o) => ({
      "Order ID": o.orderId,
      Symbol: o.tradingSymbol,
      "Transaction Type": o.transactionType,
      Product: o.productType,
      "Order Type": o.orderType,
      Quantity: o.quantity,
      "Filled Qty": o.filledQty,
      Price: o.price,
      "Trigger Price": o.triggerPrice ?? "",
      Status: o.orderStatus,
      "Create Time": o.createTime,
      "Update Time": o.updateTime,
      "OMS Error": o.omsErrorDescription ?? "",
    }));
    const filename = `dhan-orders-today-${todayISO()}.csv`;
    downloadCsv(rows, filename);
    toast({
      title: `Exported ${rows.length} rows`,
      description: filename,
    });
  }

  const totalOrders = orders.length;
  const tradedCount = orders.filter((o) => o.orderStatus === "TRADED").length;
  const pendingCount = orders.filter(
    (o) => o.orderStatus === "PENDING" || o.orderStatus === "TRANSIT"
  ).length;
  const rejCancelCount = orders.filter(
    (o) => o.orderStatus === "REJECTED" || o.orderStatus === "CANCELLED"
  ).length;

  const canModifyOrCancel = (status: OrderStatus) =>
    status === "PENDING" || status === "TRANSIT";

  return (
    <TooltipProvider>
      <div className="space-y-3">

        {/* ── Header row ─────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-sm font-bold text-foreground hidden sm:block">
            Today&apos;s Orders
          </p>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={ordersRefreshing}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${ordersRefreshing ? "animate-spin" : ""}`} />
              {ordersRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard
            icon={<ClipboardList className="h-4 w-4" />}
            label="Total Orders Today"
            value={totalOrders}
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Traded"
            value={tradedCount}
            color="text-success"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Pending / Transit"
            value={pendingCount}
            color="text-warning"
          />
          <StatCard
            icon={<XCircle className="h-4 w-4" />}
            label="Rejected / Cancelled"
            value={rejCancelCount}
            color="text-destructive"
          />
        </div>

          <div className="space-y-0">
            <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 18rem)" }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-medium">Today's Orders</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-7 text-xs"
                  onClick={exportTodayOrders}
                >
                  <Download className="h-3 w-3" />
                  Export
                </Button>
              </div>

              {ordersError ? (
                <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
                  <AlertCircle className="h-8 w-8 text-destructive/70" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      Broker not connected
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Please connect your Dhan account in Settings.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 mt-1"
                    onClick={() =>
                      (window.location.href = `${BASE}settings`)
                    }
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Go to Settings
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {[
                          "Time",
                          "Symbol",
                          "Type",
                          "Product",
                          "Qty",
                          "Price",
                          "Trigger",
                          "Status",
                          "Action",
                        ].map((h, i) => (
                          <th
                            key={h}
                            className={`px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap ${
                              i >= 4 && i <= 6 ? "text-right" : "text-left"
                            }`}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ordersLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr
                            key={i}
                            className="border-b border-border/50 last:border-0"
                          >
                            {Array.from({ length: 9 }).map((_, j) => (
                              <td key={j} className="px-4 py-3">
                                <Skeleton className="h-4 w-full" />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : orders.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-16 text-center">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                              <ClipboardList className="h-8 w-8 opacity-40" />
                              <p className="text-sm">
                                No orders placed today
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        orders.map((order) => (
                          <tr
                            key={order.orderId}
                            className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                          >
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                              {formatTime(order.createTime)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-mono font-semibold text-sm">
                                {order.tradingSymbol}
                              </span>
                              {order.omsErrorDescription && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <AlertCircle className="inline-block ml-1.5 h-3 w-3 text-destructive align-middle cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    {order.omsErrorDescription}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <SideBadge side={order.transactionType} />
                            </td>
                            <td className="px-4 py-3">
                              <ProductBadge product={order.productType} />
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-mono">
                              {order.filledQty > 0 ? (
                                <span>
                                  {order.quantity}{" "}
                                  <span className="text-muted-foreground">
                                    / {order.filledQty} filled
                                  </span>
                                </span>
                              ) : (
                                order.quantity
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-mono">
                              {order.orderType === "MARKET" ? (
                                <span className="text-muted-foreground">
                                  MKT
                                </span>
                              ) : (
                                formatCurrency(order.price)
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-xs font-mono">
                              {(order.triggerPrice ?? 0) > 0 ? (
                                formatCurrency(order.triggerPrice!)
                              ) : (
                                <span className="text-muted-foreground">
                                  —
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <StatusBadge status={order.orderStatus} />
                            </td>
                            <td className="px-4 py-3">
                              {cancelConfirmId === order.orderId ? (
                                <CancelConfirm
                                  orderId={order.orderId}
                                  onConfirm={() =>
                                    void handleCancel(order.orderId)
                                  }
                                  onDismiss={() => setCancelConfirmId(null)}
                                  loading={cancelLoading}
                                />
                              ) : canModifyOrCancel(order.orderStatus) ? (
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[11px] border-primary/50 text-primary hover:bg-primary/10"
                                    onClick={() => setModifyOrder(order)}
                                  >
                                    Modify
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[11px] border-destructive/50 text-destructive hover:bg-destructive/10"
                                    onClick={() =>
                                      setCancelConfirmId(order.orderId)
                                    }
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  —
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

        {/* ── Previous Orders (Trade History) ─────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {/* Card header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/10">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <History className="h-3.5 w-3.5 text-primary" />
              </div>
              <p className="text-sm font-semibold">Previous Orders</p>
              <span className="text-[10px] text-muted-foreground bg-muted/40 border border-border/50 rounded-full px-2 py-0.5 hidden sm:inline">Trade History</span>
            </div>
            {historyFetched && historyOrders.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 text-xs"
                onClick={() => void exportHistory()}
              >
                <Download className="h-3 w-3" />
                Export
              </Button>
            )}
          </div>

          {/* Date picker + Fetch button */}
          <div className="px-4 py-3 border-b border-border/50 bg-muted/5">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex items-center gap-2 flex-1 rounded-xl border border-border bg-background/60 px-3 h-10 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-colors">
                <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
                <input
                  type="date"
                  value={historyDate}
                  max={todayISO()}
                  onChange={e => setHistoryDate(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") void fetchHistory(); }}
                  className="flex-1 bg-transparent text-sm font-mono text-foreground outline-none min-w-0 [color-scheme:dark]"
                  style={{ colorScheme: "dark" }}
                />
              </div>
              <Button
                size="sm"
                className="h-10 px-5 gap-2 font-medium shrink-0"
                onClick={() => void fetchHistory()}
                disabled={historyLoading || !historyDate}
              >
                {historyLoading ? (
                  <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Fetching…</>
                ) : (
                  <><Search className="h-3.5 w-3.5" />Fetch Orders</>
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Select a date to view executed trades from Dhan trade history.
            </p>
          </div>

          {/* Results area */}
          {historyError && (
            <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
              <AlertCircle className="h-7 w-7 text-destructive/60" />
              <p className="text-sm text-destructive font-medium">Failed to load</p>
              <p className="text-xs text-muted-foreground max-w-xs">{historyError}</p>
            </div>
          )}

          {!historyError && !historyFetched && !historyLoading && (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
              <History className="h-7 w-7 opacity-30" />
              <p className="text-sm">Select a date above and tap Fetch Orders</p>
            </div>
          )}

          {historyLoading && (
            <div className="overflow-x-auto">
              <table className="w-full table-auto text-sm">
                <tbody>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!historyLoading && historyFetched && (
            historyOrders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <ClipboardList className="h-7 w-7 opacity-30" />
                <p className="text-sm">No trades found for {historyDate}</p>
                <p className="text-xs opacity-60">Only executed (filled) trades appear in history</p>
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="flex flex-col gap-0 sm:hidden">
                  {historyOrders.map((t, idx) => {
                    const seg = formatSegment(t.exchangeSegment);
                    const value = t.tradeValue ?? t.tradedQuantity * t.tradedPrice;
                    return (
                      <div key={t.exchangeTradeId ?? idx} className="border-b border-border/40 last:border-0 px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-sm">{t.tradingSymbol}</span>
                          <SideBadge side={t.transactionType} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.color}`}>{seg.label}</span>
                          <ProductBadge product={t.productType} />
                        </div>
                        <div className="grid grid-cols-3 gap-1 text-[11px]">
                          <div><span className="text-muted-foreground">Qty</span><p className="font-mono font-medium">{t.tradedQuantity}</p></div>
                          <div><span className="text-muted-foreground">Price</span><p className="font-mono font-medium">{formatCurrency(t.tradedPrice)}</p></div>
                          <div><span className="text-muted-foreground">Value</span><p className="font-mono font-medium">{formatCurrency(value)}</p></div>
                        </div>
                        <p className="text-[10px] text-muted-foreground font-mono">{formatTime(t.createTime)}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Desktop table view */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Time", "Symbol", "Segment", "Type", "Product", "Qty", "Price", "Value"].map((h, i) => (
                          <th key={h} className={`px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap ${i >= 5 ? "text-right" : "text-left"}`}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyOrders.map((t, idx) => {
                        const seg = formatSegment(t.exchangeSegment);
                        const value = t.tradeValue ?? t.tradedQuantity * t.tradedPrice;
                        return (
                          <tr key={t.exchangeTradeId ?? idx} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">
                              {formatTime(t.createTime)}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="font-mono font-semibold text-sm">{t.tradingSymbol}</span>
                              {t.customSymbol && (
                                <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{t.customSymbol}</p>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.color}`}>{seg.label}</span>
                            </td>
                            <td className="px-4 py-3"><SideBadge side={t.transactionType} /></td>
                            <td className="px-4 py-3"><ProductBadge product={t.productType} /></td>
                            <td className="px-4 py-3 text-right text-xs font-mono">{t.tradedQuantity}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono">{formatCurrency(t.tradedPrice)}</td>
                            <td className="px-4 py-3 text-right text-xs font-mono font-medium">{formatCurrency(value)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-muted/10">
                        <td colSpan={7} className="px-4 py-2 text-xs text-muted-foreground text-right font-medium">
                          Total Trade Value
                        </td>
                        <td className="px-4 py-2 text-right text-xs font-mono font-bold">
                          {formatCurrency(historyOrders.reduce((sum, t) => sum + (t.tradeValue ?? t.tradedQuantity * t.tradedPrice), 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )
          )}
        </div>

        <ModifyOrderModal
          order={modifyOrder}
          open={!!modifyOrder}
          onClose={() => setModifyOrder(null)}
          onSuccess={() => void fetchOrders()}
        />
      </div>
    </TooltipProvider>
  );
}
