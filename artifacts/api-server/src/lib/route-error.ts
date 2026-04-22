import { Response } from "express";
import { DhanApiError } from "./dhan-client";
import { logger } from "./logger";
import { sendTelegramAlertIfEnabled, alertHeader, alertFooter } from "./telegram";

const ALERT_CODES = new Set(["DH-901", "DH-911"]);
const alertCooldown = new Map<string, number>();
const COOLDOWN_MS = 15 * 60 * 1_000; // 15 min — don't spam

function maybeSendCriticalAlert(errorCode: string, context: string) {
  const now = Date.now();
  const last = alertCooldown.get(errorCode) ?? 0;
  if (now - last < COOLDOWN_MS) return;
  alertCooldown.set(errorCode, now);

  if (errorCode === "DH-901") {
    void sendTelegramAlertIfEnabled(
      "criticalErrors",
      [
        alertHeader("ALGO TRADER", "CRITICAL"),
        "",
        "🔴 *TOKEN EXPIRED (DH-901)*",
        "Your Dhan access token has expired.",
        "Orders and live data will fail until reconnected.",
        "",
        "*Action:* Settings → paste a new access token.",
        "",
        alertFooter(),
      ].join("\n"),
    );
  } else if (errorCode === "DH-911") {
    void sendTelegramAlertIfEnabled(
      "criticalErrors",
      [
        alertHeader("ALGO TRADER", "CRITICAL"),
        "",
        "🔴 *IP NOT WHITELISTED (DH-911)*",
        "Your server IP is not whitelisted in Dhan portal.",
        "Order APIs are currently blocked.",
        "",
        "*Action:* Dhan Portal → My Profile → Manage App → whitelist IP.",
        "",
        alertFooter(),
      ].join("\n"),
    );
  }
}

export function handleRouteError(
  res: Response,
  err: unknown,
  context: string,
): void {
  if (err instanceof DhanApiError) {
    const body = err.toClientResponse();
    logger.warn({ context, errorCode: body.errorCode }, `${context}: ${body.errorMessage}`);

    if (ALERT_CODES.has(body.errorCode)) {
      maybeSendCriticalAlert(body.errorCode, context);
    }

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
