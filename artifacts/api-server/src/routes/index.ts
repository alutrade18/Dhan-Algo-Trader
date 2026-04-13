import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import positionsRouter from "./positions";
import fundsRouter from "./funds";
import marketRouter from "./market";
import strategiesRouter from "./strategies";
import settingsRouter from "./settings";
import brokerRouter from "./broker";
import paperTradesRouter from "./paper-trades";
import riskRouter from "./risk";
import tradesRouter from "./trades";
import logsRouter from "./logs";
import superOrdersRouter from "./super-orders";
import foreverOrdersRouter from "./forever-orders";
import conditionalRouter from "./conditional";
import { createPostbackRouter } from "./postback";
import { getIO } from "../lib/io";
import instrumentsRouter from "./instruments";
import {
  orderRateLimit,
  dataRateLimit,
  quoteRateLimit,
  nonTradingRateLimit,
  optionChainRateLimitMiddleware,
} from "../middleware/rate-limit";

const router: IRouter = Router();

// ── ORDER APIs: 10/sec | 250/min | 1000/hr | 7000/day ────────────────────────
router.use("/orders", orderRateLimit);
router.use("/super-orders", orderRateLimit);
router.use("/forever-orders", orderRateLimit);
router.use("/conditional", orderRateLimit);
router.use("/positions/exit-single", orderRateLimit); // exit = order placement

// ── QUOTE APIs: 1/sec (LTP, OHLC, snapshots) ─────────────────────────────────
router.use("/market/quote", quoteRateLimit);
router.use("/market/ltp", quoteRateLimit);
router.use("/funds/margin", quoteRateLimit);

// ── OPTION CHAIN: 1 per 3 seconds per underlying (Dhan special rule) ─────────
router.use("/market/option-chain", optionChainRateLimitMiddleware);

// ── DATA APIs: 5/sec | 100,000/day (historical & candle data) ────────────────
router.use("/market/historical", dataRateLimit);
router.use("/market/intraday", dataRateLimit);
router.use("/market/expiry-list", dataRateLimit);
router.use("/market/expiry", dataRateLimit);
router.use("/market/option-strikes", dataRateLimit);
router.use("/market/security-list", dataRateLimit);
router.use("/market/securities", dataRateLimit);

// ── NON-TRADING APIs: 20/sec (management, info, config endpoints) ─────────────
router.use([
  "/health",
  "/dashboard",
  "/positions",     // GET positions (read-only)
  "/funds",         // GET fund limits
  "/settings",
  "/broker",
  "/strategies",
  "/paper-trades",
  "/risk",
  "/trades",
  "/logs",
  "/instruments",   // symbol search
  "/postback",
], nonTradingRateLimit);

// ── ROUTE REGISTRATIONS ───────────────────────────────────────────────────────
router.use(healthRouter);
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(positionsRouter);
router.use(fundsRouter);
router.use(marketRouter);
router.use(strategiesRouter);
router.use(settingsRouter);
router.use(brokerRouter);
router.use(paperTradesRouter);
router.use(riskRouter);
router.use(tradesRouter);
router.use(logsRouter);
router.use(instrumentsRouter);
router.use(superOrdersRouter);
router.use(foreverOrdersRouter);
router.use(conditionalRouter);
router.use((req, res, next) => {
  const io = getIO();
  if (io) {
    createPostbackRouter(io)(req, res, next);
  } else {
    next();
  }
});

export default router;
