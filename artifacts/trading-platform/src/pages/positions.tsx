import { useGetPositions } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Position } from "@workspace/api-zod/src/generated/types";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

export default function Positions() {
  const { data: positions, isLoading } = useGetPositions();

  const totalUnrealized = positions?.reduce((acc, pos) => acc + (pos.unrealizedProfit || 0), 0) || 0;
  const totalRealized = positions?.reduce((acc, pos) => acc + (pos.realizedProfit || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Positions</h1>
          <p className="text-sm text-muted-foreground">Your open positions across all segments.</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-card border border-border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-1">Unrealized P&L</div>
            <div className={cn("text-lg font-mono font-bold", totalUnrealized >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(totalUnrealized)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-1">Realized P&L</div>
            <div className={cn("text-lg font-mono font-bold", totalRealized >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(totalRealized)}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Net Qty</TableHead>
              <TableHead className="text-right">Avg Price</TableHead>
              <TableHead className="text-right">LTP</TableHead>
              <TableHead className="text-right">Realized</TableHead>
              <TableHead className="text-right">Unrealized</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : positions && positions.length > 0 ? (
              positions.map((pos: Position) => (
                <TableRow key={`${pos.securityId}-${pos.productType}`}>
                  <TableCell className="font-mono font-medium">{pos.tradingSymbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {pos.productType}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", (pos.netQty || 0) > 0 ? "text-success" : (pos.netQty || 0) < 0 ? "text-destructive" : "")}>
                    {pos.netQty}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatCurrency((pos.netQty || 0) >= 0 ? pos.buyAvg : pos.sellAvg)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    -
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", (pos.realizedProfit || 0) >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(pos.realizedProfit)}
                  </TableCell>
                  <TableCell className={cn("text-right font-mono", (pos.unrealizedProfit || 0) >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(pos.unrealizedProfit)}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No open positions
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
