import { Router, type IRouter } from "express";
import { db, appLogsTable } from "@workspace/db";
import { desc, and, gte, lte, eq, or, sql } from "drizzle-orm";

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
      limit = "50",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(0, Math.min(3, parseInt(page, 10) || 0)); // max page 3 (0-indexed → 4 pages)
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 50));
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
          sql`${appLogsTable.action} ILIKE ${"%" + search + "%"}`,
          sql`COALESCE(${appLogsTable.details}, '') ILIKE ${"%" + search + "%"}`,
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
