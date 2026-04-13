import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { appLogsTable, tradeLogsTable } from "@workspace/db/schema";
import { desc, and, gte, lte, eq, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/logs", async (req, res): Promise<void> => {
  try {
    const {
      tab,
      category,
      search,
      fromDate,
      toDate,
      fromTimestamp,
      page = "0",
      limit = "100",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(0, parseInt(page, 10) || 0);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
    const offset = pageNum * limitNum;

    const conditions = [];

    if (tab === "failed") {
      conditions.push(or(eq(appLogsTable.status, "failed"), eq(appLogsTable.level, "error"))!);
    } else if (tab === "success") {
      conditions.push(eq(appLogsTable.status, "success"));
    }

    if (category && category !== "all") {
      conditions.push(eq(appLogsTable.category, category));
    }
    if (fromTimestamp) {
      conditions.push(gte(appLogsTable.createdAt, new Date(fromTimestamp)));
    } else if (fromDate) {
      conditions.push(gte(appLogsTable.createdAt, new Date(fromDate + "T00:00:00Z")));
    }
    if (toDate) {
      conditions.push(lte(appLogsTable.createdAt, new Date(toDate + "T23:59:59Z")));
    }
    if (search) {
      conditions.push(
        or(
          ilike(appLogsTable.action, `%${search}%`),
          ilike(appLogsTable.details ?? sql`''`, `%${search}%`),
        )!
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db.select().from(appLogsTable).where(where).orderBy(desc(appLogsTable.createdAt)).limit(limitNum).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(appLogsTable).where(where),
    ]);

    res.json({
      logs,
      total: countResult[0]?.count ?? 0,
      page: pageNum,
      limit: limitNum,
    });
  } catch (e) {
    req.log.error({ err: e }, "Logs fetch error");
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

// GET /logs/counts — badge counts for tab headers
// Failed = app_logs (failed/error) + trade_logs (failed) combined
router.get("/logs/counts", async (_req, res): Promise<void> => {
  try {
    const [failedAppRow, failedTradeRow, successRow] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(appLogsTable)
        .where(or(eq(appLogsTable.status, "failed"), eq(appLogsTable.level, "error"))!),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(tradeLogsTable)
        .where(eq(tradeLogsTable.status, "failed")),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(appLogsTable)
        .where(eq(appLogsTable.status, "success")),
    ]);
    res.json({
      failed: (failedAppRow[0]?.count ?? 0) + (failedTradeRow[0]?.count ?? 0),
      success: successRow[0]?.count ?? 0,
    });
  } catch (e) {
    req.log.error({ err: e }, "Logs counts error");
    res.status(500).json({ error: "Failed" });
  }
});

// View-reset — does NOT delete from DB; frontend uses localStorage timestamp.
router.delete("/logs", async (_req, res): Promise<void> => {
  res.json({ success: true });
});

export default router;
