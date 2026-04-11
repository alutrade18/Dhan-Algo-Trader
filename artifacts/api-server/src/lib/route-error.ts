import { Response } from "express";
import { DhanApiError } from "./dhan-client";
import { logger } from "./logger";

export function handleRouteError(
  res: Response,
  err: unknown,
  context: string,
): void {
  if (err instanceof DhanApiError) {
    const body = err.toClientResponse();
    logger.warn({ context, errorCode: body.errorCode }, `${context}: ${body.errorMessage}`);
    res.status(err.status).json(body);
    return;
  }

  logger.error({ err, context }, `Unexpected error in ${context}`);
  res.status(500).json({
    errorCode: "INTERNAL",
    errorMessage: "An unexpected server error occurred. Please try again.",
    retryable: true,
  });
}
