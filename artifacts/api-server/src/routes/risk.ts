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

router.get("/risk/killswitch", async (_req, res): Promise<void> => {
  if (!requireBroker(res)) return;
  try {
    const data = await dhanClient.getKillSwitchStatus();
    res.json(data);
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to get kill switch status" });
    }
  }
});

router.post("/risk/killswitch", async (req, res): Promise<void> => {
  if (!requireBroker(res)) return;
  const { status } = req.body as { status?: string };
  if (status !== "ACTIVATE" && status !== "DEACTIVATE") {
    res.status(400).json({ error: "status must be ACTIVATE or DEACTIVATE" });
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
    void sendTelegramAlert(
      status === "ACTIVATE"
        ? "🛑 Kill Switch ACTIVATED — All order placement blocked."
        : "✅ Kill Switch DEACTIVATED — Trading resumed normally.",
    );
    res.json(data);
  } catch (err) {
    if (err instanceof DhanApiError) {
      res.status(err.status).json(err.toClientResponse());
    } else {
      res.status(500).json({ error: "Failed to toggle kill switch" });
    }
  }
});

router.post("/risk/pnl-exit", async (req, res): Promise<void> => {
  if (!requireBroker(res)) return;
  const { profitValue, lossValue, productType, enableKillSwitch } = req.body as {
    profitValue?: number;
    lossValue?: number;
    productType?: string[];
    enableKillSwitch?: boolean;
  };
  if (profitValue === undefined || lossValue === undefined || !productType?.length) {
    res.status(400).json({ error: "profitValue, lossValue and productType are required" });
    return;
  }
  try {
    const data = await dhanClient.setPnlExit({
      profitValue,
      lossValue,
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
