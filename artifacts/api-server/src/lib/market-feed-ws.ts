import { EventEmitter } from "events";
import WebSocket from "ws";
import { logger } from "./logger";

const FEED_URL = "wss://api-feed.dhan.co";

interface TickData {
  securityId: number;
  exchangeSegment: string;
  ltp: number;
  ltt?: number;
}

interface QuoteData extends TickData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const EXCHANGE_MAP: Record<number, string> = {
  0: "IDX_I", 1: "NSE_EQ", 2: "NSE_FNO", 3: "NSE_CURRENCY",
  4: "BSE_EQ", 5: "BSE_FNO", 6: "BSE_CURRENCY", 7: "MCX_COMM",
};

const REQUEST_CODE = { TICKER: 15, QUOTE: 17, FULL: 21 };

class MarketFeedWS extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId = "";
  private accessToken = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Map<string, { exchange: number; securityIds: number[]; mode: number }> = new Map();
  private connected = false;

  configure(clientId: string, accessToken: string) {
    this.clientId = clientId;
    this.accessToken = accessToken;
  }

  connect() {
    if (!this.clientId || !this.accessToken) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;

    const url = `${FEED_URL}?version=2&token=${this.accessToken}&clientId=${this.clientId}&authType=2`;
    logger.info("MarketFeedWS connecting...");

    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.on("open", () => {
      logger.info("MarketFeedWS connected");
      this.connected = true;
      this.emit("connected");
      this.resubscribeAll();
    });

    this.ws.on("message", (data: Buffer | ArrayBuffer) => {
      try {
        const buf = data instanceof ArrayBuffer ? Buffer.from(data) : data;
        this.parsePacket(buf);
      } catch (e) {
        logger.warn({ err: e }, "MarketFeedWS parse error");
      }
    });

    this.ws.on("ping", () => {
      this.ws?.pong();
    });

    this.ws.on("close", (code) => {
      logger.warn({ code }, "MarketFeedWS disconnected");
      this.connected = false;
      this.emit("disconnected", { code });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.warn({ err }, "MarketFeedWS error");
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      logger.info("MarketFeedWS reconnecting...");
      this.connect();
    }, 5000);
  }

  private parsePacket(buf: Buffer) {
    if (buf.length < 8) return;
    const responseCode = buf.readUInt8(0);
    const exchId = buf.readUInt8(1);
    const securityId = buf.readInt32LE(4);
    const exchSeg = EXCHANGE_MAP[exchId] ?? "UNKNOWN";

    if (responseCode === 2) {
      if (buf.length < 16) return;
      const ltp = buf.readFloatLE(8);
      const ltt = buf.readInt32LE(12);
      const tick: TickData = { securityId: Math.abs(securityId), exchangeSegment: exchSeg, ltp, ltt };
      this.emit("tick", tick);
    } else if (responseCode === 4) {
      if (buf.length < 40) return;
      const ltp = buf.readFloatLE(8);
      const ltt = buf.readInt32LE(12);
      const open = buf.readFloatLE(16);
      const high = buf.readFloatLE(20);
      const low = buf.readFloatLE(24);
      const close = buf.readFloatLE(28);
      const volume = buf.readInt32LE(32);
      const quote: QuoteData = { securityId: Math.abs(securityId), exchangeSegment: exchSeg, ltp, ltt, open, high, low, close, volume };
      this.emit("quote", quote);
      this.emit("tick", { securityId: quote.securityId, exchangeSegment: exchSeg, ltp, ltt });
    } else if (responseCode === 50) {
      logger.warn("MarketFeedWS: server sent disconnect packet");
      this.ws?.close();
    }
  }

  subscribe(exchangeSegment: string, securityIds: number[], mode: "ticker" | "quote" | "full" = "ticker") {
    const exchangeNumMap: Record<string, number> = {
      "IDX_I": 0, "NSE_EQ": 1, "NSE_FNO": 2, "NSE_CURRENCY": 3,
      "BSE_EQ": 4, "BSE_FNO": 5, "BSE_CURRENCY": 6, "MCX_COMM": 7,
    };
    const exchNum = exchangeNumMap[exchangeSegment] ?? 1;
    const requestCode = mode === "full" ? REQUEST_CODE.FULL : mode === "quote" ? REQUEST_CODE.QUOTE : REQUEST_CODE.TICKER;
    const key = `${exchangeSegment}:${mode}`;
    this.subscriptions.set(key, { exchange: exchNum, securityIds, mode: requestCode });

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(exchNum, securityIds, requestCode);
    }
  }

  private resubscribeAll() {
    for (const sub of this.subscriptions.values()) {
      this.sendSubscribe(sub.exchange, sub.securityIds, sub.mode);
    }
  }

  private sendSubscribe(exchange: number, securityIds: number[], requestCode: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({
      RequestCode: requestCode,
      InstrumentCount: securityIds.length,
      InstrumentList: securityIds.map(id => ({
        ExchangeSegment: EXCHANGE_MAP[exchange] ?? "NSE_EQ",
        SecurityId: String(id),
      })),
    });
    this.ws.send(msg);
  }

  unsubscribe(exchangeSegment: string, securityIds: number[]) {
    ["ticker", "quote", "full"].forEach(mode => {
      this.subscriptions.delete(`${exchangeSegment}:${mode}`);
    });

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const exchangeNumMap: Record<string, number> = {
      "IDX_I": 0, "NSE_EQ": 1, "NSE_FNO": 2, "NSE_CURRENCY": 3,
      "BSE_EQ": 4, "BSE_FNO": 5, "BSE_CURRENCY": 6, "MCX_COMM": 7,
    };
    const exchNum = exchangeNumMap[exchangeSegment] ?? 1;
    const msg = JSON.stringify({
      RequestCode: 16,
      InstrumentCount: securityIds.length,
      InstrumentList: securityIds.map(id => ({ ExchangeSegment: EXCHANGE_MAP[exchNum] ?? "NSE_EQ", SecurityId: String(id) })),
    });
    this.ws.send(msg);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  isConnected() { return this.connected; }
}

export const marketFeedWS = new MarketFeedWS();
