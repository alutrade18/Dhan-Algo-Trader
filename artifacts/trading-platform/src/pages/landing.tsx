import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  TrendingUp, Shield, Zap, BarChart2, Target, Clock,
  CheckCircle, ArrowRight, Layers
} from "lucide-react";

const PLANS = [
  {
    name: "Basic",
    priceMonthly: 2999,
    price3M: 6999,
    price12M: 26999,
    badge: null,
    features: [
      "Live Positions & Order Book",
      "Super Orders (Entry + Target + SL)",
      "Option Chain viewer",
      "Equity curve & P&L dashboard",
      "Telegram alerts",
      "1 Dhan account",
    ],
  },
  {
    name: "Pro",
    priceMonthly: 2999,
    price3M: 6999,
    price12M: 26999,
    badge: "Most Popular",
    features: [
      "Everything in Basic",
      "Unlimited strategies",
      "Backtesting engine",
      "Risk Manager (kill switch, auto SQ-off)",
      "Priority support",
      "Advanced notifications",
    ],
  },
  {
    name: "Elite",
    priceMonthly: 2999,
    price3M: 6999,
    price12M: 26999,
    badge: "Best Value",
    features: [
      "Everything in Pro",
      "Multiple Dhan accounts",
      "Admin analytics",
      "API access",
      "Dedicated onboarding call",
      "White-glove support",
    ],
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/40 px-6 py-4 flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold text-lg tracking-tight">Rajesh Algo</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/sign-in">
            <Button variant="ghost" size="sm">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button size="sm" className="gap-1.5">Get Started <ArrowRight className="w-3.5 h-3.5" /></Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 py-24 text-center">
        <Badge variant="outline" className="mb-6 text-primary border-primary/30 bg-primary/10 px-3 py-1">
          Built for NSE &amp; BSE Intraday Traders
        </Badge>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Algorithmic Trading<br />
          <span className="text-primary">Made Simple</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Connect your Dhan account and trade smarter with Super Orders, live option chains,
          risk management, and automated strategies — all in one platform.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/sign-up">
            <Button size="lg" className="gap-2 px-8">
              Start Free Trial <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
          <Link href="/sign-in">
            <Button size="lg" variant="outline" className="px-8">Sign In</Button>
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">No credit card required · Powered by Dhan API</p>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-12">Everything you need to trade algorithmically</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            { icon: Zap, title: "Super Orders", desc: "Place entry, target & stop-loss in a single bracket order. Auto-calculated at 15% target and 10% SL." },
            { icon: BarChart2, title: "Live Option Chain", desc: "Real-time NSE/BSE option chain with OI, IV, Greeks and ATM auto-scroll." },
            { icon: Shield, title: "Risk Manager", desc: "Kill switch, daily loss limits, auto square-off at 3:14 PM, and PnL exit rules." },
            { icon: TrendingUp, title: "Equity Curve", desc: "Track your portfolio growth over 7D, 30D, 1Y or all-time using your Dhan ledger." },
            { icon: Target, title: "Strategy Engine", desc: "Build, backtest, and automate your trading strategies with visual drag-and-drop." },
            { icon: Clock, title: "Trade History", desc: "Full ledger statement, P&L analysis, and trade logs synced directly from Dhan." },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-border/50 bg-card/60 hover:bg-card transition-colors">
              <CardContent className="p-6">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-7xl mx-auto px-6 py-16">
        <h2 className="text-3xl font-bold text-center mb-3">Simple, Transparent Pricing</h2>
        <p className="text-muted-foreground text-center mb-12">Save more with longer plans</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => (
            <Card
              key={plan.name}
              className={`border-border/50 relative ${plan.badge === "Most Popular" ? "border-primary/60 bg-primary/5" : "bg-card/60"}`}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-3">{plan.badge}</Badge>
                </div>
              )}
              <CardContent className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Layers className="w-4 h-4 text-primary" />
                  <span className="font-bold text-lg">{plan.name}</span>
                </div>
                <div className="space-y-1 mb-6">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-extrabold">₹{plan.priceMonthly.toLocaleString("en-IN")}</span>
                    <span className="text-muted-foreground text-sm">/month</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    ₹{plan.price3M.toLocaleString("en-IN")} for 3 months · ₹{plan.price12M.toLocaleString("en-IN")} annually
                  </div>
                </div>
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link href="/sign-up">
                  <Button className="w-full" variant={plan.badge === "Most Popular" ? "default" : "outline"}>
                    Get Started
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-center text-xs text-muted-foreground mt-8">
          Prices exclusive of GST · Razorpay payments coming soon
        </p>
      </section>

      {/* Disclaimer */}
      <section className="border-t border-border/40 max-w-7xl mx-auto px-6 py-10">
        <p className="text-xs text-muted-foreground text-center leading-relaxed max-w-3xl mx-auto">
          <strong>SEBI Disclaimer:</strong> Rajesh Algo is a technology platform only. It does not provide investment advice,
          recommendations, or portfolio management services. Trading in equity derivatives involves substantial risk of loss.
          Past performance is not indicative of future results. Please read all risk disclosures carefully before trading.
          This platform is not registered with SEBI as an investment adviser.
        </p>
        <p className="text-xs text-muted-foreground text-center mt-4">
          © {new Date().getFullYear()} Rajesh Algo · All rights reserved
        </p>
      </section>
    </div>
  );
}
