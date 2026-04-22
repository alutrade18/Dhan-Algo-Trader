import { db, settingsTable } from "@workspace/db";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

export type TelegramAlertCategory = "orderFills" | "killSwitch" | "autoSquareOff" | "criticalErrors";

interface TelegramConfig {
  botToken: string;
  chatId: string;
  alerts: {
    orderFills: boolean;
    killSwitch: boolean;
    autoSquareOff: boolean;
    criticalErrors: boolean;
  };
}

async function getTelegramConfig(): Promise<TelegramConfig | null> {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (!settings?.telegramBotToken || !settings?.telegramChatId) return null;
    return {
      botToken: settings.telegramBotToken,
      chatId: settings.telegramChatId,
      alerts: settings.telegramAlerts ?? {
        orderFills: true,
        killSwitch: true,
        autoSquareOff: true,
        criticalErrors: true,
      },
    };
  } catch {
    return null;
  }
}

async function sendRaw(botToken: string, chatId: string, text: string): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (!response.ok) {
      console.warn("[Telegram] Failed to send:", await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[Telegram] Error sending:", err);
    return false;
  }
}

/** Unconditional send — used for test messages and credential pings */
export async function sendTelegramAlert(message: string): Promise<void> {
  const config = await getTelegramConfig();
  if (!config) return;
  await sendRaw(config.botToken, config.chatId, message);
}

/** Gated send — checks the per-category toggle before sending */
export async function sendTelegramAlertIfEnabled(category: TelegramAlertCategory, message: string): Promise<void> {
  const config = await getTelegramConfig();
  if (!config) return;
  if (!config.alerts[category]) return;
  await sendRaw(config.botToken, config.chatId, message);
}

export function alertHeader(appName: string, type: string): string {
  return `🔔 *${appName.toUpperCase()} — ${type}*\n━━━━━━━━━━━━━━━━━━━━━━━`;
}

export function alertFooter(): string {
  return "━━━━━━━━━━━━━━━━━━━━━━━";
}

/** Direct test send using explicit credentials (for test-message endpoint) */
export async function sendTelegramTest(botToken: string, chatId: string): Promise<{ ok: boolean; error?: string }> {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: true,
  });
  const text = [
    alertHeader(APP_NAME, "TEST ALERT"),
    "",
    "✅ *Telegram alerts are working correctly.*",
    "_This is a test — no action required._",
    "",
    alertFooter(),
    `🕐 *Sent:* ${now} IST`,
    `🏦 *Broker:* Dhan NSE`,
    alertFooter(),
  ].join("\n");

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
    if (!res.ok) {
      const body = await res.json() as { description?: string };
      return { ok: false, error: body.description ?? "Telegram API error" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
