import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Trash2, Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

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
  system: "bg-muted text-muted-foreground",
};

function LogRow({ log }: { log: AppLog }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(log.details);
  let parsedDetails: Record<string, unknown> | null = null;
  if (hasDetails) {
    try { parsedDetails = JSON.parse(log.details!); } catch { parsedDetails = null; }
  }

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 hover:bg-muted/30 transition-colors text-xs",
          hasDetails && "cursor-pointer"
        )}
        onClick={() => hasDetails && setExpanded(e => !e)}
      >
        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">
          {new Date(log.createdAt).toLocaleString("en-IN", {
            day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
          })}
        </td>
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
        <td className="px-2 py-2 font-medium max-w-[280px] truncate">{log.action}</td>
        <td className="px-2 py-2">
          {log.status && (
            <Badge
              variant={log.status === "success" ? "default" : log.status === "failed" ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {log.status}
            </Badge>
          )}
        </td>
        <td className="px-2 py-2 text-muted-foreground font-mono text-[10px]">
          {log.statusCode ?? "—"}
        </td>
        <td className="px-2 py-2 text-muted-foreground text-[10px]">
          {hasDetails && (
            <span className="text-primary">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
          )}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={7} className="px-4 py-2">
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap break-all font-mono leading-relaxed">
              {parsedDetails ? JSON.stringify(parsedDetails, null, 2) : log.details}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Logs() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [level, setLevel] = useState("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isFetching, refetch } = useQuery<LogsResponse>({
    queryKey: ["app-logs", level, category, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "100" });
      if (level !== "all") params.set("level", level);
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`${BASE}api/logs?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}api/logs`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      toast({ title: "Logs cleared" });
      queryClient.invalidateQueries({ queryKey: ["app-logs"] });
    },
    onError: () => toast({ title: "Failed to clear logs", variant: "destructive" }),
  });

  function handleSearch() {
    setSearch(searchInput);
    setPage(0);
  }

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const LIMIT = 100;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3 pt-4 px-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <div>
              <CardTitle className="text-base">Application Logs</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                All API actions, errors, and system events — auto-refreshes every 10s
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost" size="sm" className="h-8 gap-1.5 text-xs"
                onClick={() => refetch()} disabled={isFetching}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
                Refresh
              </Button>
              <Button
                variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => { if (confirm("Clear all logs?")) clearMutation.mutate(); }}
                disabled={clearMutation.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear All
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="px-4 pb-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={level} onValueChange={v => { setLevel(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[110px] text-xs">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warn">Warn</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={v => { setCategory(v); setPage(0); }}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="broker">Broker</SelectItem>
                <SelectItem value="order">Order</SelectItem>
                <SelectItem value="strategy">Strategy</SelectItem>
                <SelectItem value="settings">Settings</SelectItem>
                <SelectItem value="risk">Risk</SelectItem>
                <SelectItem value="api">API</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-center gap-1 flex-1 min-w-[180px]">
              <Input
                ref={searchRef}
                placeholder="Search action or details…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                className="h-8 text-xs"
              />
              <Button size="sm" className="h-8 px-2" onClick={handleSearch}>
                <Search className="h-3.5 w-3.5" />
              </Button>
            </div>

            <span className="text-xs text-muted-foreground ml-auto shrink-0">
              {total} total {total === 1 ? "entry" : "entries"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full table-auto text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Time</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Level</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Action</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                  <th className="px-2 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Code</th>
                  <th className="px-2 py-2 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td colSpan={7} className="px-3 py-2">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      No logs found — actions like connecting broker, placing orders, or saving settings will appear here
                    </td>
                  </tr>
                ) : (
                  logs.map(log => <LogRow key={log.id} log={log} />)
                )}
              </tbody>
            </table>
          </div>

          {total > LIMIT && (
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline" size="sm" className="text-xs h-7"
                disabled={page === 0}
                onClick={() => setPage(p => Math.max(0, p - 1))}
              >Previous</Button>
              <span className="text-xs text-muted-foreground">
                Page {page + 1} of {Math.ceil(total / LIMIT)}
              </span>
              <Button
                variant="outline" size="sm" className="text-xs h-7"
                disabled={(page + 1) * LIMIT >= total}
                onClick={() => setPage(p => p + 1)}
              >Next</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
