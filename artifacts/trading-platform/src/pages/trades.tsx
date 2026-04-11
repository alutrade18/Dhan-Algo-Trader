import { useGetTradeBook } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trade } from "@workspace/api-zod/src/generated/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

export default function Trades() {
  const { data: trades, isLoading } = useGetTradeBook();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade Book</h1>
          <p className="text-sm text-muted-foreground">Today's executed trades.</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Order ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                </TableRow>
              ))
            ) : trades && trades.length > 0 ? (
              trades.map((trade: Trade) => (
                <TableRow key={`${trade.orderId}-${trade.tradingSymbol}`}>
                  <TableCell className="text-xs text-muted-foreground">
                    {trade.createTime ? format(new Date(trade.createTime), 'HH:mm:ss') : '-'}
                  </TableCell>
                  <TableCell className="font-mono font-medium">{trade.tradingSymbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn(
                      "text-[10px]",
                      trade.transactionType === 'BUY' ? "border-success text-success" : "border-destructive text-destructive"
                    )}>
                      {trade.transactionType}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {trade.tradedQuantity}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(trade.tradedPrice)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency(trade.tradedQuantity * trade.tradedPrice)}
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground">
                    {trade.orderId}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No trades for today
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
