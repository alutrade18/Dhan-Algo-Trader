import { Router, type IRouter } from "express";
import type { Server as SocketIOServer } from "socket.io";
import { logger } from "../lib/logger";
import { sendTelegramAlert } from "../lib/telegram";

export function createPostbackRouter(io: SocketIOServer): IRouter {
  const router: IRouter = Router();

  router.post("/postback", async (req, res): Promise<void> => {
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
        void sendTelegramAlert(
          `✅ *ORDER EXECUTED*\nSymbol: ${symbol}\nSide: ${side} | Qty: ${qty}\nPrice: ₹${price}\nOrder: ${orderNo}`,
        );
      } else if (status === "REJECTED") {
        const reason = String(payload.omsErrorDescription ?? payload.OmsErrorDescription ?? "Unknown");
        void sendTelegramAlert(
          `❌ *ORDER REJECTED*\nSymbol: ${symbol}\nReason: ${reason}\nOrder: ${orderNo}`,
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
