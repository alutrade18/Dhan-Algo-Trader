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
import { startKillSwitchScheduler, initDeactivationTracker } from "./routes/risk";
import { startEquityScheduler } from "./lib/equity-scheduler";
import { decryptToken } from "./lib/crypto-utils";
import { loadDailyCountersFromDb } from "./lib/rate-limiter";
import { loadHolidayCache } from "./lib/market-calendar";

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
  path: "/api/socket.io",
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
      if (token === null) {
        logger.warn(
          { clientId: "****" + settings.brokerClientId.slice(-4) },
          "Saved broker access token could not be decrypted (ENCRYPTION_KEY may have changed). Broker will show as disconnected until user re-authenticates.",
        );
        return;
      }
      dhanClient.configure(settings.brokerClientId, token);
      logger.info({ clientId: "****" + settings.brokerClientId.slice(-4) }, "Loaded broker credentials from database");
      marketFeedWS.configure(settings.brokerClientId, token);
      orderUpdateWS.configure(settings.brokerClientId, token);
      marketFeedWS.connect();
      orderUpdateWS.connect();
      // Validate token immediately in background — sets tokenExpired=true on 401
      setTimeout(() => {
        dhanClient.getFundLimits().then(() => {
          logger.info("Startup token validation: OK");
        }).catch((err: unknown) => {
          const status = (err as { status?: number })?.status;
          if (status === 401) {
            logger.warn("Startup token validation: expired (DH-901) — broker will show as disconnected");
          } else {
            logger.warn({ status }, "Startup token validation: non-auth error (token may still be valid)");
          }
        });
      }, 2_000);
    } else {
      logger.info("No saved broker credentials found in database");
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to load broker credentials from database");
  }
}

loadSavedCredentials().then(async () => {
  await loadDailyCountersFromDb();
  await loadHolidayCache();
  await initDeactivationTracker();
  httpServer.listen(port, () => {
    logger.info({ port }, "Server listening");
    startAutoSquareOffScheduler();
    startSuperOrderMonitor();
    startKillSwitchScheduler();
    startEquityScheduler();
  });
});

// Graceful shutdown — ensures port is released on workflow restart/stop
function gracefulShutdown(signal: string) {
  logger.info({ signal }, "Shutting down gracefully…");
  // Stop accepting new connections immediately
  httpServer.keepAliveTimeout = 0;
  io.close();
  httpServer.close(() => {
    logger.info("HTTP server closed");
    process.exit(0);
  });
  // Force exit after 5s if close hangs
  setTimeout(() => {
    logger.warn("Forced exit after timeout");
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT",  () => gracefulShutdown("SIGINT"));

// If port is already in use (stale process), log clearly and exit so the workflow runner retries
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error({ port }, "Port already in use — exiting so runner can retry");
    process.exit(1);
  } else {
    throw err;
  }
});

export { io };
