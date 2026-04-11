import { Link, useLocation } from "wouter";
import { 
  Activity, 
  BarChart2, 
  Briefcase, 
  Clock, 
  FileText, 
  FlaskConical,
  LayoutDashboard, 
  List, 
  Settings, 
  ShieldAlert, 
  TerminalSquare,
  PlayCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: List },
  { href: "/positions", label: "Positions", icon: Briefcase },
  { href: "/holdings", label: "Holdings", icon: FileText },
  { href: "/strategies", label: "Strategies", icon: TerminalSquare },
  { href: "/backtesting", label: "Backtesting", icon: FlaskConical },
  { href: "/paper-trading", label: "Paper Trading", icon: PlayCircle },
  { href: "/trades", label: "Trade Book", icon: Activity },
  { href: "/trade-logs", label: "Trade Logs", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="w-64 border-r border-border bg-sidebar flex flex-col h-screen overflow-y-auto">
      <div className="p-4 flex items-center gap-2 border-b border-sidebar-border">
        <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
          <BarChart2 className="w-5 h-5" />
        </div>
        <span className="font-bold text-lg tracking-tight text-sidebar-foreground">DhanAlgo</span>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldAlert className="w-3 h-3" />
          <span>Connection Secure</span>
        </div>
      </div>
    </div>
  );
}
