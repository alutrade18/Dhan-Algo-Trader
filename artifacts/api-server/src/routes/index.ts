import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import ordersRouter from "./orders";
import positionsRouter from "./positions";
import holdingsRouter from "./holdings";
import tradesRouter from "./trades";
import fundsRouter from "./funds";
import marketRouter from "./market";
import strategiesRouter from "./strategies";
import tradeLogsRouter from "./trade-logs";
import settingsRouter from "./settings";
import brokerRouter from "./broker";
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
  "/holdings",
  "/trades",
  "/trade-logs",
  "/funds",
  "/settings",
  "/broker",
  "/strategies",
], nonTradingRateLimit);

router.use(healthRouter);
router.use(dashboardRouter);
router.use(ordersRouter);
router.use(positionsRouter);
router.use(holdingsRouter);
router.use(tradesRouter);
router.use(fundsRouter);
router.use(marketRouter);
router.use(strategiesRouter);
router.use(tradeLogsRouter);
router.use(settingsRouter);
router.use(brokerRouter);

export default router;
