import http from "http";
import { Server as SocketIO } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { dhanClient } from "./lib/dhan-client";
import { db, settingsTable } from "@workspace/db";
import { marketFeedWS } from "./lib/market-feed-ws";
import { orderUpdateWS } from "./lib/order-update-ws";
import { setIO } from "./lib/io";
import { startAutoSquareOffScheduler } from "./lib/auto-square-off";
import { startSuperOrderMonitor } from "./lib/super-order-monitor";
import { decryptToken } from "./lib/crypto-utils";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

const io = new SocketIO(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  path: "/socket.io",
});

setIO(io);

marketFeedWS.on("tick", (data) => io.emit("market:tick", data));
marketFeedWS.on("quote", (data) => io.emit("market:quote", data));
marketFeedWS.on("depth", (data) => io.emit("market:depth", data));
orderUpdateWS.on("orderUpdate", (data) => io.emit("order:update", data));

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket.io client connected");

  socket.on("market:subscribe", ({ exchange, securityIds, mode }: { exchange: string; securityIds: number[]; mode?: "ticker" | "quote" | "full" }) => {
    marketFeedWS.subscribe(exchange, securityIds, mode ?? "ticker");
  });

  socket.on("market:unsubscribe", ({ exchange, securityIds }: { exchange: string; securityIds: number[] }) => {
    marketFeedWS.unsubscribe(exchange, securityIds);
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket.io client disconnected");
  });
});

async function loadSavedCredentials() {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (settings?.brokerClientId && settings?.brokerAccessToken) {
      const token = decryptToken(settings.brokerAccessToken);
      dhanClient.configure(settings.brokerClientId, token);
      logger.info({ clientId: "****" + settings.brokerClientId.slice(-4) }, "Loaded broker credentials from database");
      marketFeedWS.configure(settings.brokerClientId, token);
      orderUpdateWS.configure(settings.brokerClientId, token);
      marketFeedWS.connect();
      orderUpdateWS.connect();
    } else {
      logger.info("No saved broker credentials found in database");
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to load broker credentials from database");
  }
}

loadSavedCredentials().then(() => {
  httpServer.listen(port, () => {
    logger.info({ port }, "Server listening");
    startAutoSquareOffScheduler();
    startSuperOrderMonitor();
  });
});

export { io };
