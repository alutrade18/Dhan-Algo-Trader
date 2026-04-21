import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import positionsRouter from "./positions";
import fundsRouter from "./funds";
import marketRouter from "./market";
import settingsRouter from "./settings";
import brokerRouter from "./broker";
import riskRouter from "./risk";
import tradesRouter from "./trades";
import logsRouter from "./logs";
import { createPostbackRouter } from "./postback";
import { getIO } from "../lib/io";
import instrumentsRouter from "./instruments";
import {
  orderRateLimit,
  dataRateLimit,
  quoteRateLimit,
  nonTradingRateLimit,
} from "../middleware/rate-limit";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

// ── ORDER APIs: 10/sec | 250/min | 1000/hr | 7000/day ────────────────────────
router.use("/orders", orderRateLimit);
router.use("/positions/exit-single", orderRateLimit); // exit = order placement

// ── QUOTE APIs: 1/sec (LTP, OHLC, snapshots) ─────────────────────────────────
router.use("/market/quote", quoteRateLimit);
router.use("/market/ltp", quoteRateLimit);
router.use("/funds/margin", quoteRateLimit);

// ── OPTION CHAIN: throttled in route handler (market.ts) with 3.5s delay ─────
// No middleware block here — the route handler delays instead of rejecting.

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
  "/healthz",
  "/rate-limits",
  "/dashboard",
  "/positions",     // GET positions (read-only)
  "/funds",         // GET fund limits
  "/settings",
  "/broker",
  "/risk",
  "/trades",
  "/logs",
  "/instruments",   // symbol search
  "/postback",
], nonTradingRateLimit);

// ── PUBLIC ROUTES (no auth required) ─────────────────────────────────────────
// Health check endpoints are publicly accessible for uptime monitoring
router.use(healthRouter);

// Dhan postback uses its own shared secret for authentication
router.use((req, res, next) => {
  const io = getIO();
  if (io && req.path === "/postback") {
    createPostbackRouter(io)(req, res, next);
  } else {
    next();
  }
});

// ── AUTHENTICATION ────────────────────────────────────────────────────────────
// All remaining routes require a valid Clerk session
router.use(requireAuth);

// ── PROTECTED ROUTE REGISTRATIONS ────────────────────────────────────────────
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(positionsRouter);
router.use(fundsRouter);
router.use(marketRouter);
router.use(settingsRouter);
router.use(brokerRouter);
router.use(riskRouter);
router.use(tradesRouter);
router.use(logsRouter);
router.use(instrumentsRouter);

export default router;
