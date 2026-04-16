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
  ltq?: number;
  avgPrice?: number;
  volume?: number;
  totalSellQty?: number;
  totalBuyQty?: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface OIData {
  securityId: number;
  exchangeSegment: string;
  oi: number;
}

// From Dhan Python SDK reference (marketfeed.py):
//   IDX=0, NSE=1, NSE_FNO=2, NSE_CURR=3, BSE=4, MCX=5, BSE_CURR=7, BSE_FNO=8
// Binary packets carry the exchange ID as a uint8 at offset 3 of every packet.
const EXCHANGE_MAP: Record<number, string> = {
  0: "IDX_I",
  1: "NSE_EQ",
  2: "NSE_FNO",
  3: "NSE_CURRENCY",
  4: "BSE_EQ",
  5: "MCX_COMM",
  7: "BSE_CURRENCY",
  8: "BSE_FNO",
};

// Reverse map: segment string → Dhan exchange numeric ID
const EXCHANGE_NUM_MAP: Record<string, number> = {
  "IDX_I": 0, "NSE_EQ": 1, "NSE_FNO": 2, "NSE_CURRENCY": 3,
  "BSE_EQ": 4, "MCX_COMM": 5, "BSE_CURRENCY": 7, "BSE_FNO": 8,
};

// Request codes (subscribe): Ticker=15, Quote=17, Full=21
// Unsubscribe codes = subscribe_code + 1: 16, 18, 22
const REQUEST_CODE = { TICKER: 15, QUOTE: 17, FULL: 21 };
const UNSUB_CODE: Record<number, number> = { 15: 16, 17: 18, 21: 22 };

const MIN_RECONNECT_MS = 5_000;
const MAX_RECONNECT_MS = 120_000;

// Packet binary layout (little-endian), common header for all packet types:
//   Offset 0  — uint8  — response code
//   Offset 1  — uint16 — message length
//   Offset 3  — uint8  — exchange segment ID (EXCHANGE_MAP key)
//   Offset 4  — uint32 — security ID
//   Offset 8  — float  — LTP
//
// Ticker (responseCode=2): header + LTT(uint32)          → 16 bytes total
// Quote  (responseCode=4): header + LTQ(uint16) + LTT(uint32) + avgPrice(f) + vol(u32) +
//                          sellQty(u32) + buyQty(u32) + open(f) + close(f) + high(f) + low(f) → 50 bytes
// Full   (responseCode=8): like Quote + OI(u32) + OI_hi(u32) + OI_lo(u32) before OHLC + depth(100b) → 162 bytes
// OI     (responseCode=5): header(4B) + secId(u32) + OI(u32)  → 12 bytes
// PrevClose(responseCode=6): same as Ticker layout → 16 bytes
// Status (responseCode=7): 8 bytes
// Disconnect(responseCode=50): 10 bytes with error code at offset 8

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

    // Bytes 1-2: message length (uint16 LE) — skip for routing
    // Byte 3: exchange segment ID — THIS is the correct offset per Dhan binary spec
    const exchId = buf.readUInt8(3);
    const exchSeg = EXCHANGE_MAP[exchId] ?? "UNKNOWN";

    // Security ID at bytes 4-7 — Dhan publishes this as an unsigned 32-bit LE
    // integer. Parsing it as signed (and abs-ing) silently corrupts IDs >= 2^31.
    const securityId = buf.readUInt32LE(4);

    // LTP at bytes 8-11 (float32 LE) — same position for all packet types
    if (buf.length < 12) return;
    const ltp = buf.readFloatLE(8);

    if (responseCode === 2) {
      // Ticker: <B H B I f I> = 16 bytes
      // Offset 12-15: LTT (uint32 LE)
      if (buf.length < 16) return;
      const ltt = buf.readUInt32LE(12);
      const tick: TickData = { securityId, exchangeSegment: exchSeg, ltp, ltt };
      this.onValidPacketReceived();
      this.emit("tick", tick);

    } else if (responseCode === 4) {
      // Quote: <B H B I f H I f I I I f f f f> = 50 bytes
      //   8-11:  LTP (f)
      //   12-13: LTQ (H = uint16)
      //   14-17: LTT (I = uint32)
      //   18-21: avg_price (f)
      //   22-25: volume (I)
      //   26-29: total_sell_qty (I)
      //   30-33: total_buy_qty (I)
      //   34-37: open (f)
      //   38-41: close (f)
      //   42-45: high (f)
      //   46-49: low (f)
      if (buf.length < 50) return;
      const ltq    = buf.readUInt16LE(12);
      const ltt    = buf.readUInt32LE(14);
      const avgPrice = buf.readFloatLE(18);
      const volume = buf.readUInt32LE(22);
      const totalSellQty = buf.readUInt32LE(26);
      const totalBuyQty  = buf.readUInt32LE(30);
      const open   = buf.readFloatLE(34);
      const close  = buf.readFloatLE(38);
      const high   = buf.readFloatLE(42);
      const low    = buf.readFloatLE(46);
      const quote: QuoteData = {
        securityId, exchangeSegment: exchSeg,
        ltp, ltt, ltq, avgPrice, volume, totalSellQty, totalBuyQty,
        open, high, low, close,
      };
      this.onValidPacketReceived();
      this.emit("quote", quote);
      this.emit("tick", { securityId, exchangeSegment: exchSeg, ltp, ltt });

    } else if (responseCode === 8) {
      // Full packet: <B H B I f H I f I I I I I I f f f f 100s> = 162 bytes
      //   8-11:  LTP (f)
      //   12-13: LTQ (H)
      //   14-17: LTT (I)
      //   18-21: avg_price (f)
      //   22-25: volume (I)
      //   26-29: total_sell_qty (I)
      //   30-33: total_buy_qty (I)
      //   34-37: OI (I)
      //   38-41: oi_day_high (I)
      //   42-45: oi_day_low (I)
      //   46-49: open (f)
      //   50-53: close (f)
      //   54-57: high (f)
      //   58-61: low (f)
      //   62-161: market depth (100 bytes, 5 levels × 20 bytes each)
      if (buf.length < 62) return;
      const ltq    = buf.readUInt16LE(12);
      const ltt    = buf.readUInt32LE(14);
      const avgPrice = buf.readFloatLE(18);
      const volume = buf.readUInt32LE(22);
      const totalSellQty = buf.readUInt32LE(26);
      const totalBuyQty  = buf.readUInt32LE(30);
      const oi     = buf.readUInt32LE(34);
      const open   = buf.readFloatLE(46);
      const close  = buf.readFloatLE(50);
      const high   = buf.readFloatLE(54);
      const low    = buf.readFloatLE(58);
      const full: QuoteData & { oi?: number } = {
        securityId, exchangeSegment: exchSeg,
        ltp, ltt, ltq, avgPrice, volume, totalSellQty, totalBuyQty,
        open, high, low, close, oi,
      };
      this.onValidPacketReceived();
      this.emit("quote", full);
      this.emit("tick", { securityId, exchangeSegment: exchSeg, ltp, ltt });

    } else if (responseCode === 5) {
      // OI data: <B H B I I> = 12 bytes
      //   4-7: security ID (already read)
      //   8-11: OI (I = uint32)
      if (buf.length < 12) return;
      const oi = buf.readUInt32LE(8);
      const oiData: OIData = { securityId, exchangeSegment: exchSeg, oi };
      this.onValidPacketReceived();
      this.emit("oi", oiData);

    } else if (responseCode === 6) {
      // Previous close: same layout as Ticker → 16 bytes
      // Offset 8-11: prev_close (f), offset 12-15: prev_OI (I)
      if (buf.length < 16) return;
      const prevClose = buf.readFloatLE(8);
      const prevOI    = buf.readUInt32LE(12);
      this.onValidPacketReceived();
      this.emit("prevClose", { securityId, exchangeSegment: exchSeg, prevClose, prevOI });

    } else if (responseCode === 7) {
      // Market status packet — no security-specific data
      this.onValidPacketReceived();

    } else if (responseCode === 50) {
      // Server disconnect: error code at bytes 8-9 (uint16 LE)
      if (buf.length >= 10) {
        const errorCode = buf.readUInt16LE(8);
        const errorMessages: Record<number, string> = {
          805: "Too many active WebSocket connections",
          806: "Subscribe to Data APIs to continue",
          807: "Access Token is expired",
          808: "Invalid Client ID",
          809: "Authentication failed",
        };
        logger.warn({ errorCode, msg: errorMessages[errorCode] ?? "Unknown" }, "MarketFeedWS: server disconnect");
      } else {
        logger.warn("MarketFeedWS: server sent disconnect packet");
      }
      this.ws?.close();
    }
  }

  subscribe(exchangeSegment: string, securityIds: number[], mode: "ticker" | "quote" | "full" = "ticker") {
    const exchNum = EXCHANGE_NUM_MAP[exchangeSegment] ?? 1;
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
    // Dhan v2 subscription: send in batches of 100
    for (let i = 0; i < securityIds.length; i += 100) {
      const batch = securityIds.slice(i, i + 100);
      const msg = JSON.stringify({
        RequestCode: requestCode,
        InstrumentCount: batch.length,
        InstrumentList: batch.map(id => ({
          ExchangeSegment: EXCHANGE_MAP[exchange] ?? "NSE_EQ",
          SecurityId: String(id),
        })),
      });
      this.ws.send(msg);
    }
  }

  unsubscribe(exchangeSegment: string, securityIds: number[]) {
    const exchNum = EXCHANGE_NUM_MAP[exchangeSegment] ?? 1;

    for (const mode of ["ticker", "quote", "full"] as const) {
      const requestCode = mode === "full" ? REQUEST_CODE.FULL : mode === "quote" ? REQUEST_CODE.QUOTE : REQUEST_CODE.TICKER;
      const key = `${exchangeSegment}:${mode}`;
      const sub = this.subscriptions.get(key);
      if (sub) {
        for (const id of securityIds) sub.securityIds.delete(id);
        if (sub.securityIds.size === 0) this.subscriptions.delete(key);

        if (this.ws?.readyState === WebSocket.OPEN) {
          // Unsubscribe code = subscribe code + 1 (per Dhan Python SDK)
          const unsubCode = UNSUB_CODE[requestCode] ?? requestCode + 1;
          const msg = JSON.stringify({
            RequestCode: unsubCode,
            InstrumentCount: securityIds.length,
            InstrumentList: securityIds.map(id => ({
              ExchangeSegment: EXCHANGE_MAP[exchNum] ?? "NSE_EQ",
              SecurityId: String(id),
            })),
          });
          this.ws.send(msg);
        }
      }
    }
  }

  disconnect() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.subscriptions.clear();
  }

  reset() {
    this.destroyed = false;
    this.reconnectDelay = MIN_RECONNECT_MS;
  }

  isConnected() { return this.connected; }
}

export const marketFeedWS = new MarketFeedWS();
