import { Layers } from "lucide-react";

export default function Strategies() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center p-6">
      <div className="rounded-full bg-primary/10 p-5">
        <Layers className="h-10 w-10 text-primary" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
        <p className="text-muted-foreground text-sm max-w-xs">
          Strategy builder is coming soon. Build, backtest, and deploy custom trading strategies with one click.
        </p>
      </div>
      <span className="rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-medium text-primary tracking-wide uppercase">
        Coming Soon
      </span>
    </div>
  );
}
