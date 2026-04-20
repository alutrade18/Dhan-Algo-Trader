import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL;

interface AuditEntry {
  id: number; action: string; field: string | null; oldValue: string | null;
  newValue: string | null; description: string | null; changedAt: string;
}

function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

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

export default function Logs() {
  const TABLE_H = "calc(100vh - 220px)";

  const { data: auditLogs = [], isLoading: auditLoading, isError: auditError } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings/audit-log`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    retry: 2,
  });

  return (
    <div className="w-full space-y-3">
      {auditError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load audit logs. The server may be unavailable — retrying automatically.
        </div>
      )}
      <Card>
        <CardContent className="px-3 pb-3 pt-3">
          <LogTable
            headers={["Time (IST)", "Action", "Field", "Old Value", "New Value", "Description"]}
            isLoading={auditLoading}
            isEmpty={!auditError && auditLogs.length === 0}
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
    </div>
  );
}
