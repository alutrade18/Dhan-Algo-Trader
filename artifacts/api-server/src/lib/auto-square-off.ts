import { db, settingsTable, auditLogTable } from "@workspace/db";
import { dhanClient } from "./dhan-client";
import { sendTelegramAlertIfEnabled } from "./telegram";
import { logger } from "./logger";
import { getMarketStatus } from "./market-calendar";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastNSESquareOffDate = "";
let lastMCXSquareOffDate = "";

function nowIST(): { hours: number; minutes: number; timeStr: string; dateStr: string } {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return {
    hours: ist.getUTCHours(),
    minutes: ist.getUTCMinutes(),
    timeStr: `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`,
    dateStr: ist.toISOString().slice(0, 10),
  };
}

function isWeekday(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day >= 1 && day <= 5;
}

function isAtTargetTime(hours: number, minutes: number, targetTime: string): boolean {
  const [targetH, targetM] = targetTime.split(":").map(Number);
  const currentMinutes = hours * 60 + minutes;
  const targetMinutes = targetH * 60 + targetM;
  return Math.abs(currentMinutes - targetMinutes) <= 1;
}

async function doSquareOff(exchange: "NSE" | "MCX", timeStr: string, dateStr: string): Promise<void> {
  logger.info({ exchange, timeStr, dateStr }, "[AutoSquareOff] Triggering square-off");
  const result = await dhanClient.exitAllPositions();
  logger.info({ result, exchange }, "[AutoSquareOff] Exit all positions result");
  await db.insert(auditLogTable).values({
    action: "AUTO_SQUARE_OFF",
    description: `Auto square-off (${exchange}) triggered at ${timeStr} IST on ${dateStr}`,
  });
  void sendTelegramAlertIfEnabled(
    "autoSquareOff",
    `⏰ *Auto Square-Off (${exchange}) Executed*\n\nAll intraday positions squared off at *${timeStr} IST* (${dateStr}).\n\n_${APP_NAME} — Auto Square-Off_`
  );
}

async function checkAndSquareOff(): Promise<void> {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (!settings?.autoSquareOffEnabled) return;
    if (!dhanClient.isConfigured()) return;

    const { hours, minutes, timeStr, dateStr } = nowIST();
    if (!isWeekday(dateStr)) return;

    const marketStatus = getMarketStatus();

    // NSE square-off
    const nseTime = settings.autoSquareOffTimeNSE ?? settings.autoSquareOffTime ?? "15:14";
    if (
      marketStatus.nseOpen &&
      lastNSESquareOffDate !== dateStr &&
      isAtTargetTime(hours, minutes, nseTime)
    ) {
      lastNSESquareOffDate = dateStr;
      await doSquareOff("NSE", timeStr, dateStr);
    }

    // MCX square-off — separate time, separate guard
    const mcxTime = settings.autoSquareOffTimeMCX ?? "23:25";
    if (
      marketStatus.mcxOpen &&
      lastMCXSquareOffDate !== dateStr &&
      isAtTargetTime(hours, minutes, mcxTime)
    ) {
      lastMCXSquareOffDate = dateStr;
      await doSquareOff("MCX", timeStr, dateStr);
    }
  } catch (e) {
    logger.error({ err: e }, "[AutoSquareOff] Error during square-off");
  }
}

export function startAutoSquareOffScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => void checkAndSquareOff(), 30_000);
  logger.info("[AutoSquareOff] Scheduler started (checks every 30s)");
}

export function stopAutoSquareOffScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
