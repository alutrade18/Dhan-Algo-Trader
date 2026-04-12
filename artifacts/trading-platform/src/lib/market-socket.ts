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

class MarketSocket {
  private socket: Socket;
  private tickListeners = new Map<string, Set<TickCallback>>();
  private orderUpdateListeners = new Set<OrderUpdateCallback>();

  constructor() {
    this.socket = io(window.location.origin, {
      path: `${BASE}socket.io`.replace(/\/\//g, "/"),
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
    });

    this.socket.on("order:update", (data: Record<string, unknown>) => {
      this.orderUpdateListeners.forEach(cb => cb(data));
    });
  }

  subscribe(exchange: string, securityId: number, cb: TickCallback, mode: "ticker" | "quote" | "full" = "ticker") {
    const key = `${exchange}:${securityId}`;
    if (!this.tickListeners.has(key)) {
      this.tickListeners.set(key, new Set());
      this.socket.emit("market:subscribe", { exchange, securityIds: [securityId], mode });
    }
    this.tickListeners.get(key)!.add(cb);
    return () => this.unsubscribe(exchange, securityId, cb);
  }

  unsubscribe(exchange: string, securityId: number, cb: TickCallback) {
    const key = `${exchange}:${securityId}`;
    const listeners = this.tickListeners.get(key);
    if (listeners) {
      listeners.delete(cb);
      if (listeners.size === 0) {
        this.tickListeners.delete(key);
        this.socket.emit("market:unsubscribe", { exchange, securityIds: [securityId] });
      }
    }
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
