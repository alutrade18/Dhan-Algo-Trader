import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/dashboard";
import Orders from "@/pages/orders";
import Positions from "@/pages/positions";
import Strategies from "@/pages/strategies";
import Backtesting from "@/pages/backtesting";
import Settings from "@/pages/settings";
import RiskManager from "@/pages/risk-manager";
import Logs from "@/pages/logs";
import SuperOrders from "@/pages/super-orders";
import OptionChain from "@/pages/option-chain";
import TradeHistory from "@/pages/trade-history";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const BASE = import.meta.env.BASE_URL;

const queryClient = new QueryClient();

function AppRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/">
          <Redirect to="/dashboard" />
        </Route>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/orders" component={Orders} />
        <Route path="/positions" component={Positions} />
        <Route path="/strategies" component={Strategies} />
        <Route path="/backtesting" component={Backtesting} />
        <Route path="/settings" component={Settings} />
        <Route path="/risk-manager" component={RiskManager} />
        <Route path="/logs" component={Logs} />
        <Route path="/super-orders" component={SuperOrders} />
        <Route path="/option-chain" component={OptionChain} />
        <Route path="/trade-history" component={TradeHistory} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

/** Blocks the full layout render until the initial settings fetch resolves. */
function AppInitializer() {
  const { isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings`);
      if (!r.ok) throw new Error("Failed to load settings");
      return r.json();
    },
    staleTime: 30_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground tracking-wide">Initializing…</p>
      </div>
    );
  }

  return <AppRoutes />;
}

function App() {
  return (
    <ThemeProvider>
      <WouterRouter base={basePath}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <AppInitializer />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
