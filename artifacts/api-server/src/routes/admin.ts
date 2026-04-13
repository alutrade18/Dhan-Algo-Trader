import { Router } from "express";
import { db, settingsTable, superOrdersTable, appLogsTable } from "@workspace/db";
import { desc, count, eq, isNotNull, sql } from "drizzle-orm";

const router = Router();

router.get("/admin/stats", async (_req, res) => {
  try {
    const [totalUsers] = await db
      .select({ count: count() })
      .from(settingsTable)
      .where(isNotNull(settingsTable.userId));

    const [totalSuperOrders] = await db
      .select({ count: count() })
      .from(superOrdersTable);

    const [configuredBrokers] = await db
      .select({ count: count() })
      .from(settingsTable)
      .where(isNotNull(settingsTable.brokerClientId));

    const [recentErrors] = await db
      .select({ count: count() })
      .from(appLogsTable)
      .where(eq(appLogsTable.level, "error"));

    res.json({
      totalUsers: totalUsers?.count ?? 0,
      totalSuperOrders: totalSuperOrders?.count ?? 0,
      configuredBrokers: configuredBrokers?.count ?? 0,
      recentErrors: recentErrors?.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/admin/users", async (_req, res) => {
  try {
    const users = await db
      .select({
        id: settingsTable.id,
        userId: settingsTable.userId,
        brokerClientId: settingsTable.brokerClientId,
        enableAutoTrading: settingsTable.enableAutoTrading,
        killSwitchEnabled: settingsTable.killSwitchEnabled,
        autoSquareOffEnabled: settingsTable.autoSquareOffEnabled,
        theme: settingsTable.theme,
        updatedAt: settingsTable.updatedAt,
        tokenGeneratedAt: settingsTable.tokenGeneratedAt,
      })
      .from(settingsTable)
      .orderBy(desc(settingsTable.updatedAt));

    const usersWithCounts = await Promise.all(
      users.map(async (u) => {
        const [orderCount] = u.userId
          ? await db
              .select({ count: count() })
              .from(superOrdersTable)
              .where(eq(superOrdersTable.userId, u.userId))
          : [{ count: 0 }];
        return { ...u, superOrderCount: orderCount?.count ?? 0 };
      })
    );

    res.json(usersWithCounts);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/admin/recent-orders", async (_req, res) => {
  try {
    const orders = await db
      .select()
      .from(superOrdersTable)
      .orderBy(desc(superOrdersTable.createdAt))
      .limit(50);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

router.get("/admin/logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const logs = await db
      .select()
      .from(appLogsTable)
      .orderBy(desc(appLogsTable.createdAt))
      .limit(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch logs" });
  }
});

export default router;
