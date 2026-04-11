import { useState } from "react";
import {
  useGetStrategies,
  useToggleStrategy,
  useExecuteStrategy,
  useDeleteStrategy,
  useCreateStrategy,
  useUpdateStrategy,
  useGetStrategyPerformance,
  getGetStrategiesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Strategy } from "@workspace/api-zod/src/generated/types";
import {
  Play, Pause, Trash2, Zap, Plus, Settings2, X, PlusCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) =>
  val !== undefined
    ? new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(val)
    : "₹0";

const INDICATORS = ["RSI", "EMA", "SMA", "MACD", "Price", "Volume", "BB_Upper", "BB_Lower", "VWAP"];
const COMPARATORS = [
  { value: "<", label: "<" },
  { value: ">", label: ">" },
  { value: "=", label: "=" },
  { value: "crosses_above", label: "Crosses Above" },
  { value: "crosses_below", label: "Crosses Below" },
];

interface Condition {
  indicator: string;
  comparator: string;
  value: string;
  period?: string;
}

function ConditionBuilder({
  label,
  conditions,
  onChange,
}: {
  label: string;
  conditions: Condition[];
  onChange: (c: Condition[]) => void;
}) {
  const add = () =>
    onChange([...conditions, { indicator: "RSI", comparator: "<", value: "30", period: "14" }]);
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));
  const update = (i: number, field: keyof Condition, val: string) => {
    const next = [...conditions];
    next[i] = { ...next[i], [field]: val };
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button type="button" variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={add}>
          <PlusCircle className="h-3 w-3" /> Add
        </Button>
      </div>
      {conditions.length === 0 && (
        <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-3 py-2">
          No conditions — strategy fires on schedule/manual execute
        </p>
      )}
      {conditions.map((c, i) => (
        <div key={i} className="flex gap-2 items-center bg-muted/40 rounded-md px-3 py-2">
          <Select value={c.indicator} onValueChange={v => update(i, "indicator", v)}>
            <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
            <SelectContent>{INDICATORS.map(ind => <SelectItem key={ind} value={ind}>{ind}</SelectItem>)}</SelectContent>
          </Select>
          {(c.indicator !== "Price" && c.indicator !== "Volume") && (
            <Input
              className="h-7 text-xs w-[52px]"
              placeholder="Period"
              value={c.period ?? "14"}
              onChange={e => update(i, "period", e.target.value)}
            />
          )}
          <Select value={c.comparator} onValueChange={v => update(i, "comparator", v)}>
            <SelectTrigger className="h-7 text-xs w-[120px]"><SelectValue /></SelectTrigger>
            <SelectContent>{COMPARATORS.map(op => <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>)}</SelectContent>
          </Select>
          <Input
            className="h-7 text-xs w-[70px]"
            placeholder="Value"
            value={c.value}
            onChange={e => update(i, "value", e.target.value)}
          />
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => remove(i)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function parseConditions(raw?: string | null): Condition[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderConditions(raw?: string | null): string {
  const conditions = parseConditions(raw);
  if (!conditions.length) return "—";
  return conditions
    .map(c => {
      const indStr = c.period ? `${c.indicator}(${c.period})` : c.indicator;
      return `${indStr} ${c.comparator} ${c.value}`;
    })
    .join(", ");
}

const strategySchema = z.object({
  name: z.string().min(1, "Required"),
  description: z.string().optional(),
  type: z.enum(["scalping", "swing", "positional", "options", "custom"]),
  securityId: z.string().min(1, "Required"),
  tradingSymbol: z.string().min(1, "Required"),
  exchangeSegment: z.string().min(1, "Required"),
  transactionType: z.enum(["BUY", "SELL"]),
  productType: z.enum(["INTRA", "CNC", "MARGIN", "CO", "BO"]),
  orderType: z.enum(["MARKET", "LIMIT", "SL", "SLM"]),
  quantity: z.coerce.number().min(1),
  entryPrice: z.coerce.number().optional(),
  stopLoss: z.coerce.number().optional(),
  target: z.coerce.number().optional(),
  trailingStopLoss: z.coerce.number().optional(),
  maxPositions: z.coerce.number().optional(),
  maxLossPerDay: z.coerce.number().optional(),
  maxProfitPerDay: z.coerce.number().optional(),
  timeframeMinutes: z.coerce.number().optional(),
});

export default function Strategies() {
  const { data: strategies, isLoading } = useGetStrategies();
  const { data: performance } = useGetStrategyPerformance();
  const toggleStrategy = useToggleStrategy();
  const executeStrategy = useExecuteStrategy();
  const deleteStrategy = useDeleteStrategy();
  const createStrategy = useCreateStrategy();
  const updateStrategy = useUpdateStrategy();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [entryConditions, setEntryConditions] = useState<Condition[]>([]);
  const [exitConditions, setExitConditions] = useState<Condition[]>([]);

  const form = useForm<z.infer<typeof strategySchema>>({
    resolver: zodResolver(strategySchema),
    defaultValues: {
      type: "custom",
      exchangeSegment: "NSE",
      transactionType: "BUY",
      productType: "INTRA",
      orderType: "MARKET",
      quantity: 1,
    },
  });

  const handleToggle = (id: number) => {
    toggleStrategy.mutate(
      { id },
      {
        onSuccess: (data) => {
          toast({ title: `Strategy ${(data as { status?: string }).status === "active" ? "activated" : "paused"}` });
          queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
        },
      },
    );
  };

  const handleExecute = (id: number) => {
    executeStrategy.mutate(
      { id },
      {
        onSuccess: (data) => {
          const d = data as { status?: string; message?: string };
          if (d.status === "success") {
            toast({ title: "Order placed", description: d.message });
          } else {
            toast({ title: "Execution failed", description: d.message, variant: "destructive" });
          }
        },
        onError: (err) => {
          toast({ title: "Execution failed", description: String(err), variant: "destructive" });
        },
      },
    );
  };

  const onSubmit = (values: z.infer<typeof strategySchema>) => {
    const data = {
      ...values,
      entryConditions: JSON.stringify(entryConditions),
      exitConditions: JSON.stringify(exitConditions),
    };

    if (editingId) {
      updateStrategy.mutate(
        { id: editingId, data: data as Parameters<typeof updateStrategy.mutate>[0]["data"] },
        {
          onSuccess: () => {
            toast({ title: "Strategy updated" });
            closeDialog();
            queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
          },
        },
      );
    } else {
      createStrategy.mutate(
        { data: data as Parameters<typeof createStrategy.mutate>[0]["data"] },
        {
          onSuccess: () => {
            toast({ title: "Strategy created" });
            closeDialog();
            queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
          },
        },
      );
    }
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setEntryConditions([]);
    setExitConditions([]);
    form.reset();
  };

  const openEditDialog = (s: Strategy) => {
    setEditingId(s.id);
    setEntryConditions(parseConditions(s.entryConditions));
    setExitConditions(parseConditions(s.exitConditions));
    form.reset({
      name: s.name,
      description: s.description || "",
      type: s.type as "scalping" | "swing" | "positional" | "options" | "custom",
      securityId: s.securityId,
      tradingSymbol: s.tradingSymbol,
      exchangeSegment: s.exchangeSegment,
      transactionType: s.transactionType as "BUY" | "SELL",
      productType: s.productType as "INTRA" | "CNC" | "MARGIN" | "CO" | "BO",
      orderType: s.orderType as "MARKET" | "LIMIT" | "SL" | "SLM",
      quantity: s.quantity,
      entryPrice: s.entryPrice ?? undefined,
      stopLoss: s.stopLoss ?? undefined,
      target: s.target ?? undefined,
      trailingStopLoss: s.trailingStopLoss ?? undefined,
      maxPositions: s.maxPositions ?? undefined,
      maxLossPerDay: s.maxLossPerDay ?? undefined,
      maxProfitPerDay: s.maxProfitPerDay ?? undefined,
      timeframeMinutes: s.timeframeMinutes ?? undefined,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Create Strategy</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[720px] max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Strategy" : "Create New Strategy"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>Strategy Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem><FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="scalping">Scalping</SelectItem>
                          <SelectItem value="swing">Swing</SelectItem>
                          <SelectItem value="positional">Positional</SelectItem>
                          <SelectItem value="options">Options</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="tradingSymbol" render={({ field }) => (
                    <FormItem><FormLabel>Symbol</FormLabel><FormControl><Input {...field} placeholder="NIFTY-I" /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="securityId" render={({ field }) => (
                    <FormItem><FormLabel>Security ID</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="exchangeSegment" render={({ field }) => (
                    <FormItem><FormLabel>Exchange</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="NSE">NSE</SelectItem>
                          <SelectItem value="BSE">BSE</SelectItem>
                          <SelectItem value="NFO">NFO</SelectItem>
                          <SelectItem value="MCX">MCX</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <FormField control={form.control} name="transactionType" render={({ field }) => (
                    <FormItem><FormLabel>Action</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="BUY">BUY</SelectItem>
                          <SelectItem value="SELL">SELL</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="productType" render={({ field }) => (
                    <FormItem><FormLabel>Product</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="INTRA">INTRA</SelectItem>
                          <SelectItem value="CNC">CNC</SelectItem>
                          <SelectItem value="MARGIN">MARGIN</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="orderType" render={({ field }) => (
                    <FormItem><FormLabel>Order Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="MARKET">MARKET</SelectItem>
                          <SelectItem value="LIMIT">LIMIT</SelectItem>
                          <SelectItem value="SL">SL</SelectItem>
                        </SelectContent>
                      </Select><FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="quantity" render={({ field }) => (
                    <FormItem><FormLabel>Qty</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="entryPrice" render={({ field }) => (
                    <FormItem><FormLabel>Entry Price</FormLabel><FormControl><Input type="number" step="0.05" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="stopLoss" render={({ field }) => (
                    <FormItem><FormLabel>Stop Loss %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="target" render={({ field }) => (
                    <FormItem><FormLabel>Target %</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <div className="space-y-3 border border-border rounded-md p-3">
                  <p className="text-xs font-semibold text-foreground">Condition Builder</p>
                  <ConditionBuilder
                    label="Entry Conditions (ALL must be true to trigger BUY/SELL)"
                    conditions={entryConditions}
                    onChange={setEntryConditions}
                  />
                  <ConditionBuilder
                    label="Exit Conditions (ANY triggers position close)"
                    conditions={exitConditions}
                    onChange={setExitConditions}
                  />
                </div>

                <DialogFooter className="pt-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                  <Button type="submit" disabled={createStrategy.isPending || updateStrategy.isPending}>
                    {editingId ? "Update Strategy" : "Create Strategy"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {performance && (
        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: "Overall P&L", value: formatCurrency(performance.totalPnl), colored: true, val: performance.totalPnl },
            { label: "Win Rate", value: `${performance.overallWinRate.toFixed(1)}%`, colored: false, val: 0 },
            { label: "Total Trades", value: String(performance.totalTrades), colored: false, val: 0 },
            { label: "Avg P&L / Trade", value: formatCurrency(performance.avgPnlPerTrade), colored: true, val: performance.avgPnlPerTrade },
          ].map(stat => (
            <Card key={stat.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold font-mono", stat.colored && (stat.val >= 0 ? "text-success" : "text-destructive"))}>
                  {stat.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name / Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Conditions</TableHead>
              <TableHead className="text-right">Performance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 6 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-7 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : strategies && strategies.length > 0 ? (
              strategies.map((s: Strategy) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="font-medium text-sm flex items-center gap-2">
                      {s.name}
                      <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground" onClick={() => openEditDialog(s)}>
                        <Settings2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="font-mono text-xs text-muted-foreground mt-0.5">
                      {s.tradingSymbol} · {s.exchangeSegment} · {s.transactionType} {s.orderType} {s.quantity}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[10px]">{s.type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[220px]">
                    {(s.entryConditions || s.exitConditions) ? (
                      <div className="space-y-0.5">
                        {s.entryConditions && parseConditions(s.entryConditions).length > 0 && (
                          <div className="truncate"><span className="text-success font-medium">Entry:</span> {renderConditions(s.entryConditions)}</div>
                        )}
                        {s.exitConditions && parseConditions(s.exitConditions).length > 0 && (
                          <div className="truncate"><span className="text-destructive font-medium">Exit:</span> {renderConditions(s.exitConditions)}</div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground/50">No conditions</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className={cn("font-mono font-medium text-sm", (s.totalPnl ?? 0) >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(s.totalPnl ?? 0)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      W: {s.winTrades ?? 0} / L: {s.lossTrades ?? 0}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={s.status === "active" ? "default" : s.status === "paused" ? "secondary" : "destructive"}
                      className={cn("text-[10px] capitalize", s.status === "active" && "bg-success hover:bg-success/90 text-success-foreground")}
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-success hover:bg-success/10"
                        title="Execute Now"
                        onClick={() => handleExecute(s.id)}
                      >
                        <Zap className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground"
                        onClick={() => handleToggle(s.id)}
                      >
                        {s.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          deleteStrategy.mutate(
                            { id: s.id },
                            { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() }) },
                          )
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                  No strategies — click "Create Strategy" to get started
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
