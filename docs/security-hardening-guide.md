# Security Hardening Guide — Dhan Algo Trader
## Complete Step-by-Step Implementation

---

## Guide Kaise Use Karein

- **Ek step ek baar** — dono ek saath mat karo
- **Har step ke baad test karo** — phir agle pe jao
- **Agent ko bolo** step ka number — woh implement karega
- **Checklist** ke end mein hai — done hone pe tick karo

### Har Code Change Ke Baad Deploy Command:
```bash
# Step 1 — Replit Shell mein push karo:
git add -A && git commit -m "security: step-X description" && git push origin main

# Step 2 — DO Server pe update karo:
cd /var/www/trading && git pull origin main && PORT=3001 pnpm --filter @workspace/api-server run build && pm2 restart dhan-api
```

### Sirf Server-Side Steps (code change nahi):
```bash
# Sirf DO server pe commands chalao — no git push needed
```

---
---

# STEP 1 — HTTPS / SSL Certificate

## Real Attack Scenario:
Tum `http://68.183.247.209/settings` pe apna Dhan Access Token save karte ho. Agar koi same network pe hai (cafe, ISP level sniffing), woh MITM attack se tera token dekh sakta hai. HTTPS ke bina sab plain text mein jaata hai — password, token, orders sab.

## Kya karta hai HTTPS:
- Server aur browser ke beech ka sab data encrypt hota hai
- Green lock browser mein dikhta hai
- Dhan API calls bhi encrypted channel se jaati hain

## Zaroorat:
- Ek domain (GoDaddy/Namecheap se ~₹500/year)
- Example: `trading.yourdomain.com`

## Steps:

### Step 1A — Domain kharido aur DNS set karo:
1. GoDaddy/Namecheap pe domain kharido
2. DNS management mein jao
3. **A Record** add karo:
   - Name: `@` ya `trading`
   - Value: `168.144.92.231` (droplet ka Public IP — outbound IP)
   - TTL: 600
4. 10-30 minute wait karo DNS propagate hone ke liye

### Step 1B — Check karo DNS propagate hua ya nahi:
```bash
# Apne PC ke CMD mein:
nslookup trading.yourdomain.com
# Should return: 168.144.92.231
```

### Step 1C — DO Server pe SSL lagao:
```bash
# Certbot install karo
apt-get install -y certbot python3-certbot-nginx

# SSL certificate generate karo
certbot --nginx -d trading.yourdomain.com

# Questions:
# Enter email: apna email
# Agree to terms: Y
# Share email: N
# Redirect HTTP to HTTPS: 2 (recommended)

# Auto-renewal enable karo
systemctl enable certbot.timer
systemctl start certbot.timer
```

### Step 1D — Nginx config automatically update hogi. Verify karo:
```bash
cat /etc/nginx/sites-available/trading
# listen 443 ssl; line dikhna chahiye
```

### Step 1E — .env update karo DO server pe:
```bash
nano /var/www/trading/.env
# ALLOWED_ORIGINS ko update karo:
# ALLOWED_ORIGINS=https://trading.yourdomain.com
```

### Step 1F — PM2 restart karo:
```bash
pm2 restart dhan-api
```

## Test karo:
```bash
# Browser mein:
https://trading.yourdomain.com
# Green lock dikhna chahiye

# HTTP redirect test:
curl -I http://trading.yourdomain.com
# HTTP/1.1 301 Moved Permanently location: https://trading.yourdomain.com
```

## Auto-renewal test:
```bash
certbot renew --dry-run
# "Congratulations, all simulated renewals succeeded" aana chahiye
```

## Agar Dikkat Aaye:
- DNS abhi propagate nahi hua → 30 min wait karo
- Certbot fail hua → check karo port 80 open hai (`ufw allow 80`)
- App nahi khul raha → `nginx -t && systemctl restart nginx`

---

# STEP 2 — Helmet.js (HTTP Security Headers)

## Real Attack Scenario:
**Clickjacking:** Koi attacker ek evil website banata hai jisme tumhari trading app ko invisible iframe mein embed karta hai. Jab tum unki site pe click karte ho, actually tumhari app pe click ho raha hota hai — order place ho jaata hai bina tumhare jaane.

**MIME Sniffing:** Attacker ek file upload karta hai jo "text/plain" hai lekin actually JavaScript hai. Browser usse execute kar deta hai.

**XSS:** Cross-site scripting attacks jisme attacker tumhare browser mein malicious script inject karta hai.

## Helmet kya karta hai:
- `X-Frame-Options: SAMEORIGIN` → clickjacking band
- `X-Content-Type-Options: nosniff` → MIME sniffing band
- `Strict-Transport-Security` → HTTPS enforce karta hai
- `X-DNS-Prefetch-Control` → DNS prefetch disable
- `X-Download-Options` → IE download attacks band
- 10+ aur headers automatically

## Kahan karna hai:
**File:** `artifacts/api-server/src/app.ts`
**Package:** `artifacts/api-server/`

### Install karo:
```bash
# Replit Shell mein:
pnpm --filter @workspace/api-server add helmet
```

### `artifacts/api-server/src/app.ts` — COMPLETE FILE (copy-paste karo):
```typescript
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";   // ← NEW
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestLogger } from "./middleware/request-logger";

const app: Express = express();
app.set("etag", false);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Helmet — HTTP Security Headers ───────────────────────────────────────────
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,  // Socket.io ke liye zaroori
    contentSecurityPolicy: false,       // React SPA ke liye (baad mein configure karenge)
    crossOriginResourcePolicy: { policy: "cross-origin" },  // API responses ke liye
  })
);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:8081",
      "http://localhost:80",
      "http://localhost",
    ];

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        /\.replit\.dev$/.test(origin) ||
        /\.riker\.replit\.dev$/.test(origin) ||
        /\.replit\.app$/.test(origin)
      ) {
        return callback(null, true);
      }
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);
app.use("/api", router);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.warn({ err: err.message }, "Unhandled middleware error");
  res.status(500).json({ success: false, error: err.message ?? "Internal server error" });
});

export default app;
```

## Test karo:
```bash
curl -I http://68.183.247.209/api/health
# In headers aane chahiye:
# x-content-type-options: nosniff
# x-frame-options: SAMEORIGIN
# x-dns-prefetch-control: off
# x-download-options: noopen
```

## Common Mistakes:
- Helmet ko CORS ke BAAD mat lagao — pehle lagao
- `crossOriginEmbedderPolicy: false` mat bhulo — warna Socket.io toot jaayega

---

# STEP 3 — Request Size Limit

## Real Attack Scenario:
**Memory Exhaustion Attack:** Attacker ek script se 100MB JSON body bhejta hai. Server usse memory mein load karta hai — RAM full, server crash. Yeh DoS (Denial of Service) hai.

```bash
# Attacker yeh karta hai:
curl -X POST http://yourserver/api/orders/place \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "print('{\"data\":\"' + 'x'*104857600 + '\"}')")"
# 100MB body → server crash
```

## Fix karo:
**File:** `artifacts/api-server/src/app.ts`

### Change karo (2 lines):
```typescript
// PEHLE (vulnerable):
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// BAAD MEIN (safe):
app.use(express.json({ limit: "512kb" }));          // 512KB se zyada JSON reject
app.use(express.urlencoded({ extended: true, limit: "512kb" }));
```

### Kya limit rakhe:
- Trading app mein koi bhi valid request 10KB se zyada nahi honi chahiye
- `512kb` safe aur generous limit hai
- Instruments CSV upload agar ho toh alag route pe `50mb` limit lagao

## Test karo:
```bash
# Large payload bhejo — 413 aana chahiye
node -e "
const http = require('http');
const data = JSON.stringify({ x: 'a'.repeat(600000) });
const req = http.request({
  hostname: '68.183.247.209',
  port: 80,
  path: '/api/health',
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
});
req.on('response', r => console.log('Status:', r.statusCode));
req.write(data);
req.end();
"
# Status: 413 — aana chahiye
```

---

# STEP 4 — Error Messages Hide Karo

## Real Attack Scenario:
**Information Leakage:** Abhi agar database error aata hai toh yeh client ko jaata hai:
```json
{
  "error": "relation \"settings\" does not exist at character 45 — HINT: check your PostgreSQL schema"
}
```
Hacker ko pata chal jaata hai:
- Database type (PostgreSQL)
- Table names
- Schema structure
- Exact query format

Yeh information future attacks ke liye use hoti hai.

## Fix karo:
**File:** `artifacts/api-server/src/app.ts`

### Error handler replace karo:
```typescript
// PEHLE (information leak):
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.warn({ err: err.message }, "Unhandled middleware error");
  res.status(500).json({ success: false, error: err.message ?? "Internal server error" });
});

// BAAD MEIN (safe):
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // Full error sirf server logs mein — client ko nahi
  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      name: err.name,
    },
    req: {
      method: req.method,
      url: req.url,
      ip: req.ip,
    }
  }, "Unhandled error");

  // CORS errors (known operational errors) — original message bhejo
  if (err.message?.includes("Not allowed by CORS")) {
    res.status(403).json({ success: false, error: "Origin not allowed" });
    return;
  }

  // Payload too large
  if ((err as any).type === "entity.too.large") {
    res.status(413).json({ success: false, error: "Request too large" });
    return;
  }

  // Sab baaki errors: generic message
  res.status(500).json({
    success: false,
    error: "Internal server error",   // stack trace ya DB details NAHI
  });
});
```

## Test karo:
```bash
# Invalid JSON bhejo — server details leak nahi hone chahiye
curl -X POST http://68.183.247.209/api/settings \
  -H "Content-Type: application/json" \
  -d "{ invalid json }"
# Response mein sirf: {"success":false,"error":"Internal server error"}
# PostgreSQL ya stack details nahi aane chahiye
```

---

# STEP 5 — CORS Production Lockdown

## Real Attack Scenario:
**Cross-Origin API Abuse:** Abhi Replit ke saare `.replit.dev` domains allow hain. Koi bhi Replit pe ek app banake tumhara API call kar sakta hai:
```javascript
// Evil Replit app se:
fetch("http://68.183.247.209/api/orders/place", {
  method: "POST",
  credentials: "include",
  body: JSON.stringify({ /* fake order */ })
});
// Yeh kaam karega — CORS allow hai
```

Production mein sirf tumhara own domain allowed hona chahiye.

## Fix karo:
**File:** `artifacts/api-server/src/app.ts`

### CORS replace karo:
```typescript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:8081",
    ];

const isDevelopment = process.env.NODE_ENV !== "production";

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // Server-to-server calls (no origin) — allow karo
      if (!origin) return callback(null, true);

      // Dev mein Replit domains allow — prod mein nahi
      if (isDevelopment) {
        if (
          /\.replit\.dev$/.test(origin) ||
          /\.riker\.replit\.dev$/.test(origin) ||
          /\.replit\.app$/.test(origin)
        ) {
          return callback(null, true);
        }
      }

      // Allowed origins list check karo
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);

      // Sab baaki reject
      logger.warn({ origin }, "CORS blocked request from unknown origin");
      callback(new Error("Not allowed by CORS"));
    },
  }),
);
```

### DO Server pe .env update karo:
```bash
nano /var/www/trading/.env
# Yeh line add/update karo:
ALLOWED_ORIGINS=http://68.183.247.209
# Ya agar HTTPS lag gayi hai:
# ALLOWED_ORIGINS=https://trading.yourdomain.com
```

## Test karo:
```bash
# Allowed origin — 200 aana chahiye
curl -H "Origin: http://68.183.247.209" \
  http://68.183.247.209/api/health
# Access-Control-Allow-Origin: http://68.183.247.209

# Unknown origin — blocked hona chahiye
curl -H "Origin: http://evil.com" \
  http://68.183.247.209/api/health
# Access-Control-Allow-Origin header nahi aana chahiye
```

---

# STEP 6 — Webhook / Postback Security (Already Partial)

## Real Attack Scenario:
**Fake Order Fills:** Dhan tumhe order update ke liye postback bhejta hai. Abhi agar `POSTBACK_SECRET` set hai toh basic protection hai. Lekin HMAC signature verification zyada secure hai kyunki:
- Simple secret: attacker ek baar dekh le toh hamesha fake maar sakta hai
- HMAC: har request ka unique signature hota hai — replay attacks bhi band

## Current Status Check karo:
```bash
# DO server pe:
grep POSTBACK_SECRET /var/www/trading/.env
```

### Agar `POSTBACK_SECRET` set nahi hai — ABHI set karo:
```bash
# DO server pe secret generate karo:
openssl rand -hex 32

# .env mein add karo:
nano /var/www/trading/.env
# POSTBACK_SECRET=generated_value_yahan
```

## Enhanced HMAC Verification (Optional but Stronger):
**File:** `artifacts/api-server/src/routes/postback.ts`

```typescript
import crypto from "crypto";

// Existing secret check ke SAATH yeh bhi add karo:
function verifyHmacSignature(
  payload: string,
  receivedSig: string | undefined,
  secret: string
): boolean {
  if (!receivedSig) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");
  // timingSafeEqual — timing attack prevent karta hai
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(receivedSig, "hex")
    );
  } catch {
    return false;
  }
}

// Route mein use karo:
router.post("/postback", async (req, res): Promise<void> => {
  const secret = process.env.POSTBACK_SECRET;

  if (!secret) {
    logger.warn({ ip: req.ip }, "POSTBACK_SECRET not set — rejecting");
    res.status(401).json({ error: "Postback not configured" });
    return;
  }

  // Method 1: Simple header check (current)
  const provided = req.headers["x-postback-secret"] as string | undefined;
  if (provided !== secret) {
    logger.warn({ ip: req.ip }, "Postback rejected: invalid secret");
    res.status(401).json({ error: "Unauthorized postback" });
    return;
  }

  // Method 2: HMAC (agar Dhan support kare future mein)
  // const sig = req.headers["x-dhan-signature"] as string;
  // if (!verifyHmacSignature(JSON.stringify(req.body), sig, secret)) { ... }

  // ... baaki handling same
});
```

## Additional: IP Whitelist for Postback:
Dhan ke servers ki IPs whitelist karo — sirf unhi se postback accept karo:
```typescript
// Dhan ke server IPs (Dhan docs se verify karo)
const DHAN_IPS = ["103.252.236.0/24", "34.100.0.0/16"];  // example — actual IPs Dhan docs mein

router.post("/postback", async (req, res): Promise<void> => {
  const clientIp = req.ip ?? req.socket.remoteAddress ?? "";
  logger.info({ postbackIp: clientIp }, "Postback received");
  // IP check add karo agar Dhan known IPs publish kare
});
```

## Test karo:
```bash
# Bina secret — 401 aana chahiye
curl -X POST http://68.183.247.209/api/postback \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'
# {"error":"Postback not configured"} ya "Unauthorized postback"

# Galat secret — 401 aana chahiye
curl -X POST http://68.183.247.209/api/postback \
  -H "Content-Type: application/json" \
  -H "x-postback-secret: wrong_secret" \
  -d '{"test": "data"}'
# {"error":"Unauthorized postback"}
```

---

# STEP 7 — Brute Force / IP Rate Limiting

## Real Attack Scenario:
**Credential Stuffing:** Attacker automated script se 10,000 different passwords try karta hai settings endpoint pe. Abhi koi limit nahi hai — woh baar baar try kar sakta hai.

**DDoS:** Attacker 1000 requests/second bhejta hai — server overload.

## Currently:
App mein Dhan API category-based rate limiting hai (orders, data, quotes). Lekin HTTP request level pe koi IP-based limit nahi hai.

## Fix karo:
**Package install:** `artifacts/api-server/`
**New File:** `artifacts/api-server/src/middleware/http-rate-limit.ts`

### Install karo:
```bash
pnpm --filter @workspace/api-server add express-rate-limit
```

### Naya file banao — `artifacts/api-server/src/middleware/http-rate-limit.ts`:
```typescript
import rateLimit from "express-rate-limit";
import { logger } from "../lib/logger";

// General API limit — sabhi routes pe
// 300 requests per 15 minutes per IP
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    // X-Forwarded-For (Nginx ke peeche) ya direct IP
    const forwarded = req.headers["x-forwarded-for"];
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) ?? req.ip ?? "unknown";
  },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, url: req.url }, "Rate limit exceeded — general");
    res.status(429).json({
      success: false,
      error: "Too many requests. Please wait 15 minutes and try again.",
    });
  },
});

// Strict limit — sensitive operations pe
// 10 requests per 15 minutes per IP
export const sensitiveRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]) ?? req.ip ?? "unknown";
  },
  handler: (req, res) => {
    logger.warn({ ip: req.ip, url: req.url }, "Rate limit exceeded — sensitive endpoint");
    res.status(429).json({
      success: false,
      error: "Too many attempts on sensitive endpoint. Please wait 15 minutes.",
    });
  },
});
```

### `artifacts/api-server/src/app.ts` mein add karo:
```typescript
import { generalRateLimit } from "./middleware/http-rate-limit";

// CORS ke baad, router se pehle:
app.use("/api", generalRateLimit);
app.use("/api", router);
```

### Sensitive routes pe strict limit:
```typescript
// artifacts/api-server/src/routes/settings.ts mein:
import { sensitiveRateLimit } from "../middleware/http-rate-limit";

// Settings save pe strict limit:
router.post("/", sensitiveRateLimit, async (req, res) => { ... });

// artifacts/api-server/src/routes/broker.ts mein:
router.post("/connect", sensitiveRateLimit, async (req, res) => { ... });
router.post("/set-ip", sensitiveRateLimit, async (req, res) => { ... });
```

### Nginx pe bhi rate limit lagao (double protection):
```bash
# /etc/nginx/nginx.conf ke http block mein add karo:
nano /etc/nginx/nginx.conf
```
```nginx
http {
    # Existing content ...

    # Rate limiting zones
    limit_req_zone $binary_remote_addr zone=api_general:10m rate=20r/m;
    limit_req_zone $binary_remote_addr zone=api_strict:10m rate=5r/m;
}
```

```bash
# /etc/nginx/sites-available/trading mein location /api/ block mein add karo:
location /api/ {
    limit_req zone=api_general burst=30 nodelay;
    # ... baaki proxy settings same
}
```

## Test karo:
```bash
# 305 requests jaldi se bhejo:
for i in $(seq 1 305); do
  curl -s -o /dev/null -w "%{http_code}\n" http://68.183.247.209/api/health
done
# Pehle 300 mein: 200
# Baad mein: 429
```

---

# STEP 8 — WebSocket Authentication

## Real Attack Scenario:
**Unauthorized Market Feed:** Koi bhi `ws://68.183.247.209/api/socket.io` se connect ho sakta hai. Aur real-time market data free mein le sakta hai. Agar future mein per-user WS hoga toh dusre user ka data bhi dekh sakta hai.

## Fix karo:
**Files:**
- `artifacts/api-server/src/index.ts` (server side)
- `artifacts/trading-platform/src/lib/market-socket.ts` (client side)

### Server — `artifacts/api-server/src/index.ts` mein:

Pehle existing SocketIO initialization dhundo:
```typescript
// Current code find karo:
const io = new SocketIO(server, {
  cors: { ... }
});

// Isme middleware add karo:
const io = new SocketIO(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? ["http://localhost:5173"],
    credentials: true,
  },
});

// Auth middleware — har connection pe check karo
io.use((socket, next) => {
  const token = socket.handshake.auth.wsToken as string | undefined;
  const validToken = process.env.WS_ACCESS_TOKEN;

  // Dev mein token optional
  if (!validToken) return next();

  if (!token || token !== validToken) {
    logger.warn({ socketId: socket.id }, "WebSocket: unauthorized connection attempt");
    return next(new Error("Unauthorized WebSocket connection"));
  }

  next();
});
```

### Client — `artifacts/trading-platform/src/lib/market-socket.ts`:
```typescript
// Current socket creation dhundo aur update karo:
const socket = io(/* existing config */, {
  path: `${BASE}api/socket.io`.replace(/\/\//g, "/"),
  auth: {
    wsToken: import.meta.env.VITE_WS_TOKEN ?? "",   // ADD THIS
  },
  // ... baaki config same
});
```

### Frontend `.env.production` (naya file):
```bash
# artifacts/trading-platform/.env.production
VITE_WS_TOKEN=same_value_jo_server_pe_hai
```

### DO Server pe .env update karo:
```bash
# Strong token generate karo:
openssl rand -hex 32

# .env mein add karo:
nano /var/www/trading/.env
# WS_ACCESS_TOKEN=generated_value_yahan
```

### Frontend dobara build karo (.env.production ke saath):
```bash
cd /var/www/trading && PORT=8080 BASE_PATH=/ NODE_ENV=production VITE_WS_TOKEN=same_value pnpm --filter @workspace/trading-platform run build
```

## Test karo:
```bash
# Bina token ke connect try karo — fail hona chahiye
node -e "
const { io } = require('socket.io-client');
const socket = io('http://68.183.247.209', {
  path: '/api/socket.io'
});
socket.on('connect_error', (e) => console.log('Good — blocked:', e.message));
socket.on('connect', () => console.log('Bad — connected without token'));
"
# Output: "Good — blocked: Unauthorized WebSocket connection"
```

---

# STEP 9 — Audit Logging

## Real Attack Scenario:
**Undetected Breach:** Koi tere Dhan token se order place karta hai. Tujhe pata hi nahi chalta kab, kaise, kaunse IP se hua. Audit logs ke bina forensics impossible hai.

## Kya track karna chahiye:
- Order placed/modified/cancelled
- Settings changed
- Broker connected/disconnected
- Kill switch on/off
- Auto square-off triggered
- Failed auth attempts
- Webhook received

## Fix karo:
**New File:** `artifacts/api-server/src/lib/audit-logger.ts`

### Naya file banao:
```typescript
import { logger } from "./logger";

export type AuditAction =
  | "ORDER_PLACED"
  | "ORDER_MODIFIED"
  | "ORDER_CANCELLED"
  | "SETTINGS_UPDATED"
  | "BROKER_CONNECTED"
  | "BROKER_DISCONNECTED"
  | "KILL_SWITCH_ENABLED"
  | "KILL_SWITCH_DISABLED"
  | "AUTO_SQUARE_OFF_TRIGGERED"
  | "WEBHOOK_RECEIVED"
  | "WEBHOOK_REJECTED"
  | "RATE_LIMIT_EXCEEDED"
  | "INVALID_REQUEST";

export interface AuditDetails {
  ip?: string;
  userId?: string;
  symbol?: string;
  orderId?: string;
  qty?: number | string;
  side?: string;
  price?: number | string;
  reason?: string;
  [key: string]: unknown;
}

export function auditLog(action: AuditAction, details: AuditDetails = {}): void {
  logger.info(
    {
      audit: true,
      action,
      ts: new Date().toISOString(),
      ...details,
    },
    `[AUDIT] ${action}`
  );
}
```

### Orders mein use karo — `artifacts/api-server/src/routes/orders.ts`:
```typescript
import { auditLog } from "../lib/audit-logger";

// Place order ke baad:
auditLog("ORDER_PLACED", {
  ip: req.ip,
  symbol: body.tradingSymbol,
  qty: body.quantity,
  side: body.transactionType,
  orderId: response.orderId,
});

// Cancel order ke baad:
auditLog("ORDER_CANCELLED", {
  ip: req.ip,
  orderId: req.params.orderId,
});

// Modify order ke baad:
auditLog("ORDER_MODIFIED", {
  ip: req.ip,
  orderId: req.params.orderId,
  newQty: body.quantity,
  newPrice: body.price,
});
```

### Risk routes mein — `artifacts/api-server/src/routes/risk.ts`:
```typescript
import { auditLog } from "../lib/audit-logger";

// Kill switch enable:
auditLog("KILL_SWITCH_ENABLED", { ip: req.ip });

// Kill switch disable:
auditLog("KILL_SWITCH_DISABLED", { ip: req.ip });

// Auto square-off:
auditLog("AUTO_SQUARE_OFF_TRIGGERED", {
  reason: "scheduled",
  time: new Date().toISOString(),
});
```

### Settings mein — `artifacts/api-server/src/routes/settings.ts`:
```typescript
auditLog("SETTINGS_UPDATED", {
  ip: req.ip,
  changedFields: Object.keys(req.body),
});
```

## Logs kaise dekhe:
```bash
# DO server pe:
pm2 logs dhan-api --lines 100 | grep AUDIT

# Ya:
pm2 logs dhan-api 2>&1 | grep '"audit":true'

# Real-time watch:
pm2 logs dhan-api | grep --line-buffered AUDIT
```

## Log example output:
```json
{
  "level": 30,
  "audit": true,
  "action": "ORDER_PLACED",
  "ts": "2026-04-24T10:30:00.000Z",
  "ip": "::1",
  "symbol": "NIFTY",
  "qty": 50,
  "side": "BUY",
  "orderId": "1234567890",
  "msg": "[AUDIT] ORDER_PLACED"
}
```

---

# STEP 10 — Nginx Security Headers

## Real Attack Scenario:
- **Clickjacking via Nginx:** Agar helmet sirf API routes pe hai, frontend pe nahi — static files pe clickjacking possible
- **Server version leak:** `Server: nginx/1.24.0` — attacker ko exact version pata — known vulnerabilities dhundh sakta hai
- **Referrer leakage:** URL mein sensitive info ho toh external sites ko jaata hai

## Fix karo:
**Location:** DO Server pe Nginx config

```bash
nano /etc/nginx/sites-available/trading
```

### Complete updated config (copy-paste karo):
```nginx
server {
    listen 80;
    server_name _;

    # ── Security Headers ─────────────────────────────────────────────────────
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    # Agar HTTPS hai:
    # add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # ── Hide Server Info ─────────────────────────────────────────────────────
    server_tokens off;  # Nginx version hide karo

    root /var/www/trading/artifacts/trading-platform/dist/public;
    index index.html;

    # ── API Proxy ────────────────────────────────────────────────────────────
    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts — hanging connections band karo
        proxy_connect_timeout 10s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;

        # Buffer limits
        proxy_buffer_size 4k;
        proxy_buffers 4 32k;
    }

    # ── Static Files ─────────────────────────────────────────────────────────
    location / {
        try_files $uri $uri/ /index.html;

        # Static assets cache
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # ── Block Hidden Files ────────────────────────────────────────────────────
    location ~ /\. {
        deny all;
        return 404;
    }

    # ── Block Sensitive Files ─────────────────────────────────────────────────
    location ~* \.(env|log|bak|sql|conf)$ {
        deny all;
        return 404;
    }
}
```

### Apply karo:
```bash
nginx -t
# "test is successful" aana chahiye

systemctl reload nginx
```

## Test karo:
```bash
# Server version hide hua:
curl -I http://68.183.247.209/ | grep -i server
# Sirf "Server: nginx" — version number nahi

# Security headers hain:
curl -I http://68.183.247.209/ | grep -iE "x-frame|x-content|referrer"
# X-Frame-Options: SAMEORIGIN
# X-Content-Type-Options: nosniff

# .env file block hua:
curl http://68.183.247.209/.env
# 404

# Hidden files block hua:
curl http://68.183.247.209/.htaccess
# 404
```

---

# STEP 11 — Environment Variable Security Audit

## Real Attack Scenario:
**Weak Secrets:** ENCRYPTION_KEY agar `12345` jaisi hai toh encrypted tokens brute-force se crack ho sakte hain. `.env` agar git mein commit ho jaaye toh GitHub pe saari secrets public.

## Checklist:

### 1. `.env` git mein nahi hai — verify karo:
```bash
# Replit Shell mein:
cat .gitignore | grep .env
# .env dikhna chahiye

# Ya check karo:
git status
# .env files "Untracked" mein nahi aani chahiye
```

### 2. DO Server pe current .env audit karo:
```bash
cat /var/www/trading/.env
```

### Sab values properly set honi chahiye:
```env
# Required — har cheez set honi chahiye
NODE_ENV=production                          # ✓ "production" hona chahiye
DATABASE_URL=postgresql://...                # ✓ URL-encoded password
PORT=3001                                   # ✓ API server port
ENCRYPTION_KEY=<64-char hex>               # ✓ Exactly 64 chars

# Security secrets — generate karo agar nahi hain
POSTBACK_SECRET=<32+ char random>           # webhook security
WS_ACCESS_TOKEN=<32+ char random>           # websocket auth
ALLOWED_ORIGINS=http://68.183.247.209       # production origin

# Optional lekin recommended
LOG_LEVEL=info                              # debug nahi — logs mein sensitive data
```

### Generate strong secrets agar nahi hain:
```bash
# DO server pe:
openssl rand -hex 32   # POSTBACK_SECRET ke liye
openssl rand -hex 32   # WS_ACCESS_TOKEN ke liye
```

### ENCRYPTION_KEY verify karo (exactly 64 chars hona chahiye):
```bash
grep ENCRYPTION_KEY /var/www/trading/.env | cut -d= -f2 | wc -c
# 65 aana chahiye (64 chars + newline)
```

### 3. File permissions:
```bash
# .env sirf root read kar sake:
chmod 600 /var/www/trading/.env
ls -la /var/www/trading/.env
# -rw------- 1 root root — aana chahiye
```

### 4. .env kabhi bhi Git mein commit mat karo:
```bash
# Replit Shell mein verify:
cat .gitignore
# Agar .env nahi hai — add karo:
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore
echo "!.env.example" >> .gitignore
```

---

# STEP 12 — Firewall (UFW)

## Real Attack Scenario:
**Direct API Attack:** Nginx bypass karke koi directly `http://68.183.247.209:3001/api/orders/place` call kar sakta hai. Port 3001 pe direct access mein:
- CORS checks skip ho sakte hain
- Rate limiting skip ho sakti hai
- Nginx security headers nahi honge

**Port Scanning:** Attacker `nmap 68.183.247.209` se saare open ports scan karta hai aur attack surface dhundh ta hai.

## Fix karo:
**Location:** DO Server pe (code change nahi)

### UFW configure karo:
```bash
# Pehle current status check karo:
ufw status

# Default rules set karo:
ufw default deny incoming   # Sab inbound band
ufw default allow outgoing  # Sab outbound allow (API calls ke liye)

# Zaroorat ke ports kholo:
ufw allow 22/tcp     # SSH — DO console access (ZAROOR karo warna lock out ho jaoge)
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS

# UFW enable karo:
ufw enable
# "Command may disrupt existing ssh connections. Proceed with operation (y|n)?" — y daao

# Status verify karo:
ufw status verbose
```

### Output dikhna chahiye:
```
Status: active

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
```

### Verify karo port 3001 band hai:
```bash
# Apne PC se test karo (Windows CMD mein):
curl http://68.183.247.209:3001/api/health
# "Connection refused" ya timeout — aana chahiye (good)

# Port 80 se kaam karta hai (Nginx ke through):
curl http://68.183.247.209/api/health
# {"status":"ok"} — aana chahiye (good)
```

## Agar SSH disconnect ho jaye (emergency):
DO browser console se connect karo (yeh firewall se bypass hota hai):
```bash
# UFW disable karo:
ufw disable
# Phir rule check karo — port 22 allow karo aur wapas enable karo
```

---
---

# Implementation Order — Sabse Easy Se Shuru Karo

```
STEP 12: Firewall          ← Pehle karo, sabse important, no code change (5 min)
    ↓
STEP 11: Env Audit         ← .env check karo, secrets generate karo (10 min)
    ↓
STEP 10: Nginx Headers     ← Server pe sirf config change (10 min)
    ↓
STEP 3: Request Size       ← 2 line code change (5 min)
    ↓
STEP 4: Error Messages     ← Error handler update (10 min)
    ↓
STEP 2: Helmet.js          ← Install + 5 lines add (10 min)
    ↓
STEP 5: CORS Lockdown      ← CORS update + .env (15 min)
    ↓
STEP 7: Rate Limiting      ← New middleware + install (20 min)
    ↓
STEP 9: Audit Logging      ← New file + add to routes (30 min)
    ↓
STEP 6: Webhook Security   ← POSTBACK_SECRET set karo (15 min)
    ↓
STEP 8: WebSocket Auth     ← Token-based WS auth (30 min)
    ↓
STEP 1: HTTPS              ← Domain kharidne ke baad (30 min)
```

---

# Phase 2A (Clerk Auth) Se Jo Automatically Milega

Jab multi-user auth lagayenge (Phase 2A), yeh security bhi aa jaayegi:
- **Har API route authenticated** — bina login ke kuch nahi
- **JWT token validation** — Clerk handle karta hai
- **Brute force on login** — Clerk ka built-in protection
- **Session management** — Clerk secure cookies/tokens
- **OAuth (Google/GitHub)** — Password-less login option
- **MFA support** — 2FA Clerk mein built-in

---

# Security Checklist

| # | Step | Kahan | Status | Time |
|---|---|---|---|---|
| 12 | Firewall (UFW) | DO Server | ⬜ | 5 min |
| 11 | Env Variable Audit | DO Server + .gitignore | ⬜ | 10 min |
| 10 | Nginx Security Headers | DO Server | ⬜ | 10 min |
| 3 | Request Size Limit | api-server/app.ts | ⬜ | 5 min |
| 4 | Error Messages Hide | api-server/app.ts | ⬜ | 10 min |
| 2 | Helmet.js | api-server/app.ts | ⬜ | 10 min |
| 5 | CORS Lockdown | api-server/app.ts | ⬜ | 15 min |
| 7 | IP Rate Limiting | New middleware | ⬜ | 20 min |
| 9 | Audit Logging | New lib + routes | ⬜ | 30 min |
| 6 | Webhook Security | postback.ts | ⬜ | 15 min |
| 8 | WebSocket Auth | index.ts + socket.ts | ⬜ | 30 min |
| 1 | HTTPS/SSL | DO Server (domain needed) | ⬜ | 30 min |

**Total:** ~3 hours (ek ek karke aaram se karo)
