import { useGetHoldings } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Holding } from "@workspace/api-zod/src/generated/types";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

export default function Holdings() {
  const { data: holdings, isLoading } = useGetHoldings();

  const totalInvested = holdings?.reduce((acc, h) => acc + (h.investedValue || 0), 0) || 0;
  const totalCurrent = holdings?.reduce((acc, h) => acc + (h.currentValue || 0), 0) || 0;
  const totalPnl = totalCurrent - totalInvested;
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Holdings</h1>
          <p className="text-sm text-muted-foreground">Long term portfolio investments.</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-card border border-border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-1">Invested Value</div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(totalInvested)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-1">Current Value</div>
            <div className="text-lg font-mono font-bold">
              {formatCurrency(totalCurrent)}
            </div>
          </div>
          <div className="bg-card border border-border rounded-md px-4 py-2 text-right">
            <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
            <div className={cn("text-lg font-mono font-bold flex items-center justify-end gap-2", totalPnl >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(totalPnl)}
              <span className="text-xs opacity-80">({pnlPercent.toFixed(2)}%)</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Avg Cost</TableHead>
              <TableHead className="text-right">LTP</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Current</TableHead>
              <TableHead className="text-right">P&L</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : holdings && holdings.length > 0 ? (
              holdings.map((h: Holding) => (
                <TableRow key={h.securityId}>
                  <TableCell className="font-mono font-medium">{h.tradingSymbol}</TableCell>
                  <TableCell className="text-right font-mono">{h.totalQty}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(h.avgCostPrice)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(h.lastTradedPrice)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(h.investedValue)}</TableCell>
                  <TableCell className="text-right font-mono">{formatCurrency(h.currentValue)}</TableCell>
                  <TableCell className={cn("text-right font-mono", (h.pnl || 0) >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(h.pnl)}
                    <span className="text-[10px] ml-1 opacity-80">({(h.changePercent || 0).toFixed(2)}%)</span>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No holdings found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
