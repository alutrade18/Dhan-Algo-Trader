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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  ClipboardList,
  CheckCircle2,
  Clock,
  XCircle,
  RefreshCw,
  Download,
  Search,
  AlertCircle,
  Settings,
  TrendingDown,
} from "lucide-react";
import * as XLSX from "xlsx";

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

interface DhanTrade {
  exchangeTradeId: string;
  orderId: string;
  dhanClientId?: string;
  correlationId?: string;
  transactionType: TransactionType;
  exchangeSegment: string;
  productType: ProductType;
  orderType: OrderType;
  tradingSymbol: string;
  customSymbol?: string;
  securityId: string;
  tradedQuantity: number;
  tradedPrice: number;
  createTime: string;
  exchangeTime?: string;
  instrument?: string;
  drvExpiryDate?: string;
  drvOptionType?: string;
  drvStrikePrice?: number;
}

interface ModifyFormState {
  orderType: OrderType;
  quantity: string;
  price: string;
  triggerPrice: string;
  validity: Validity;
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

function formatDateTime(dt: string): string {
  if (!dt) return "—";
  try {
    return new Date(dt).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
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

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; className: string }> = {
    TRADED: {
      label: "TRADED",
      className: "bg-green-500/20 text-green-400 border border-green-500/30",
    },
    PENDING: {
      label: "PENDING",
      className:
        "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    },
    TRANSIT: {
      label: "TRANSIT",
      className:
        "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
    },
    PART_TRADED: {
      label: "PART TRADED",
      className: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
    },
    REJECTED: {
      label: "REJECTED",
      className: "bg-red-500/20 text-red-400 border border-red-500/30",
    },
    CANCELLED: {
      label: "CANCELLED",
      className: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
    },
    EXPIRED: {
      label: "EXPIRED",
      className: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
    },
  };
  const cfg = map[status] ?? {
    label: status,
    className: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
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
          ? "bg-green-500/20 text-green-400"
          : "bg-red-500/20 text-red-400"
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
    }
  }, [order]);

  const priceRequired =
    form.orderType === "LIMIT" || form.orderType === "STOP_LOSS";
  const triggerRequired =
    form.orderType === "STOP_LOSS" || form.orderType === "STOP_LOSS_MARKET";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            Modify Order
          </DialogTitle>
        </DialogHeader>
        {order && (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
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
                disabled={loading}
              >
                Close
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? "Modifying…" : "Modify Order"}
              </Button>
            </DialogFooter>
          </form>
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
    <div className="flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400 whitespace-nowrap">
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
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className="shrink-0 text-muted-foreground">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground truncate">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("today");

  const [orders, setOrders] = useState<DhanOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersRefreshing, setOrdersRefreshing] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [modifyOrder, setModifyOrder] = useState<DhanOrder | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const [fromDate, setFromDate] = useState(daysAgoISO(30));
  const [toDate, setToDate] = useState(todayISO());
  const [tradeHistory, setTradeHistory] = useState<DhanTrade[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySearched, setHistorySearched] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const HISTORY_PAGE_SIZE = 100;
  const lastSearchRef = useRef<{ from: string; to: string } | null>(null);

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
    }, 11000);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [fetchOrders]);

  const fetchHistory = useCallback(async (from?: string, to?: string) => {
    const fd = from ?? fromDate;
    const td = to ?? toDate;
    lastSearchRef.current = { from: fd, to: td };
    setHistoryLoading(true);
    setHistorySearched(true);
    setHistoryPage(0);
    try {
      const res = await fetch(
        `${BASE}api/trades/history?fromDate=${fd}&toDate=${td}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        toast({
          title: "Failed to fetch trade history",
          description:
            (data.errorMessage as string) || "Could not load history",
          variant: "destructive",
        });
        setTradeHistory([]);
        return;
      }
      const data = (await res.json()) as DhanTrade[];
      setTradeHistory(Array.isArray(data) ? data : []);
    } catch {
      toast({
        title: "Network error",
        description: "Could not reach server",
        variant: "destructive",
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [fromDate, toDate, toast]);

  function handleRefresh() {
    if (activeTab === "today") {
      void fetchOrders(true);
    } else {
      if (lastSearchRef.current) {
        void fetchHistory(lastSearchRef.current.from, lastSearchRef.current.to);
      } else {
        void fetchOrders(true);
      }
    }
  }

  function applyQuickRange(from: string, to: string) {
    setFromDate(from);
    setToDate(to);
    void fetchHistory(from, to);
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
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, `dhan-orders-today-${todayISO()}.xlsx`);
    toast({
      title: `Exported ${rows.length} rows to Excel`,
      description: `dhan-orders-today-${todayISO()}.xlsx`,
    });
  }

  function exportHistory() {
    if (tradeHistory.length === 0) {
      toast({
        title: "No data to export",
        description: "No trades to export",
        variant: "destructive",
      });
      return;
    }
    const rows = tradeHistory.map((t) => ({
      "Trade Time":   t.exchangeTime || t.createTime || "",
      "Segment":      t.exchangeSegment,
      "Symbol":       t.customSymbol || t.tradingSymbol,
      "Instrument":   t.instrument || "",
      "Side":         t.transactionType,
      "Option Type":  t.drvOptionType || "",
      "Strike Price": t.drvStrikePrice ?? "",
      "Expiry Date":  t.drvExpiryDate || "",
      "Product":      t.productType,
      "Qty":          t.tradedQuantity,
      "Price":        t.tradedPrice,
      "Order ID":     t.orderId,
      "Security ID":  t.securityId,
      "Client ID":    t.dhanClientId || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Trade History");
    XLSX.writeFile(wb, `dhan-trades-${fromDate}-to-${toDate}.xlsx`);
    toast({
      title: `Exported ${rows.length} rows to Excel`,
      description: `dhan-trades-${fromDate}-to-${toDate}.xlsx`,
    });
  }

  const totalHistoryPages = Math.ceil(tradeHistory.length / HISTORY_PAGE_SIZE);
  const pagedTrades = tradeHistory.slice(
    historyPage * HISTORY_PAGE_SIZE,
    (historyPage + 1) * HISTORY_PAGE_SIZE
  );

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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">

        {/* ── Single header row ─────────────────────────────────── */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Order Book</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage orders and view trade history
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={ordersRefreshing || historyLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${ordersRefreshing || historyLoading ? "animate-spin" : ""}`} />
              {ordersRefreshing || historyLoading ? "Refreshing…" : "Refresh"}
            </Button>
            <TabsList className="bg-muted/40 h-8">
              <TabsTrigger value="today" className="text-xs px-3 h-6">Today's Orders</TabsTrigger>
              <TabsTrigger value="history" className="text-xs px-3 h-6">Order History</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<ClipboardList className="h-5 w-5" />}
            label="Total Orders Today"
            value={totalOrders}
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Traded"
            value={tradedCount}
            color="text-green-400"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />}
            label="Pending / Transit"
            value={pendingCount}
            color="text-yellow-400"
          />
          <StatCard
            icon={<XCircle className="h-5 w-5" />}
            label="Rejected / Cancelled"
            value={rejCancelCount}
            color="text-red-400"
          />
        </div>

          <TabsContent value="today" className="space-y-0 mt-0">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
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
                                    <AlertCircle className="inline-block ml-1.5 h-3 w-3 text-red-400 align-middle cursor-help" />
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
                                    className="h-6 px-2 text-[11px] border-blue-500/50 text-blue-400 hover:bg-blue-500/10"
                                    onClick={() => setModifyOrder(order)}
                                  >
                                    Modify
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[11px] border-red-500/50 text-red-400 hover:bg-red-500/10"
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
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-0">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">From Date</Label>
                  <Input
                    type="date"
                    className="h-9 text-sm w-44 cursor-pointer"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">To Date</Label>
                  <Input
                    type="date"
                    className="h-9 text-sm w-44 cursor-pointer"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2"
                    disabled={historyLoading}
                    onClick={() => applyQuickRange(todayISO(), todayISO())}
                  >
                    Today
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2"
                    disabled={historyLoading}
                    onClick={() => applyQuickRange(daysAgoISO(7), todayISO())}
                  >
                    7D
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs px-2"
                    disabled={historyLoading}
                    onClick={() => applyQuickRange(daysAgoISO(30), todayISO())}
                  >
                    30D
                  </Button>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5 h-8"
                  onClick={() => void fetchHistory()}
                  disabled={historyLoading}
                >
                  <Search className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} />
                  {historyLoading ? "Searching…" : "Search"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 h-8 ml-auto"
                  disabled={!historySearched || tradeHistory.length === 0}
                  onClick={exportHistory}
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Excel
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-medium">
                  {historySearched
                    ? `${tradeHistory.length} trade${tradeHistory.length !== 1 ? "s" : ""} found`
                    : "Trade History"}
                  {historySearched && tradeHistory.length > HISTORY_PAGE_SIZE && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">
                      (showing {historyPage * HISTORY_PAGE_SIZE + 1}–{Math.min((historyPage + 1) * HISTORY_PAGE_SIZE, tradeHistory.length)})
                    </span>
                  )}
                </p>
                {historySearched && tradeHistory.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {lastSearchRef.current?.from} → {lastSearchRef.current?.to}
                  </p>
                )}
              </div>

              {!historySearched ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <Search className="h-8 w-8 opacity-40" />
                  <p className="text-sm">Select a date range and click Search</p>
                </div>
              ) : historyLoading ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          {Array.from({ length: 8 }).map((_, j) => (
                            <td key={j} className="px-4 py-2.5">
                              <Skeleton className="h-4 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : tradeHistory.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <TrendingDown className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No trades found for selected period</p>
                </div>
              ) : (
                <div>
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border bg-muted/30">
                        {([
                          ["Trade Time",   "left" ],
                          ["Symbol",       "left" ],
                          ["Option Type",  "left" ],
                          ["Side",         "left" ],
                          ["Instrument",   "left" ],
                          ["Product",      "left" ],
                          ["Strike Price", "left" ],
                          ["Expiry Date",  "left" ],
                          ["Qty",          "right"],
                          ["Price",        "right"],
                          ["Segment",      "left" ],
                          ["Order ID",     "left" ],
                          ["Security ID",  "left" ],
                          ["Client ID",    "left" ],
                        ] as [string, string][]).map(([label, align]) => (
                          <th key={label}
                            className={`px-2.5 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap text-${align}${label === "Order ID" ? " min-w-[160px]" : ""}`}
                          >{label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedTrades.map((trade, idx) => {
                        const seg = formatSegment(trade.exchangeSegment);
                        const optType = trade.drvOptionType && trade.drvOptionType !== "NA"
                          ? trade.drvOptionType : null;
                        return (
                        <tr key={`${trade.exchangeTradeId}-${idx}`}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors"
                        >
                          {/* Trade Time */}
                          <td className="px-2.5 py-2 text-xs text-muted-foreground font-mono whitespace-nowrap">
                            {formatDateTime(trade.exchangeTime || trade.createTime)}
                          </td>
                          {/* Symbol */}
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            <span className="font-mono font-semibold text-xs">
                              {trade.customSymbol || trade.tradingSymbol}
                            </span>
                          </td>
                          {/* Option Type */}
                          <td className="px-2.5 py-2 text-xs font-semibold whitespace-nowrap">
                            {optType ? (
                              <span className={optType === "CALL" || optType === "CE"
                                ? "text-green-400" : "text-red-400"}>
                                {optType}
                              </span>
                            ) : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          {/* Side */}
                          <td className="px-2.5 py-2">
                            <SideBadge side={trade.transactionType} />
                          </td>
                          {/* Instrument */}
                          <td className="px-2.5 py-2 text-xs text-muted-foreground whitespace-nowrap">
                            {trade.instrument || "—"}
                          </td>
                          {/* Product */}
                          <td className="px-2.5 py-2">
                            <ProductBadge product={trade.productType} />
                          </td>
                          {/* Strike Price */}
                          <td className="px-2.5 py-2 text-left text-xs font-mono">
                            {trade.drvStrikePrice && trade.drvStrikePrice !== 0
                              ? trade.drvStrikePrice.toLocaleString("en-IN")
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          {/* Expiry Date */}
                          <td className="px-2.5 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {trade.drvExpiryDate && trade.drvExpiryDate !== "NA"
                              ? trade.drvExpiryDate
                              : <span className="text-muted-foreground/40">—</span>}
                          </td>
                          {/* Qty */}
                          <td className="px-2.5 py-2 text-right text-xs font-mono">
                            {trade.tradedQuantity.toLocaleString("en-IN")}
                          </td>
                          {/* Price */}
                          <td className="px-2.5 py-2 text-right text-xs font-mono font-semibold">
                            {formatCurrency(trade.tradedPrice)}
                          </td>
                          {/* Segment */}
                          <td className="px-2.5 py-2">
                            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${seg.color}`}>
                              {seg.label}
                            </span>
                          </td>
                          {/* Order ID — full width, no truncation */}
                          <td className="px-2.5 py-2 min-w-[160px]">
                            <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                              {trade.orderId}
                            </span>
                          </td>
                          {/* Security ID */}
                          <td className="px-2.5 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {trade.securityId}
                          </td>
                          {/* Client ID */}
                          <td className="px-2.5 py-2 text-xs font-mono text-muted-foreground whitespace-nowrap">
                            {trade.dhanClientId || "—"}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {totalHistoryPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
                    <p className="text-xs text-muted-foreground">
                      Page {historyPage + 1} of {totalHistoryPages} &nbsp;·&nbsp; {tradeHistory.length} total trades
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        disabled={historyPage === 0}
                        onClick={() => setHistoryPage((p) => p - 1)}
                      >
                        ← Previous
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        disabled={historyPage >= totalHistoryPages - 1}
                        onClick={() => setHistoryPage((p) => p + 1)}
                      >
                        Next →
                      </Button>
                    </div>
                  </div>
                )}
                </div>
              )}
            </div>
          </TabsContent>

        <ModifyOrderModal
          order={modifyOrder}
          open={!!modifyOrder}
          onClose={() => setModifyOrder(null)}
          onSuccess={() => void fetchOrders()}
        />
      </Tabs>
    </TooltipProvider>
  );
}
