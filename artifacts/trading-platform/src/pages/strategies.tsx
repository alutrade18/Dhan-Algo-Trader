import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { SymbolSearch, type InstrumentResult } from "@/components/symbol-search";
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Zap,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface Strategy {
  id: number;
  name: string;
  description: string | null;
  entryCondition: string;
  securityId: string | null;
  exchangeSegment: string | null;
  tradingSymbol: string | null;
  quantity: number;
  productType: string;
  transactionType: string;
  active: boolean;
  webhookToken: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
}

interface FormState {
  name: string;
  description: string;
  entryCondition: string;
  quantity: string;
  productType: string;
  transactionType: string;
  active: boolean;
  security: InstrumentResult | null;
}

const BLANK_FORM: FormState = {
  name: "",
  description: "",
  entryCondition: "MANUAL",
  quantity: "1",
  productType: "INTRADAY",
  transactionType: "BUY",
  active: true,
  security: null,
};

function segmentFromInstrument(inst: InstrumentResult): string {
  const seg = inst.segment?.toUpperCase() ?? "";
  const exch = inst.exchId?.toUpperCase() ?? "NSE";
  if (seg === "E" || seg === "NSE_EQ" || seg === "BSE_EQ") return `${exch}_EQ`;
  if (seg === "D") return `${exch}_DEBT`;
  if (seg === "C") return `${exch}_CURR`;
  if (seg.includes("_")) return seg; // already full segment
  return `${exch}_EQ`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={handleCopy}
      className="ml-1.5 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function conditionLabel(c: string) {
  if (c === "PRICE_ABOVE") return "Price Above";
  if (c === "PRICE_BELOW") return "Price Below";
  return "Manual";
}

function transactionColor(t: string) {
  return t === "BUY"
    ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
    : "text-red-400 border-red-400/30 bg-red-400/10";
}

export default function Strategies() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Strategy | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: strategies = [], isLoading, error, refetch } = useQuery<Strategy[]>({
    queryKey: ["strategies"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/strategies`);
      if (!r.ok) throw new Error("Failed to load strategies");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const url = editTarget
        ? `${BASE}api/strategies/${editTarget.id}`
        : `${BASE}api/strategies`;
      const r = await fetch(url, {
        method: editTarget ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? "Save failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setDialogOpen(false);
      toast({
        title: editTarget ? "Strategy updated" : "Strategy created",
        description: editTarget ? `"${form.name}" has been updated.` : `"${form.name}" is ready.`,
      });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}api/strategies/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      setDeleteConfirmOpen(false);
      toast({ title: "Strategy deleted" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const r = await fetch(`${BASE}api/strategies/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      });
      if (!r.ok) throw new Error("Toggle failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strategies"] }),
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  function openCreate() {
    setEditTarget(null);
    setForm(BLANK_FORM);
    setDialogOpen(true);
  }

  function openEdit(s: Strategy) {
    setEditTarget(s);
    setForm({
      name: s.name,
      description: s.description ?? "",
      entryCondition: s.entryCondition,
      quantity: String(s.quantity),
      productType: s.productType,
      transactionType: s.transactionType,
      active: s.active,
      security: s.securityId
        ? ({
            securityId: Number(s.securityId),
            exchId: s.exchangeSegment?.split("_")[0] ?? "NSE",
            segment: s.exchangeSegment ?? "NSE_EQ",
            symbolName: s.tradingSymbol ?? "",
            displayName: s.tradingSymbol,
            instrument: "",
            isin: null,
            series: null,
            lotSize: null,
            tickSize: null,
            underlyingSymbol: null,
            expiryDate: null,
            strikePrice: null,
            optionType: null,
          } as InstrumentResult)
        : null,
    });
    setDialogOpen(true);
  }

  function handleSave() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    const qty = Number(form.quantity);
    if (isNaN(qty) || qty < 1) {
      toast({ title: "Quantity must be ≥ 1", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      name: form.name.trim(),
      description: form.description.trim() || null,
      entryCondition: form.entryCondition,
      securityId: form.security ? String(form.security.securityId) : null,
      exchangeSegment: form.security ? segmentFromInstrument(form.security) : null,
      tradingSymbol: form.security?.symbolName ?? null,
      quantity: qty,
      productType: form.productType,
      transactionType: form.transactionType,
      active: form.active,
    });
  }

  function webhookUrl(s: Strategy) {
    const origin = window.location.origin;
    const base = BASE.endsWith("/") ? BASE.slice(0, -1) : BASE;
    const token = s.webhookToken ? `?token=${s.webhookToken}` : "";
    return `${origin}${base}/api/strategy/${s.id}/trigger${token}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
          <p className="text-muted-foreground text-sm mt-0.5 max-w-xl">
            Define and manage your automated trading strategies. Connect signals to automatically
            place orders via webhooks or scheduled execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            Create Strategy
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center gap-3 py-6">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">Failed to load strategies. Check your connection and try again.</p>
          </CardContent>
        </Card>
      ) : strategies.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <Layers className="h-8 w-8 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">No strategies yet</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Create your first strategy to automate order placement via webhooks or triggers.
              </p>
            </div>
            <Button onClick={openCreate} className="gap-1.5 mt-1">
              <Plus className="h-4 w-4" />
              Create Strategy
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {strategies.map((s) => (
            <Card key={s.id} className={s.active ? "" : "opacity-60"}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{s.name}</CardTitle>
                      <Badge
                        variant="outline"
                        className={transactionColor(s.transactionType)}
                      >
                        {s.transactionType}
                      </Badge>
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        {s.productType}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          s.active
                            ? "text-emerald-400 border-emerald-400/30 bg-emerald-400/10"
                            : "text-muted-foreground"
                        }
                      >
                        {s.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {s.description && (
                      <CardDescription className="mt-1 text-xs">{s.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={s.active}
                      onCheckedChange={(v) => toggleMutation.mutate({ id: s.id, active: v })}
                      title={s.active ? "Deactivate" : "Activate"}
                    />
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)} title="Edit">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setDeleteId(s.id);
                        setDeleteConfirmOpen(true);
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Security</p>
                    <p className="font-medium font-mono text-xs">
                      {s.tradingSymbol ?? (s.securityId ? `ID:${s.securityId}` : "—")}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Segment</p>
                    <p className="font-medium text-xs">{s.exchangeSegment ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Quantity</p>
                    <p className="font-medium text-xs">{s.quantity}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Entry</p>
                    <p className="font-medium text-xs">{conditionLabel(s.entryCondition)}</p>
                  </div>
                </div>
                {/* Webhook URL */}
                <div className="rounded-lg bg-muted/40 border border-border/50 px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Webhook Trigger
                    </span>
                    {s.lastTriggeredAt && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        Last: {new Date(s.lastTriggeredAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <code className="text-[11px] text-muted-foreground break-all leading-relaxed flex-1">
                      POST {webhookUrl(s)}
                    </code>
                    <CopyButton text={webhookUrl(s)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit Strategy" : "Create Strategy"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Strategy Name *</Label>
              <Input
                id="s-name"
                placeholder="e.g. NIFTY Breakout Long"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="s-desc">Description</Label>
              <Textarea
                id="s-desc"
                placeholder="Describe when this strategy fires…"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>

            {/* Entry Condition */}
            <div className="space-y-1.5">
              <Label>Entry Condition</Label>
              <Select
                value={form.entryCondition}
                onValueChange={(v) => setForm((f) => ({ ...f, entryCondition: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">Manual (webhook only)</SelectItem>
                  <SelectItem value="PRICE_ABOVE">Price Above</SelectItem>
                  <SelectItem value="PRICE_BELOW">Price Below</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Security */}
            <div className="space-y-1.5">
              <Label>Security</Label>
              <SymbolSearch
                value={form.security}
                onChange={(inst) => setForm((f) => ({ ...f, security: inst }))}
                placeholder="Search symbol…"
              />
              {form.security && (
                <p className="text-xs text-muted-foreground">
                  {form.security.symbolName} · {segmentFromInstrument(form.security)} · ID {form.security.securityId}
                </p>
              )}
            </div>

            {/* Transaction Type */}
            <div className="space-y-1.5">
              <Label>Side</Label>
              <Select
                value={form.transactionType}
                onValueChange={(v) => setForm((f) => ({ ...f, transactionType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUY">BUY</SelectItem>
                  <SelectItem value="SELL">SELL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Quantity */}
            <div className="space-y-1.5">
              <Label htmlFor="s-qty">Quantity *</Label>
              <Input
                id="s-qty"
                type="number"
                min={1}
                placeholder="1"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </div>

            {/* Product Type */}
            <div className="space-y-1.5">
              <Label>Product Type</Label>
              <Select
                value={form.productType}
                onValueChange={(v) => setForm((f) => ({ ...f, productType: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INTRADAY">INTRADAY</SelectItem>
                  <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                  <SelectItem value="MARGIN">MARGIN</SelectItem>
                  <SelectItem value="MTF">MTF</SelectItem>
                  <SelectItem value="CO">CO (Cover Order)</SelectItem>
                  <SelectItem value="BO">BO (Bracket Order)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Webhook trigger will be accepted when active</p>
              </div>
              <Switch
                checked={form.active}
                onCheckedChange={(v) => setForm((f) => ({ ...f, active: v }))}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-1.5">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editTarget ? "Save Changes" : "Create Strategy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Strategy?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the strategy and its webhook token. Any external systems
            using this webhook URL will stop working.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
              className="gap-1.5"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
