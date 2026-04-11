import { useState } from "react";
import { useGetOrders, useCancelOrder, usePlaceOrder, getGetOrdersQueryKey } from "@workspace/api-client-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Order, PlaceOrderBodyTransactionType, PlaceOrderBodyOrderType, PlaceOrderBodyProductType, PlaceOrderBodyValidity } from "@workspace/api-zod/src/generated/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { XCircle, Edit2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

const placeOrderSchema = z.object({
  securityId: z.string().min(1, "Required"),
  exchangeSegment: z.string().min(1, "Required"),
  transactionType: z.enum(["BUY", "SELL"]),
  quantity: z.coerce.number().min(1),
  orderType: z.enum(["MARKET", "LIMIT", "SL", "SLM"]),
  productType: z.enum(["INTRA", "CNC", "MARGIN", "CO", "BO"]),
  price: z.coerce.number().min(0),
  triggerPrice: z.coerce.number().optional(),
  validity: z.enum(["DAY", "IOC"]).optional(),
});

export default function Orders() {
  const { data: orders, isLoading } = useGetOrders();
  const cancelOrder = useCancelOrder();
  const placeOrder = usePlaceOrder();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof placeOrderSchema>>({
    resolver: zodResolver(placeOrderSchema),
    defaultValues: {
      securityId: "",
      exchangeSegment: "NSE",
      transactionType: "BUY",
      quantity: 1,
      orderType: "MARKET",
      productType: "INTRA",
      price: 0,
      validity: "DAY",
    },
  });

  const handleCancel = (orderId: string) => {
    cancelOrder.mutate({ orderId }, {
      onSuccess: () => {
        toast({ title: "Order cancelled successfully" });
        queryClient.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to cancel order", variant: "destructive" });
      }
    });
  };

  const onSubmit = (values: z.infer<typeof placeOrderSchema>) => {
    placeOrder.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Order placed successfully" });
        setDialogOpen(false);
        form.reset();
        queryClient.invalidateQueries({ queryKey: getGetOrdersQueryKey() });
      },
      onError: () => {
        toast({ title: "Failed to place order", variant: "destructive" });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-sm text-muted-foreground">Manage your active and past orders.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> Place Order</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Place New Order</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
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
                          <SelectItem value="MCX">MCX</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="transactionType" render={({ field }) => (
                    <FormItem><FormLabel>Action</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger className={field.value === 'BUY' ? 'text-success border-success/30 bg-success/10' : 'text-destructive border-destructive/30 bg-destructive/10'}><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="BUY" className="text-success">BUY</SelectItem>
                          <SelectItem value="SELL" className="text-destructive">SELL</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="quantity" render={({ field }) => (
                    <FormItem><FormLabel>Quantity</FormLabel><FormControl><Input type="number" {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="productType" render={({ field }) => (
                    <FormItem><FormLabel>Product</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="INTRA">Intraday (MIS)</SelectItem>
                          <SelectItem value="CNC">Delivery (CNC)</SelectItem>
                          <SelectItem value="MARGIN">Margin (NRML)</SelectItem>
                          <SelectItem value="CO">Cover Order (CO)</SelectItem>
                          <SelectItem value="BO">Bracket Order (BO)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="orderType" render={({ field }) => (
                    <FormItem><FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="MARKET">Market</SelectItem>
                          <SelectItem value="LIMIT">Limit</SelectItem>
                          <SelectItem value="SL">SL</SelectItem>
                          <SelectItem value="SLM">SL-M</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="price" render={({ field }) => (
                    <FormItem><FormLabel>Price</FormLabel><FormControl><Input type="number" step="0.05" {...field} disabled={form.watch('orderType') === 'MARKET' || form.watch('orderType') === 'SLM'} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="triggerPrice" render={({ field }) => (
                    <FormItem><FormLabel>Trigger Price</FormLabel><FormControl><Input type="number" step="0.05" {...field} disabled={form.watch('orderType') === 'MARKET' || form.watch('orderType') === 'LIMIT'} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <DialogFooter className="pt-4">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={placeOrder.isPending} className={form.watch('transactionType') === 'BUY' ? 'bg-success hover:bg-success/90' : 'bg-destructive hover:bg-destructive/90'}>
                    {placeOrder.isPending ? "Placing..." : `Place ${form.watch('transactionType')}`}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : orders && orders.length > 0 ? (
              orders.map((order: Order) => (
                <TableRow key={order.orderId}>
                  <TableCell className="text-xs text-muted-foreground">
                    {order.createTime ? format(new Date(order.createTime), 'HH:mm:ss') : '-'}
                  </TableCell>
                  <TableCell className="font-mono font-medium">{order.tradingSymbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-[10px]",
                      order.transactionType === 'BUY' ? "border-success text-success" : "border-destructive text-destructive"
                    )}>
                      {order.transactionType} {order.orderType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{order.productType}</TableCell>
                  <TableCell className="text-right font-mono">
                    {order.filledQty || 0}/{order.quantity}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(order.price)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{order.orderStatus}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {['PENDING', 'OPEN', 'PARTIALLY_FILLED'].includes(order.orderStatus?.toUpperCase()) && (
                      <div className="flex justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleCancel(order.orderId)}
                          disabled={cancelOrder.isPending}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No orders found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
