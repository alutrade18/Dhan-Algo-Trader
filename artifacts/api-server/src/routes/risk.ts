import { Router, type IRouter } from "express";
import { dhanClient, DhanApiError } from "../lib/dhan-client";
import { db, settingsTable } from "@workspace/db";
import { sendTelegramAlert } from "../lib/telegram";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function requireBroker(res: Parameters<Parameters<typeof router.get>[1]>[1]): boolean {
  if (!dhanClient.isConfigured()) {
    res.status(403).json({ error: "Broker not connected. Connect your Dhan account first." });
    return false;
  }
  return true;
}

function noCache(res: Parameters<Parameters<typeof router.get>[1]>[1]) {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function getISTDateString(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

const deactivationTracker: { date: string; count: number } = {
  date: "",
  count: 0,
};

function canDeactivateToday(): boolean {
  const today = getISTDateString();
  if (deactivationTracker.date !== today) {
    deactivationTracker.date = today;
    deactivationTracker.count = 0;
  }
  return deactivationTracker.count < 1;
}

function recordDeactivation() {
  const today = getISTDateString();
  if (deactivationTracker.date !== today) {
    deactivationTracker.date = today;
    deactivationTracker.count = 0;
  }
  deactivationTracker.count += 1;
}

async function autoDeactivateKillSwitch() {
  if (!dhanClient.isConfigured()) return;
  try {
    const status = (await dhanClient.getKillSwitchStatus()) as { killSwitchStatus?: string };
    const isActive = status?.killSwitchStatus === "ACTIVE" || status?.killSwitchStatus === "ACTIVATE";
    if (!isActive) return;

    await dhanClient.setKillSwitch("DEACTIVATE");
    const settings = await db.select().from(settingsTable).limit(1);
    if (settings.length > 0) {
      await db.update(settingsTable)
        .set({ killSwitchEnabled: false, updatedAt: new Date() })
        .where(eq(settingsTable.id, settings[0].id));
    }
    deactivationTracker.date = getISTDateString();
    deactivationTracker.count = 0;
    void sendTelegramAlert("🟢 *Midnight Reset* — Kill switch automatically deactivated. Fresh trading allowed for the new day.");
  } catch {
    // silent
  }
}

function startKillSwitchScheduler() {
  setInterval(() => {
    const now = new Date();
    // Convert to IST (UTC+5:30) and check for midnight (00:00 IST)
    const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
    const h = istNow.getUTCHours();
    const m = istNow.getUTCMinutes();
    // Auto-deactivate kill switch at midnight IST (00:00) so fresh trading resumes
    if (h === 0 && m === 0) {
      void autoDeactivateKillSwitch();
    }
  }, 60 * 1000);
}

startKillSwitchScheduler();

router.get("/risk/killswitch", async (_req, res): Promise<void> => {
  noCache(res);
  if (!requireBroker(res)) return;
  try {
    const data = (await dhanClient.getKillSwitchStatus()) as Record<string, unknown>;
    const ksActive = data?.killSwitchStatus === "ACTIVE" || data?.killSwitchStatus === "ACTIVATE";
    res.json({
      ...data,
      isActive: ksActive,
      canDeactivateToday: canDeactivateToday(),
      deactivationsUsed: deactivationTracker.count,
    });
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to get kill switch status" });
    }
  }
});

router.post("/risk/killswitch", async (req, res): Promise<void> => {
  noCache(res);
  if (!requireBroker(res)) return;
  const { status } = req.body as { status?: string };
  if (status !== "ACTIVATE" && status !== "DEACTIVATE") {
    res.status(400).json({ error: "status must be ACTIVATE or DEACTIVATE" });
    return;
  }

  if (status === "DEACTIVATE" && !canDeactivateToday()) {
    // Reset time = next midnight IST = next day 00:00 IST = next day 18:30 UTC (previous day)
    const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const resetTime = new Date(istNow);
    resetTime.setUTCDate(resetTime.getUTCDate() + 1);
    resetTime.setUTCHours(0, 0, 0, 0); // midnight IST = 00:00 IST time
    // Convert back to UTC for ISO string: subtract 5.5 hours
    const resetUTC = new Date(resetTime.getTime() - 5.5 * 60 * 60 * 1000);
    res.status(403).json({
      error: "Daily deactivation limit reached. Kill switch will auto-reset at midnight IST (start of next trading day).",
      resetAt: resetUTC.toISOString(),
      code: "DAILY_LIMIT_REACHED",
    });
    return;
  }

  try {
    const data = await dhanClient.setKillSwitch(status);
    const settings = await db.select().from(settingsTable).limit(1);
    if (settings.length > 0) {
      await db.update(settingsTable)
        .set({ killSwitchEnabled: status === "ACTIVATE", updatedAt: new Date() })
        .where(eq(settingsTable.id, settings[0].id));
    }
    if (status === "DEACTIVATE") {
      recordDeactivation();
    }
    void sendTelegramAlert(
      status === "ACTIVATE"
        ? "🛑 Kill Switch ACTIVATED — All order placement blocked."
        : "✅ Kill Switch DEACTIVATED — Trading resumed normally.",
    );
    res.json({
      ...(data as Record<string, unknown>),
      isActive: status === "ACTIVATE",
      canDeactivateToday: canDeactivateToday(),
      deactivationsUsed: deactivationTracker.count,
    });
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to toggle kill switch" });
    }
  }
});

router.get("/risk/pnl-exit", async (_req, res): Promise<void> => {
  noCache(res);
  if (!requireBroker(res)) return;
  try {
    const data = await dhanClient.getPnlExit();
    res.json(data);
  } catch (err) {
    if (err instanceof DhanApiError && err.status === 400) {
      res.json({ pnlExitStatus: "INACTIVE", message: "No active P&L exit configured" });
    } else if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to get P&L exit status" });
    }
  }
});

router.post("/risk/pnl-exit", async (req, res): Promise<void> => {
  noCache(res);
  if (!requireBroker(res)) return;
  const { profitValue, lossValue, productType, enableKillSwitch } = req.body as {
    profitValue?: number;
    lossValue?: number;
    productType?: string[];
    enableKillSwitch?: boolean;
  };
  if (!profitValue || !lossValue || !productType?.length) {
    res.status(400).json({ error: "profitValue, lossValue and productType are required" });
    return;
  }
  try {
    const data = await dhanClient.setPnlExit({
      profitValue: Number(profitValue),
      lossValue: Number(lossValue),
      productType,
      enableKillSwitch: enableKillSwitch ?? false,
    });
    res.json(data);
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to set P&L exit" });
    }
  }
});

router.delete("/risk/pnl-exit", async (_req, res): Promise<void> => {
  noCache(res);
  if (!requireBroker(res)) return;
  try {
    const data = await dhanClient.stopPnlExit();
    res.json(data);
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to stop P&L exit" });
    }
  }
});

export default router;
