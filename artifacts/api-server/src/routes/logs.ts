import { Router, type IRouter } from "express";
import { db, appLogsTable } from "@workspace/db";
import { desc, and, gte, lte, eq, ilike, or, sql } from "drizzle-orm";

const router: IRouter = Router();

// Failed logs always show last 7 days only
function sevenDaysAgo(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

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
      // Failed logs: enforce 7-day rolling window — no UI override possible
      conditions.push(gte(appLogsTable.createdAt, sevenDaysAgo()));
    } else if (tab === "success") {
      conditions.push(eq(appLogsTable.status, "success"));
    }

    if (category && category !== "all") {
      conditions.push(eq(appLogsTable.category, category));
    }
    // Date filters only apply to success (failed uses enforced 7-day window above)
    if (tab !== "failed") {
      if (fromTimestamp) {
        conditions.push(gte(appLogsTable.createdAt, new Date(fromTimestamp)));
      } else if (fromDate) {
        conditions.push(gte(appLogsTable.createdAt, new Date(fromDate + "T00:00:00Z")));
      }
      if (toDate) {
        conditions.push(lte(appLogsTable.createdAt, new Date(toDate + "T23:59:59Z")));
      }
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

export default router;
