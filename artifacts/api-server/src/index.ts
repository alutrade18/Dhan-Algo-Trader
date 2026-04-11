import app from "./app";
import { logger } from "./lib/logger";
import { dhanClient } from "./lib/dhan-client";
import { db, settingsTable } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function loadSavedCredentials() {
  try {
    const [settings] = await db.select().from(settingsTable);
    if (settings?.brokerClientId && settings?.brokerAccessToken) {
      dhanClient.configure(settings.brokerClientId, settings.brokerAccessToken);
      logger.info(
        { clientId: "****" + settings.brokerClientId.slice(-4) },
        "Loaded broker credentials from database",
      );
    } else {
      logger.info("No saved broker credentials found in database");
    }
  } catch (e) {
    logger.error({ err: e }, "Failed to load broker credentials from database");
  }
}

loadSavedCredentials().then(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
