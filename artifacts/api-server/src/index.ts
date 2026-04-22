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

// Require a valid ENCRYPTION_KEY at startup — without it broker tokens cannot be
// stored securely and the server refuses to start rather than silently persisting
// plaintext credentials.
const encryptionKeyHex = process.env["ENCRYPTION_KEY"] ?? "";
if (!encryptionKeyHex || Buffer.from(encryptionKeyHex, "hex").length !== 32) {
  throw new Error(
    "ENCRYPTION_KEY environment variable is required and must be a 64-character hex string (32 bytes). " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
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

// ── Market data events from broker feed ───────────────────────────────────────
marketFeedWS.on("tick", (data) => io.emit("market:tick", data));
marketFeedWS.on("quote", (data) => io.emit("market:quote", data));
marketFeedWS.on("depth", (data) => io.emit("market:depth", data));
orderUpdateWS.on("orderUpdate", (data) => {
  // C4: PARTIALLY_FILLED requires special handling — the order is live but not
  // complete. Emit the standard event AND a dedicated partial-fill event so
  // the frontend can highlight the row without treating it as done.
  io.emit("order:update", data);
  const status = String((data as Record<string, unknown>).Status ?? "");
  if (status === "PARTIALLY_FILLED") {
    const tradedQty = (data as Record<string, unknown>).TradedQty;
    const totalQty  = (data as Record<string, unknown>).Quantity;
    logger.info(
      { orderId: (data as Record<string, unknown>).OrderNo, tradedQty, totalQty },
      "[C4] Partially-filled order — still open on exchange",
    );
    io.emit("order:partial-fill", data);
  }
});

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

/**
 * Fetch this server's outbound public IP and register it with Dhan's API whitelist.
 * Replit production servers have dynamic IPs that change on each redeploy, so this
 * must run on every startup to keep the whitelist current.
 *
 * Tries SECONDARY slot first (least disruptive). Falls back to PRIMARY if SECONDARY
 * is not supported. Dhan may enforce a 7-day change lock — if so, logs the error
 * clearly so the user knows they must wait before the new IP takes effect.
 */
async function autoRegisterServerIp() {
  if (!dhanClient.isConfigured()) {
    logger.info("[AutoIP] Broker not configured — skipping IP registration");
    return;
  }
  let ip: string;
  try {
    const r = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(5_000) });
    ({ ip } = await r.json() as { ip: string });
    logger.info({ serverOutboundIp: ip }, "SERVER OUTBOUND IP — this must be whitelisted in Dhan API Access for order placement");
  } catch {
    logger.warn("[AutoIP] Could not determine server outbound IP");
    return;
  }

  const creds = dhanClient.getCredentials();
  // Try SECONDARY first (preserves any existing PRIMARY whitelist)
  for (const ipFlag of ["SECONDARY", "PRIMARY"] as const) {
    try {
      const resp = await fetch("https://api.dhan.co/v2/ip/setIP", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "access-token": creds.accessToken,
        },
        body: JSON.stringify({ dhanClientId: creds.clientId, ip, ipFlag }),
        signal: AbortSignal.timeout(8_000),
      });
      const data = await resp.json().catch(() => ({})) as Record<string, unknown>;
      const statusStr = String(data.status ?? data.Status ?? "").toUpperCase();
      if (resp.ok && (statusStr === "SUCCESS" || statusStr === "OK")) {
        logger.info({ ip, ipFlag }, `[AutoIP] Server IP auto-registered with Dhan as ${ipFlag} — order placement should now work`);
        return; // success, done
      }
      const errMsg = String(data.message ?? data.errorMessage ?? data.description ?? resp.status);
      logger.warn({ ip, ipFlag, status: resp.status, response: data },
        `[AutoIP] Could not register as ${ipFlag}: ${errMsg}`);
      // If it looks like a "too recent" lock error, note it clearly
      if (errMsg.toLowerCase().includes("7") || errMsg.toLowerCase().includes("day") || errMsg.toLowerCase().includes("lock") || errMsg.toLowerCase().includes("change")) {
        logger.warn({ ip }, `[AutoIP] Dhan 7-day IP change lock active — go to Dhan portal and add ${ip} manually`);
        return;
      }
    } catch (e) {
      logger.warn({ err: e, ip, ipFlag }, `[AutoIP] Network error registering ${ipFlag} IP`);
    }
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

    // Auto-register server's outbound IP with Dhan so order placement works
    // even when Replit assigns a new IP after each redeploy.
    void autoRegisterServerIp();
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
