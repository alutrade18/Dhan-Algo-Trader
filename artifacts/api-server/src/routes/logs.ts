import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { appLogsTable } from "@workspace/db/schema";
import { desc, and, gte, lte, eq, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/logs", async (req, res): Promise<void> => {
  try {
    const {
      level,
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

    if (level && level !== "all") {
      conditions.push(eq(appLogsTable.level, level));
    }
    if (category && category !== "all") {
      conditions.push(eq(appLogsTable.category, category));
    }
    if (fromTimestamp) {
      // Precise ISO timestamp filter — used by "Delete" view reset on frontend
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
        )
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, countResult] = await Promise.all([
      db
        .select()
        .from(appLogsTable)
        .where(where)
        .orderBy(desc(appLogsTable.createdAt))
        .limit(limitNum)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(appLogsTable)
        .where(where),
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

// View-reset endpoint — does NOT delete from DB (logs are kept permanently for audit purposes).
// The frontend uses a localStorage timestamp to "hide" older entries from the UI view.
router.delete("/logs", async (_req, res): Promise<void> => {
  res.json({ success: true });
});

export default router;
