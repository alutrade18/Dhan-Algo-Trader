import { Router, type IRouter } from "express";
import { db, appLogsTable, auditLogTable } from "@workspace/db";
import { desc, and, gte, lte, eq, or, sql, isNull } from "drizzle-orm";

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

    const pageNum = Math.max(0, Math.min(3, parseInt(page, 10) || 0));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 50));
    const offset = pageNum * limitNum;

    const conditions = [];

    // Never show soft-deleted entries in UI
    conditions.push(isNull(appLogsTable.deletedAt));

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

    const where = and(...conditions);

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

// Soft-delete logs by tab type (success or failed).
// Records are NEVER physically removed — deletedAt is set so data stays in DB for safety.
// The action is permanently recorded in audit_log for full traceability.
router.delete("/logs", async (req, res): Promise<void> => {
  const { tab } = req.query as Record<string, string>;

  if (!tab || !["success", "failed"].includes(tab)) {
    res.status(400).json({ error: "tab must be 'success' or 'failed'" });
    return;
  }

  try {
    const now = new Date();
    let condition;
    if (tab === "failed") {
      condition = and(
        or(eq(appLogsTable.status, "failed"), eq(appLogsTable.level, "error"))!,
        isNull(appLogsTable.deletedAt),
      );
    } else {
      condition = and(
        eq(appLogsTable.status, "success"),
        isNull(appLogsTable.deletedAt),
      );
    }

    const deleted = await db
      .update(appLogsTable)
      .set({ deletedAt: now })
      .where(condition)
      .returning({ id: appLogsTable.id });

    // Permanently record this action in audit log (these entries are never soft-deleted)
    await db.insert(auditLogTable).values({
      action: "LOGS_DELETED",
      field: tab,
      description: `User cleared ${deleted.length} ${tab} log(s) from the UI. Records are soft-deleted and permanently retained in the database for audit.`,
    });

    req.log.info({ tab, count: deleted.length }, "Logs soft-deleted by user");
    res.json({ ok: true, deleted: deleted.length });
  } catch (e) {
    req.log.error({ err: e }, "Failed to soft-delete logs");
    res.status(500).json({ error: "Failed to delete logs" });
  }
});

export default router;
