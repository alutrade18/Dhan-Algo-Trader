import { useGetTradeLogs } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TradeLog } from "@workspace/api-zod/src/generated/types";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const formatCurrency = (val?: number) => val !== undefined ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val) : '₹0.00';

export default function TradeLogs() {
  const { data: logs, isLoading } = useGetTradeLogs();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Execution Logs</h1>
          <p className="text-sm text-muted-foreground">System-wide algorithmic execution traces.</p>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead>Symbol / Action</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="text-right">Details</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                </TableRow>
              ))
            ) : logs && logs.length > 0 ? (
              logs.map((log: TradeLog) => (
                <TableRow key={log.id}>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {format(new Date(log.executedAt), 'MMM dd, HH:mm:ss.SSS')}
                  </TableCell>
                  <TableCell className="font-medium text-sm">
                    {log.strategyName}
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-sm">{log.tradingSymbol}</div>
                    <div className="mt-1">
                      <span className={cn("text-xs font-medium", log.transactionType === 'BUY' ? "text-success" : "text-destructive")}>
                        {log.transactionType}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate" title={log.message}>
                    {log.message || '-'}
                  </TableCell>
                  <TableCell className="text-right text-xs font-mono">
                    <div>{log.quantity} Qty @ {formatCurrency(log.price)}</div>
                    {log.pnl !== undefined && log.pnl !== null && (
                      <div className={cn("mt-1", log.pnl >= 0 ? "text-success" : "text-destructive")}>
                        P&L: {formatCurrency(log.pnl)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === 'success' ? 'outline' : log.status === 'failed' ? 'destructive' : 'secondary'} 
                           className={cn("text-[10px]", log.status === 'success' && "border-success text-success")}>
                      {log.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No execution logs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
