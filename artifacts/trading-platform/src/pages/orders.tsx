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
  Search,
  CalendarDays,
} from "lucide-react";
const BASE = import.meta.env.BASE_URL;

// ── helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function formatTime(dt: string): string {
  if (!dt) return "—";
  try {
    const normalized = dt.replace(" ", "T");
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dt || "—";
    return date.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    });
  } catch {
    return dt || "—";
  }
}

function formatDateTime(dt: string): string {
  if (!dt) return "—";
  try {
    const normalized = dt.replace(" ", "T");
    const date = new Date(normalized);
    if (isNaN(date.getTime())) return dt || "—";
    const ist = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const dd   = String(ist.getDate()).padStart(2, "0");
    const mm   = String(ist.getMonth() + 1).padStart(2, "0");
    const yyyy = ist.getFullYear();
    const hh   = String(ist.getHours()).padStart(2, "0");
    const min  = String(ist.getMinutes()).padStart(2, "0");
    const ss   = String(ist.getSeconds()).padStart(2, "0");
    return `${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;
  } catch {
    return dt || "—";
  }
}

function formatCurrency(n: number): string {
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

// ── types ─────────────────────────────────────────────────────────────────────

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
type Preset = "today" | "7d" | "30d" | "365d" | "custom";

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

// ── small UI components ───────────────────────────────────────────────────────

function StatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { label: string; className: string }> = {
    TRADED:     { label: "TRADED",      className: "bg-success/15 text-success border border-success/30" },
    PENDING:    { label: "PENDING",     className: "bg-warning/15 text-warning border border-warning/30" },
    TRANSIT:    { label: "TRANSIT",     className: "bg-warning/15 text-warning border border-warning/30" },
    PART_TRADED:{ label: "PART TRADED", className: "bg-primary/15 text-primary border border-primary/30" },
    REJECTED:   { label: "REJECTED",    className: "bg-destructive/15 text-destructive border border-destructive/30" },
    CANCELLED:  { label: "CANCELLED",   className: "bg-muted text-muted-foreground border border-border" },
    EXPIRED:    { label: "EXPIRED",     className: "bg-muted text-muted-foreground border border-border" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-muted text-muted-foreground border border-border" };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function SideBadge({ side }: { side: TransactionType }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
      side === "BUY" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
    }`}>
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

function DateInput({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  label: string;
}) {
  const display = value ? value.split("-").reverse().join("-") : "";
  return (
    <div className="flex items-center gap-1.5 flex-1 min-w-0">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <div className="relative flex-1 min-w-0">
        <div className="flex items-center border border-border/50 rounded-md px-2 py-1 bg-transparent pointer-events-none select-none h-8">
          <span className={`text-sm font-mono ${display ? "text-foreground" : "text-muted-foreground"}`}>
            {display || "DD-MM-YYYY"}
          </span>
        </div>
        <input
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          style={{ colorScheme: "dark" }}
        />
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color?: string;
}

function StatCard({ icon, label, value, color = "text-foreground" }: StatCardProps) {
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

// ── ModifyOrderModal ──────────────────────────────────────────────────────────

interface ModifyOrderModalProps {
  order: DhanOrder | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function ModifyOrderModal({ order, open, onClose, onSuccess }: ModifyOrderModalProps) {
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

  const priceRequired   = form.orderType === "LIMIT" || form.orderType === "STOP_LOSS";
  const triggerRequired = form.orderType === "STOP_LOSS" || form.orderType === "STOP_LOSS_MARKET";

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
      toast({ title: "Order modified successfully", description: String(data.message ?? `Order ${order.orderId} updated`) });
      onSuccess();
      onClose();
    } catch {
      toast({ title: "Network error", description: "Could not reach server", variant: "destructive" });
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
              <Select value={form.orderType} onValueChange={(v) => setForm((f) => ({ ...f, orderType: v as OrderType }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="LIMIT">LIMIT</SelectItem>
                  <SelectItem value="MARKET">MARKET</SelectItem>
                  <SelectItem value="STOP_LOSS">STOP LOSS</SelectItem>
                  <SelectItem value="STOP_LOSS_MARKET">STOP LOSS MARKET</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={1} className="h-8 text-sm" value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} required />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price {!priceRequired && <span className="text-muted-foreground">(N/A)</span>}</Label>
                <Input type="number" step="0.05" className="h-8 text-sm" value={form.price}
                  disabled={!priceRequired}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} required={priceRequired} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Trigger {!triggerRequired && <span className="text-muted-foreground">(N/A)</span>}</Label>
                <Input type="number" step="0.05" className="h-8 text-sm" value={form.triggerPrice}
                  disabled={!triggerRequired}
                  onChange={(e) => setForm((f) => ({ ...f, triggerPrice: e.target.value }))} required={triggerRequired} />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Validity</Label>
              <Select value={form.validity} onValueChange={(v) => setForm((f) => ({ ...f, validity: v as Validity }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAY">DAY</SelectItem>
                  <SelectItem value="IOC">IOC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Close</Button>
              <Button type="submit" size="sm">Review Changes</Button>
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowConfirm(false)} disabled={loading}>Back</Button>
              <Button type="button" size="sm" disabled={loading} onClick={() => void handleConfirm()}>
                {loading ? "Modifying…" : "Confirm Modify"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── CancelConfirm ─────────────────────────────────────────────────────────────

interface CancelConfirmProps {
  orderId: string;
  onConfirm: () => void;
  onDismiss: () => void;
  loading: boolean;
}

function CancelConfirm({ orderId, onConfirm, onDismiss, loading }: CancelConfirmProps) {
  return (
    <div className="flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive whitespace-nowrap">
      <span>Cancel …{orderId.slice(-6)}?</span>
      <Button size="sm" variant="destructive" className="h-5 px-2 text-[10px]" onClick={onConfirm} disabled={loading}>
        {loading ? "…" : "Yes"}
      </Button>
      <Button size="sm" variant="ghost" className="h-5 px-2 text-[10px] text-muted-foreground" onClick={onDismiss} disabled={loading}>
        No
      </Button>
    </div>
  );
}

// ── main page ─────────────────────────────────────────────────────────────────

const PRESETS: { id: Preset; label: string; days: number | null }[] = [
  { id: "today", label: "Today",  days: 0   },
  { id: "7d",    label: "7d",     days: 7   },
  { id: "30d",   label: "30d",    days: 30  },
  { id: "365d",  label: "365d",   days: 365 },
];

export default function OrdersPage() {
  const { toast } = useToast();

  // ── today's live orders ──────────────────────────────────────────────────
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
        setOrdersError((data.errorMessage as string) || "Failed to fetch orders. Is broker connected?");
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

  // ── filter / preset state ────────────────────────────────────────────────
  const [activePreset, setActivePreset] = useState<Preset>("today");
  const [fromDate, setFromDate] = useState<string>(daysAgoISO(7));
  const [toDate, setToDate] = useState<string>(todayISO());

  // ── history orders ───────────────────────────────────────────────────────
  const [historyOrders, setHistoryOrders] = useState<TradeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFetched, setHistoryFetched] = useState(false);

  const isToday = activePreset === "today";

  // ── today auto-refresh ───────────────────────────────────────────────────
  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    if (isToday) {
      autoRefreshRef.current = setInterval(() => void fetchOrders(), 2000);
    }
    return () => { if (autoRefreshRef.current) clearInterval(autoRefreshRef.current); };
  }, [fetchOrders, isToday]);

  // ── history fetch ────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async (from: string, to: string) => {
    if (!from || !to) return;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryFetched(false);
    try {
      const res = await fetch(`${BASE}api/orders/history?from=${from}&to=${to}`, { cache: "no-store" });
      const data = await res.json() as TradeHistoryEntry[] | { errorMessage?: string };
      if (!res.ok) {
        setHistoryError((data as { errorMessage?: string }).errorMessage ?? "Failed to fetch order history.");
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
  }, []);

  // ── preset click handler ─────────────────────────────────────────────────
  function handlePreset(p: Preset) {
    setActivePreset(p);
    if (p === "today" || p === "custom") return;
    const preset = PRESETS.find((x) => x.id === p);
    if (!preset || preset.days === null) return;
    const from = daysAgoISO(preset.days);
    const to   = todayISO();
    setFromDate(from);
    setToDate(to);
    void fetchHistory(from, to);
  }

  function handleCustomFetch() {
    setActivePreset("custom");
    void fetchHistory(fromDate, toDate);
  }

  function handleRefresh() {
    if (isToday) void fetchOrders(true);
    else void fetchHistory(fromDate, toDate);
  }

  // ── cancel ───────────────────────────────────────────────────────────────
  async function handleCancel(orderId: string) {
    setCancelLoading(true);
    try {
      const res = await fetch(`${BASE}api/orders/${orderId}`, { method: "DELETE" });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        toast({
          title: "Cancel failed",
          description: (data.omsErrorDescription as string) || (data.errorMessage as string) || "Could not cancel order",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Order cancelled", description: `Order …${orderId.slice(-8)} cancelled successfully` });
      setCancelConfirmId(null);
      await fetchOrders();
    } catch {
      toast({ title: "Network error", description: "Could not reach server", variant: "destructive" });
    } finally {
      setCancelLoading(false);
    }
  }

  // ── export ───────────────────────────────────────────────────────────────
  function handleExport() {
    if (isToday) {
      if (orders.length === 0) { toast({ title: "No data to export", variant: "destructive" }); return; }
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
      toast({ title: `Exported ${rows.length} rows`, description: filename });
    } else {
      if (historyOrders.length === 0) { toast({ title: "No data to export", variant: "destructive" }); return; }
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
      const filename = `dhan-orders-${fromDate}-to-${toDate}.csv`;
      downloadCsv(rows, filename);
      toast({ title: `Exported ${rows.length} rows`, description: filename });
    }
  }

  // ── derived stats ─────────────────────────────────────────────────────────
  const totalOrders = isToday ? orders.length : historyOrders.length;
  const tradedCount = isToday
    ? orders.filter((o) => o.orderStatus === "TRADED").length
    : historyOrders.length;
  const pendingCount = isToday
    ? orders.filter((o) => o.orderStatus === "PENDING" || o.orderStatus === "TRANSIT").length
    : 0;
  const rejCancelCount = isToday
    ? orders.filter((o) => o.orderStatus === "REJECTED" || o.orderStatus === "CANCELLED").length
    : 0;

  const canModifyOrCancel = (status: OrderStatus) => status === "PENDING" || status === "TRANSIT";

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="space-y-3">

        {/* ── Top header ────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <p className="text-sm font-bold text-foreground hidden sm:block">Today&apos;s Orders</p>
          <div className="flex items-center gap-2 sm:ml-auto">
            <Button
              variant="outline" size="sm"
              onClick={handleRefresh}
              disabled={isToday ? ordersRefreshing : historyLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${(isToday ? ordersRefreshing : historyLoading) ? "animate-spin" : ""}`} />
              {(isToday ? ordersRefreshing : historyLoading) ? "Refreshing…" : "Refresh"}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* ── Filter bar: presets + date range ──────────────────── */}
        <div className="rounded-xl border border-border bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Preset tabs */}
          <div className="flex items-center gap-1 shrink-0">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePreset(p.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activePreset === p.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="hidden sm:block w-px h-5 bg-border shrink-0" />

          {/* Date pickers */}
          <div className="flex items-center gap-2 flex-1">
            <DateInput
              label="From"
              value={fromDate}
              max={toDate}
              onChange={(v) => { setFromDate(v); setActivePreset("custom"); }}
            />
            <DateInput
              label="To"
              value={toDate}
              min={fromDate}
              max={todayISO()}
              onChange={(v) => { setToDate(v); setActivePreset("custom"); }}
            />
            <Button
              size="sm" className="h-8 px-4 gap-1.5 shrink-0"
              onClick={handleCustomFetch}
              disabled={historyLoading || !fromDate || !toDate || activePreset === "today"}
            >
              {historyLoading && activePreset !== "today" ? (
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
              Fetch
            </Button>
          </div>
        </div>

        {/* ── Stat cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard icon={<ClipboardList className="h-4 w-4" />} label={isToday ? "Total Orders Today" : "Total Trades"} value={totalOrders} />
          <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label={isToday ? "Traded" : "Executed Trades"} value={tradedCount} color="text-success" />
          <StatCard icon={<Clock className="h-4 w-4" />} label="Pending / Transit" value={pendingCount} color={pendingCount > 0 ? "text-warning" : "text-foreground"} />
          <StatCard icon={<XCircle className="h-4 w-4" />} label="Rejected / Cancelled" value={rejCancelCount} color={rejCancelCount > 0 ? "text-destructive" : "text-foreground"} />
        </div>

        {/* ── Main table ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 22rem)" }}>

          {/* ── TODAY view ─────────────────────────────────────── */}
          {isToday && (
            ordersError ? (
              <div className="flex flex-col items-center gap-3 py-12 px-4 text-center">
                <AlertCircle className="h-8 w-8 text-destructive/70" />
                <div>
                  <p className="text-sm font-medium text-destructive">Broker not connected</p>
                  <p className="text-xs text-muted-foreground mt-1">Please connect your Dhan account in Settings.</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5 mt-1"
                  onClick={() => (window.location.href = `${BASE}settings`)}>
                  <Settings className="h-3.5 w-3.5" />Go to Settings
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-auto text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Time", "Symbol", "Type", "Product", "Qty", "Price", "Trigger", "Status", "Action"].map((h, i) => (
                        <th key={h} className={`px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap ${i >= 4 && i <= 6 ? "text-right" : "text-left"}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ordersLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          {Array.from({ length: 9 }).map((_, j) => (
                            <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                          ))}
                        </tr>
                      ))
                    ) : orders.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-16 text-center">
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <ClipboardList className="h-8 w-8 opacity-40" />
                            <p className="text-sm">No orders placed today</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      orders.map((order) => (
                        <tr key={order.orderId} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatTime(order.createTime)}</td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono font-semibold text-sm">{order.tradingSymbol}</span>
                            {order.omsErrorDescription && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <AlertCircle className="inline-block ml-1.5 h-3 w-3 text-destructive align-middle cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs text-xs">{order.omsErrorDescription}</TooltipContent>
                              </Tooltip>
                            )}
                          </td>
                          <td className="px-4 py-3"><SideBadge side={order.transactionType} /></td>
                          <td className="px-4 py-3"><ProductBadge product={order.productType} /></td>
                          <td className="px-4 py-3 text-right text-xs font-mono">
                            {order.filledQty > 0 ? (
                              <span>{order.quantity} <span className="text-muted-foreground">/ {order.filledQty} filled</span></span>
                            ) : order.quantity}
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-mono">
                            {order.orderType === "MARKET" ? <span className="text-muted-foreground">MKT</span> : formatCurrency(order.price)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs font-mono">
                            {(order.triggerPrice ?? 0) > 0 ? formatCurrency(order.triggerPrice!) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-4 py-3"><StatusBadge status={order.orderStatus} /></td>
                          <td className="px-4 py-3">
                            {cancelConfirmId === order.orderId ? (
                              <CancelConfirm orderId={order.orderId}
                                onConfirm={() => void handleCancel(order.orderId)}
                                onDismiss={() => setCancelConfirmId(null)}
                                loading={cancelLoading} />
                            ) : canModifyOrCancel(order.orderStatus) ? (
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline"
                                  className="h-6 px-2 text-[11px] border-primary/50 text-primary hover:bg-primary/10"
                                  onClick={() => setModifyOrder(order)}>Modify</Button>
                                <Button size="sm" variant="outline"
                                  className="h-6 px-2 text-[11px] border-destructive/50 text-destructive hover:bg-destructive/10"
                                  onClick={() => setCancelConfirmId(order.orderId)}>Cancel</Button>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── HISTORY view ───────────────────────────────────── */}
          {!isToday && (
            <>
              {historyError && (
                <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
                  <AlertCircle className="h-7 w-7 text-destructive/60" />
                  <p className="text-sm text-destructive font-medium">Failed to load</p>
                  <p className="text-xs text-muted-foreground max-w-xs">{historyError}</p>
                </div>
              )}

              {!historyError && !historyFetched && !historyLoading && (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <CalendarDays className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Select a date range and click Fetch</p>
                  <p className="text-xs opacity-60">Only executed (filled) trades appear in history</p>
                </div>
              )}

              {historyLoading && (
                <div className="overflow-x-auto">
                  <table className="w-full table-auto text-sm">
                    <tbody>
                      {Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50 last:border-0">
                          {Array.from({ length: 8 }).map((_, j) => (
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
                  <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                    <ClipboardList className="h-7 w-7 opacity-30" />
                    <p className="text-sm">No trades found for {fromDate} → {toDate}</p>
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
                            {t.orderId && (
                              <p className="text-[10px] text-muted-foreground font-mono">Order ID: …{t.orderId.slice(-10)}</p>
                            )}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.color}`}>{seg.label}</span>
                              <ProductBadge product={t.productType} />
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-[11px]">
                              <div><span className="text-muted-foreground">Qty</span><p className="font-mono font-medium">{t.tradedQuantity}</p></div>
                              <div><span className="text-muted-foreground">Price</span><p className="font-mono font-medium">{formatCurrency(t.tradedPrice)}</p></div>
                              <div><span className="text-muted-foreground">Value</span><p className="font-mono font-medium">{formatCurrency(value)}</p></div>
                            </div>
                            <p className="text-[10px] text-muted-foreground font-mono">{formatDateTime(t.createTime)}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop table view */}
                    <div className="hidden sm:block overflow-x-auto">
                      <table className="w-full table-auto text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/30">
                            {["Create Time", "Order ID", "Symbol", "Segment", "Type", "Product", "Qty", "Price", "Value"].map((h, i) => (
                              <th key={h} className={`px-4 py-2.5 text-xs font-medium text-muted-foreground whitespace-nowrap ${i >= 6 ? "text-right" : "text-left"}`}>
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
                                <td className="px-4 py-3 text-xs text-muted-foreground font-mono whitespace-nowrap">{formatDateTime(t.createTime)}</td>
                                <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                                  {t.orderId ? `…${t.orderId.slice(-10)}` : "—"}
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <span className="font-mono font-semibold text-sm">{t.tradingSymbol}</span>
                                  {t.customSymbol && <p className="text-[10px] text-muted-foreground truncate max-w-[140px]">{t.customSymbol}</p>}
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
                            <td colSpan={8} className="px-4 py-2 text-xs text-muted-foreground text-right font-medium">Total Trade Value</td>
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
            </>
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
