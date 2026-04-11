import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { useHealthCheck } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Activity } from "lucide-react";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { data: health, isLoading } = useHealthCheck();

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 border-b border-border bg-card/50 backdrop-blur flex items-center justify-between px-6 shrink-0">
          <h2 className="font-semibold text-lg tracking-tight">Market Overview</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-mono">SYSTEM:</span>
              {isLoading ? (
                <Badge variant="outline" className="text-muted-foreground">CHECKING</Badge>
              ) : health?.status === "ok" ? (
                <Badge variant="outline" className="text-success border-success/30 bg-success/10 gap-1.5 rounded-sm">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                  ONLINE
                </Badge>
              ) : (
                <Badge variant="destructive" className="rounded-sm">OFFLINE</Badge>
              )}
            </div>
            <div className="h-4 w-[1px] bg-border" />
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-mono tracking-tighter">NSE: LIVE</span>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-[1400px]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
