import { useState } from "react";
import { Layers, Clock } from "lucide-react";

function StrategyToggle({ label, enabled, onToggle }: { label: string; enabled: boolean; onToggle: () => void }) {
  return (
    <div className="w-full max-w-sm border rounded-xl p-4 bg-card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{label}</span>
        <button
          onClick={onToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
            enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4 shrink-0" />
          <span>Coming Soon — This feature is under development.</span>
        </div>
      )}
    </div>
  );
}

export default function Strategies() {
  const [indicatorEnabled, setIndicatorEnabled] = useState(false);
  const [pythonEnabled, setPythonEnabled] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center p-6">
      <div className="rounded-full bg-muted p-5">
        <Layers className="h-10 w-10 text-muted-foreground" />
      </div>

      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">Strategies</h1>
        <p className="text-muted-foreground text-sm max-w-xs">
          Choose a strategy type to get started. More features coming soon.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        <StrategyToggle
          label="Indicator Strategy"
          enabled={indicatorEnabled}
          onToggle={() => setIndicatorEnabled((v) => !v)}
        />
        <StrategyToggle
          label="Python Strategy"
          enabled={pythonEnabled}
          onToggle={() => setPythonEnabled((v) => !v)}
        />
      </div>
    </div>
  );
}
