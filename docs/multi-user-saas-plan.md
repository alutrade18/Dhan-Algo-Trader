# Multi-User SaaS Plan — Dhan Algo Trader
## (Phase 2 — Future Build)

---

## Current State (Single User)

- Koi login nahi — seedha app open hoti hai
- Ek hi Dhan account ke credentials settings mein save hote hain
- Saare orders, strategies, positions ek hi jagah — kisi ka bhi user_id nahi
- Ek hi WebSocket connection poore app ke liye
- Koi billing nahi

---

## Target State (Multi-User SaaS)

- 10-50+ traders apna alag account banayenge
- Har trader ke apne Dhan credentials
- Har trader ka alag data — orders, strategies, positions sab alag
- Har trader ke liye alag Dhan WebSocket connection
- Admin panel — sabka status dekh sako
- Razorpay subscription billing

---

---

# PHASE 2A — Authentication + Per-User Credentials

## Kya karna hai:
1. Clerk Auth integrate karna (login/signup)
2. Database mein `users` table banana
3. `settings` table mein `userId` properly use karna
4. Har API call mein authenticated user ka ID pass karna

---

## 2A-1: Clerk Auth Setup

**Kya hai Clerk?**
Clerk ek ready-made auth service hai — login, signup, Google login, OTP sab built-in hota hai.

**Backend mein:**

```typescript
// artifacts/api-server/src/middleware/auth.ts  (NAYA FILE)
import { clerkClient } from "@clerk/express";

export async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = await clerkClient.verifyToken(token);
    req.userId = payload.sub;  // Clerk user ID
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
```

**Sabhi routes pe middleware lagao:**
```typescript
// artifacts/api-server/src/app.ts mein
import { requireAuth } from "./middleware/auth";
app.use("/api", requireAuth, router);  // requireAuth add karo
```

**Frontend mein:**
```typescript
// artifacts/trading-platform/src/main.tsx mein
import { ClerkProvider } from "@clerk/clerk-react";

<ClerkProvider publishableKey={CLERK_KEY}>
  <App />
</ClerkProvider>
```

**Login page banana:**
```typescript
// artifacts/trading-platform/src/pages/login.tsx  (NAYA FILE)
import { SignIn } from "@clerk/clerk-react";

export default function LoginPage() {
  return <SignIn />;
}
```

**Protected routes:**
```typescript
// App.tsx mein - login ke bina koi page na khule
import { useAuth } from "@clerk/clerk-react";

function ProtectedRoute({ children }) {
  const { isSignedIn } = useAuth();
  if (!isSignedIn) return <Navigate to="/login" />;
  return children;
}
```

---

## 2A-2: Database — Users Table Banana

**lib/db/src/schema/users.ts (NAYA FILE):**
```typescript
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),  // Clerk user ID (clerk_xxxx format)
  email: text("email").notNull().unique(),
  name: text("name"),
  plan: text("plan").notNull().default("free"),  // free / pro
  isActive: boolean("is_active").notNull().default(true),
  isAdmin: boolean("is_admin").notNull().default(false),
  razorpayCustomerId: text("razorpay_customer_id"),
  subscriptionId: text("subscription_id"),
  subscriptionStatus: text("subscription_status"),  // active / cancelled / expired
  subscriptionEndsAt: timestamp("subscription_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

---

## 2A-3: Settings Table — userId Properly Use Karna

**Current state:** `settings` table mein `userId` column hai lekin use nahi hota.

**Change:** Har settings query mein userId filter lagao.

```typescript
// artifacts/api-server/src/routes/settings.ts mein CHANGE

// ABHI (galat):
const settings = await db.select().from(settingsTable).limit(1);

// HONA CHAHIYE:
const settings = await db.select().from(settingsTable)
  .where(eq(settingsTable.userId, req.userId))
  .limit(1);

// Settings save karte waqt:
await db.insert(settingsTable)
  .values({ ...data, userId: req.userId })
  .onConflictDoUpdate({
    target: settingsTable.userId,
    set: data
  });
```

---

## 2A-4: Per-User Dhan Client

**Current state:** Ek global `dhanClient` hai poori app ke liye.

**Change:** Har request ke waqt us user ki credentials se client banana.

```typescript
// artifacts/api-server/src/lib/dhan-client.ts mein CHANGE

// ABHI: ek global client
export const dhanClient = new DhanHQ(clientId, accessToken);

// HONA CHAHIYE: function jo user ki settings se client banaye
export async function getDhanClient(userId: string) {
  const settings = await db.select().from(settingsTable)
    .where(eq(settingsTable.userId, userId))
    .limit(1);

  const { brokerClientId, brokerAccessToken } = settings[0];
  const token = decryptToken(brokerAccessToken);

  return new DhanHQ(brokerClientId, token);
}
```

**Har route mein use karo:**
```typescript
// ABHI:
const result = await dhanClient.getPositions();

// HONA CHAHIYE:
const client = await getDhanClient(req.userId);
const result = await client.getPositions();
```

---

---

# PHASE 2B — Data Isolation (Per-User Data)

## Kya karna hai:
- `strategies`, `rate_limit_log`, `orders` tables mein `userId` column add karna
- Saari queries mein user filter lagana
- Per-user WebSocket connections

---

## 2B-1: Schema Changes

**strategies table mein userId add karo:**
```typescript
// lib/db/src/schema/strategies.ts mein ADD
export const strategiesTable = pgTable("strategies", {
  // ... existing columns ...
  userId: text("user_id").notNull(),  // ADD THIS
});
```

**rate_limit_log table mein userId add karo:**
```typescript
export const rateLimitLogTable = pgTable("rate_limit_log", {
  userId: text("user_id").notNull(),  // ADD THIS
  category: text("category").notNull(),
  date: text("date").notNull(),
  count: integer("count").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.userId, table.category, table.date] })  // userId bhi add karo
]);
```

---

## 2B-2: API Routes — User Filter

**Sabhi routes mein yeh pattern follow karo:**

```typescript
// strategies route example
router.get("/strategies", async (req, res) => {
  const userId = req.userId;  // middleware se aata hai

  const strategies = await db.select().from(strategiesTable)
    .where(eq(strategiesTable.userId, userId));  // USER FILTER

  res.json(strategies);
});

router.post("/strategies", async (req, res) => {
  const userId = req.userId;

  await db.insert(strategiesTable).values({
    ...req.body,
    userId  // SAVE WITH USER ID
  });
});
```

**Rate limiter per-user:**
```typescript
// lib/rate-limiter.ts mein CHANGE
// Abhi: global counter
// Hona chahiye: userId-based counter

export async function checkDailyLimit(userId: string, category: string) {
  const today = new Date().toISOString().split("T")[0];

  const log = await db.select().from(rateLimitLogTable)
    .where(
      and(
        eq(rateLimitLogTable.userId, userId),  // USER FILTER
        eq(rateLimitLogTable.category, category),
        eq(rateLimitLogTable.date, today)
      )
    ).limit(1);

  // ... rest of logic
}
```

---

## 2B-3: Per-User WebSocket Connections

**Current state:** Ek global `marketFeedWS` aur `orderUpdateWS` hai.

**Change:** Har connected user ke liye alag WS maintain karo.

```typescript
// artifacts/api-server/src/lib/ws-manager.ts  (NAYA FILE)

const userConnections = new Map<string, {
  marketFeed: MarketFeedWS,
  orderUpdate: OrderUpdateWS
}>();

export async function getOrCreateUserWS(userId: string) {
  if (userConnections.has(userId)) {
    return userConnections.get(userId);
  }

  const client = await getDhanClient(userId);
  const marketFeed = new MarketFeedWS(client);
  const orderUpdate = new OrderUpdateWS(client);

  userConnections.set(userId, { marketFeed, orderUpdate });
  return { marketFeed, orderUpdate };
}

export function closeUserWS(userId: string) {
  const conn = userConnections.get(userId);
  if (conn) {
    conn.marketFeed.close();
    conn.orderUpdate.close();
    userConnections.delete(userId);
  }
}
```

**Socket.io rooms — har user apne room mein:**
```typescript
// artifacts/api-server/src/lib/io.ts mein CHANGE

io.on("connection", (socket) => {
  const userId = socket.handshake.auth.userId;

  socket.join(`user:${userId}`);  // User-specific room

  // Emit sirf us user ko:
  io.to(`user:${userId}`).emit("orderUpdate", data);
});
```

---

---

# PHASE 2C — Billing + Admin Panel

## Kya karna hai:
- Razorpay subscription integrate karna
- Subscription status check karna — expired users block karna
- Admin panel banana

---

## 2C-1: Razorpay Subscription

**Backend — subscription routes:**
```typescript
// artifacts/api-server/src/routes/billing.ts  (NAYA FILE)

import Razorpay from "razorpay";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Subscription create karo
router.post("/billing/subscribe", async (req, res) => {
  const subscription = await razorpay.subscriptions.create({
    plan_id: process.env.RAZORPAY_PLAN_ID,
    total_count: 12,  // 12 months
    customer_notify: 1
  });

  res.json({ subscriptionId: subscription.id });
});

// Razorpay webhook — payment success pe update karo
router.post("/billing/webhook", async (req, res) => {
  const event = req.body.event;

  if (event === "subscription.activated") {
    const userId = req.body.payload.subscription.entity.notes.userId;

    await db.update(usersTable)
      .set({
        plan: "pro",
        subscriptionStatus: "active",
        subscriptionEndsAt: /* next renewal date */
      })
      .where(eq(usersTable.id, userId));
  }

  res.json({ ok: true });
});
```

**Frontend — pricing page:**
```typescript
// artifacts/trading-platform/src/pages/pricing.tsx  (NAYA FILE)

export default function PricingPage() {
  return (
    <div>
      <h1>Choose Your Plan</h1>

      <div className="plan-card">
        <h2>Free</h2>
        <p>- Paper trading only</p>
        <p>- No live orders</p>
      </div>

      <div className="plan-card">
        <h2>Pro — ₹999/month</h2>
        <p>- Live trading</p>
        <p>- All strategies</p>
        <p>- Telegram alerts</p>
        <button onClick={handleSubscribe}>Subscribe Now</button>
      </div>
    </div>
  );
}
```

**Subscription gate — Pro features block karo:**
```typescript
// artifacts/api-server/src/middleware/subscription-check.ts  (NAYA FILE)

export async function requirePro(req, res, next) {
  const user = await db.select().from(usersTable)
    .where(eq(usersTable.id, req.userId))
    .limit(1);

  if (user[0].plan !== "pro") {
    return res.status(403).json({
      error: "Pro subscription required",
      upgradeUrl: "/pricing"
    });
  }

  next();
}

// Orders route pe lagao:
router.post("/orders/place", requirePro, async (req, res) => {
  // ... order placement
});
```

---

## 2C-2: Admin Panel

**Backend — admin routes:**
```typescript
// artifacts/api-server/src/routes/admin.ts  (NAYA FILE)

// Admin middleware
async function requireAdmin(req, res, next) {
  const user = await db.select().from(usersTable)
    .where(eq(usersTable.id, req.userId)).limit(1);

  if (!user[0].isAdmin) return res.status(403).json({ error: "Admin only" });
  next();
}

// Sabhi users ki list
router.get("/admin/users", requireAdmin, async (req, res) => {
  const users = await db.select().from(usersTable);
  res.json(users);
});

// Kisi user ko ban karo
router.patch("/admin/users/:userId/ban", requireAdmin, async (req, res) => {
  await db.update(usersTable)
    .set({ isActive: false })
    .where(eq(usersTable.id, req.params.userId));
  res.json({ ok: true });
});

// Kisi user ki subscription manually update karo
router.patch("/admin/users/:userId/plan", requireAdmin, async (req, res) => {
  await db.update(usersTable)
    .set({ plan: req.body.plan })
    .where(eq(usersTable.id, req.params.userId));
  res.json({ ok: true });
});
```

**Frontend — admin page:**
```typescript
// artifacts/trading-platform/src/pages/admin.tsx  (NAYA FILE)

export default function AdminPage() {
  // Users table with: name, email, plan, status, joined date
  // Actions: ban, unban, change plan, view their orders
}
```

---

---

# Environment Variables — New Ones Needed

```env
# Existing
DATABASE_URL=...
ENCRYPTION_KEY=...
PORT=...

# Phase 2A — Clerk Auth
CLERK_SECRET_KEY=sk_live_xxxxx
VITE_CLERK_PUBLISHABLE_KEY=pk_live_xxxxx

# Phase 2C — Razorpay
RAZORPAY_KEY_ID=rzp_live_xxxxx
RAZORPAY_KEY_SECRET=xxxxx
RAZORPAY_PLAN_ID=plan_xxxxx
```

---

---

# Build Order — Kaunsa Pehle Banao

```
Phase 2A-1: Clerk install + login/signup page
      ↓
Phase 2A-2: users table create
      ↓
Phase 2A-3: requireAuth middleware — sabhi routes secure karo
      ↓
Phase 2A-4: settings userId se fetch/save ho
      ↓
Phase 2A-5: getDhanClient() — per-user client
      ↓
Phase 2B-1: strategies + rate_limit tables mein userId add karo
      ↓
Phase 2B-2: sabhi route queries mein userId filter
      ↓
Phase 2B-3: per-user WebSocket connections
      ↓
Phase 2C-1: Razorpay subscription + pricing page
      ↓
Phase 2C-2: requirePro middleware
      ↓
Phase 2C-3: Admin panel
```

---

# Estimated Time

| Phase | Kaam | Time |
|---|---|---|
| 2A | Auth + per-user credentials | 4-5 din |
| 2B | Data isolation + per-user WS | 4-5 din |
| 2C | Billing + Admin | 4-5 din |
| **Total** | | **~2 weeks** |

---

# Important Notes

1. **Clerk free plan** mein 10,000 monthly active users milte hain — kaafi hai initially
2. **Razorpay** mein pehle test mode mein sab test karo, phir live karo
3. **Per-user WS** mein memory badh jaati hai — monitor karo
4. **Admin account** manually database mein `is_admin = true` set karke banao pehli baar
5. **Data migration** — existing single-user ka data multi-user mein migrate karna padega carefully
