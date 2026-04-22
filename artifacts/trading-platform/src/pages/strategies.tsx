import { Layers } from "lucide-react";

export default function Strategies() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center p-6">
      <div className="rounded-full bg-muted p-5">
        <Layers className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">No Strategies Yet</h1>
        <p className="text-muted-foreground text-sm max-w-xs">
          Automated strategy execution will appear here. Use orders and conditional triggers for now.
        </p>
      </div>
    </div>
  );
}
