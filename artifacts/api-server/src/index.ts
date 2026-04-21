import http from "http";
import { Server as SocketIO } from "socket.io";
import { verifyToken } from "@clerk/backend";
import app from "./app";
import { logger } from "./lib/logger";
import { dhanClient } from "./lib/dhan-client";
import { db, settingsTable } from "@workspace/db";
import { marketFeedWS } from "./lib/market-feed-ws";
import { orderUpdateWS } from "./lib/order-update-ws";
import { setIO } from "./lib/io";
import { startAutoSquareOffScheduler } from "./lib/auto-square-off";
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

// ── Per-socket subscription tracking ─────────────────────────────────────────
// socketSubs: socketId → Map<"exchange:mode", Set<securityId>>
// Prevents one socket from manipulating subscriptions owned by another socket.
// Keyed by "exchange:mode" so mode isolation is preserved end-to-end.
const socketSubs = new Map<string, Map<string, Set<number>>>();

type ModeStr = "ticker" | "quote" | "full";

interface GlobalUnsub {
  exchange: string;
  mode: ModeStr;
  securityIds: number[];
}

function addSocketSub(socketId: string, exchange: string, securityIds: number[], mode: ModeStr) {
  if (!socketSubs.has(socketId)) socketSubs.set(socketId, new Map());
  const key = `${exchange}:${mode}`;
  const subs = socketSubs.get(socketId)!;
  if (!subs.has(key)) subs.set(key, new Set());
  const idSet = subs.get(key)!;
  for (const id of securityIds) idSet.add(id);
}

/**
 * Removes `securityIds` from `socketId`'s subscription registry across all modes
 * (or a specific mode if provided).  Returns per-mode lists of IDs that should be
 * globally unsubscribed because no other socket retains them in that exact mode.
 */
function removeSocketSub(
  socketId: string,
  exchange: string,
  securityIds: number[],
  mode?: ModeStr,
): GlobalUnsub[] {
  const subs = socketSubs.get(socketId);
  if (!subs) return [];
  const modes: ModeStr[] = mode ? [mode] : ["ticker", "quote", "full"];
  const result: GlobalUnsub[] = [];

  for (const m of modes) {
    const key = `${exchange}:${m}`;
    const idSet = subs.get(key);
    if (!idSet) continue;
    const removable: number[] = [];

    for (const id of securityIds) {
      if (!idSet.has(id)) continue;
      idSet.delete(id);
      // Globally unsubscribe this mode only if no other socket still needs it
      const stillNeeded = [...socketSubs.entries()].some(
        ([sid, subMap]) => sid !== socketId && subMap.get(key)?.has(id),
      );
      if (!stillNeeded) removable.push(id);
    }

    if (idSet.size === 0) subs.delete(key);
    if (removable.length > 0) result.push({ exchange, mode: m, securityIds: removable });
  }

  return result;
}

/**
 * Removes a socket from the registry on disconnect and returns per-mode lists of
 * IDs that should be globally unsubscribed because no remaining socket needs them.
 */
function cleanupSocket(socketId: string): GlobalUnsub[] {
  const subs = socketSubs.get(socketId);
  socketSubs.delete(socketId);
  if (!subs) return [];
  const result: GlobalUnsub[] = [];

  for (const [key, idSet] of subs.entries()) {
    const colonIdx = key.lastIndexOf(":");
    const exchange = key.slice(0, colonIdx);
    const mode = key.slice(colonIdx + 1) as ModeStr;
    const removable: number[] = [];

    for (const id of idSet) {
      const stillNeeded = [...socketSubs.entries()].some(
        ([, subMap]) => subMap.get(key)?.has(id),
      );
      if (!stillNeeded) removable.push(id);
    }

    if (removable.length > 0) result.push({ exchange, mode, securityIds: removable });
  }

  return result;
}

// ── Socket.IO authentication middleware ───────────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    logger.warn({ socketId: socket.id }, "Socket.IO connection rejected: no auth token");
    return next(new Error("Unauthorized: authentication required"));
  }
  try {
    await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    next();
  } catch (err) {
    logger.warn({ socketId: socket.id, err }, "Socket.IO connection rejected: invalid token");
    next(new Error("Unauthorized: invalid or expired token"));
  }
});

// ── Market data events from broker feed ───────────────────────────────────────
marketFeedWS.on("tick", (data) => io.emit("market:tick", data));
marketFeedWS.on("quote", (data) => io.emit("market:quote", data));
marketFeedWS.on("depth", (data) => io.emit("market:depth", data));
orderUpdateWS.on("orderUpdate", (data) => io.emit("order:update", data));

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Socket.io client connected");

  socket.on("market:subscribe", ({ exchange, securityIds, mode }: { exchange: string; securityIds: number[]; mode?: ModeStr }) => {
    const resolvedMode: ModeStr = mode ?? "ticker";
    addSocketSub(socket.id, exchange, securityIds, resolvedMode);
    marketFeedWS.subscribe(exchange, securityIds, resolvedMode);
  });

  socket.on("market:unsubscribe", ({ exchange, securityIds }: { exchange: string; securityIds: number[] }) => {
    // Check all modes this socket has for these IDs; only globally remove per-mode
    // if no other socket still needs that exact exchange+mode combination.
    const toRemove = removeSocketSub(socket.id, exchange, securityIds);
    for (const { exchange: exch, mode, securityIds: ids } of toRemove) {
      marketFeedWS.unsubscribe(exch, ids, mode);
    }
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Socket.io client disconnected");
    const cleanups = cleanupSocket(socket.id);
    for (const { exchange, mode, securityIds } of cleanups) {
      marketFeedWS.unsubscribe(exchange, securityIds, mode);
    }
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
