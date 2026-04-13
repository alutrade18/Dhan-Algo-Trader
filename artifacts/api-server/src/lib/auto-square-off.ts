import { db, settingsTable, auditLogTable } from "@workspace/db";
import { dhanClient } from "./dhan-client";
import { sendTelegramAlert } from "./telegram";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastSquareOffDate = "";

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

async function checkAndSquareOff(): Promise<void> {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (!settings?.autoSquareOffEnabled) return;
    if (!dhanClient.isConfigured()) return;

    const { hours, minutes, timeStr, dateStr } = nowIST();
    if (!isWeekday(dateStr)) return;
    if (lastSquareOffDate === dateStr) return;

    const targetTime = settings.autoSquareOffTime ?? "15:14";
    const [targetH, targetM] = targetTime.split(":").map(Number);
    const currentMinutes = hours * 60 + minutes;
    const targetMinutes = targetH * 60 + targetM;
    if (Math.abs(currentMinutes - targetMinutes) > 1) return;

    lastSquareOffDate = dateStr;

    console.log(`[AutoSquareOff] Triggering at ${timeStr} IST for ${dateStr}`);

    const result = await dhanClient.exitAllPositions();
    console.log("[AutoSquareOff] Result:", result);

    await db.insert(auditLogTable).values({
      action: "AUTO_SQUARE_OFF",
      description: `Auto square-off triggered at ${timeStr} IST on ${dateStr}`,
    });

    const prefs = settings.notificationPreferences as { autoSquareOff?: boolean } | null;
    if (prefs?.autoSquareOff !== false) {
      void sendTelegramAlert(
        `⏰ *Auto Square-Off Executed*\n\nAll intraday positions squared off at *${timeStr} IST* (${dateStr}).\n\n_${APP_NAME} — Auto Square-Off_`
      );
    }
  } catch (e) {
    console.error("[AutoSquareOff] Error:", e);
  }
}

export function startAutoSquareOffScheduler(): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => void checkAndSquareOff(), 30_000);
  console.log("[AutoSquareOff] Scheduler started (checks every 30s)");
}

export function stopAutoSquareOffScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
