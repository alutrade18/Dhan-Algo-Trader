import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ChevronLeft, ChevronRight, CheckCircle2, XCircle, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL;
const PER_PAGE = 50;
const MAX_PAGES = 4;

// ── Types ─────────────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

function levelColor(level: string) {
  if (level === "error") return "text-destructive";
  if (level === "warn")  return "text-warning";
  return "text-muted-foreground";
}

function categoryBadge(cat: string) {
  const colors: Record<string, string> = {
    order: "bg-primary/10 text-primary",
    broker: "bg-blue-500/10 text-blue-400",
    risk: "bg-destructive/10 text-destructive",
    settings: "bg-purple-500/10 text-purple-400",
    strategy: "bg-success/10 text-success",
    system: "bg-muted text-muted-foreground",
    api: "bg-muted text-muted-foreground",
  };
  return colors[cat] ?? "bg-muted text-muted-foreground";
}

// ── Shared table shell ────────────────────────────────────────────────────────
function TableShell({ headers, isLoading, isEmpty, emptyText, colSpan, children }: {
  headers: string[]; isLoading: boolean; isEmpty: boolean;
  emptyText: string; colSpan: number; children: React.ReactNode;
}) {
  return (
    <div className="overflow-auto rounded-md border border-border max-h-[420px]">
      <table className="w-full min-w-[600px] table-auto text-sm">
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
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td colSpan={colSpan} className="px-3 py-2">
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))
            : isEmpty
              ? <tr><td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-muted-foreground">{emptyText}</td></tr>
              : children}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagination bar ────────────────────────────────────────────────────────────
function Pagination({ page, total, onPrev, onNext }: {
  page: number; total: number; onPrev: () => void; onNext: () => void;
}) {
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PER_PAGE)));
  const hasMore = total > MAX_PAGES * PER_PAGE;
  return (
    <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
      <span>
        {total > 0
          ? `${page * PER_PAGE + 1}–${Math.min((page + 1) * PER_PAGE, total)} of ${total}${hasMore ? "+" : ""} entries`
          : "0 entries"}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onPrev} disabled={page === 0}>
          <ChevronLeft className="w-3.5 h-3.5" />
        </Button>
        <span className="px-2 font-medium text-foreground">Page {page + 1} / {totalPages}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onNext} disabled={page >= totalPages - 1}>
          <ChevronRight className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function LogSection({ icon, title, iconClass, children }: {
  icon: React.ReactNode; title: string; iconClass: string; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className={iconClass}>{icon}</span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">{children}</CardContent>
    </Card>
  );
}

// ── 1. Audit Logs ─────────────────────────────────────────────────────────────
function AuditLogsTable() {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useQuery<PagedResponse<AuditEntry>>({
    queryKey: ["audit-log", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings/audit-log?page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    retry: 2,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <LogSection
      icon={<ClipboardList className="w-4 h-4" />}
      title="Audit Logs — Settings Changes"
      iconClass="text-purple-400"
    >
      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Failed to load — retrying automatically.
        </div>
      )}
      <TableShell
        headers={["Time (IST)", "Action", "Field", "Old Value", "New Value", "Description"]}
        isLoading={isLoading}
        isEmpty={!isError && logs.length === 0}
        emptyText="No settings changes recorded yet."
        colSpan={6}
      >
        {logs.map((e) => (
          <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
            <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.changedAt)}</td>
            <td className="px-2 py-2 text-xs font-medium">{e.action}</td>
            <td className="px-2 py-2 text-[10px] font-mono text-primary">{e.field ?? "—"}</td>
            <td className="px-2 py-2 text-[10px] font-mono text-muted-foreground max-w-[130px] truncate">{e.oldValue ?? "—"}</td>
            <td className="px-2 py-2 text-[10px] font-mono text-foreground max-w-[130px] truncate">{e.newValue ?? "—"}</td>
            <td className="px-2 py-2 text-[10px] text-muted-foreground max-w-[160px] truncate">{e.description ?? "—"}</td>
          </tr>
        ))}
      </TableShell>
      <Pagination
        page={page}
        total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </LogSection>
  );
}

// ── 2. Success Logs ───────────────────────────────────────────────────────────
function SuccessLogsTable() {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useQuery<PagedResponse<AppLog>>({
    queryKey: ["logs-success", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=success&page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    retry: 2,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <LogSection
      icon={<CheckCircle2 className="w-4 h-4" />}
      title="Success Logs"
      iconClass="text-success"
    >
      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Failed to load — retrying automatically.
        </div>
      )}
      <TableShell
        headers={["Time (IST)", "Category", "Action", "Status Code", "Details"]}
        isLoading={isLoading}
        isEmpty={!isError && logs.length === 0}
        emptyText="No success logs recorded yet."
        colSpan={5}
      >
        {logs.map((e) => (
          <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
            <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.createdAt)}</td>
            <td className="px-2 py-2">
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", categoryBadge(e.category))}>
                {e.category}
              </span>
            </td>
            <td className="px-2 py-2 text-xs font-medium">{e.action}</td>
            <td className="px-2 py-2 text-[10px] font-mono text-success">{e.statusCode ?? "—"}</td>
            <td className="px-2 py-2 text-[10px] text-muted-foreground max-w-[220px] truncate" title={e.details ?? ""}>
              {e.details ?? "—"}
            </td>
          </tr>
        ))}
      </TableShell>
      <Pagination
        page={page}
        total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </LogSection>
  );
}

// ── 3. Failed Logs ────────────────────────────────────────────────────────────
function FailedLogsTable() {
  const [page, setPage] = useState(0);

  const { data, isLoading, isError } = useQuery<PagedResponse<AppLog>>({
    queryKey: ["logs-failed", page],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/logs?tab=failed&page=${page}&limit=${PER_PAGE}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    retry: 2,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <LogSection
      icon={<XCircle className="w-4 h-4" />}
      title="Failed Logs"
      iconClass="text-destructive"
    >
      {isError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Failed to load — retrying automatically.
        </div>
      )}
      <TableShell
        headers={["Time (IST)", "Category", "Level", "Action", "Status Code", "Details"]}
        isLoading={isLoading}
        isEmpty={!isError && logs.length === 0}
        emptyText="No failed logs recorded yet."
        colSpan={6}
      >
        {logs.map((e) => (
          <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
            <td className="px-3 py-2 text-[10px] font-mono text-muted-foreground whitespace-nowrap">{fmtIST(e.createdAt)}</td>
            <td className="px-2 py-2">
              <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded", categoryBadge(e.category))}>
                {e.category}
              </span>
            </td>
            <td className={cn("px-2 py-2 text-[10px] font-semibold uppercase", levelColor(e.level))}>{e.level}</td>
            <td className="px-2 py-2 text-xs font-medium">{e.action}</td>
            <td className="px-2 py-2 text-[10px] font-mono text-destructive">{e.statusCode ?? "—"}</td>
            <td className="px-2 py-2 text-[10px] text-muted-foreground max-w-[200px] truncate" title={e.details ?? ""}>
              {e.details ?? "—"}
            </td>
          </tr>
        ))}
      </TableShell>
      <Pagination
        page={page}
        total={total}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => Math.min(MAX_PAGES - 1, p + 1))}
      />
    </LogSection>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function Logs() {
  return (
    <div className="w-full space-y-4">
      <AuditLogsTable />
      <SuccessLogsTable />
      <FailedLogsTable />
    </div>
  );
}
