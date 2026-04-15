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
const MIN_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 120_000;

class MarketFeedWS extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId = "";
  private accessToken = "";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Map<string, { exchange: number; securityIds: Set<number>; mode: number }> = new Map();
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
        logger.debug({ err: (e as Error).message }, "MarketFeedWS parse error");
      }
    });

    this.ws.on("ping", () => {
      this.ws?.pong();
    });

    this.ws.on("close", (code) => {
      this.connected = false;
      if (this.destroyed) return;
      logger.warn({ code, nextRetryMs: this.reconnectDelay }, "MarketFeedWS disconnected");
      this.emit("disconnected", { code });
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      logger.warn({ err: (err as Error).message }, "MarketFeedWS error");
    });
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS);
    this.reconnectTimer = setTimeout(() => {
      if (!this.destroyed) {
        logger.info({ delayMs: delay }, "MarketFeedWS reconnecting...");
        this.connect();
      }
    }, delay);
  }

  private onValidPacketReceived() {
    this.reconnectDelay = MIN_RECONNECT_MS;
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
      this.onValidPacketReceived();
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
      this.onValidPacketReceived();
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

    const existing = this.subscriptions.get(key);
    if (existing) {
      for (const id of securityIds) existing.securityIds.add(id);
    } else {
      this.subscriptions.set(key, { exchange: exchNum, securityIds: new Set(securityIds), mode: requestCode });
    }

    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe(exchNum, securityIds, requestCode);
    }
  }

  private resubscribeAll() {
    for (const sub of this.subscriptions.values()) {
      const ids = Array.from(sub.securityIds);
      if (ids.length > 0) this.sendSubscribe(sub.exchange, ids, sub.mode);
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
    const exchangeNumMap: Record<string, number> = {
      "IDX_I": 0, "NSE_EQ": 1, "NSE_FNO": 2, "NSE_CURRENCY": 3,
      "BSE_EQ": 4, "BSE_FNO": 5, "BSE_CURRENCY": 6, "MCX_COMM": 7,
    };
    const exchNum = exchangeNumMap[exchangeSegment] ?? 1;

    for (const mode of ["ticker", "quote", "full"] as const) {
      const key = `${exchangeSegment}:${mode}`;
      const sub = this.subscriptions.get(key);
      if (sub) {
        for (const id of securityIds) sub.securityIds.delete(id);
        if (sub.securityIds.size === 0) this.subscriptions.delete(key);
      }
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg = JSON.stringify({
      RequestCode: 16,
      InstrumentCount: securityIds.length,
      InstrumentList: securityIds.map(id => ({ ExchangeSegment: EXCHANGE_MAP[exchNum] ?? "NSE_EQ", SecurityId: String(id) })),
    });
    this.ws.send(msg);
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    // Clear all subscriptions so a subsequent connect() starts fresh.
    // This prevents stale subscriptions from a previous broker session
    // being replayed to a new broker's WebSocket on reconnect.
    this.subscriptions.clear();
  }

  reset() {
    this.destroyed = false;
    this.reconnectDelay = MIN_RECONNECT_MS;
  }

  isConnected() { return this.connected; }
}

export const marketFeedWS = new MarketFeedWS();
