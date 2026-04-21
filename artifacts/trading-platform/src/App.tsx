import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClerkProvider,
  SignIn,
  SignUp,
  Show,
  useAuth,
  useClerk,
} from "@clerk/react";
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

// NOTE: in dev this env var will be empty; in production it is auto-set by Replit
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL as string | undefined;

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

// Clerk passes full paths — strip the base prefix so Wouter doesn't double it
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

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

// Invalidates React Query cache when the signed-in user changes
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

// Wires Socket.IO with Clerk token — web API calls use session cookies automatically
function SocketAuthInitializer() {
  const { getToken } = useAuth();
  useEffect(() => {
    void marketSocket.init(getToken);
  }, [getToken]);
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

  return <AppRoutes />;
}

function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
      />
    </div>
  );
}

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
      />
    </div>
  );
}

// For protected routes: show app if signed in, redirect to sign-in if not
function ProtectedApp() {
  return (
    <>
      <Show when="signed-in">
        <SocketAuthInitializer />
        <AppInitializer />
        <Toaster />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function AppRouter() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ProtectedApp} />
          </Switch>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <WouterRouter base={basePath}>
        <AppRouter />
      </WouterRouter>
    </ThemeProvider>
  );
}

export default App;
