import { Layers, Clock } from "lucide-react";

export default function Strategies() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center p-6">
      <div className="rounded-full bg-muted p-5">
        <Layers className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
        <p className="text-muted-foreground text-sm max-w-xs">
          Automated strategy execution is coming soon. Stay tuned!
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4 shrink-0" />
        <span>Coming Soon</span>
      </div>
    </div>
  );
}
