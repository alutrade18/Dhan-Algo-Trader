import { db, settingsTable } from "@workspace/db";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

async function getTelegramConfig(): Promise<{ botToken: string; chatId: string } | null> {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (!settings?.telegramBotToken || !settings?.telegramChatId) return null;
    return { botToken: settings.telegramBotToken, chatId: settings.telegramChatId };
  } catch {
    return null;
  }
}

export async function sendTelegramAlert(message: string): Promise<void> {
  const config = await getTelegramConfig();
  if (!config) return;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: `🤖 *${APP_NAME}*\n${message}`,
        parse_mode: "Markdown",
      }),
    });
    if (!response.ok) {
      console.warn("[Telegram] Failed to send alert:", await response.text());
    }
  } catch (err) {
    console.warn("[Telegram] Error sending alert:", err);
  }
}
