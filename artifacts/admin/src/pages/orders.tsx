import { useQuery } from "@tanstack/react-query";
import { ShoppingCart, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { apiFetch, type AdminOrder } from "@/lib/api";
import { formatDate, formatCurrency } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    PENDING: "bg-warning/10 text-warning",
    TRADED: "bg-success/10 text-success",
    CANCELLED: "bg-muted text-muted-foreground",
    REJECTED: "bg-destructive/10 text-destructive",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls[status] ?? "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export default function OrdersPage() {
  const { data: orders = [], isLoading, refetch, isFetching } = useQuery<AdminOrder[]>({
    queryKey: ["admin-orders"],
    queryFn: () => apiFetch("/admin/recent-orders"),
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-primary" />
            Super Orders
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Last 50 across all users — intraday only</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-md px-3 py-1.5 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg h-14 animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-12 text-center">
          <ShoppingCart className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No super orders yet</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="table-header-cell text-left px-4 py-3">ID</th>
                  <th className="table-header-cell text-left px-4 py-3">Symbol</th>
                  <th className="table-header-cell text-left px-4 py-3">Type</th>
                  <th className="table-header-cell text-right px-4 py-3">Qty</th>
                  <th className="table-header-cell text-right px-4 py-3">Entry</th>
                  <th className="table-header-cell text-right px-4 py-3">Target</th>
                  <th className="table-header-cell text-right px-4 py-3">SL</th>
                  <th className="table-header-cell text-center px-4 py-3">Status</th>
                  <th className="table-header-cell text-left px-4 py-3">User</th>
                  <th className="table-header-cell text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-border/50 table-row-hover">
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">#{order.id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{order.tradingSymbol || order.securityId}</p>
                        <p className="text-xs text-muted-foreground">{order.exchangeSegment}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1 text-xs font-medium ${
                        order.transactionType === "BUY" ? "text-success" : "text-destructive"
                      }`}>
                        {order.transactionType === "BUY"
                          ? <TrendingUp className="w-3 h-3" />
                          : <TrendingDown className="w-3 h-3" />}
                        {order.transactionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-medium text-foreground">{order.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-foreground">{formatCurrency(order.price)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-success">{formatCurrency(order.targetPrice)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-mono text-destructive">{formatCurrency(order.stopLossPrice)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={order.status} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">
                        {order.userId ? `${order.userId.slice(0, 8)}…` : "anon"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
