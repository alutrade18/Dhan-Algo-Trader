import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import PaperTrading from "@/pages/paper-trading";
import Settings from "@/pages/settings";
import RiskManager from "@/pages/risk-manager";
import SystemNotifications from "@/pages/system-notifications";
import Logs from "@/pages/logs";
import SuperOrders from "@/pages/super-orders";
import ForeverOrders from "@/pages/forever-orders";
import Conditional from "@/pages/conditional";
import OptionChain from "@/pages/option-chain";
import TradeHistory from "@/pages/trade-history";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/orders" component={Orders} />
        <Route path="/positions" component={Positions} />
        <Route path="/strategies" component={Strategies} />
        <Route path="/backtesting" component={Backtesting} />
        <Route path="/paper-trading" component={PaperTrading} />
        <Route path="/settings" component={Settings} />
        <Route path="/risk-manager" component={RiskManager} />
        <Route path="/system-notifications" component={SystemNotifications} />
        <Route path="/logs" component={Logs} />
        <Route path="/super-orders" component={SuperOrders} />
        <Route path="/forever-orders" component={ForeverOrders} />
        <Route path="/conditional" component={Conditional} />
        <Route path="/option-chain" component={OptionChain} />
        <Route path="/trade-history" component={TradeHistory} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
