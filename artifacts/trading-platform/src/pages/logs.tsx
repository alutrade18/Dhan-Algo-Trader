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
  Trash2,
  History,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  MapPin,
  Clock,
  FileCode2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;
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
  const msg = (parsed.errorMessage ?? parsed.message ?? parsed.error) as string | undefined;
  if (msg || statusCode) return { code: errorCode ?? String(numCode ?? statusCode ?? ""), type: "API Error", message: msg ?? `HTTP ${statusCode}`, color: "text-muted-foreground" };
  return null;
}

function parseDetails(details: string | null | undefined): Record<string, unknown> | null {
  if (!details) return null;
  try { return JSON.parse(details) as Record<string, unknown>; } catch { return null; }
}

// ── Types ────────────────────────────────────────────────────────────────────
interface AppLog {
  id: number; level: string; category: string; action: string;
  details?: string | null; status?: string | null; statusCode?: number | null; createdAt: string;
}
interface LogsResponse { logs: AppLog[]; total: number; page: number; limit: number; }
interface AuditEntry {
  id: number; action: string; field: string | null; oldValue: string | null;
  newValue: string | null; description: string | null; changedAt: string;
}
interface LogCounts { failed: number; success: number; }

// ── Style maps ───────────────────────────────────────────────────────────────
const LEVEL_STYLES: Record<string, string> = {
  info:  "bg-blue-500/10 text-blue-400 border-blue-400/30",
  warn:  "bg-yellow-500/10 text-yellow-400 border-yellow-400/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};
const CATEGORY_STYLES: Record<string, string> = {
  broker: "bg-purple-500/10 text-purple-400", order: "bg-emerald-500/10 text-emerald-400",
  settings: "bg-orange-500/10 text-orange-400",
  risk: "bg-red-500/10 text-red-400", api: "bg-muted text-muted-foreground",
  system: "bg-muted/60 text-muted-foreground",
};
const METHOD_STYLES: Record<string, string> = {
  GET:    "text-blue-400",
  POST:   "text-emerald-400",
  PUT:    "text-yellow-400",
  PATCH:  "text-orange-400",
  DELETE: "text-red-400",
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function SourceRouteBadge({ route }: { route: string | undefined }) {
  if (!route) return null;
  const [method, ...pathParts] = route.split(" ");
  const path = pathParts.join(" ");
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] bg-muted/60 border border-border/50 rounded px-1.5 py-0.5 max-w-[220px] truncate">
      <span className={cn("font-bold", METHOD_STYLES[method] ?? "text-muted-foreground")}>{method}</span>
      <span className="text-muted-foreground truncate">{path}</span>
    </span>
  );
}

// ── Failed App Log Row ───────────────────────────────────────────────────────
function FailedAppLogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const dhanErr = parseDhanError(log.details, log.statusCode);
  const parsed = parseDetails(log.details);
  const sourceRoute = parsed?.sourceRoute as string | undefined;
  const errorMessage = parsed?.errorMessage as string | undefined;
  const duration = parsed?.duration as string | undefined;
  const requestBody = parsed?.requestBody as Record<string, unknown> | undefined;
  const queryParams = parsed?.queryParams as Record<string, unknown> | undefined;

  const rawDetails: Record<string, unknown> = {};
  if (parsed) {
    for (const [k, v] of Object.entries(parsed)) {
      if (!["sourceRoute", "duration", "errorMessage", "requestBody", "queryParams"].includes(k)) {
        rawDetails[k] = v;
      }
    }
  }

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
        <td className="px-2 py-2 max-w-[160px]">
          <div className="font-medium truncate text-[11px]">{log.action}</div>
          <SourceRouteBadge route={sourceRoute} />
        </td>
        <td className="px-2 py-2 min-w-[200px]">
          {dhanErr ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {dhanErr.code && <span className="font-mono text-[9px] bg-destructive/10 text-destructive border border-destructive/30 rounded px-1">{dhanErr.code}</span>}
                <span className={cn("text-[10px] font-semibold", dhanErr.color)}>{dhanErr.type}</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug max-w-[280px] truncate">{dhanErr.message}</p>
            </div>
          ) : errorMessage ? (
            <p className="text-[10px] text-destructive/80 leading-snug max-w-[280px] truncate" title={errorMessage}>{errorMessage}</p>
          ) : (
            <span className="text-[10px] text-muted-foreground italic">{log.statusCode ? `HTTP ${log.statusCode}` : "No details"}</span>
          )}
        </td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">{expanded ? <ChevronDown className="h-3 w-3 text-destructive" /> : <ChevronRight className="h-3 w-3" />}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/40 bg-destructive/5">
          <td colSpan={6} className="px-4 py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              {sourceRoute && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-primary/60" />
                  <span className="font-semibold text-foreground/70">Source Route:</span>
                  <SourceRouteBadge route={sourceRoute} />
                </span>
              )}
              {duration && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  <span className="font-semibold text-foreground/70">Duration:</span>
                  <span className="font-mono">{duration}</span>
                </span>
              )}
              {log.statusCode && (
                <span className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground/70">HTTP Status:</span>
                  <span className={cn("font-mono font-bold", log.statusCode >= 500 ? "text-destructive" : "text-yellow-400")}>{log.statusCode}</span>
                </span>
              )}
            </div>
            {dhanErr && (
              <div className="rounded border border-destructive/30 bg-destructive/8 p-2.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <span className="text-xs font-semibold text-destructive">{dhanErr.code ? `${dhanErr.code} · ` : ""}{dhanErr.type}</span>
                </div>
                <p className="text-xs text-foreground/80 leading-relaxed">{dhanErr.message}</p>
              </div>
            )}
            {errorMessage && !dhanErr && (
              <div className="rounded border border-destructive/30 bg-destructive/8 p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <span className="text-xs font-semibold text-destructive">Error Message</span>
                </div>
                <p className="text-xs text-foreground/80 font-mono leading-relaxed break-all">{errorMessage}</p>
              </div>
            )}
            {requestBody && Object.keys(requestBody).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1 flex items-center gap-1">
                  <FileCode2 className="w-3 h-3" /> Request Body
                </p>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed bg-muted/30 rounded p-2 border border-border/40">
                  {JSON.stringify(requestBody, null, 2)}
                </pre>
              </div>
            )}
            {queryParams && Object.keys(queryParams).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Query Params</p>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed bg-muted/30 rounded p-2 border border-border/40">
                  {JSON.stringify(queryParams, null, 2)}
                </pre>
              </div>
            )}
            {Object.keys(rawDetails).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Raw Error Response</p>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed bg-muted/30 rounded p-2 border border-border/40">
                  {JSON.stringify(rawDetails, null, 2)}
                </pre>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Success Log Row ──────────────────────────────────────────────────────────
function SuccessLogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const parsed = parseDetails(log.details);
  const sourceRoute = parsed?.sourceRoute as string | undefined;
  const duration = parsed?.duration as string | undefined;
  const requestBody = parsed?.requestBody as Record<string, unknown> | undefined;
  const hasDetails = !!(sourceRoute || duration || requestBody);

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
        <td className="px-2 py-2 max-w-[200px]">
          <div className="font-medium text-foreground text-[11px] truncate">{log.action}</div>
          <SourceRouteBadge route={sourceRoute} />
        </td>
        <td className="px-2 py-2">
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
            <CheckCircle2 className="w-3 h-3" /> success
          </span>
          {duration && <span className="ml-2 text-[10px] text-muted-foreground font-mono">{duration}</span>}
        </td>
        <td className="px-2 py-1.5 w-5 text-muted-foreground">
          {hasDetails && (expanded ? <ChevronDown className="h-3 w-3 text-emerald-400" /> : <ChevronRight className="h-3 w-3" />)}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-border/40 bg-emerald-500/5">
          <td colSpan={6} className="px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
              {sourceRoute && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-primary/60" />
                  <span className="font-semibold text-foreground/70">Source Route:</span>
                  <SourceRouteBadge route={sourceRoute} />
                </span>
              )}
              {duration && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  <span className="font-semibold text-foreground/70">Duration:</span>
                  <span className="font-mono">{duration}</span>
                </span>
              )}
            </div>
            {requestBody && Object.keys(requestBody).length > 0 && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1 flex items-center gap-1">
                  <FileCode2 className="w-3 h-3" /> Request Body
                </p>
                <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed bg-muted/30 rounded p-2 border border-border/40">
                  {JSON.stringify(requestBody, null, 2)}
                </pre>
              </div>
            )}
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
      <table className="w-full min-w-[560px] table-auto text-sm">
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // ── Failed: last 7 days only — enforced server-side — refreshes every 3s ─
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

  // ── Success — refreshes every 3s ─────────────────────────────────────────
  const { data: successData, isLoading: successLoading } = useQuery<LogsResponse>({
    queryKey: ["logs-success", successPage],
    queryFn: async () => {
      const p = new URLSearchParams({ tab: "success", page: String(successPage), limit: String(LIMIT) });
      const r = await fetch(`${BASE}api/logs?${p}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 3_000,
    staleTime: 2_000,
    enabled: activeTab === "success",
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

  const failedLogs  = failedData?.logs ?? [];
  const failedTotal = failedData?.total ?? 0;
  const successLogs  = successData?.logs ?? [];
  const successTotal = successData?.total ?? 0;

  // ── Delete all success logs from database ────────────────────────────────
  async function handleDeleteSuccess() {
    setDeleting(true);
    try {
      const r = await fetch(`${BASE}api/logs/success`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      setSuccessPage(0);
      await queryClient.invalidateQueries({ queryKey: ["logs-success"] });
      await queryClient.invalidateQueries({ queryKey: ["log-counts"] });
      toast({ title: "Success logs deleted", description: "All success log entries have been permanently removed from the database." });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete success logs. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="w-full space-y-3">
      <Tabs value={activeTab} onValueChange={setActiveTab}>

        {/* ── Tab bar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <div className="overflow-x-auto flex-1">
            <TabsList className="h-8 w-max">

              <TabsTrigger value="failed" className="text-xs px-2.5 sm:px-3 gap-1.5">
                <XCircle className="w-3 h-3 text-destructive" />
                Failed Logs
                {(counts?.failed ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold px-1.5 min-w-[16px] text-center leading-4">
                    {counts!.failed > 99 ? "99+" : counts!.failed}
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger value="success" className="text-xs px-2.5 sm:px-3 gap-1.5">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                Success Logs
                {(counts?.success ?? 0) > 0 && (
                  <span className="ml-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold px-1.5 min-w-[16px] text-center leading-4">
                    {counts!.success > 999 ? "999+" : counts!.success}
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger value="audit" className="text-xs px-2.5 sm:px-3 gap-1.5">
                <History className="w-3 h-3" />
                Audit Logs
              </TabsTrigger>
            </TabsList>
          </div>

          {activeTab === "success" && (
            <Button
              variant="outline" size="sm"
              className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10 self-start sm:self-auto"
              onClick={() => setConfirmOpen(true)}
              disabled={successTotal === 0}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete All
            </Button>
          )}
        </div>

        {/* ── FAILED LOGS ── */}
        <TabsContent value="failed" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <LogTable
                headers={["Time (IST)", "Level", "Category", "Action / Source Route", "Error Details", ""]}
                isLoading={failedLoading}
                isEmpty={failedLogs.length === 0}
                emptyText="No failures in the last 7 days — all API calls are succeeding."
                colSpan={6}
                tableH={TABLE_H}
              >
                {failedLogs.map((log) => <FailedAppLogRow key={log.id} log={log} />)}
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
              <LogTable
                headers={["Time (IST)", "Level", "Category", "Action / Source Route", "Status / Duration", ""]}
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

        {/* ── AUDIT LOGS ── */}
        <TabsContent value="audit" className="mt-0">
          <Card>
            <CardContent className="px-3 pb-3 pt-3">
              <LogTable
                headers={["Time (IST)", "Action", "Field", "Old Value", "New Value", "Description"]}
                isLoading={auditLoading}
                isEmpty={auditLogs.length === 0}
                emptyText="No settings changes recorded yet."
                colSpan={6}
                tableH={TABLE_H}
              >
                {auditLogs.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/40 hover:bg-muted/30 text-xs">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">{fmtIST(entry.changedAt)}</td>
                    <td className="px-2 py-2 font-medium">{entry.action}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-primary">{entry.field ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground max-w-[140px] truncate">{entry.oldValue ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-foreground max-w-[140px] truncate">{entry.newValue ?? "—"}</td>
                    <td className="px-2 py-2 text-[10px] text-muted-foreground">{entry.description ?? "—"}</td>
                  </tr>
                ))}
              </LogTable>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm delete dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all success logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all <strong>{successTotal.toLocaleString()}</strong> success log entries from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSuccess}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {deleting ? "Deleting…" : "Delete All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
