import { useState } from "react";
import { 
  useGetStrategies, 
  useToggleStrategy, 
  useExecuteStrategy, 
  useDeleteStrategy, 
  useCreateStrategy,
  useUpdateStrategy,
  useGetStrategyPerformance,
  getGetStrategiesQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Strategy, CreateStrategyBodyType, StrategyStatus } from "@workspace/api-zod/src/generated/types";
import { Play, Pause, Trash2, Zap, Plus, Settings2, BarChart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

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
  entryConditions: z.string().optional(),
  exitConditions: z.string().optional(),
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
    toggleStrategy.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Strategy status updated" });
        queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
      }
    });
  };

  const handleExecute = (id: number) => {
    executeStrategy.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Strategy execution triggered" });
      },
      onError: () => {
        toast({ title: "Execution failed", variant: "destructive" });
      }
    });
  };

  const onSubmit = (values: z.infer<typeof strategySchema>) => {
    if (editingId) {
      updateStrategy.mutate({ id: editingId, data: values }, {
        onSuccess: () => {
          toast({ title: "Strategy updated successfully" });
          setDialogOpen(false);
          setEditingId(null);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
        }
      });
    } else {
      createStrategy.mutate({ data: values as any }, {
        onSuccess: () => {
          toast({ title: "Strategy created successfully" });
          setDialogOpen(false);
          form.reset();
          queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() });
        }
      });
    }
  };

  const openEditDialog = (strategy: Strategy) => {
    setEditingId(strategy.id);
    form.reset({
      name: strategy.name,
      description: strategy.description || "",
      type: strategy.type as "scalping" | "swing" | "positional" | "options" | "custom",
      securityId: strategy.securityId,
      tradingSymbol: strategy.tradingSymbol,
      exchangeSegment: strategy.exchangeSegment,
      transactionType: strategy.transactionType as "BUY" | "SELL",
      productType: strategy.productType as "INTRA" | "CNC" | "MARGIN" | "CO" | "BO",
      orderType: strategy.orderType as "MARKET" | "LIMIT" | "SL" | "SLM",
      quantity: strategy.quantity,
      entryPrice: strategy.entryPrice,
      stopLoss: strategy.stopLoss,
      target: strategy.target,
      trailingStopLoss: strategy.trailingStopLoss,
      maxPositions: strategy.maxPositions,
      maxLossPerDay: strategy.maxLossPerDay,
      maxProfitPerDay: strategy.maxProfitPerDay,
      timeframeMinutes: strategy.timeframeMinutes,
      entryConditions: strategy.entryConditions,
      exitConditions: strategy.exitConditions,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
          <p className="text-sm text-muted-foreground">Build, manage and monitor algorithmic strategies.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) { setEditingId(null); form.reset(); }
        }}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Create Strategy</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? 'Edit Strategy' : 'Create New Strategy'}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem><FormLabel>Strategy Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem><FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="scalping">Scalping</SelectItem>
                          <SelectItem value="swing">Swing</SelectItem>
                          <SelectItem value="positional">Positional</SelectItem>
                          <SelectItem value="options">Options</SelectItem>
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
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
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="NSE">NSE</SelectItem>
                          <SelectItem value="BSE">BSE</SelectItem>
                          <SelectItem value="NFO">NFO</SelectItem>
                          <SelectItem value="MCX">MCX</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-4 gap-4">
                  <FormField control={form.control} name="transactionType" render={({ field }) => (
                    <FormItem><FormLabel>Action</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="BUY">BUY</SelectItem>
                          <SelectItem value="SELL">SELL</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="productType" render={({ field }) => (
                    <FormItem><FormLabel>Product</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="INTRA">INTRA</SelectItem>
                          <SelectItem value="CNC">CNC</SelectItem>
                          <SelectItem value="MARGIN">MARGIN</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="orderType" render={({ field }) => (
                    <FormItem><FormLabel>Order</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="MARKET">MKT</SelectItem>
                          <SelectItem value="LIMIT">LMT</SelectItem>
                          <SelectItem value="SL">SL</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="quantity" render={({ field }) => (
                    <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="stopLoss" render={({ field }) => (
                    <FormItem><FormLabel>Stop Loss (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="target" render={({ field }) => (
                    <FormItem><FormLabel>Target (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="trailingStopLoss" render={({ field }) => (
                    <FormItem><FormLabel>Trailing SL (%)</FormLabel><FormControl><Input type="number" step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>

                <FormField control={form.control} name="entryConditions" render={({ field }) => (
                  <FormItem><FormLabel>Entry Conditions (JSON/Logic)</FormLabel><FormControl><Textarea className="h-20 font-mono text-xs" placeholder='{"indicator": "RSI", "operator": "<", "value": 30}' {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                
                <FormField control={form.control} name="exitConditions" render={({ field }) => (
                  <FormItem><FormLabel>Exit Conditions (JSON/Logic)</FormLabel><FormControl><Textarea className="h-20 font-mono text-xs" placeholder='{"indicator": "RSI", "operator": ">", "value": 70}' {...field} /></FormControl><FormMessage /></FormItem>
                )} />

                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Overall P&L</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-bold font-mono", performance.totalPnl >= 0 ? "text-success" : "text-destructive")}>
                {formatCurrency(performance.totalPnl)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{performance.overallWinRate.toFixed(1)}%</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-mono">{performance.totalTrades}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg P&L / Trade</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-bold font-mono", performance.avgPnlPerTrade >= 0 ? "text-success" : "text-destructive")}>
                {formatCurrency(performance.avgPnlPerTrade)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name / Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Config</TableHead>
              <TableHead className="text-right">Performance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
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
                    <div className="font-mono text-xs text-muted-foreground mt-1">{s.tradingSymbol} • {s.exchangeSegment}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize text-[10px]">{s.type}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>{s.quantity} Qty • {s.transactionType} {s.orderType}</div>
                    <div className="mt-1">SL: {s.stopLoss ? `${s.stopLoss}%` : 'None'} • TG: {s.target ? `${s.target}%` : 'None'}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className={cn("font-mono font-medium text-sm", (s.totalPnl || 0) >= 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(s.totalPnl)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      W: {s.winTrades || 0} / L: {s.lossTrades || 0}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={s.status === 'active' ? 'default' : s.status === 'paused' ? 'secondary' : 'destructive'} 
                      className={cn("text-[10px] capitalize", s.status === 'active' && "bg-success hover:bg-success/90 text-success-foreground")}
                    >
                      {s.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 hover:text-success hover:bg-success/10"
                        onClick={() => handleExecute(s.id)}
                        disabled={s.status !== 'active'}
                      >
                        <Zap className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 text-muted-foreground"
                        onClick={() => handleToggle(s.id)}
                      >
                        {s.status === 'active' ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deleteStrategy.mutate({ id: s.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetStrategiesQueryKey() }) })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No strategies configured
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
