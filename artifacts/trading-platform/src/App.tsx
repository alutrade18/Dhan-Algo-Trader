import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { lazy, Suspense, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/layout/app-layout";
import { ThemeProvider } from "@/lib/theme";
import NotFound from "@/pages/not-found";
import { marketSocket } from "@/lib/market-socket";

const Dashboard    = lazy(() => import("@/pages/dashboard"));
const Charts       = lazy(() => import("@/pages/charts"));
const Orders       = lazy(() => import("@/pages/orders"));
const Positions    = lazy(() => import("@/pages/positions"));
const Strategies   = lazy(() => import("@/pages/strategies"));
const Settings     = lazy(() => import("@/pages/settings"));
const RiskManager  = lazy(() => import("@/pages/risk-manager"));
const Logs         = lazy(() => import("@/pages/logs"));
const OptionChain  = lazy(() => import("@/pages/option-chain"));
const TradeHistory = lazy(() => import("@/pages/trade-history"));

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const BASE = import.meta.env.BASE_URL;

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    </div>
  );
}

function SocketInitializer() {
  useEffect(() => {
    void marketSocket.init(() => Promise.resolve(null));
  }, []);
  return null;
}

function AppRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/">
            <Redirect to="/dashboard" />
          </Route>
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/charts" component={Charts} />
          <Route path="/orders" component={Orders} />
          <Route path="/positions" component={Positions} />
          <Route path="/strategies" component={Strategies} />
          <Route path="/settings" component={Settings} />
          <Route path="/risk-manager" component={RiskManager} />
          <Route path="/logs" component={Logs} />
          <Route path="/option-chain" component={OptionChain} />
          <Route path="/trade-history" component={TradeHistory} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function AppInitializer() {
  const { isLoading, isError, refetch } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const r = await fetch(`${BASE}api/settings`);
      if (!r.ok) throw new Error("Failed to load settings");
      return r.json();
    },
    staleTime: 30_000,
    retry: 2,
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

  if (isError) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-background px-4">
        <div className="rounded-full bg-destructive/10 p-4">
          <svg className="h-8 w-8 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-foreground">Unable to connect to server</p>
          <p className="text-xs text-muted-foreground max-w-xs">The API server is not responding. Check that the backend is running.</p>
        </div>
        <button
          onClick={() => void refetch()}
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <SocketInitializer />
      <AppRoutes />
      <Toaster />
    </>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={basePath}>
            <AppInitializer />
          </WouterRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
