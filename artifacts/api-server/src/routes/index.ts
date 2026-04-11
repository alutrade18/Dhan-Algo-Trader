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

const router: IRouter = Router();

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
