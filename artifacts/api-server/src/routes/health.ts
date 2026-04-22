import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { getMarketStatus, refreshHolidayCacheIfStale } from "../lib/market-calendar";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  // Trigger a background refresh if the 24-h cache is stale (non-blocking)
  refreshHolidayCacheIfStale();

  const market = getMarketStatus();
  const brokerConnected = dhanClient.isConnected();

  res.json({
    status: "ok",
    marketOpen: market.isOpen,
    marketName: market.name,
    marketClosedReason: market.closedReason,
    nseOpen: market.nseOpen,
    mcxOpen: market.mcxOpen,
    mcxSession: market.mcxSession,
    brokerConnected,
    systemOnline: market.isOpen && brokerConnected,
  });
});


export default router;
