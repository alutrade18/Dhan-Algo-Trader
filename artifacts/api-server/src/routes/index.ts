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
import {
  orderRateLimit,
  dataRateLimit,
  quoteRateLimit,
  nonTradingRateLimit,
} from "../middleware/rate-limit";

const router: IRouter = Router();

router.use("/orders", orderRateLimit);

router.use("/market/quote", quoteRateLimit);
router.use("/market/ltp", quoteRateLimit);

router.use("/market/historical", dataRateLimit);
router.use("/market/intraday", dataRateLimit);
router.use("/market/option-chain", dataRateLimit);
router.use("/market/expiry", dataRateLimit);
router.use("/market/security-list", dataRateLimit);

router.use([
  "/health",
  "/dashboard",
  "/positions",
  "/funds",
  "/settings",
  "/broker",
  "/strategies",
  "/paper-trades",
  "/risk",
  "/trades",
], nonTradingRateLimit);

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
