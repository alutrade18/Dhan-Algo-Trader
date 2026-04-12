import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { dhanClient } from "../lib/dhan-client";
import { sendTelegramAlert } from "../lib/telegram";

async function sendTelegramPing(botToken: string, chatId: string): Promise<void> {
  try {
    const now = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: true,
    });
    const message = [
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "🤖  *RAJESH ALGO TRADING*",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "✅  *Bot Connected Successfully*",
      "",
      "Your Telegram channel is now linked to the platform. You will receive real-time notifications for:",
      "",
      "  • Order executions & fills",
      "  • Strategy signals & triggers",
      "  • Kill switch activations",
      "  • Risk management alerts",
      "  • Daily P&L summaries",
      "",
      `🕐  *Connected at:* ${now} IST`,
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "_Rajesh Algo Platform — Powered by Dhan_",
    ].join("\n");

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
    });
  } catch {
    // fire-and-forget — ignore errors
  }
}

const router: IRouter = Router();

async function getOrCreateSettings() {
  let [settings] = await db.select().from(settingsTable);
  if (!settings) {
    [settings] = await db.insert(settingsTable).values({}).returning();
  }
  return settings;
}

function serializeSettings(settings: typeof settingsTable.$inferSelect) {
  return {
    id: settings.id,
    dhanClientId: process.env.DHAN_CLIENT_ID ? "****" + (process.env.DHAN_CLIENT_ID.slice(-4) || "") : "",
    apiConnected: dhanClient.isConfigured(),
    defaultProductType: settings.defaultProductType,
    defaultOrderType: settings.defaultOrderType,
    defaultExchange: settings.defaultExchange,
    maxOrderValue: settings.maxOrderValue ? Number(settings.maxOrderValue) : null,
    maxDailyLoss: settings.maxDailyLoss !== null && settings.maxDailyLoss !== undefined ? Number(settings.maxDailyLoss) : 5000,
    maxDailyProfit: settings.maxDailyProfit ? Number(settings.maxDailyProfit) : null,
    enableAutoTrading: settings.enableAutoTrading,
    enableNotifications: settings.enableNotifications,
    riskPerTrade: settings.riskPerTrade ? Number(settings.riskPerTrade) : null,
    theme: settings.theme,
    telegramBotToken: settings.telegramBotToken || "",
    telegramChatId: settings.telegramChatId || "",
    killSwitchEnabled: settings.killSwitchEnabled,
    updatedAt: settings.updatedAt?.toISOString(),
  };
}

router.get("/settings", async (_req, res): Promise<void> => {
  const settings = await getOrCreateSettings();
  res.json(serializeSettings(settings));
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await getOrCreateSettings();

  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  if (parsed.data.defaultProductType !== undefined) updateData.defaultProductType = parsed.data.defaultProductType;
  if (parsed.data.defaultOrderType !== undefined) updateData.defaultOrderType = parsed.data.defaultOrderType;
  if (parsed.data.defaultExchange !== undefined) updateData.defaultExchange = parsed.data.defaultExchange;
  if (parsed.data.maxOrderValue !== undefined) updateData.maxOrderValue = parsed.data.maxOrderValue?.toString();
  if (parsed.data.maxDailyProfit !== undefined) updateData.maxDailyProfit = parsed.data.maxDailyProfit?.toString();
  if (parsed.data.enableAutoTrading !== undefined) updateData.enableAutoTrading = parsed.data.enableAutoTrading;
  if (parsed.data.enableNotifications !== undefined) updateData.enableNotifications = parsed.data.enableNotifications;
  if (parsed.data.riskPerTrade !== undefined) updateData.riskPerTrade = parsed.data.riskPerTrade?.toString();
  if (parsed.data.theme !== undefined) updateData.theme = parsed.data.theme;

  if (body.maxDailyLoss !== undefined && body.maxDailyLoss !== null) {
    const val = Number(body.maxDailyLoss);
    if (!isNaN(val) && val >= 0) updateData.maxDailyLoss = val.toString();
  }
  const newToken = body.telegramBotToken !== undefined
    ? (body.telegramBotToken as string | null) || null
    : undefined;
  const newChatId = body.telegramChatId !== undefined
    ? (body.telegramChatId as string | null) || null
    : undefined;
  if (newToken !== undefined) updateData.telegramBotToken = newToken;
  if (newChatId !== undefined) updateData.telegramChatId = newChatId;

  const effectiveToken = newToken !== undefined ? newToken : existing.telegramBotToken;
  const effectiveChatId = newChatId !== undefined ? newChatId : existing.telegramChatId;
  const bothProvided = effectiveToken && effectiveChatId;
  const credentialsChanged = (newToken !== undefined && newToken !== null) || (newChatId !== undefined && newChatId !== null);
  if (bothProvided && credentialsChanged) {
    void sendTelegramPing(effectiveToken, effectiveChatId);
  }

  if (body.killSwitchEnabled !== undefined) {
    updateData.killSwitchEnabled = Boolean(body.killSwitchEnabled);
    if (Boolean(body.killSwitchEnabled) && !existing.killSwitchEnabled) {
      void sendTelegramAlert("🚨 *Emergency Kill Switch ACTIVATED* — All trading halted");
    } else if (!Boolean(body.killSwitchEnabled) && existing.killSwitchEnabled) {
      void sendTelegramAlert("✅ Kill switch deactivated — Trading resumed");
    }
  }

  const [settings] = await db
    .update(settingsTable)
    .set(updateData)
    .where(eq(settingsTable.id, existing.id))
    .returning();

  res.json(serializeSettings(settings));
});

export default router;
