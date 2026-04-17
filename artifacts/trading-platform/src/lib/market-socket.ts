import { io, Socket } from "socket.io-client";

const BASE = import.meta.env.BASE_URL;

interface TickData {
  securityId: number;
  exchangeSegment: string;
  ltp: number;
  ltt?: number;
}

export interface QuoteData extends TickData {
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  avgPrice?: number;
  ltq?: number;
  totalBuyQty?: number;
  totalSellQty?: number;
  oi?: number;
}

type TickCallback = (data: TickData) => void;
type QuoteCallback = (data: QuoteData) => void;
type OrderUpdateCallback = (data: Record<string, unknown>) => void;
type Mode = "ticker" | "quote" | "full";

interface SubEntry {
  exchange: string;
  mode: Mode;
  securityIds: Set<number>;
}

class MarketSocket {
  private socket: Socket;
  private tickListeners = new Map<string, Set<TickCallback>>();
  private quoteListeners = new Map<string, Set<QuoteCallback>>();
  private orderUpdateListeners = new Set<OrderUpdateCallback>();
  private subRegistry = new Map<string, SubEntry>();

  constructor() {
    this.socket = io(window.location.origin, {
      path: `${BASE}api/socket.io`.replace(/\/\//g, "/"),
      transports: ["websocket", "polling"],
    });

    this.socket.on("market:tick", (data: TickData) => {
      const key = `${data.exchangeSegment}:${data.securityId}`;
      this.tickListeners.get(key)?.forEach(cb => cb(data));
      this.tickListeners.get("*")?.forEach(cb => cb(data));
    });

    this.socket.on("market:quote", (data: QuoteData) => {
      const key = `${data.exchangeSegment}:${data.securityId}`;
      // Dispatch to tick listeners (LTP only)
      this.tickListeners.get(key)?.forEach(cb => cb(data));
      this.tickListeners.get("*")?.forEach(cb => cb(data));
      // Dispatch to quote listeners (full OHLCV data)
      this.quoteListeners.get(key)?.forEach(cb => cb(data));
      this.quoteListeners.get("*")?.forEach(cb => cb(data));
    });

    this.socket.on("order:update", (data: Record<string, unknown>) => {
      this.orderUpdateListeners.forEach(cb => cb(data));
    });

    this.socket.on("connect", () => {
      this.resubscribeAll();
    });
  }

  private registryKey(exchange: string, mode: Mode) {
    return `${exchange}:${mode}`;
  }

  private registerIds(exchange: string, securityIds: number[], mode: Mode) {
    const key = this.registryKey(exchange, mode);
    if (!this.subRegistry.has(key)) {
      this.subRegistry.set(key, { exchange, mode, securityIds: new Set() });
    }
    const entry = this.subRegistry.get(key)!;
    securityIds.forEach(id => entry.securityIds.add(id));
  }

  private deregisterIds(exchange: string, securityIds: number[], mode?: Mode) {
    const modes: Mode[] = mode ? [mode] : ["ticker", "quote", "full"];
    for (const m of modes) {
      const key = this.registryKey(exchange, m);
      const entry = this.subRegistry.get(key);
      if (entry) {
        securityIds.forEach(id => entry.securityIds.delete(id));
        if (entry.securityIds.size === 0) this.subRegistry.delete(key);
      }
    }
  }

  private resubscribeAll() {
    for (const { exchange, mode, securityIds } of this.subRegistry.values()) {
      const ids = Array.from(securityIds);
      if (ids.length > 0) {
        this.socket.emit("market:subscribe", { exchange, securityIds: ids, mode });
      }
    }
  }

  subscribe(exchange: string, securityId: number, cb: TickCallback, mode: Mode = "ticker") {
    const listenerKey = `${exchange}:${securityId}`;
    if (!this.tickListeners.has(listenerKey)) {
      this.tickListeners.set(listenerKey, new Set());
      this.registerIds(exchange, [securityId], mode);
      this.socket.emit("market:subscribe", { exchange, securityIds: [securityId], mode });
    }
    this.tickListeners.get(listenerKey)!.add(cb);
    return () => this.unsubscribe(exchange, securityId, cb);
  }

  subscribeQuote(exchange: string, securityId: number, cb: QuoteCallback): () => void {
    const listenerKey = `${exchange}:${securityId}`;
    if (!this.quoteListeners.has(listenerKey)) {
      this.quoteListeners.set(listenerKey, new Set());
    }
    this.quoteListeners.get(listenerKey)!.add(cb);

    // Also ensure we have a "quote" mode subscription so quote data flows
    if (!this.tickListeners.has(listenerKey)) {
      this.registerIds(exchange, [securityId], "quote");
      this.socket.emit("market:subscribe", { exchange, securityIds: [securityId], mode: "quote" });
    }

    return () => {
      const listeners = this.quoteListeners.get(listenerKey);
      if (listeners) {
        listeners.delete(cb);
        if (listeners.size === 0) {
          this.quoteListeners.delete(listenerKey);
          // Only unsubscribe from WS if no tick listeners either
          if (!this.tickListeners.has(listenerKey)) {
            this.deregisterIds(exchange, [securityId]);
            this.socket.emit("market:unsubscribe", { exchange, securityIds: [securityId] });
          }
        }
      }
    };
  }

  unsubscribe(exchange: string, securityId: number, cb: TickCallback) {
    const listenerKey = `${exchange}:${securityId}`;
    const listeners = this.tickListeners.get(listenerKey);
    if (listeners) {
      listeners.delete(cb);
      if (listeners.size === 0) {
        this.tickListeners.delete(listenerKey);
        if (!this.quoteListeners.has(listenerKey)) {
          this.deregisterIds(exchange, [securityId]);
          this.socket.emit("market:unsubscribe", { exchange, securityIds: [securityId] });
        }
      }
    }
  }

  subscribeBatch(
    exchange: string,
    securityIds: number[],
    cb: TickCallback,
    mode: Mode = "quote",
  ): () => void {
    if (securityIds.length === 0) return () => {};

    securityIds.forEach((secId) => {
      const listenerKey = `${exchange}:${secId}`;
      if (!this.tickListeners.has(listenerKey)) this.tickListeners.set(listenerKey, new Set());
      this.tickListeners.get(listenerKey)!.add(cb);
    });

    this.registerIds(exchange, securityIds, mode);
    this.socket.emit("market:subscribe", { exchange, securityIds, mode });

    return () => {
      securityIds.forEach((secId) => {
        const listenerKey = `${exchange}:${secId}`;
        const listeners = this.tickListeners.get(listenerKey);
        if (listeners) {
          listeners.delete(cb);
          if (listeners.size === 0) this.tickListeners.delete(listenerKey);
        }
      });
      this.deregisterIds(exchange, securityIds, mode);
      this.socket.emit("market:unsubscribe", { exchange, securityIds });
    };
  }

  onOrderUpdate(cb: OrderUpdateCallback): () => void {
    this.orderUpdateListeners.add(cb);
    return () => this.orderUpdateListeners.delete(cb);
  }

  isConnected() {
    return this.socket.connected;
  }

  getSocket() {
    return this.socket;
  }
}

export const marketSocket = new MarketSocket();
