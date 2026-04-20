import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp, TrendingDown, Minus, Zap,
  ChevronRight, Info, X, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

type Direction = "bullish" | "bearish" | "neutral" | "any";
type LegSide = "BUY" | "SELL";
type OptionType = "CE" | "PE";

interface Leg {
  side: LegSide;
  type: OptionType;
  strikeOffset: number; // 0 = ATM, positive = OTM away from money, negative = ITM
  strikeLabel: string; // e.g. "ATM", "ATM+100", "ATM-100"
  qty: number; // lot multiplier (1 or 2)
}

interface ReadyMadeStrategy {
  id: string;
  name: string;
  direction: Direction;
  description: string;
  maxProfit: string;
  maxLoss: string;
  legs: Leg[];
  netPremium: "debit" | "credit" | "varies";
  idealWhen: string;
}

// ─── Strategy Definitions ─────────────────────────────────────────────────────

const STRATEGIES: ReadyMadeStrategy[] = [
  // ── Bullish ──────────────────────────────────────────────────────────────
  {
    id: "bull-call-spread",
    name: "Bull Call Spread",
    direction: "bullish",
    description: "Buy a lower-strike CE and sell a higher-strike CE on the same expiry. Capped profit, capped loss. Costs less premium than buying a naked call.",
    maxProfit: "Difference between strikes minus net premium paid",
    maxLoss: "Net premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Moderately bullish — expecting a rise but not a runaway rally.",
    legs: [
      { side: "BUY",  type: "CE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100",  qty: 1 },
    ],
  },
  {
    id: "bull-put-spread",
    name: "Bull Put Spread",
    direction: "bullish",
    description: "Sell a lower-strike PE and buy a higher-strike PE. Collect upfront premium. Profit if market stays flat or rises above the short strike.",
    maxProfit: "Net credit received",
    maxLoss: "Difference between strikes minus net credit (limited)",
    netPremium: "credit",
    idealWhen: "Mildly bullish or sideways — comfortable being near support.",
    legs: [
      { side: "SELL", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100",  qty: 1 },
      { side: "BUY",  type: "PE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
    ],
  },
  {
    id: "call-ratio-spread",
    name: "Call Ratio Spread",
    direction: "bullish",
    description: "Buy 1 ATM CE and sell 2 OTM CEs. Low cost or even free entry. Profits if market moves up moderately — but loses if it rockets past the short strikes.",
    maxProfit: "At short strike expiry",
    maxLoss: "Unlimited above breakeven (if sold calls outrun)",
    netPremium: "varies",
    idealWhen: "Moderately bullish with expectation of limited upside.",
    legs: [
      { side: "BUY",  type: "CE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100",  qty: 2 },
    ],
  },

  // ── Bearish ───────────────────────────────────────────────────────────────
  {
    id: "put-ratio-spread",
    name: "Put Ratio Spread",
    direction: "bearish",
    description: "Buy 1 ATM PE and sell 2 OTM PEs. Low-cost bearish trade. Profits if market falls moderately — loses if it crashes past both short puts.",
    maxProfit: "At short strike expiry",
    maxLoss: "Unlimited below breakeven",
    netPremium: "varies",
    idealWhen: "Moderately bearish with expectation of limited downside.",
    legs: [
      { side: "BUY",  type: "PE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100",  qty: 2 },
    ],
  },
  {
    id: "bear-call-spread",
    name: "Bear Call Spread",
    direction: "bearish",
    description: "Sell a lower-strike CE and buy a higher-strike CE. Collect net credit. Profit if market stays flat or falls below the short strike.",
    maxProfit: "Net credit received",
    maxLoss: "Difference between strikes minus net credit (limited)",
    netPremium: "credit",
    idealWhen: "Mildly bearish or sideways — comfortable being near resistance.",
    legs: [
      { side: "SELL", type: "CE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "BUY",  type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100",  qty: 1 },
    ],
  },
  {
    id: "bear-put-spread",
    name: "Bear Put Spread",
    direction: "bearish",
    description: "Buy a higher-strike PE and sell a lower-strike PE. Pay net debit. Profit if market falls below the long put minus premium paid.",
    maxProfit: "Difference between strikes minus net premium paid",
    maxLoss: "Net premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Moderately bearish — expecting a controlled fall, not a freefall.",
    legs: [
      { side: "BUY",  type: "PE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100",  qty: 1 },
    ],
  },

  // ── Non-Directional ───────────────────────────────────────────────────────
  {
    id: "short-straddle",
    name: "Short Straddle",
    direction: "neutral",
    description: "Sell ATM CE and ATM PE simultaneously. Collect maximum premium. Profits if market stays near ATM until expiry. Unlimited loss if market moves sharply either way.",
    maxProfit: "Total premium received",
    maxLoss: "Unlimited (both sides)",
    netPremium: "credit",
    idealWhen: "Market expected to remain range-bound around ATM. Low VIX environment.",
    legs: [
      { side: "SELL", type: "CE", strikeOffset: 0, strikeLabel: "ATM", qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: 0, strikeLabel: "ATM", qty: 1 },
    ],
  },
  {
    id: "short-strangle",
    name: "Short Strangle",
    direction: "neutral",
    description: "Sell OTM CE and OTM PE. Wider profit zone than Short Straddle but lower premium collected. Profits as long as market stays between the two strikes.",
    maxProfit: "Net premium received",
    maxLoss: "Unlimited (both sides)",
    netPremium: "credit",
    idealWhen: "Market expected to remain range-bound. More forgiving than a straddle.",
    legs: [
      { side: "SELL", type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100", qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100", qty: 1 },
    ],
  },
  {
    id: "short-iron-butterfly",
    name: "Short Iron Butterfly",
    direction: "neutral",
    description: "Sell ATM CE + ATM PE, buy OTM CE + OTM PE as protection. Defined risk version of Short Straddle. Maximum profit at ATM at expiry.",
    maxProfit: "Net credit received",
    maxLoss: "Width of wing minus net credit (limited — protected by wings)",
    netPremium: "credit",
    idealWhen: "Expecting very low movement around current price. Defined risk preference.",
    legs: [
      { side: "BUY",  type: "CE", strikeOffset: 200,  strikeLabel: "ATM+200", qty: 1 },
      { side: "SELL", type: "CE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "BUY",  type: "PE", strikeOffset: -200, strikeLabel: "ATM-200", qty: 1 },
    ],
  },
  {
    id: "short-iron-condor",
    name: "Short Iron Condor",
    direction: "neutral",
    description: "Sell OTM CE + OTM PE (inner strikes), buy further OTM CE + OTM PE (outer wings). Premium collected for staying within a defined range.",
    maxProfit: "Net credit received",
    maxLoss: "Width of spread minus net credit (limited)",
    netPremium: "credit",
    idealWhen: "Market expected to stay inside a wide range. Most popular professional sell strategy.",
    legs: [
      { side: "BUY",  type: "CE", strikeOffset: 200,  strikeLabel: "ATM+200", qty: 1 },
      { side: "SELL", type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100", qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100", qty: 1 },
      { side: "BUY",  type: "PE", strikeOffset: -200, strikeLabel: "ATM-200", qty: 1 },
    ],
  },

  // ── Any Direction ─────────────────────────────────────────────────────────
  {
    id: "long-straddle",
    name: "Long Straddle",
    direction: "any",
    description: "Buy ATM CE and ATM PE simultaneously. Profits from a large move in either direction. Loses if market stays flat (time decay works against you).",
    maxProfit: "Unlimited (both directions)",
    maxLoss: "Total premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Expecting a big move before expiry — budget announcements, results, elections.",
    legs: [
      { side: "BUY", type: "CE", strikeOffset: 0, strikeLabel: "ATM", qty: 1 },
      { side: "BUY", type: "PE", strikeOffset: 0, strikeLabel: "ATM", qty: 1 },
    ],
  },
  {
    id: "long-strangle",
    name: "Long Strangle",
    direction: "any",
    description: "Buy OTM CE and OTM PE. Cheaper than Long Straddle but needs a bigger move to profit. Excellent for high-volatility events.",
    maxProfit: "Unlimited (both directions)",
    maxLoss: "Total premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Big move expected but direction unknown. Lower cost than Long Straddle.",
    legs: [
      { side: "BUY", type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100", qty: 1 },
      { side: "BUY", type: "PE", strikeOffset: -100, strikeLabel: "ATM-100", qty: 1 },
    ],
  },
  {
    id: "long-iron-butterfly",
    name: "Long Iron Butterfly",
    direction: "any",
    description: "Buy ATM CE + ATM PE, sell OTM CE + OTM PE as financing. Lower cost than Long Straddle — but profit is capped at the short strike.",
    maxProfit: "Width of wing minus net debit (capped)",
    maxLoss: "Net premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Expecting a moderate-to-large move. Want to reduce cost of Long Straddle.",
    legs: [
      { side: "SELL", type: "CE", strikeOffset: 200,  strikeLabel: "ATM+200", qty: 1 },
      { side: "BUY",  type: "CE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "BUY",  type: "PE", strikeOffset: 0,   strikeLabel: "ATM",      qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -200, strikeLabel: "ATM-200", qty: 1 },
    ],
  },
  {
    id: "long-iron-condor",
    name: "Long Iron Condor",
    direction: "any",
    description: "Buy inner OTM CE + OTM PE, sell further OTM CE + OTM PE. Profits from a moderate breakout in either direction, with limited risk.",
    maxProfit: "Width of inner spread minus net debit",
    maxLoss: "Net premium paid (limited)",
    netPremium: "debit",
    idealWhen: "Expecting a moderate breakout. Defined risk, defined reward on both sides.",
    legs: [
      { side: "SELL", type: "CE", strikeOffset: 200,  strikeLabel: "ATM+200", qty: 1 },
      { side: "BUY",  type: "CE", strikeOffset: 100,  strikeLabel: "ATM+100", qty: 1 },
      { side: "BUY",  type: "PE", strikeOffset: -100, strikeLabel: "ATM-100", qty: 1 },
      { side: "SELL", type: "PE", strikeOffset: -200, strikeLabel: "ATM-200", qty: 1 },
    ],
  },
];

const CATEGORIES: { label: string; direction: Direction; icon: React.ComponentType<{ className?: string }>; color: string; bg: string; border: string }[] = [
  {
    label: "Bullish",
    direction: "bullish",
    icon: TrendingUp,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
  },
  {
    label: "Bearish",
    direction: "bearish",
    icon: TrendingDown,
    color: "text-red-400",
    bg: "bg-red-400/10",
    border: "border-red-400/30",
  },
  {
    label: "Non-Directional",
    direction: "neutral",
    icon: Minus,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
  },
  {
    label: "Any Direction",
    direction: "any",
    icon: Zap,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
    border: "border-yellow-400/30",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function directionMeta(d: Direction) {
  return CATEGORIES.find(c => c.direction === d)!;
}

function premiumBadge(p: "debit" | "credit" | "varies") {
  if (p === "credit") return { label: "Net Credit", cls: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30" };
  if (p === "debit") return { label: "Net Debit",  cls: "bg-red-400/10 text-red-400 border-red-400/30" };
  return { label: "Varies",     cls: "bg-muted text-muted-foreground border-border" };
}

// ─── Deploy Dialog ────────────────────────────────────────────────────────────

interface DeployDialogProps {
  strategy: ReadyMadeStrategy;
  onClose: () => void;
}

const POPULAR_INSTRUMENTS = [
  "NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY",
  "RELIANCE", "TCS", "INFY", "HDFC", "ICICIBANK", "SBIN",
];

function DeployDialog({ strategy, onClose }: DeployDialogProps) {
  const { toast } = useToast();
  const [instrument, setInstrument] = useState("NIFTY");
  const [customInstrument, setCustomInstrument] = useState("");
  const [expiry, setExpiry] = useState("weekly");
  const [atmStrike, setAtmStrike] = useState("");
  const [strikeGap, setStrikeGap] = useState("50");
  const [lots, setLots] = useState("1");
  const [step, setStep] = useState<"config" | "review">("config");

  const meta = directionMeta(strategy.direction);
  const pb = premiumBadge(strategy.netPremium);

  const effectiveInstrument = customInstrument.trim() || instrument;

  function resolveStrike(offset: number): string {
    const atm = parseInt(atmStrike) || 0;
    const gap = parseInt(strikeGap) || 50;
    const steps = offset / 100; // offset is in 100 multiples
    const resolved = atm + steps * gap;
    return resolved > 0 ? resolved.toString() : "ATM" + (offset > 0 ? `+${offset}` : offset < 0 ? `${offset}` : "");
  }

  function handleDeploy() {
    toast({
      title: "Not yet available",
      description: "Automated multi-leg strategy deployment is under development. Use the Orders or Super Orders page to place individual legs manually.",
      variant: "destructive",
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", meta.bg)}>
              <meta.icon className={cn("w-5 h-5", meta.color)} />
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{strategy.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{strategy.legs.length} legs · {pb.label}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === "config" ? (
            <div className="p-5 space-y-5">

              {/* Instrument */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Instrument</label>
                <div className="flex flex-wrap gap-2">
                  {POPULAR_INSTRUMENTS.map(sym => (
                    <button
                      key={sym}
                      onClick={() => { setInstrument(sym); setCustomInstrument(""); }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        instrument === sym && !customInstrument
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                      )}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Or type custom symbol (e.g. BANKNIFTY)"
                  value={customInstrument}
                  onChange={e => setCustomInstrument(e.target.value.toUpperCase())}
                  className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Expiry */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Expiry</label>
                <div className="flex gap-2">
                  {["weekly", "monthly", "next-weekly"].map(e => (
                    <button
                      key={e}
                      onClick={() => setExpiry(e)}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-medium border capitalize transition-colors",
                        expiry === e
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {e === "next-weekly" ? "Next Weekly" : e.charAt(0).toUpperCase() + e.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* ATM Strike + Gap */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">ATM Strike</label>
                  <input
                    type="number"
                    placeholder="e.g. 24000"
                    value={atmStrike}
                    onChange={e => setAtmStrike(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[10px] text-muted-foreground">Leave blank to auto-detect from market</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Strike Gap</label>
                  <input
                    type="number"
                    placeholder="50"
                    value={strikeGap}
                    onChange={e => setStrikeGap(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[10px] text-muted-foreground">NIFTY=50, BANKNIFTY=100</p>
                </div>
              </div>

              {/* Lots */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Lots</label>
                <div className="flex gap-2">
                  {["1", "2", "3", "5", "10"].map(l => (
                    <button
                      key={l}
                      onClick={() => setLots(l)}
                      className={cn(
                        "px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                        lots === l
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {l}
                    </button>
                  ))}
                  <input
                    type="number"
                    min="1"
                    placeholder="Custom"
                    value={["1","2","3","5","10"].includes(lots) ? "" : lots}
                    onChange={e => setLots(e.target.value)}
                    className="w-24 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Risk Warning for unlimited loss strategies */}
              {strategy.maxLoss.toLowerCase().includes("unlimited") && (
                <div className="flex gap-3 p-3 bg-red-400/5 border border-red-400/20 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-400">
                    This strategy has <strong>unlimited loss potential</strong>. Always set a Stop Loss using Risk Manager before deploying.
                  </p>
                </div>
              )}
            </div>
          ) : (
            // Review step
            <div className="p-5 space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Instrument</span>
                  <span className="font-medium text-foreground">{effectiveInstrument}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Expiry</span>
                  <span className="font-medium text-foreground capitalize">{expiry.replace("-", " ")}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Lots</span>
                  <span className="font-medium text-foreground">{lots}</span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Order Legs</p>
                {strategy.legs.map((leg, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-xs font-bold",
                        leg.side === "BUY" ? "bg-emerald-400/15 text-emerald-400" : "bg-red-400/15 text-red-400"
                      )}>
                        {leg.side}
                      </span>
                      <span className="text-sm font-mono text-foreground">
                        {atmStrike
                          ? `${resolveStrike(leg.strikeOffset)} ${leg.type}`
                          : `${leg.strikeLabel} ${leg.type}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{lots} lot{parseInt(lots) !== 1 ? "s" : ""} × {leg.qty}</span>
                      <span className="text-xs capitalize">{expiry.replace("-", " ")} expiry</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Review your legs before placing. All {strategy.legs.length} legs will be sent as separate orders simultaneously. Check your available margin before proceeding.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border shrink-0">
          {step === "config" ? (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={() => setStep("review")}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                Review Legs <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep("config")} className="flex-1 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                Back
              </button>
              <button
                onClick={handleDeploy}
                className="flex-1 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Deploy Strategy
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Strategy Card ─────────────────────────────────────────────────────────────

function StrategyCard({ strategy }: { strategy: ReadyMadeStrategy }) {
  const [showInfo, setShowInfo] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);
  const meta = directionMeta(strategy.direction);
  const pb = premiumBadge(strategy.netPremium);

  return (
    <>
      <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors group">

        {/* Top row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className={cn("p-1.5 rounded-md shrink-0", meta.bg)}>
              <meta.icon className={cn("w-4 h-4", meta.color)} />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-foreground leading-tight">{strategy.name}</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", pb.cls)}>{pb.label}</span>
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", meta.bg, meta.color, meta.border)}>
                  {meta.label}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowInfo(v => !v)}
            className="text-muted-foreground/50 hover:text-muted-foreground p-1 rounded transition-colors shrink-0"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Description (toggle) */}
        {showInfo && (
          <div className="space-y-2 text-xs text-muted-foreground border-t border-border pt-3">
            <p className="leading-relaxed">{strategy.description}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-emerald-400/5 border border-emerald-400/20 rounded-lg p-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-400 mb-0.5">Max Profit</p>
                <p className="text-emerald-400/80 text-[10px] leading-tight">{strategy.maxProfit}</p>
              </div>
              <div className="bg-red-400/5 border border-red-400/20 rounded-lg p-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-red-400 mb-0.5">Max Loss</p>
                <p className="text-red-400/80 text-[10px] leading-tight">{strategy.maxLoss}</p>
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-0.5">Ideal When</p>
              <p className="text-[10px] leading-tight">{strategy.idealWhen}</p>
            </div>
          </div>
        )}

        {/* Legs */}
        <div className="flex flex-wrap gap-1.5">
          {strategy.legs.map((leg, i) => (
            <div key={i} className={cn(
              "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-semibold border",
              leg.side === "BUY"
                ? "bg-emerald-400/10 border-emerald-400/20 text-emerald-400"
                : "bg-red-400/10 border-red-400/20 text-red-400"
            )}>
              <span className="opacity-70">{leg.side}</span>
              <span>{leg.strikeLabel} {leg.type}</span>
              {leg.qty > 1 && <span className="opacity-60">×{leg.qty}</span>}
            </div>
          ))}
        </div>

        {/* Deploy button */}
        <button
          onClick={() => setShowDeploy(true)}
          className="mt-auto w-full py-2 rounded-lg bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/40 text-primary text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
        >
          Configure &amp; Deploy <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {showDeploy && (
        <DeployDialog strategy={strategy} onClose={() => setShowDeploy(false)} />
      )}
    </>
  );
}

// ─── Ready Made Tab ────────────────────────────────────────────────────────────

function ReadyMadeTab() {
  return (
    <div className="space-y-8">
      {CATEGORIES.map(cat => {
        const strats = STRATEGIES.filter(s => s.direction === cat.direction);
        return (
          <div key={cat.direction}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className={cn("p-1.5 rounded-md", cat.bg)}>
                <cat.icon className={cn("w-4 h-4", cat.color)} />
              </div>
              <h2 className="font-semibold text-foreground">{cat.label}</h2>
              <span className={cn("ml-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", cat.bg, cat.color, cat.border)}>
                {strats.length} strategies
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {strats.map(s => <StrategyCard key={s.id} strategy={s} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function Strategies() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">Strategies</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a ready-made options strategy and deploy it with one click.
        </p>
      </div>

      <ReadyMadeTab />
    </div>
  );
}
