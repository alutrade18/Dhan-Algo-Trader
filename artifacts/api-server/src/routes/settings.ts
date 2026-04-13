import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, settingsTable, auditLogTable } from "@workspace/db";
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
      "Your Telegram channel is now linked to the platform.",
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
    // fire-and-forget
  }
}

async function addAuditLog(action: string, field: string | null, oldVal: string | null, newVal: string | null, description?: string) {
  try {
    await db.insert(auditLogTable).values({
      action,
      field,
      oldValue: oldVal,
      newValue: newVal,
      description: description ?? null,
    });
  } catch {
    // non-critical
  }
}

const router: IRouter = Router();

export async function getOrCreateSettings() {
  let [settings] = await db.select().from(settingsTable);
  if (!settings) {
    [settings] = await db.insert(settingsTable).values({}).returning();
  }
  return settings;
}

function serializeSettings(s: typeof settingsTable.$inferSelect) {
  return {
    id: s.id,
    dhanClientId: process.env.DHAN_CLIENT_ID ? "****" + (process.env.DHAN_CLIENT_ID.slice(-4) || "") : "",
    apiConnected: dhanClient.isConfigured(),
    defaultProductType: s.defaultProductType,
    defaultOrderType: s.defaultOrderType,
    defaultExchange: s.defaultExchange,
    defaultQuantity: s.defaultQuantity ?? null,
    maxOrderValue: s.maxOrderValue ? Number(s.maxOrderValue) : null,
    maxDailyLoss: s.maxDailyLoss !== null && s.maxDailyLoss !== undefined ? Number(s.maxDailyLoss) : 5000,
    maxDailyProfit: s.maxDailyProfit ? Number(s.maxDailyProfit) : null,
    enableAutoTrading: s.enableAutoTrading,
    enableNotifications: s.enableNotifications,
    riskPerTrade: s.riskPerTrade ? Number(s.riskPerTrade) : null,
    theme: s.theme,
    telegramBotToken: s.telegramBotToken || "",
    telegramChatId: s.telegramChatId || "",
    killSwitchEnabled: s.killSwitchEnabled,
    killSwitchPin: s.killSwitchPin ? "****" : null,
    hasKillSwitchPin: !!s.killSwitchPin,
    updatedAt: s.updatedAt?.toISOString(),
    autoSquareOffEnabled: s.autoSquareOffEnabled,
    autoSquareOffTime: s.autoSquareOffTime,
    maxTradesPerDay: s.maxTradesPerDay ?? null,
    maxPositionSizeValue: s.maxPositionSizeValue ? Number(s.maxPositionSizeValue) : null,
    maxPositionSizeType: s.maxPositionSizeType,
    instrumentBlacklist: (s.instrumentBlacklist as string[] | null) ?? [],
    notificationPreferences: s.notificationPreferences ?? {
      orderFilled: true,
      targetHit: true,
      stopLossHit: true,
      killSwitchTriggered: true,
      tokenExpiry: true,
      strategyPausedActivated: true,
      dailyPnlSummary: false,
      autoSquareOff: true,
    },
    pushNotificationsEnabled: s.pushNotificationsEnabled,
    dashboardWidgets: s.dashboardWidgets ?? {
      todayPnl: true,
      totalPnl: true,
      availableBalance: true,
      activeStrategies: true,
      equityCurve: true,
    },
    refreshIntervalSeconds: s.refreshIntervalSeconds ?? 15,
    tradingHoursStart: s.tradingHoursStart ?? "09:00",
    tradingHoursEnd: s.tradingHoursEnd ?? "15:30",
  };
}

router.get("/settings", async (req, res): Promise<void> => {
  try {
    const settings = await getOrCreateSettings();
    res.json(serializeSettings(settings));
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch settings");
    res.status(500).json({ error: "Failed to fetch settings" });
  }
});

router.put("/settings", async (req, res): Promise<void> => {
  const existing = await getOrCreateSettings();
  const body = req.body as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  const auditEntries: Array<{ field: string; old: string | null; new: string | null }> = [];

  function set(field: string, dbField: string, serialize: (v: unknown) => unknown = v => v) {
    if (body[field] === undefined) return;
    const oldRaw = (existing as Record<string, unknown>)[dbField];
    const newVal = body[field];
    const serialized = serialize(newVal);
    updateData[dbField] = serialized;
    const oldStr = oldRaw != null ? String(oldRaw) : null;
    const newStr = newVal != null ? String(newVal) : null;
    if (oldStr !== newStr) auditEntries.push({ field, old: oldStr, new: newStr });
  }

  set("defaultProductType", "defaultProductType");
  set("defaultOrderType", "defaultOrderType");
  set("defaultExchange", "defaultExchange");
  set("defaultQuantity", "defaultQuantity", v => v != null ? Number(v) : null);
  set("enableAutoTrading", "enableAutoTrading", v => Boolean(v));
  set("enableNotifications", "enableNotifications", v => Boolean(v));
  set("theme", "theme");
  set("autoSquareOffEnabled", "autoSquareOffEnabled", v => Boolean(v));
  set("autoSquareOffTime", "autoSquareOffTime");
  set("maxTradesPerDay", "maxTradesPerDay", v => v != null ? Number(v) : null);
  set("maxPositionSizeType", "maxPositionSizeType");
  set("pushNotificationsEnabled", "pushNotificationsEnabled", v => Boolean(v));
  set("refreshIntervalSeconds", "refreshIntervalSeconds", v => Number(v));
  set("tradingHoursStart", "tradingHoursStart");
  set("tradingHoursEnd", "tradingHoursEnd");

  if (body.maxOrderValue !== undefined) {
    const val = body.maxOrderValue != null ? Number(body.maxOrderValue).toString() : null;
    if (val !== (existing.maxOrderValue ?? null)?.toString()) {
      auditEntries.push({ field: "maxOrderValue", old: existing.maxOrderValue?.toString() ?? null, new: val });
    }
    updateData.maxOrderValue = val;
  }
  if (body.maxDailyLoss !== undefined && body.maxDailyLoss !== null) {
    const val = Number(body.maxDailyLoss);
    if (!isNaN(val) && val >= 0) {
      if (String(val) !== (existing.maxDailyLoss ?? "")) auditEntries.push({ field: "maxDailyLoss", old: existing.maxDailyLoss?.toString() ?? null, new: String(val) });
      updateData.maxDailyLoss = val.toString();
    }
  }
  if (body.maxDailyProfit !== undefined) {
    const val = body.maxDailyProfit != null ? Number(body.maxDailyProfit).toString() : null;
    updateData.maxDailyProfit = val;
  }
  if (body.maxPositionSizeValue !== undefined) {
    const val = body.maxPositionSizeValue != null ? Number(body.maxPositionSizeValue).toString() : null;
    updateData.maxPositionSizeValue = val;
    auditEntries.push({ field: "maxPositionSizeValue", old: existing.maxPositionSizeValue?.toString() ?? null, new: val });
  }
  if (body.riskPerTrade !== undefined) {
    updateData.riskPerTrade = body.riskPerTrade != null ? Number(body.riskPerTrade).toString() : null;
  }
  if (body.instrumentBlacklist !== undefined && Array.isArray(body.instrumentBlacklist)) {
    const newList = (body.instrumentBlacklist as string[]).map(s => String(s).toUpperCase().trim());
    updateData.instrumentBlacklist = newList;
    auditEntries.push({ field: "instrumentBlacklist", old: JSON.stringify(existing.instrumentBlacklist), new: JSON.stringify(newList) });
  }
  if (body.notificationPreferences !== undefined && typeof body.notificationPreferences === "object") {
    updateData.notificationPreferences = body.notificationPreferences;
    auditEntries.push({ field: "notificationPreferences", old: JSON.stringify(existing.notificationPreferences), new: JSON.stringify(body.notificationPreferences) });
  }
  if (body.dashboardWidgets !== undefined && typeof body.dashboardWidgets === "object") {
    updateData.dashboardWidgets = body.dashboardWidgets;
  }
  if (body.pushSubscription !== undefined) {
    updateData.pushSubscription = body.pushSubscription;
  }

  const newToken = body.telegramBotToken !== undefined ? (body.telegramBotToken as string | null) || null : undefined;
  const newChatId = body.telegramChatId !== undefined ? (body.telegramChatId as string | null) || null : undefined;
  if (newToken !== undefined) updateData.telegramBotToken = newToken;
  if (newChatId !== undefined) updateData.telegramChatId = newChatId;
  const effectiveToken = newToken !== undefined ? newToken : existing.telegramBotToken;
  const effectiveChatId = newChatId !== undefined ? newChatId : existing.telegramChatId;
  const credentialsChanged = (newToken !== undefined && newToken !== null) || (newChatId !== undefined && newChatId !== null);
  if (effectiveToken && effectiveChatId && credentialsChanged) void sendTelegramPing(effectiveToken, effectiveChatId);

  if (body.killSwitchEnabled !== undefined) {
    updateData.killSwitchEnabled = Boolean(body.killSwitchEnabled);
    if (Boolean(body.killSwitchEnabled) && !existing.killSwitchEnabled) {
      void sendTelegramAlert("🚨 *Emergency Kill Switch ACTIVATED* — All trading halted");
      auditEntries.push({ field: "killSwitchEnabled", old: "false", new: "true" });
    } else if (!Boolean(body.killSwitchEnabled) && existing.killSwitchEnabled) {
      void sendTelegramAlert("✅ Kill switch deactivated — Trading resumed");
      auditEntries.push({ field: "killSwitchEnabled", old: "true", new: "false" });
    }
  }

  if (body.killSwitchPin !== undefined) {
    updateData.killSwitchPin = body.killSwitchPin ? String(body.killSwitchPin) : null;
    auditEntries.push({ field: "killSwitchPin", old: existing.killSwitchPin ? "****" : null, new: body.killSwitchPin ? "****" : null });
  }

  if (body.clearKillSwitchPin === true) {
    updateData.killSwitchPin = null;
    auditEntries.push({ field: "killSwitchPin", old: "****", new: null });
  }

  if (Object.keys(updateData).length === 0) {
    res.json(serializeSettings(existing));
    return;
  }

  const [updated] = await db.update(settingsTable).set(updateData).where(eq(settingsTable.id, existing.id)).returning();

  if (auditEntries.length > 0) {
    void Promise.all(
      auditEntries.map(e => addAuditLog("UPDATE_SETTINGS", e.field, e.old, e.new, `Changed ${e.field}`))
    );
  }

  res.json(serializeSettings(updated));
});

router.post("/settings/verify-pin", async (req, res): Promise<void> => {
  const { pin } = req.body as { pin?: string };
  const settings = await getOrCreateSettings();
  if (!settings.killSwitchPin) {
    res.json({ valid: true, message: "No PIN set" });
    return;
  }
  if (pin === settings.killSwitchPin) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false, error: "Incorrect PIN" });
  }
});

router.get("/settings/audit-log", async (req, res): Promise<void> => {
  try {
    const logs = await db.select().from(auditLogTable).orderBy(desc(auditLogTable.changedAt)).limit(50);
    res.json(logs);
  } catch (e) {
    req.log.error({ err: e }, "Failed to fetch audit log");
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

export default router;
