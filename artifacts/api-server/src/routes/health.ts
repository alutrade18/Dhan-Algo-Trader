import { Router, type IRouter } from "express";
import { dhanClient } from "../lib/dhan-client";
import { getRateLimitStats } from "../lib/rate-limiter";
import { RATE_LIMITS_REFERENCE } from "../lib/dhan-errors";

const router: IRouter = Router();

function isNSEMarketOpen(): boolean {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffset);

  const dayOfWeek = istNow.getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const hours = istNow.getUTCHours();
  const minutes = istNow.getUTCMinutes();
  const totalMinutes = hours * 60 + minutes;

  const marketOpen = 9 * 60;
  const marketClose = 15 * 60 + 30;

  return totalMinutes >= marketOpen && totalMinutes < marketClose;
}

router.get("/healthz", (_req, res) => {
  const marketOpen = isNSEMarketOpen();
  const brokerConnected = dhanClient.isConfigured();

  res.json({
    status: "ok",
    marketOpen,
    brokerConnected,
    systemOnline: marketOpen && brokerConnected,
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
