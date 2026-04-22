import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertTriangle, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;
const PER_PAGE = 50;
const MAX_PAGES = 4;

interface AuditEntry {
  id: number; action: string; field: string | null; oldValue: string | null;
  newValue: string | null; description: string | null; changedAt: string;
}
interface AppLog {
  id: number; level: string; category: string; action: string;
  details: string | null; status: string | null; statusCode: number | null;
  createdAt: string;
}
interface PagedResponse<T> { logs: T[]; total: number; page: number; limit: number; }

type TabKey = "audit" | "success" | "failed";

function fmtIST(iso: string) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const ist  = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const dd   = String(ist.getDate()).padStart(2, "0");
    const mm   = String(ist.getMonth() + 1).padStart(2, "0");
    const yyyy = ist.getFullYear();
    const hh   = String(ist.getHours()).padStart(2, "0");
    const min  = String(ist.getMinutes()).padStart(2, "0");
    const ss   = String(ist.getSeconds()).padStart(2, "0");
    return `${dd}-${mm}-${yyyy} ${hh}:${min}:${ss}`;
  } catch { return iso; }
}

function levelColor(level: string) {
  if (level === "error") return "text-destructive font-semibold";
  if (level === "warn")  return "text-warning font-semibold";
  return "text-muted-foreground";
}
function categoryBadge(cat: string) {
  const map: Record<string, string> = {
    order: "bg-primary/10 text-primary", broker: "bg-blue-500/10 text-blue-400",
    risk: "bg-destructive/10 text-destructive", settings: "bg-purple-500/10 text-purple-400",
    strategy: "bg-success/10 text-success", system: "bg-muted text-muted-foreground",
    api: "bg-muted text-muted-foreground",
  };
  return map[cat] ?? "bg-muted text-muted-foreground";
}

function prettyDetails(raw: string | null): string {
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-0.5">{label}</p>
      <p className={cn("text-sm break-words", mono && "font-mono text-xs")}>{value || "—"}</p>
    </div>
  );
}

function AuditDetailModal({ entry, onClose }: { entry: AuditEntry | null; onClose: () => void }) {
  return (
    <Dialog open={!!entry} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">{entry?.action ?? ""}</DialogTitle>
          <DialogDescription className="text-[11px] font-mono">
            {entry ? fmtIST(entry.changedAt) : ""}
          </DialogDescription>
        </DialogHeader>
        {entry && (
          <div className="space-y-4 pt-1">
            <DetailRow label="Field Changed" value={entry.field ?? "—"} mono />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-0.5">Old Value</p>
                <pre className="text-xs font-mono bg-destructive/10 text-destructive rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                  {entry.oldValue ?? "—"}
                </pre>
              </div>
              <div>
                <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-0.5">New Value</p>
                <pre className="text-xs font-mono bg-success/10 text-success rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                  {entry.newValue ?? "—"}
                </pre>
              </div>
            </div>
            {entry.description && <DetailRow label="Description" value={entry.description} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppLogDetailModal({ log, onClose }: { log: AppLog | null; onClose: () => void }) {
  const details = log ? prettyDetails(log.details) : "—";
  return (
    <Dialog open={!!log} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base">{log?.action ?? ""}</DialogTitle>
          <DialogDescription className="text-[11px] font-mono">
            {log ? fmtIST(log.createdAt) : ""}
          </DialogDescription>
        </DialogHeader>
        {log && (
          <div className="space-y-4 pt-1 overflow-y-auto flex-1 pr-1">
            <div className="flex flex-wrap gap-3">
              <span className={cn("text-[10px] font-semibold px-2 py-1 rounded", categoryBadge(log.category))}>
                {log.category}
              </span>
              <span className={cn("text-[10px] font-semibold px-2 py-1 rounded bg-muted uppercase", levelColor(log.level))}>
                {log.level}
              </span>
              {log.statusCode !== null && (
                <span className={cn(
                  "text-[10px] font-mono font-semibold px-2 py-1 rounded",
                  log.statusCode >= 400 ? "bg-destructive/10 text-destructive" : "bg-success/10 text-success"
                )}>
                  HTTP {log.statusCode}
                </span>
              )}
              {log.status && (
                <span className="text-[10px] font-semibold px-2 py-1 rounded bg-muted text-muted-foreground">
                  {log.status}
                </span>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wide mb-1.5">Details</p>
              <pre className="text-[11px] font-mono bg-muted/50 border border-border rounded-md p-3 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words max-h-72 leading-relaxed">
                {details}
              </pre>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TableShell({ headers, isLoading, isEmpty, emptyText, colSpan, children }: {
  headers: string[]; isLoading: boolean; isEmpty: boolean;
  emptyText: string; colSpan: number; children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border" style={{ maxHeight: "calc(100vh - 280px)", minHeight: 220, overflowY: "auto" }}>
      <table className="w-full table-auto text-sm" style={{ minWidth: 520 }}>
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-border bg-muted/90 backdrop-blur text-left">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                {h}
              </th>
            ))}
            <th className="px-2 py-2.5 w-6" />
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td colSpan={colSpan + 1} className="px-3 py-2.5">
                    <Skeleton className="h-3.5 w-full" />
                  </td>
                </tr>
              ))
            : isEmpty
              ? <tr><td colSpan={colSpan + 1} className="px-4 py-16 text-center text-sm text-muted-foreground">{emptyText}</td></tr>
              : children}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({ page, total, onPrev, onNext }: {
  page: number; total: number; onPrev: () => void; onNext: () => void;
}) {
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PER_PAGE)));
  const hasMore = total > MAX_PAGES * PER_PAGE;
  const from = total === 0 ? 0 : page * PER_PAGE + 1;
  const to = Math.min((page + 1) * PER_PAGE, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <span className="shrink-0">
        {total > 0 ? `${from}–${to} of ${total}${hasMore ? "+" : ""} entries` : "No entries"}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev} disabled={page === 0}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="px-2 font-medium text-foreground whitespace-nowrap">
          Page {page + 1} / {totalPages}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext} disabled={page >= totalPages - 1}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AuditLogsView() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const { data, isLoading, isError } = useQuery<PagedResponse<AuditEntry>>({
    queryKey: ["audit-log", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings/audit-log?page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000, retry: 2,
  });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  return (
    <>
      {isError && <ErrorBanner />}
      <AuditDetailModal entry={selected} onClose={() => setSelected(null)} />
      <TableShell
        headers={["Time (IST)", "Action", "Field", "Old Value", "New Value", "Description"]}
        isLoading={isLoading} isEmpty={!isError && logs.length === 0}
        emptyText="No settings changes recorded yet." colSpan={6}
      >
        {logs.map((e) => (
          <tr
            key={e.id}
            className="border-b border-border/40 hover:bg-muted/40 cursor-pointer transition-colors"
            onClick={() => setSelected(e)}
          >
            <td className="px-3 py-2.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.changedAt)}</td>
            <td className="px-2 py-2.5 text-xs font-medium whitespace-nowrap">{e.action}</td>
            <td className="px-2 py-2.5 text-[10px] font-mono text-primary whitespace-nowrap">{e.field ?? "—"}</td>
            <td className="px-2 py-2.5 text-[10px] font-mono text-muted-foreground max-w-[100px] truncate">{e.oldValue ?? "—"}</td>
            <td className="px-2 py-2.5 text-[10px] font-mono text-foreground max-w-[100px] truncate">{e.newValue ?? "—"}</td>
            <td className="px-2 py-2.5 text-[10px] text-muted-foreground max-w-[140px] truncate">{e.description ?? "—"}</td>
            <td className="px-2 py-2.5 text-muted-foreground/50">
              <ChevronRight className="w-3 h-3" />
            </td>
          </tr>
        ))}
      </TableShell>
      <Pagination page={page} total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </>
  );
}

function SuccessLogsView() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AppLog | null>(null);
  const { data, isLoading, isError } = useQuery<PagedResponse<AppLog>>({
    queryKey: ["logs-success", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=success&page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000, retry: 2,
  });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  return (
    <>
      {isError && <ErrorBanner />}
      <AppLogDetailModal log={selected} onClose={() => setSelected(null)} />
      <TableShell
        headers={["Time (IST)", "Category", "Action", "Code", "Details"]}
        isLoading={isLoading} isEmpty={!isError && logs.length === 0}
        emptyText="No success logs recorded yet." colSpan={5}
      >
        {logs.map((e) => (
          <tr
            key={e.id}
            className="border-b border-border/40 hover:bg-muted/40 cursor-pointer transition-colors"
            onClick={() => setSelected(e)}
          >
            <td className="px-3 py-2.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.createdAt)}</td>
            <td className="px-2 py-2.5">
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap", categoryBadge(e.category))}>
                {e.category}
              </span>
            </td>
            <td className="px-2 py-2.5 text-xs font-medium whitespace-nowrap">{e.action}</td>
            <td className="px-2 py-2.5 text-[10px] font-mono text-success whitespace-nowrap">{e.statusCode ?? "—"}</td>
            <td className="px-2 py-2.5 text-[10px] text-muted-foreground max-w-[180px] truncate">{e.details ?? "—"}</td>
            <td className="px-2 py-2.5 text-muted-foreground/50">
              <ChevronRight className="w-3 h-3" />
            </td>
          </tr>
        ))}
      </TableShell>
      <Pagination page={page} total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </>
  );
}

function FailedLogsView() {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AppLog | null>(null);
  const { data, isLoading, isError } = useQuery<PagedResponse<AppLog>>({
    queryKey: ["logs-failed", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=failed&page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000, retry: 2,
  });
  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  return (
    <>
      {isError && <ErrorBanner />}
      <AppLogDetailModal log={selected} onClose={() => setSelected(null)} />
      <TableShell
        headers={["Time (IST)", "Category", "Level", "Action", "Code", "Details"]}
        isLoading={isLoading} isEmpty={!isError && logs.length === 0}
        emptyText="No failed logs recorded yet." colSpan={6}
      >
        {logs.map((e) => (
          <tr
            key={e.id}
            className="border-b border-border/40 hover:bg-muted/40 cursor-pointer transition-colors"
            onClick={() => setSelected(e)}
          >
            <td className="px-3 py-2.5 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.createdAt)}</td>
            <td className="px-2 py-2.5">
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap", categoryBadge(e.category))}>
                {e.category}
              </span>
            </td>
            <td className={cn("px-2 py-2.5 text-[10px] uppercase whitespace-nowrap", levelColor(e.level))}>{e.level}</td>
            <td className="px-2 py-2.5 text-xs font-medium whitespace-nowrap">{e.action}</td>
            <td className="px-2 py-2.5 text-[10px] font-mono text-destructive whitespace-nowrap">{e.statusCode ?? "—"}</td>
            <td className="px-2 py-2.5 text-[10px] text-muted-foreground max-w-[160px] truncate">{e.details ?? "—"}</td>
            <td className="px-2 py-2.5 text-muted-foreground/50">
              <ChevronRight className="w-3 h-3" />
            </td>
          </tr>
        ))}
      </TableShell>
      <Pagination page={page} total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </>
  );
}

function ErrorBanner() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-3">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      Failed to load — retrying automatically.
    </div>
  );
}

function CountBadge({ count }: { count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-muted text-muted-foreground leading-none">
      {count > 9999 ? "9999+" : count}
    </span>
  );
}

export default function Logs() {
  const [activeTab, setActiveTab] = useState<TabKey>("audit");

  const { data: auditCount } = useQuery<{ total: number }>({
    queryKey: ["audit-log-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings/audit-log?page=0&limit=1`);
      if (!r.ok) throw new Error();
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: successCount } = useQuery<{ total: number }>({
    queryKey: ["logs-success-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=success&page=0&limit=1`);
      if (!r.ok) throw new Error();
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const { data: failedCount } = useQuery<{ total: number }>({
    queryKey: ["logs-failed-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=failed&page=0&limit=1`);
      if (!r.ok) throw new Error();
      return r.json();
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; iconClass: string; count: number | undefined }[] = [
    { key: "audit",   label: "Audit Logs",   icon: <ClipboardList className="w-3.5 h-3.5" />, iconClass: "text-purple-400", count: auditCount?.total   },
    { key: "success", label: "Success Logs", icon: <CheckCircle2  className="w-3.5 h-3.5" />, iconClass: "text-success",    count: successCount?.total },
    { key: "failed",  label: "Failed Logs",  icon: <XCircle       className="w-3.5 h-3.5" />, iconClass: "text-destructive", count: failedCount?.total  },
  ];

  return (
    <div className="w-full">
      <Card>
        <div className="flex flex-wrap gap-1 p-3 pb-0 border-b border-border">
          {TABS.map(({ key, label, icon, iconClass, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-md border-b-2 transition-colors whitespace-nowrap",
                activeTab === key
                  ? "border-primary text-foreground bg-muted/40"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
              )}
            >
              <span className={activeTab === key ? iconClass : ""}>{icon}</span>
              <span className="hidden sm:inline">{label}</span>
              <span className="sm:hidden">{label.split(" ")[0]}</span>
              <CountBadge count={count} />
            </button>
          ))}
        </div>

        <CardContent className="p-3 sm:p-4">
          {activeTab === "audit"   && <AuditLogsView />}
          {activeTab === "success" && <SuccessLogsView />}
          {activeTab === "failed"  && <FailedLogsView />}
        </CardContent>
      </Card>
    </div>
  );
}
