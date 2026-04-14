import { EventEmitter } from "events";
import WebSocket from "ws";
import { logger } from "./logger";

const ORDER_WS_URL = "wss://api-order-update.dhan.co";
const MIN_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 120_000;

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
  private destroyed = false;
  private reconnectDelay = MIN_RECONNECT_MS;

  configure(clientId: string, accessToken: string) {
    this.clientId = clientId;
    this.accessToken = accessToken;
    this.reconnectDelay = MIN_RECONNECT_MS;
  }

  connect() {
    if (this.destroyed) return;
    if (!this.clientId || !this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    logger.info("OrderUpdateWS connecting...");
    this.ws = new WebSocket(ORDER_WS_URL);

    this.ws.on("open", () => {
      logger.info("OrderUpdateWS connected — sending auth");
      this.connected = true;
      this.reconnectDelay = MIN_RECONNECT_MS;
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

    this.ws.on("message", (data: Buffer | ArrayBuffer) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf.length === 0) return;

        const firstByte = buf[0];

        if (firstByte !== 0x7b && firstByte !== 0x5b) {
          logger.debug({ bytes: buf.length, first: firstByte }, "OrderUpdateWS: binary/protocol frame — skipping");
          return;
        }

        const json = JSON.parse(buf.toString("utf-8")) as OrderUpdate;
        if (!json || typeof json !== "object") return;

        logger.info({ orderUpdate: json }, "OrderUpdateWS: order update received");
        this.emit("orderUpdate", json);
      } catch (e) {
        logger.debug({ err: (e as Error).message }, "OrderUpdateWS: unhandled frame");
      }
    });

    this.ws.on("ping", () => {
      this.ws?.pong();
    });

    this.ws.on("close", (code) => {
      this.connected = false;
      if (this.destroyed) return;
      logger.warn({ code, nextRetryMs: this.reconnectDelay }, "OrderUpdateWS disconnected");
      this.emit("disconnected", { code });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.warn({ err: (err as Error).message }, "OrderUpdateWS error");
    });
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) {
        logger.info({ delayMs: delay }, "OrderUpdateWS reconnecting...");
        this.connect();
      }
    }, delay);
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  reset() {
    this.destroyed = false;
    this.reconnectDelay = MIN_RECONNECT_MS;
  }

  isConnected() { return this.connected; }
}

export const orderUpdateWS = new OrderUpdateWS();
