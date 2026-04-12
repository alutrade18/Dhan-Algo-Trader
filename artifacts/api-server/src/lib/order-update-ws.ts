import { EventEmitter } from "events";
import WebSocket from "ws";
import { logger } from "./logger";

const ORDER_WS_URL = "wss://api-order-update.dhan.co";

export interface OrderUpdate {
  OrderNo?: string;
  Status?: string;
  TxnType?: string;
  Product?: string;
  Symbol?: string;
  Quantity?: number;
  TradedQty?: number;
  TradedPrice?: number;
  Exchange?: string;
  Segment?: string;
  LegName?: string;
  AverageTradedPrice?: number;
  OmsErrorDescription?: string;
  ExchangeOrderId?: string;
  CorrelationId?: string;
  [key: string]: unknown;
}

class OrderUpdateWS extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId = "";
  private accessToken = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  configure(clientId: string, accessToken: string) {
    this.clientId = clientId;
    this.accessToken = accessToken;
  }

  connect() {
    if (!this.clientId || !this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    logger.info("OrderUpdateWS connecting...");
    this.ws = new WebSocket(ORDER_WS_URL);

    this.ws.on("open", () => {
      logger.info("OrderUpdateWS connected — sending auth");
      this.connected = true;
      const authMsg = JSON.stringify({
        LoginReq: {
          MsgCode: 42,
          ClientId: this.clientId,
          Token: this.accessToken,
        },
        UserType: "SELF",
      });
      this.ws!.send(authMsg);
      this.emit("connected");
    });

    this.ws.on("message", (data: Buffer) => {
      try {
        const text = data.toString("utf-8");
        const json = JSON.parse(text) as OrderUpdate;
        logger.info({ orderUpdate: json }, "OrderUpdateWS: order update received");
        this.emit("orderUpdate", json);
      } catch (e) {
        logger.warn({ err: e, raw: data.toString() }, "OrderUpdateWS parse error");
      }
    });

    this.ws.on("close", (code) => {
      logger.warn({ code }, "OrderUpdateWS disconnected");
      this.connected = false;
      this.emit("disconnected", { code });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.warn({ err }, "OrderUpdateWS error");
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      logger.info("OrderUpdateWS reconnecting...");
      this.connect();
    }, 5000);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected() { return this.connected; }
}

export const orderUpdateWS = new OrderUpdateWS();
