import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, RefreshCw, Info, AlertCircle } from "lucide-react";
import { apiFetch, type AppLog } from "@/lib/api";
import { formatDate } from "@/lib/utils";

function LevelIcon({ level }: { level: string }) {
  if (level === "error") return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  if (level === "warn") return <AlertTriangle className="w-3.5 h-3.5 text-warning" />;
  return <Info className="w-3.5 h-3.5 text-primary" />;
}

function LevelBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    error: "log-error",
    warn: "log-warn",
    info: "log-info",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${cls[level] ?? "bg-muted text-muted-foreground"}`}>
      {level}
    </span>
  );
}

export default function LogsPage() {
  const [filter, setFilter] = useState<"all" | "error" | "warn" | "info">("all");

  const { data: logs = [], isLoading, refetch, isFetching } = useQuery<AppLog[]>({
    queryKey: ["admin-logs"],
    queryFn: () => apiFetch("/admin/logs?limit=200"),
    refetchInterval: 30000,
  });

  const filtered = filter === "all" ? logs : logs.filter(l => l.level === filter);

  const counts = {
    all: logs.length,
    error: logs.filter(l => l.level === "error").length,
    warn: logs.filter(l => l.level === "warn").length,
    info: logs.filter(l => l.level === "info").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-primary" />
            System Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Latest 200 application log entries</p>
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

      <div className="flex gap-2">
        {(["all", "error", "warn", "info"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              filter === f
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All" : f.toUpperCase()}
            <span className="ml-1.5 opacity-70">({counts[f]})</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="bg-card border border-card-border rounded-lg h-12 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-card border border-card-border rounded-lg p-12 text-center">
          <Info className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No logs found</p>
        </div>
      ) : (
        <div className="bg-card border border-card-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-muted/80 backdrop-blur-sm">
                  <th className="table-header-cell text-left px-4 py-3">Level</th>
                  <th className="table-header-cell text-left px-4 py-3">Category</th>
                  <th className="table-header-cell text-left px-4 py-3">Action</th>
                  <th className="table-header-cell text-left px-4 py-3">Details</th>
                  <th className="table-header-cell text-center px-4 py-3">Status</th>
                  <th className="table-header-cell text-left px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr key={log.id} className="border-b border-border/40 table-row-hover">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <LevelIcon level={log.level} />
                        <LevelBadge level={log.level} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-muted-foreground font-mono">{log.category}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-foreground">{log.action}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-muted-foreground max-w-xs truncate block">
                        {log.details ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {log.statusCode ? (
                        <span className={`text-xs font-mono ${
                          log.statusCode >= 400 ? "text-destructive" : "text-success"
                        }`}>
                          {log.statusCode}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(log.createdAt)}</span>
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
