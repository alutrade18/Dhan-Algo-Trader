import { db } from "@workspace/db";
import { appLogsTable } from "@workspace/db/schema";

export type LogLevel = "info" | "warn" | "error";
export type LogCategory = "broker" | "order" | "strategy" | "settings" | "risk" | "api" | "system";

export async function logEvent(opts: {
  level?: LogLevel;
  category: LogCategory;
  action: string;
  details?: Record<string, unknown> | string;
  status?: "success" | "failed" | "pending";
  statusCode?: number;
}): Promise<void> {
  try {
    const details =
      opts.details === undefined
        ? undefined
        : typeof opts.details === "string"
          ? opts.details
          : JSON.stringify(opts.details);

    await db.insert(appLogsTable).values({
      level: opts.level ?? "info",
      category: opts.category,
      action: opts.action,
      details,
      status: opts.status,
      statusCode: opts.statusCode,
    });
  } catch {
  }
}
