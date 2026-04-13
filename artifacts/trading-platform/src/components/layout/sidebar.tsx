import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  List,
  Briefcase,
  TerminalSquare,
  FlaskConical,
  Settings,
  ShieldAlert,
  X,
  ScrollText,
  Layers,
  LineChart,
  BookOpen,
  ShieldCheck,
  BellRing,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "TRADING",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/positions", label: "Positions", icon: Briefcase },
      { href: "/orders", label: "Order Book", icon: List },
      { href: "/option-chain", label: "Option Chain", icon: LineChart },
      { href: "/super-orders", label: "Super Orders", icon: Layers },
      { href: "/trade-history", label: "Ledger Statement", icon: BookOpen },
    ],
  },
  {
    label: "AUTOMATION",
    items: [
      { href: "/strategies", label: "Strategies", icon: TerminalSquare },
      { href: "/backtesting", label: "Backtesting", icon: FlaskConical },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { href: "/logs", label: "Logs", icon: ScrollText },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/system-notifications", label: "Notifications", icon: BellRing },
      { href: "/risk-manager", label: "Risk Manager", icon: ShieldCheck },
    ],
  },
];

function BullIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6c0 0 1-2 4-2s4 2 4 2" />
      <path d="M2 4c0 0 0 2 2 3" />
      <path d="M14 4c0 0 0 2-2 3" />
      <ellipse cx="9" cy="10" rx="5" ry="4" />
      <path d="M7 14l-2 6" />
      <path d="M11 14l2 6" />
      <circle cx="7" cy="9" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="11" cy="9" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  brokerConnected?: boolean | null;
}

export function Sidebar({ isOpen, onClose, brokerConnected }: SidebarProps) {
  const [location] = useLocation();

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      <div
        className={cn(
          "fixed md:relative z-40 md:z-auto flex flex-col h-screen bg-sidebar border-sidebar-border transition-all duration-300 ease-in-out",
          isOpen
            ? "translate-x-0 w-64 border-r shrink-0"
            : "-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-r-0"
        )}
      >
        <div className="h-14 px-4 flex items-center justify-between border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="relative bg-primary text-primary-foreground p-1.5 rounded-md">
              <BullIcon className="w-5 h-5" />
              {brokerConnected != null && (
                <span
                  className={cn(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar ring-1 ring-sidebar",
                    brokerConnected
                      ? "bg-green-500"
                      : "bg-yellow-400"
                  )}
                  title={brokerConnected ? "Broker connected" : "Broker not connected"}
                />
              )}
            </div>
            <span className="font-bold text-lg tracking-tight text-sidebar-foreground">Rajesh Algo</span>
          </div>
          <button
            onClick={onClose}
            className="md:hidden text-sidebar-foreground/60 hover:text-sidebar-foreground p-1 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <p className="px-3 py-1 text-[10px] font-semibold tracking-widest text-sidebar-foreground/30 uppercase">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        onClick={() => { if (window.innerWidth < 768) onClose(); }}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        <item.icon className={cn("w-4 h-4 shrink-0", isActive ? "text-primary" : "")} />
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="w-3 h-3" />
            <span>Connection Secure</span>
          </div>
        </div>
      </div>
    </>
  );
}
