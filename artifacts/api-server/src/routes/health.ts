import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { getRateLimitStats } from "../lib/rate-limiter";
import { RATE_LIMITS_REFERENCE } from "../lib/dhan-errors";
import { getMarketStatus } from "../lib/market-calendar";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const market = getMarketStatus();
  const brokerConnected = dhanClient.isConfigured();

  res.json({
    status: "ok",
    marketOpen: market.isOpen,
    marketName: market.name,
    marketClosedReason: market.closedReason,
    brokerConnected,
    systemOnline: market.isOpen && brokerConnected,
  });
});

router.get("/rate-limits", (_req, res) => {
  res.json({
    limits: RATE_LIMITS_REFERENCE,
    currentUsage: getRateLimitStats(),
    notes: {
      orderModificationCap: "Max 25 modifications per order (Dhan hard limit)",
      rateLimitErrorCode: "DH-904 — Too many requests, retry after suggested delay",
    },
  });
});

export default router;
