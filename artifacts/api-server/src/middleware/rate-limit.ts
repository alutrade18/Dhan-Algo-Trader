import { Request, Response, NextFunction } from "express";
import { checkRateLimit, ApiCategory } from "../lib/rate-limiter";

function makeRateLimitMiddleware(category: ApiCategory) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const result = checkRateLimit(category);

    res.setHeader("X-RateLimit-Category", category);
    for (const [window, rem] of Object.entries(result.remaining)) {
      res.setHeader(`X-RateLimit-Remaining-${window}`, String(rem));
    }

    if (!result.allowed) {
      const retryAfterSec = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 1000) : 1;
      res.setHeader("Retry-After", String(retryAfterSec));
      res.status(429).json({
        errorCode: "DH-904",
        errorMessage: `Rate limit exceeded: ${result.limit} requests per ${result.violatedWindow} for ${category} APIs. Retry after ${retryAfterSec}s.`,
        category,
        violatedWindow: result.violatedWindow,
        limit: result.limit,
        retryAfterSeconds: retryAfterSec,
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
