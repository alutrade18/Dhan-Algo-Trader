import { BarChart2 } from "lucide-react";

export default function Backtesting() {
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] gap-5 text-center">
      <div className="rounded-full bg-primary/10 p-5">
        <BarChart2 className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Backtesting</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          Replay historical market data against your strategy logic to measure performance before trading live.
        </p>
      </div>
      <span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-medium text-primary tracking-wide uppercase">
        Coming Soon
      </span>
    </div>
  );
}
