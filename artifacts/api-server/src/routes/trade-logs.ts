import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, tradeLogsTable } from "@workspace/db";
import { GetTradeLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/trade-logs", async (req, res): Promise<void> => {
  const parsed = GetTradeLogsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit || 50) : 50;
  const strategyId = parsed.success ? parsed.data.strategyId : undefined;
  const status = parsed.success ? parsed.data.status : undefined;

  const conditions = [];
  if (strategyId) {
    conditions.push(eq(tradeLogsTable.strategyId, strategyId));
  }
  if (status) {
    conditions.push(eq(tradeLogsTable.status, status));
  }

  const logs = await db
    .select()
    .from(tradeLogsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(tradeLogsTable.executedAt))
    .limit(limit);

  res.json(
    logs.map((l) => ({
      ...l,
      price: Number(l.price),
      pnl: l.pnl ? Number(l.pnl) : null,
    })),
  );
});

export default router;
