import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";
import { db, settingsTable, auditLogTable } from "@workspace/db";
import { dhanClient } from "../lib/dhan-client";
import { sendTelegramAlert, sendTelegramAlertIfEnabled, sendTelegramTest } from "../lib/telegram";
import { decryptToken } from "../lib/crypto-utils";

const APP_NAME = process.env.APP_NAME ?? "Algo Trader";

function hashPin(pin: string): string {
  const salt = process.env.PIN_SALT ?? process.env.ENCRYPTION_KEY?.slice(0, 32) ?? "rajesh-algo-salt-v2";
  return crypto.createHash("sha256").update(pin + salt).digest("hex");
}

async function sendTelegramPing(botToken: string, chatId: string): Promise<void> {
  try {
    const now = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: true,
    });
    const message = [
      `🚀 *${APP_NAME.toUpperCase()} — ALERTS ACTIVE*`,
      "━━━━━━━━━━━━━━━━━━━━━━━",
      "",
      "✅ *Telegram channel connected successfully\\.*",
      "",
      "You will now receive real\\-time notifications for:",
      "• 📈 Order executions & fills",
      "• 🛡 Kill switch activations",
      "• ⚠️ Daily loss limit breaches",
      "• 🔁 Auto square\\-off triggers",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━",
      `🕐 *Activated:* ${now} IST`,
      `🏦 *Broker:* Dhan NSE/BSE`,
      "━━━━━━━━━━━━━━━━━━━━━━━",
      `⚡ _${APP_NAME} · Precision\\. Speed\\. Control\\._`,
    ].join("\n");

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "MarkdownV2" }),
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
  const connected = dhanClient.isConnected();
  const tokenExpired = dhanClient.isTokenExpired();
  return {
    id: s.id,
    // Always return masked clientId from DB (so user can re-authenticate without retyping)
    dhanClientId: s.brokerClientId ? "****" + s.brokerClientId.slice(-4) : "",
    // Clear masked token when expired — forces the frontend form field to empty
    dhanAccessToken: (() => {
      if (!connected || !s.brokerAccessToken) return "";
      const plain = decryptToken(s.brokerAccessToken);
      return plain ? "****" + plain.slice(-4) : "";
    })(),
    apiConnected: connected,
    tokenExpired,
    maxDailyLoss: s.maxDailyLoss !== null && s.maxDailyLoss !== undefined ? Number(s.maxDailyLoss) : 0,
    theme: s.theme,
    hasTelegramToken: !!s.telegramBotToken,
    hasTelegramChatId: !!s.telegramChatId,
    telegramBotToken: s.telegramBotToken ? "*".repeat(7) + s.telegramBotToken.slice(-3) : "",
    telegramChatId: s.telegramChatId ? "*".repeat(4) + s.telegramChatId.slice(-3) : "",
    killSwitchEnabled: s.killSwitchEnabled,
    killSwitchPin: s.killSwitchPin ? "****" : null,
    hasKillSwitchPin: !!s.killSwitchPin,
    updatedAt: s.updatedAt?.toISOString(),
    autoSquareOffEnabled: s.autoSquareOffEnabled,
    autoSquareOffTime: s.autoSquareOffTime,
    telegramAlerts: s.telegramAlerts ?? {
      orderFills: true,
      superOrders: true,
      killSwitch: true,
      autoSquareOff: true,
      criticalErrors: true,
    },
    dashboardWidgets: s.dashboardWidgets ?? {
      todayPnl: true,
      totalPnl: true,
      availableBalance: true,
      activeStrategies: true,
      equityCurve: true,
    },
    refreshIntervalSeconds: s.refreshIntervalSeconds ?? 15,
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

  set("theme", "theme");
  set("autoSquareOffEnabled", "autoSquareOffEnabled", v => Boolean(v));
  set("autoSquareOffTime", "autoSquareOffTime");
  set("refreshIntervalSeconds", "refreshIntervalSeconds", v => Number(v));

  if (body.maxDailyLoss !== undefined && body.maxDailyLoss !== null) {
    const val = Number(body.maxDailyLoss);
    if (!isNaN(val) && val >= 0) {
      if (String(val) !== (existing.maxDailyLoss ?? "")) auditEntries.push({ field: "maxDailyLoss", old: existing.maxDailyLoss?.toString() ?? null, new: String(val) });
      updateData.maxDailyLoss = val.toString();
    }
  }
  if (body.dashboardWidgets !== undefined && typeof body.dashboardWidgets === "object") {
    updateData.dashboardWidgets = body.dashboardWidgets;
  }

  if (body.telegramAlerts !== undefined && typeof body.telegramAlerts === "object") {
    updateData.telegramAlerts = body.telegramAlerts;
  }


  // Telegram token handling: null = explicit clear; non-empty real value = update; empty/masked = skip
  const rawToken = body.telegramBotToken;
  const rawChatId = body.telegramChatId;
  const isMasked = (v: unknown) => typeof v === "string" && v.startsWith("*");
  const isEmpty = (v: unknown) => v === "" || v === undefined;

  if (rawToken === null) {
    updateData.telegramBotToken = null;
  } else if (!isEmpty(rawToken) && !isMasked(rawToken)) {
    updateData.telegramBotToken = String(rawToken);
  }

  if (rawChatId === null) {
    updateData.telegramChatId = null;
  } else if (!isEmpty(rawChatId) && !isMasked(rawChatId)) {
    updateData.telegramChatId = String(rawChatId);
  }

  const credentialsChanged =
    (updateData.telegramBotToken !== undefined && updateData.telegramBotToken !== null) ||
    (updateData.telegramChatId !== undefined && updateData.telegramChatId !== null);
  const effectiveToken = (updateData.telegramBotToken as string | null | undefined) !== undefined
    ? (updateData.telegramBotToken as string | null) : existing.telegramBotToken;
  const effectiveChatId = (updateData.telegramChatId as string | null | undefined) !== undefined
    ? (updateData.telegramChatId as string | null) : existing.telegramChatId;
  if (effectiveToken && effectiveChatId && credentialsChanged) void sendTelegramPing(effectiveToken, effectiveChatId);

  if (body.killSwitchEnabled !== undefined) {
    updateData.killSwitchEnabled = Boolean(body.killSwitchEnabled);
    if (Boolean(body.killSwitchEnabled) && !existing.killSwitchEnabled) {
      void sendTelegramAlertIfEnabled("killSwitch", "🚨 *Emergency Kill Switch ACTIVATED* — All trading halted");
      auditEntries.push({ field: "killSwitchEnabled", old: "false", new: "true" });
    } else if (!Boolean(body.killSwitchEnabled) && existing.killSwitchEnabled) {
      void sendTelegramAlertIfEnabled("killSwitch", "✅ Kill switch deactivated — Trading resumed");
      auditEntries.push({ field: "killSwitchEnabled", old: "true", new: "false" });
    }
  }

  if (body.killSwitchPin !== undefined) {
    updateData.killSwitchPin = body.killSwitchPin ? hashPin(String(body.killSwitchPin)) : null;
    auditEntries.push({ field: "killSwitchPin", old: existing.killSwitchPin ? "****" : null, new: body.killSwitchPin ? "****" : null });
  }

  if (body.clearKillSwitchPin === true) {
    // Require the current PIN to be verified server-side before clearing it.
    // Prevents anyone with device access from deleting the PIN by entering any two identical digits.
    if (existing.killSwitchPin) {
      const currentPin = typeof body.currentPin === "string" ? body.currentPin : "";
      if (!currentPin || hashPin(currentPin) !== existing.killSwitchPin) {
        res.status(403).json({ error: "Incorrect PIN. Please enter your current PIN to delete it." });
        return;
      }
    }
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
  if (pin && hashPin(pin) === settings.killSwitchPin) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false, error: "Incorrect PIN" });
  }
});

router.post("/telegram/test", async (req, res): Promise<void> => {
  try {
    const settings = await getOrCreateSettings();
    if (!settings.telegramBotToken || !settings.telegramChatId) {
      res.status(400).json({ ok: false, error: "Telegram is not configured. Save Bot Token and Chat ID first." });
      return;
    }
    const result = await sendTelegramTest(settings.telegramBotToken, settings.telegramChatId);
    if (result.ok) {
      res.json({ ok: true });
    } else {
      res.status(502).json({ ok: false, error: result.error ?? "Telegram API error" });
    }
  } catch (e) {
    req.log.error({ err: e }, "Telegram test failed");
    res.status(500).json({ ok: false, error: "Internal server error" });
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
