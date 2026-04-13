import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Trash2,
  History,
  XCircle,
  CheckCircle2,
  Activity,
  AlertTriangle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;
const LS_SUCCESS_KEY = "log_success_reset_at";
const LIMIT = 150;

// ── Dhan API Error Code Lookup ───────────────────────────────────────────────
const DHAN_TRADING_ERRORS: Record<string, { type: string; message: string; color: string }> = {
  "DH-901": { type: "Invalid Authentication", message: "Client ID or access token is invalid or expired. Re-enter your credentials in Settings.", color: "text-red-400" },
  "DH-902": { type: "Invalid Access",          message: "User has not subscribed to Data APIs or does not have Trading API access. Subscribe in your Dhan account.", color: "text-orange-400" },
  "DH-903": { type: "User Account Error",      message: "Account issue — check if required trading segments are activated.", color: "text-orange-400" },
  "DH-904": { type: "Rate Limit Exceeded",     message: "Too many API requests from your account. Slow down API calls or wait for the window to reset.", color: "text-yellow-400" },
  "DH-905": { type: "Input Exception",         message: "Missing required fields or invalid parameter values in the request.", color: "text-yellow-400" },
  "DH-906": { type: "Order Error",             message: "Incorrect order request — check symbol, quantity, price, and product type.", color: "text-red-400" },
  "DH-907": { type: "Data Error",              message: "System could not fetch data — incorrect parameters or no data available.", color: "text-orange-400" },
  "DH-908": { type: "Internal Server Error",   message: "Dhan server was unable to process the request. Retry in a moment.", color: "text-red-400" },
  "DH-909": { type: "Network Error",           message: "Network issue — Dhan API could not communicate with the backend system.", color: "text-purple-400" },
  "DH-910": { type: "Other Error",             message: "Error from an unclassified reason. Check the full response details.", color: "text-muted-foreground" },
  "DH-911": { type: "Invalid IP",              message: "Your server IP is not whitelisted on your Dhan account.", color: "text-red-400" },
};
const DHAN_DATA_ERRORS: Record<number, { message: string; color: string }> = {
  800: { message: "Internal Server Error on Dhan Data API", color: "text-red-400" },
  804: { message: "Requested instrument count exceeds the allowed limit", color: "text-orange-400" },
  805: { message: "Too many requests — further calls may get you blocked", color: "text-yellow-400" },
  806: { message: "Data APIs not subscribed on your Dhan account", color: "text-orange-400" },
  807: { message: "Access token has expired — refresh in Settings", color: "text-red-400" },
  808: { message: "Authentication failed — Client ID or access token invalid", color: "text-red-400" },
  809: { message: "Access token is invalid", color: "text-red-400" },
  810: { message: "Client ID is invalid", color: "text-red-400" },
  811: { message: "Invalid expiry date provided", color: "text-orange-400" },
  812: { message: "Invalid date format", color: "text-orange-400" },
  813: { message: "Invalid Security ID", color: "text-orange-400" },
  814: { message: "Invalid request body or parameters", color: "text-orange-400" },
};

function parseDhanError(details: string | null | undefined, statusCode: number | null | undefined) {
  let parsed: Record<string, unknown> = {};
  if (details) { try { parsed = JSON.parse(details) as Record<string, unknown>; } catch { return null; } }
  const errorCode = (parsed.errorCode ?? parsed.error_code ?? parsed.code) as string | undefined;
  if (errorCode && DHAN_TRADING_ERRORS[errorCode]) return { code: errorCode, ...DHAN_TRADING_ERRORS[errorCode] };
  const numCode = statusCode ?? (typeof parsed.status === "number" ? parsed.status : undefined);
  if (numCode && DHAN_DATA_ERRORS[numCode]) return { code: String(numCode), type: "Data API Error", ...DHAN_DATA_ERRORS[numCode] };
  const msg = (parsed.message ?? parsed.errorMessage ?? parsed.error) as string | undefined;
  if (msg || statusCode) return { code: errorCode ?? String(numCode ?? statusCode ?? ""), type: "API Error", message: msg ?? `HTTP ${statusCode}`, color: "text-muted-foreground" };
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface AppLog {
  id: number; level: string; category: string; action: string;
  details?: string | null; status?: string | null; statusCode?: number | null; createdAt: string;
}
interface LogsResponse { logs: AppLog[]; total: number; page: number; limit: number; }
interface TradeLog {
  id: number; strategyId: number; strategyName: string; orderId?: string | null;
  tradingSymbol: string; transactionType: string; quantity: number; price: string;
  status: string; pnl?: string | null; message?: string | null; executedAt: string;
}
interface AuditEntry {
  id: number; action: string; field: string | null; oldValue: string | null;
  newValue: string | null; description: string | null; changedAt: string;
}
interface LogCounts { failed: number; success: number; }

// Unified entry type for the Failed Logs table (merges app + trade logs)
type FailedEntry =
  | { _src: "app";   ts: string; app: AppLog }
  | { _src: "trade"; ts: string; trade: TradeLog };

// ── Style maps ───────────────────────────────────────────────────────────────
const LEVEL_STYLES: Record<string, string> = {
  info:  "bg-blue-500/10 text-blue-400 border-blue-400/30",
  warn:  "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};
const CATEGORY_STYLES: Record<string, string> = {
  broker: "bg-purple-500/10 text-purple-400", order: "bg-emerald-500/10 text-emerald-400",
  strategy: "bg-cyan-500/10 text-cyan-400", settings: "bg-orange-500/10 text-orange-400",
  risk: "bg-red-500/10 text-red-400", api: "bg-muted text-muted-foreground",
  system: "bg-muted/60 text-muted-foreground",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}
function getLs(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function setLs(key: string, val: string) { try { localStorage.setItem(key, val); } catch {} }

// ── Failed App Log Row ───────────────────────────────────────────────────────
function FailedAppLogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const dhanErr = parseDhanError(log.details, log.statusCode);
  let parsed: Record<string, unknown> | null = null;
  if (log.details) { try { parsed = JSON.parse(log.details); } catch {} }

  return (
    <>
      <tr
        className={cn("border-b border-border/40 hover:bg-destructive/5 transition-colors text-xs cursor-pointer select-none", expanded && "bg-destructive/5")}
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">{fmtIST(log.createdAt)}</td>
        <td className="px-2 py-2">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", LEVEL_STYLES[log.level] ?? "")}>
            {log.level.toUpperCase()}
          </Badge>
        </td>
        <td className="px-2 py-2">
          <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0 capitalize", CATEGORY_STYLES[log.category] ?? "")}>
            {log.category}
          </Badge>
        </td>
        <td className="px-2 py-2 font-medium max-w-[180px] truncate">{log.action}</td>
        <td className="px-2 py-2 min-w-[200px]">
          {dhanErr ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                {dhanErr.code && <span className="font-mono text-[9px] bg-destructive/10 text-destructive border border-destructive/30 rounded px-1">{dhanErr.code}</span>}
                <span className={cn("text-[10px] font-semibold", dhanErr.color)}>{dhanErr.type}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug max-w-[300px] truncate">{dhanErr.message}</p>
            </div>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">{log.statusCode ? `HTTP ${log.statusCode}` : "No error code"}</span>
          )}
        </td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">{expanded ? <ChevronDown className="h-3 w-3 text-destructive" /> : <ChevronRight className="h-3 w-3" />}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-destructive/5">
          <td colSpan={6} className="px-4 py-3 space-y-2">
            {dhanErr && (
              <div className="rounded border border-destructive/30 bg-destructive/8 p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <span className="text-xs font-semibold text-destructive">{dhanErr.code ? `${dhanErr.code} · ` : ""}{dhanErr.type}</span>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">{dhanErr.message}</p>
              </div>
            )}
            {(parsed || log.details) && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Raw Response</p>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed bg-muted/30 rounded p-2 border border-border/40">
                  {parsed ? JSON.stringify(parsed, null, 2) : log.details}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Failed Trade Log Row (in Failed Logs tab) ────────────────────────────────
function FailedTradeRow({ log }: { log: TradeLog }) {
  const [expanded, setExpanded] = useState(false);
  const isBuy = log.transactionType === "BUY";
  return (
    <>
      <tr
        className={cn("border-b border-border/40 hover:bg-destructive/5 transition-colors text-xs cursor-pointer select-none", expanded && "bg-destructive/5")}
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">{fmtIST(log.executedAt)}</td>
        <td className="px-2 py-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-destructive/10 text-destructive border-destructive/30">ERROR</Badge>
        </td>
        <td className="px-2 py-2">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-cyan-500/10 text-cyan-400">strategy</Badge>
        </td>
        <td className="px-2 py-2 font-medium max-w-[180px] truncate">
          <span className="flex items-center gap-1.5">
            <span className={cn("font-mono font-semibold", isBuy ? "text-emerald-400" : "text-red-400")}>
              {log.transactionType}
            </span>
            <span>{log.tradingSymbol}</span>
            <span className="text-muted-foreground">×{log.quantity}</span>
          </span>
        </td>
        <td className="px-2 py-2 min-w-[200px]">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Badge variant="destructive" className="text-[9px] px-1.5 py-0">failed</Badge>
              <span className="text-[10px] text-red-400 font-semibold">Strategy Trade Failed</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug max-w-[300px] truncate">
              {log.message ?? `Order ID: ${log.orderId ?? "N/A"} · ${log.strategyName}`}
            </p>
          </div>
        </td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">{expanded ? <ChevronDown className="h-3 w-3 text-destructive" /> : <ChevronRight className="h-3 w-3" />}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-destructive/5">
          <td colSpan={6} className="px-4 py-3 space-y-2">
            <div className="rounded border border-destructive/30 bg-destructive/8 p-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                <span className="text-xs font-semibold text-destructive">Strategy Trade Failure</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                <div><span className="text-muted-foreground">Strategy:</span> <span className="font-medium">{log.strategyName}</span></div>
                <div><span className="text-muted-foreground">Symbol:</span> <span className="font-mono font-semibold">{log.tradingSymbol}</span></div>
                <div><span className="text-muted-foreground">Side:</span> <span className={cn("font-medium", isBuy ? "text-emerald-400" : "text-red-400")}>{log.transactionType}</span></div>
                <div><span className="text-muted-foreground">Qty:</span> <span className="font-mono">{log.quantity}</span></div>
                <div><span className="text-muted-foreground">Price:</span> <span className="font-mono">₹{Number(log.price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
                <div><span className="text-muted-foreground">Order ID:</span> <span className="font-mono">{log.orderId ?? "—"}</span></div>
              </div>
              {log.message && <p className="mt-2 text-xs text-red-400 border-t border-destructive/20 pt-2">{log.message}</p>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Success Log Row ──────────────────────────────────────────────────────────
function SuccessLogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!log.details;
  let parsed: Record<string, unknown> | null = null;
  if (hasDetails) { try { parsed = JSON.parse(log.details!); } catch {} }
  return (
    <>
      <tr
        className={cn("border-b border-border/40 hover:bg-emerald-500/5 transition-colors text-xs", hasDetails && "cursor-pointer select-none")}
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">{fmtIST(log.createdAt)}</td>
        <td className="px-2 py-2">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", LEVEL_STYLES[log.level] ?? "")}>
            {log.level.toUpperCase()}
          </Badge>
        </td>
        <td className="px-2 py-2">
          <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0 capitalize", CATEGORY_STYLES[log.category] ?? "")}>
            {log.category}
          </Badge>
        </td>
        <td className="px-2 py-2 font-medium max-w-[420px] truncate text-foreground">{log.action}</td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
            <CheckCircle2 className="w-3 h-3" /> success
          </span>
        </td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">
          {hasDetails && (expanded ? <ChevronDown className="h-3 w-3 text-emerald-400" /> : <ChevronRight className="h-3 w-3" />)}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-border/40 bg-emerald-500/5">
          <td colSpan={6} className="px-4 py-2">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed">
              {parsed ? JSON.stringify(parsed, null, 2) : log.details}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Strategy Trade Row (all trades) ─────────────────────────────────────────
function StrategyTradeRow({ log }: { log: TradeLog }) {
  const [expanded, setExpanded] = useState(false);
  const isBuy = log.transactionType === "BUY";
  const pnl = log.pnl != null ? Number(log.pnl) : null;
  const isFailed = log.status === "failed";
  return (
    <>
      <tr
        className={cn("border-b border-border/40 hover:bg-muted/20 text-xs", log.message && "cursor-pointer select-none")}
        onClick={() => log.message && setExpanded((e) => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">{fmtIST(log.executedAt)}</td>
        <td className="px-2 py-2 font-mono font-semibold">{log.tradingSymbol}</td>
        <td className="px-2 py-2">
          <span className={cn("flex items-center gap-1 font-medium", isBuy ? "text-emerald-400" : "text-red-400")}>
            {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {log.transactionType}
          </span>
        </td>
        <td className="px-2 py-2 text-right font-mono">{log.quantity}</td>
        <td className="px-2 py-2 text-right font-mono">₹{Number(log.price).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
        <td className="px-2 py-2">
          <Badge variant={log.status === "executed" ? "default" : isFailed ? "destructive" : "secondary"} className="text-[10px] px-1.5 py-0">
            {log.status}
          </Badge>
        </td>
        <td className="px-2 py-2 text-right font-mono">
          {pnl !== null
            ? <span className={pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{pnl >= 0 ? "+" : ""}₹{pnl.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>
            : <span className="text-muted-foreground">—</span>}
        </td>
        <td className="px-2 py-2 text-muted-foreground max-w-[130px] truncate">{log.strategyName}</td>
        <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">{log.orderId ?? "—"}</td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">
          {log.message && (expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />)}
        </td>
      </tr>
      {expanded && log.message && (
        <tr className={cn("border-b border-border/40", isFailed ? "bg-destructive/5" : "bg-muted/10")}>
          <td colSpan={10} className="px-4 py-2">
            <div className={cn("flex items-start gap-2 text-xs rounded p-2 border", isFailed ? "border-destructive/30 bg-destructive/8 text-destructive" : "border-emerald-500/20 bg-emerald-500/5 text-emerald-400")}>
              {isFailed ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>{log.message}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Table Shell ──────────────────────────────────────────────────────────────
function LogTable({ headers, isLoading, isEmpty, emptyText, colSpan, children, tableH }: {
  headers: string[]; isLoading: boolean; isEmpty: boolean; emptyText: string;
  colSpan: number; children: React.ReactNode; tableH: string;
}) {
  return (
    <div className="overflow-auto rounded-md border border-border" style={{ height: tableH }}>
      <table className="w-full table-auto text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted/90 backdrop-blur text-left">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 12 }).map((_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td colSpan={colSpan} className="px-3 py-2"><Skeleton className="h-4 w-full" /></td>
                </tr>
              ))
            : isEmpty
              ? <tr><td colSpan={colSpan} className="px-4 py-16 text-center text-sm text-muted-foreground">{emptyText}</td></tr>
              : children}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────
function Pager({ page, total, onPrev, onNext }: { page: number; total: number; onPrev: () => void; onNext: () => void }) {
  if (total <= LIMIT) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      <Button variant="outline" size="sm" className="text-xs h-7" disabled={page === 0} onClick={onPrev}>Previous</Button>
      <span className="text-xs text-muted-foreground">Page {page + 1} of {Math.ceil(total / LIMIT)}</span>
      <Button variant="outline" size="sm" className="text-xs h-7" disabled={(page + 1) * LIMIT >= total} onClick={onNext}>Next</Button>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function Logs() {
  const [activeTab, setActiveTab] = useState("failed");
  const [failedPage, setFailedPage]   = useState(0);
  const [successPage, setSuccessPage] = useState(0);
  const [successResetTs, setSuccessResetTsState] = useState(() => getLs(LS_SUCCESS_KEY));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const TABLE_H = "calc(100vh - 220px)";

  // ── Counts badge (refreshes every 3s) ───────────────────────────────────
  const { data: counts } = useQuery<LogCounts>({
    queryKey: ["log-counts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs/counts`);
      if (!r.ok) return { failed: 0, success: 0 };
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
  });

  // ── Failed: app_logs (failed/error) — refreshes every 3s ────────────────
  const { data: failedData, isLoading: failedLoading } = useQuery<LogsResponse>({
    queryKey: ["logs-failed", failedPage],
    queryFn: async () => {
      const p = new URLSearchParams({ tab: "failed", page: String(failedPage), limit: String(LIMIT) });
      const r = await fetch(`${BASE}api/logs?${p}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
    enabled: activeTab === "failed",
  });

  // ── Failed: trade_logs (failed) — refreshes every 3s ────────────────────
  const { data: failedTrades = [], isLoading: failedTradesLoading } = useQuery<TradeLog[]>({
    queryKey: ["failed-trade-logs"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/strategies/trade-logs?status=failed`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
    enabled: activeTab === "failed",
  });

  // ── Success: app_logs (success) — refreshes every 3s ────────────────────
  const { data: successData, isLoading: successLoading } = useQuery<LogsResponse>({
    queryKey: ["logs-success", successPage, successResetTs],
    queryFn: async () => {
      const p = new URLSearchParams({ tab: "success", page: String(successPage), limit: String(LIMIT) });
      if (successResetTs) p.set("fromTimestamp", successResetTs);
      const r = await fetch(`${BASE}api/logs?${p}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
    enabled: activeTab === "success",
  });

  // ── Strategy: ALL trade_logs — refreshes every 3s ───────────────────────
  const { data: tradeLogs = [], isLoading: tradeLoading } = useQuery<TradeLog[]>({
    queryKey: ["trade-logs"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/strategies/trade-logs`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
    enabled: activeTab === "strategy",
  });

  // ── Audit logs — refreshes every 30s ────────────────────────────────────
  const { data: auditLogs = [], isLoading: auditLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings/audit-log`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30_000,
    enabled: activeTab === "audit",
  });

  // ── Merge & sort failed entries ──────────────────────────────────────────
  const failedAppLogs = failedData?.logs ?? [];
  const failedTotal   = failedData?.total ?? 0;

  const allFailed: FailedEntry[] = [
    ...failedAppLogs.map((a): FailedEntry => ({ _src: "app",   ts: a.createdAt,  app: a })),
    ...failedTrades.map((t): FailedEntry  => ({ _src: "trade", ts: t.executedAt, trade: t })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  const failedIsLoading = failedLoading || failedTradesLoading;
  const combinedFailedTotal = failedTotal + failedTrades.length;

  // ── Clear Success logs view ──────────────────────────────────────────────
  function handleClearSuccess() {
    const now = new Date().toISOString();
    setLs(LS_SUCCESS_KEY, now);
    setSuccessResetTsState(now);
    setSuccessPage(0);
    queryClient.invalidateQueries({ queryKey: ["logs-success"] });
    queryClient.invalidateQueries({ queryKey: ["log-counts"] });
    toast({ title: "View cleared", description: "All logs permanently stored in the database." });
  }

  const successLogs  = successData?.logs ?? [];
  const successTotal = successData?.total ?? 0;

  return (
    <div className="w-full space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab}>

        {/* ── Tab bar ── */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <TabsList className="h-8 shrink-0">

            {/* Failed Logs */}
            <TabsTrigger value="failed" className="text-xs px-3 gap-1.5">
              <XCircle className="w-3 h-3 text-destructive" />
              Failed Logs
              {(counts?.failed ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1.5 min-w-[16px] text-center leading-4">
                  {counts!.failed > 99 ? "99+" : counts!.failed}
                </span>
              )}
            </TabsTrigger>

            {/* Success Logs */}
            <TabsTrigger value="success" className="text-xs px-3 gap-1.5">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Success Logs
              {(counts?.success ?? 0) > 0 && (
                <span className="ml-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold px-1.5 min-w-[16px] text-center leading-4">
                  {counts!.success > 999 ? "999+" : counts!.success}
                </span>
              )}
            </TabsTrigger>

            {/* Strategy Logs */}
            <TabsTrigger value="strategy" className="text-xs px-3 gap-1.5">
              <Activity className="w-3 h-3" />
              Strategy Logs
            </TabsTrigger>

            {/* Audit Logs */}
            <TabsTrigger value="audit" className="text-xs px-3 gap-1.5">
              <History className="w-3 h-3" />
              Audit Logs
            </TabsTrigger>
          </TabsList>

          {/* Delete button — Success Logs only */}
          {activeTab === "success" && (
            <Button
              variant="outline" size="sm"
              className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 ml-auto"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear View
            </Button>
          )}
        </div>

        {/* ── FAILED LOGS ── */}
        <TabsContent value="failed" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div className="flex items-center gap-2 mb-2.5 text-xs text-muted-foreground">
                <XCircle className="w-3.5 h-3.5 text-destructive" />
                <span>
                  <span className="font-semibold text-destructive">{combinedFailedTotal.toLocaleString()}</span>
                  {" "}failed / error {combinedFailedTotal === 1 ? "entry" : "entries"}{" "}
                  <span className="text-[10px]">(API + strategy combined)</span>
                </span>
                <span className="ml-auto text-[10px]">Live · auto-refreshes every 3s</span>
              </div>
              <LogTable
                headers={["Time (IST)", "Level", "Category", "Action / Symbol", "Dhan Error Reason / Details", ""]}
                isLoading={failedIsLoading}
                isEmpty={allFailed.length === 0}
                emptyText="No failures yet — all API calls and strategy trades are succeeding."
                colSpan={6}
                tableH={TABLE_H}
              >
                {allFailed.map((entry) =>
                  entry._src === "app"
                    ? <FailedAppLogRow key={`app-${entry.app.id}`} log={entry.app} />
                    : <FailedTradeRow  key={`trade-${entry.trade.id}`} log={entry.trade} />
                )}
              </LogTable>
              <Pager
                page={failedPage} total={failedTotal}
                onPrev={() => setFailedPage((p) => Math.max(0, p - 1))}
                onNext={() => setFailedPage((p) => p + 1)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SUCCESS LOGS ── */}
        <TabsContent value="success" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div className="flex items-center gap-2 mb-2.5 text-xs text-muted-foreground">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>
                  <span className="font-semibold text-emerald-400">{successTotal.toLocaleString()}</span>
                  {" "}{successTotal === 1 ? "entry" : "entries"}
                </span>
                <span className="ml-auto text-[10px]">Live · auto-refreshes every 3s</span>
              </div>
              <LogTable
                headers={["Time (IST)", "Level", "Category", "Action", "Status", ""]}
                isLoading={successLoading}
                isEmpty={successLogs.length === 0}
                emptyText="No success logs yet."
                colSpan={6}
                tableH={TABLE_H}
              >
                {successLogs.map((log) => <SuccessLogRow key={log.id} log={log} />)}
              </LogTable>
              <Pager
                page={successPage} total={successTotal}
                onPrev={() => setSuccessPage((p) => Math.max(0, p - 1))}
                onNext={() => setSuccessPage((p) => p + 1)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── STRATEGY LOGS ── */}
        <TabsContent value="strategy" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div className="flex items-center gap-2 mb-2.5 text-xs text-muted-foreground">
                <Activity className="w-3.5 h-3.5" />
                <span>
                  <span className="font-semibold text-foreground">{tradeLogs.length.toLocaleString()}</span>
                  {" "}strategy trade {tradeLogs.length === 1 ? "entry" : "entries"}{" "}
                  <span className="text-[10px]">(failed trades also appear in Failed Logs)</span>
                </span>
                <span className="ml-auto text-[10px]">Live · auto-refreshes every 3s</span>
              </div>
              <LogTable
                headers={["Time (IST)", "Symbol", "Side", "Qty", "Price", "Status", "P&L", "Strategy", "Order ID", ""]}
                isLoading={tradeLoading}
                isEmpty={tradeLogs.length === 0}
                emptyText="No strategy trade logs yet. Execute a trade via a strategy to see logs here."
                colSpan={10}
                tableH={TABLE_H}
              >
                {tradeLogs.map((log) => <StrategyTradeRow key={log.id} log={log} />)}
              </LogTable>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AUDIT LOGS ── */}
        <TabsContent value="audit" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <div className="flex items-center gap-2 mb-2.5 text-xs text-muted-foreground">
                <History className="w-3.5 h-3.5" />
                <span>
                  <span className="font-semibold text-foreground">{auditLogs.length.toLocaleString()}</span>
                  {" "}{auditLogs.length === 1 ? "change" : "changes"} · last 50 records
                </span>
                <span className="ml-auto text-[10px]">Auto-refreshes every 30s</span>
              </div>
              <LogTable
                headers={["Time (IST)", "Action", "Field", "Old Value", "New Value", "Description"]}
                isLoading={auditLoading}
                isEmpty={auditLogs.length === 0}
                emptyText="No settings changes recorded yet. Save any setting to start the audit trail."
                colSpan={6}
                tableH={TABLE_H}
              >
                {auditLogs.map((log) => (
                  <tr key={log.id} className="border-b border-border/40 hover:bg-muted/20 text-xs">
                    <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{fmtIST(log.changedAt)}</td>
                    <td className="px-2 py-2">
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-mono">{log.action}</Badge>
                    </td>
                    <td className="px-2 py-2 font-medium text-foreground">{log.field ?? "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground font-mono text-[10px] max-w-[140px] truncate" title={log.oldValue ?? ""}>{log.oldValue ?? "—"}</td>
                    <td className="px-2 py-2 text-foreground font-mono text-[10px] max-w-[140px] truncate" title={log.newValue ?? ""}>{log.newValue ?? "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground max-w-[200px] truncate">{log.description ?? "—"}</td>
                  </tr>
                ))}
              </LogTable>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Confirm clear Success view ── */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Success Logs view?</AlertDialogTitle>
            <AlertDialogDescription>
              Hides all current <strong>Success Logs</strong> from this view. All logs are permanently stored in the database and are never deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearSuccess}
            >
              Clear View
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
