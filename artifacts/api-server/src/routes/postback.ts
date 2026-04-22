import { Router, type IRouter } from "express";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "../lib/logger";
import { sendTelegramAlertIfEnabled, alertHeader, alertFooter } from "../lib/telegram";

export function createPostbackRouter(io: SocketIOServer): IRouter {
  const router: IRouter = Router();

  router.post("/postback", async (req, res): Promise<void> => {
    const expectedSecret = process.env.POSTBACK_SECRET;
    if (!expectedSecret) {
      logger.warn({ ip: req.ip }, "Postback received but POSTBACK_SECRET is not set — request rejected for security");
      res.status(401).json({ error: "Postback endpoint not configured. Set POSTBACK_SECRET environment variable." });
      return;
    }
    const provided = req.headers["x-postback-secret"] as string | undefined;
    if (provided !== expectedSecret) {
      logger.warn({ ip: req.ip }, "Postback rejected: invalid or missing secret");
      res.status(401).json({ error: "Unauthorized postback" });
      return;
    }

    try {
      const payload = req.body as Record<string, unknown>;
      logger.info({ postback: payload }, "Dhan postback received");

      io.emit("order:update", payload);

      const status = String(payload.orderStatus ?? payload.Status ?? "");
      const symbol = String(payload.tradingSymbol ?? payload.Symbol ?? "");
      const side = String(payload.transactionType ?? payload.TxnType ?? "");
      const qty = String(payload.quantity ?? payload.Quantity ?? "");
      const price = String(payload.averageTradedPrice ?? payload.TradedPrice ?? "");
      const orderNo = String(payload.orderId ?? payload.OrderNo ?? "");

      if (status === "TRADED") {
        void sendTelegramAlertIfEnabled(
          "orderFills",
          [
            alertHeader("ALGO TRADER", "ORDER EXECUTED"),
            "",
            `✅ *Trade filled successfully*`,
            "",
            `┃ 📊 *Symbol:* ${symbol}`,
            `┃ ${side === "BUY" ? "📈" : "📉"} *Side:* ${side} | Qty: ${qty}`,
            `┃ 💰 *Price:* ₹${price}`,
            `┃ 🔢 *Order ID:* ${orderNo}`,
            "",
            alertFooter(),
          ].join("\n"),
        );
      } else if (status === "REJECTED") {
        const reason = String(payload.omsErrorDescription ?? payload.OmsErrorDescription ?? "Unknown");
        void sendTelegramAlertIfEnabled(
          "orderFills",
          [
            alertHeader("ALGO TRADER", "ORDER REJECTED"),
            "",
            `❌ *Order was rejected*`,
            "",
            `┃ 📊 *Symbol:* ${symbol}`,
            `┃ ⚠️ *Reason:* ${reason}`,
            `┃ 🔢 *Order ID:* ${orderNo}`,
            "",
            alertFooter(),
          ].join("\n"),
        );
      }

      res.status(200).json({ status: "ok" });
    } catch (e) {
      logger.error({ err: e }, "Postback handler error");
      res.status(200).json({ status: "ok" });
    }
  });

  return router;
}

export default createPostbackRouter;
