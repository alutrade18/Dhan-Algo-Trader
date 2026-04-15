import { io, Socket } from "socket.io-client";

const BASE = import.meta.env.BASE_URL;

interface TickData {
  securityId: number;
  exchangeSegment: string;
  ltp: number;
  ltt?: number;
}

type TickCallback = (data: TickData) => void;
type OrderUpdateCallback = (data: Record<string, unknown>) => void;
type Mode = "ticker" | "quote" | "full";

// Tracks all active subscriptions so we can resubscribe on reconnect
// key = `${exchange}:${mode}` → Set of security IDs
interface SubEntry {
  exchange: string;
  mode: Mode;
  securityIds: Set<number>;
}

class MarketSocket {
  private socket: Socket;
  private tickListeners = new Map<string, Set<TickCallback>>();
  private orderUpdateListeners = new Set<OrderUpdateCallback>();
  // subscription registry: keyed by `${exchange}:${mode}`
  private subRegistry = new Map<string, SubEntry>();

  constructor() {
    this.socket = io(window.location.origin, {
      path: `${BASE}api/socket.io`.replace(/\/\//g, "/"),
      transports: ["websocket", "polling"],
    });

    this.socket.on("market:tick", (data: TickData) => {
      const key = `${data.exchangeSegment}:${data.securityId}`;
      const listeners = this.tickListeners.get(key);
      if (listeners) listeners.forEach(cb => cb(data));
      const anyListeners = this.tickListeners.get("*");
      if (anyListeners) anyListeners.forEach(cb => cb(data));
    });

    this.socket.on("market:quote", (data: TickData) => {
      const key = `${data.exchangeSegment}:${data.securityId}`;
      const listeners = this.tickListeners.get(key);
      if (listeners) listeners.forEach(cb => cb(data));
      const anyListeners = this.tickListeners.get("*");
      if (anyListeners) anyListeners.forEach(cb => cb(data));
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

  unsubscribe(exchange: string, securityId: number, cb: TickCallback) {
    const listenerKey = `${exchange}:${securityId}`;
    const listeners = this.tickListeners.get(listenerKey);
    if (listeners) {
      listeners.delete(cb);
      if (listeners.size === 0) {
        this.tickListeners.delete(listenerKey);
        this.deregisterIds(exchange, [securityId]);
        this.socket.emit("market:unsubscribe", { exchange, securityIds: [securityId] });
      }
    }
  }

  // Batch subscribe: subscribes ALL securityIds in a single WebSocket message.
  // Returns a cleanup function that unsubscribes everything.
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
