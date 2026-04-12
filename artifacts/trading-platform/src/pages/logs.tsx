import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;
const LS_KEY = "log_view_reset_at";
const LIMIT = 200;

interface AppLog {
  id: number;
  level: string;
  category: string;
  action: string;
  details?: string | null;
  status?: string | null;
  statusCode?: number | null;
  createdAt: string;
}
interface LogsResponse {
  logs: AppLog[];
  total: number;
  page: number;
  limit: number;
}
interface TradeLog {
  id: number;
  strategyId: number;
  strategyName: string;
  orderId?: string | null;
  tradingSymbol: string;
  transactionType: string;
  quantity: number;
  price: string;
  status: string;
  pnl?: string | null;
  message?: string | null;
  executedAt: string;
}

const LEVEL_STYLES: Record<string, string> = {
  info: "bg-blue-500/10 text-blue-400 border-blue-400/30",
  warn: "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};

const CATEGORY_STYLES: Record<string, string> = {
  broker: "bg-purple-500/10 text-purple-400",
  order: "bg-emerald-500/10 text-emerald-400",
  strategy: "bg-cyan-500/10 text-cyan-400",
  settings: "bg-orange-500/10 text-orange-400",
  risk: "bg-red-500/10 text-red-400",
  api: "bg-muted text-muted-foreground",
  system: "bg-muted/60 text-muted-foreground",
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function AppLogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!log.details;
  let parsed: Record<string, unknown> | null = null;
  if (hasDetails) {
    try {
      parsed = JSON.parse(log.details!);
    } catch {
      parsed = null;
    }
  }

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/40 hover:bg-muted/20 transition-colors text-xs",
          hasDetails && "cursor-pointer select-none",
        )}
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">
          {fmtTime(log.createdAt)}
        </td>
        <td className="px-2 py-2">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0",
              LEVEL_STYLES[log.level] ?? "",
            )}
          >
            {log.level.toUpperCase()}
          </Badge>
        </td>
        <td className="px-2 py-2">
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] px-1.5 py-0 capitalize",
              CATEGORY_STYLES[log.category] ?? "",
            )}
          >
            {log.category}
          </Badge>
        </td>
        <td className="px-2 py-2 font-medium max-w-[280px] truncate">
          {log.action}
        </td>
        <td className="px-2 py-2">
          {log.status && (
            <Badge
              variant={
                log.status === "success"
                  ? "default"
                  : log.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className="text-[10px] px-1.5 py-0"
            >
              {log.status}
            </Badge>
          )}
        </td>
        <td className="px-2 py-2 text-muted-foreground font-mono text-[10px]">
          {log.statusCode ?? "—"}
        </td>
        <td className="px-2 py-2 w-5 text-muted-foreground">
          {hasDetails &&
            (expanded ? (
              <ChevronDown className="h-3 w-3 text-primary" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            ))}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-border/40 bg-muted/10">
          <td colSpan={7} className="px-4 py-2">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed">
              {parsed ? JSON.stringify(parsed, null, 2) : log.details}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

function TradeLogRow({ log }: { log: TradeLog }) {
  const isBuy = log.transactionType === "BUY";
  const pnl =
    log.pnl !== null && log.pnl !== undefined ? Number(log.pnl) : null;
  return (
    <tr className="border-b border-border/40 hover:bg-muted/20 text-xs">
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">
        {fmtTime(log.executedAt)}
      </td>
      <td className="px-2 py-2 font-mono font-semibold">{log.tradingSymbol}</td>
      <td className="px-2 py-2">
        <span
          className={cn(
            "flex items-center gap-1 font-medium",
            isBuy ? "text-emerald-400" : "text-red-400",
          )}
        >
          {isBuy ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {log.transactionType}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono">{log.quantity}</td>
      <td className="px-2 py-2 text-right font-mono">
        ₹
        {Number(log.price).toLocaleString("en-IN", {
          minimumFractionDigits: 2,
        })}
      </td>
      <td className="px-2 py-2">
        <Badge
          variant={
            log.status === "executed"
              ? "default"
              : log.status === "failed"
                ? "destructive"
                : "secondary"
          }
          className="text-[10px] px-1.5 py-0"
        >
          {log.status}
        </Badge>
      </td>
      <td className="px-2 py-2 text-right font-mono">
        {pnl !== null ? (
          <span className={pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
            {pnl >= 0 ? "+" : ""}₹
            {pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-muted-foreground max-w-[160px] truncate">
        {log.strategyName}
      </td>
      <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
        {log.orderId ?? "—"}
      </td>
    </tr>
  );
}

function getResetTs(): string | null {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}
function setResetTs(ts: string) {
  try {
    localStorage.setItem(LS_KEY, ts);
  } catch {}
}

export default function Logs() {
  const [page, setPage] = useState(0);
  const [resetTs, setResetTsState] = useState<string | null>(getResetTs);
  const [activeTab, setActiveTab] = useState("app");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<LogsResponse>({
    queryKey: ["app-logs", page, resetTs],
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (resetTs) p.set("fromTimestamp", resetTs);
      const res = await fetch(`${BASE}api/logs?${p}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 10_000,
  });

  const { data: tradeLogs = [], isLoading: tradeLogsLoading } = useQuery<
    TradeLog[]
  >({
    queryKey: ["trade-logs"],
    queryFn: async () => {
      const res = await fetch(`${BASE}api/strategies/trade-logs`);
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (data && tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  }, [data]);

  function handleClearView() {
    const now = new Date().toISOString();
    setResetTs(now);
    setResetTsState(now);
    setPage(0);
    queryClient.invalidateQueries({ queryKey: ["app-logs"] });
    toast({
      title: "Logs deleted from view",
      description: "All logs remain permanently stored in the database.",
    });
  }

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  // Same height constant for both tables — keeps them identical in size
  const TABLE_H = "calc(100vh - 230px)";

  return (
    <div className="space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* ── Tab bar row ── */}
        <div className="flex items-center gap-2 mb-3">
          <TabsList className="h-8">
            <TabsTrigger value="app" className="text-xs px-3">Application Logs</TabsTrigger>
            <TabsTrigger value="trade" className="text-xs px-3">Strategy Trade Logs</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-muted-foreground">
              {activeTab === "app"
                ? `${total.toLocaleString()} ${total === 1 ? "entry" : "entries"}`
                : `${tradeLogs.length.toLocaleString()} ${tradeLogs.length === 1 ? "entry" : "entries"}`}
            </span>
            {errorCount > 0 && (
              <span className="text-[10px] font-mono rounded border border-destructive/30 bg-destructive/10 text-destructive px-2 py-0.5">
                {errorCount} error{errorCount > 1 ? "s" : ""}
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-[10px] font-mono rounded border border-yellow-400/30 bg-yellow-400/10 text-yellow-400 px-2 py-0.5">
                {warnCount} warn{warnCount > 1 ? "s" : ""}
              </span>
            )}
            <Button
              variant="outline" size="sm"
              className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={handleClearView}
              title="Clears UI view only — all logs remain permanently in the database"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {/* ── APPLICATION LOGS ── */}
        <TabsContent value="app" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div
                ref={tableScrollRef}
                className="overflow-auto rounded-md border border-border"
                style={{ height: TABLE_H }}
              >
                <table className="w-full table-auto text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-muted/90 backdrop-blur text-left">
                      {["Time", "Level", "Category", "Action", "Status", "Code", ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 12 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td colSpan={7} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>
                        </tr>
                      ))
                    ) : logs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-16 text-center text-sm text-muted-foreground">
                          No logs found.
                        </td>
                      </tr>
                    ) : (
                      logs.map((log) => <AppLogRow key={log.id} log={log} />)
                    )}
                  </tbody>
                </table>
              </div>
              {total > LIMIT && (
                <div className="flex items-center justify-between pt-1">
                  <Button variant="outline" size="sm" className="text-xs h-7"
                    disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page + 1} of {Math.ceil(total / LIMIT)}
                  </span>
                  <Button variant="outline" size="sm" className="text-xs h-7"
                    disabled={(page + 1) * LIMIT >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── STRATEGY TRADE LOGS ── */}
        <TabsContent value="trade" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div className="overflow-auto rounded-md border border-border" style={{ height: TABLE_H }}>
                <table className="w-full table-auto text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-border bg-muted/90 backdrop-blur text-left">
                      {["Time", "Symbol", "Side", "Qty", "Price", "Status", "P&L", "Strategy", "Order ID"].map((h) => (
                        <th key={h} className={cn(
                          "px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap",
                          ["Qty", "Price", "P&L"].includes(h) && "text-right"
                        )}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tradeLogsLoading ? (
                      Array.from({ length: 12 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td colSpan={9} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>
                        </tr>
                      ))
                    ) : tradeLogs.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-4 py-16 text-center text-sm text-muted-foreground">
                          No logs found.
                        </td>
                      </tr>
                    ) : (
                      tradeLogs.map((log) => <TradeLogRow key={log.id} log={log} />)
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
