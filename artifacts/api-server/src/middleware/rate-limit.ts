import { Request, Response, NextFunction } from "express";
import { checkRateLimit, checkOptionChainRateLimit, ApiCategory } from "../lib/rate-limiter";

function makeRateLimitMiddleware(category: ApiCategory) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const result = checkRateLimit(category);

    res.setHeader("X-RateLimit-Category", category);
    for (const [window, rem] of Object.entries(result.remaining)) {
      res.setHeader(`X-RateLimit-Remaining-${window}`, String(rem));
    }

    if (!result.allowed) {
      const retryAfterMs = result.retryAfterMs ?? 1000;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        errorCode: "DH-904",
        errorMessage: `Rate limit exceeded: ${result.limit} requests per ${result.violatedWindow} for ${category} APIs. Retry after ${retryAfterSec}s.`,
        category,
        violatedWindow: result.violatedWindow,
        limit: result.limit,
        retryAfterSeconds: retryAfterSec,
        retryAfterMs,
      });
      return;
    }

    next();
  };
}

export const orderRateLimit = makeRateLimitMiddleware("order");
export const dataRateLimit = makeRateLimitMiddleware("data");
export const quoteRateLimit = makeRateLimitMiddleware("quote");
export const nonTradingRateLimit = makeRateLimitMiddleware("nontrading");

// ── Option Chain: 1 request per 3 seconds per underlying+expiry combo ──
export function optionChainRateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const body = req.body as Record<string, unknown>;
  const key = `${body.underSecurityId ?? ""}:${body.expiry ?? "any"}`;
  const result = checkOptionChainRateLimit(key);

  if (!result.allowed) {
    const retryAfterSec = Math.ceil(result.waitMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Category", "option-chain");
    res.status(429).json({
      errorCode: "DH-904",
      errorMessage: `Option Chain rate limit: 1 request per 3 seconds per underlying. Retry after ${retryAfterSec}s.`,
      category: "option-chain",
      retryAfterSeconds: retryAfterSec,
      retryAfterMs: result.waitMs,
    });
    return;
  }
  next();
}
