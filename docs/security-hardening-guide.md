# Security Hardening Guide — Dhan Algo Trader
## Step-by-Step Implementation (Ek Ek Karke)

---

## How to Use This Guide

1. Har step ek ek karke karo — sab ek saath mat karo
2. Har step ke baad app test karo — kuch toot na jaye
3. Har step ke baad DO server pe push + build karo
4. Kisi step mein dikkat aaye toh agent ko woh step ka naam batao

**Push + Deploy command (har step ke baad):**
```bash
# Replit Shell mein:
git add -A && git commit -m "security: STEP_NAME" && git push origin main

# DO Server pe:
cd /var/www/trading && git pull origin main && PORT=3001 pnpm --filter @workspace/api-server run build && pm2 restart dhan-api
```

---
---

# STEP 1 — HTTPS (SSL Certificate)

## Kya hai: HTTP → HTTPS
Abhi sab data plain text mein jaata hai. HTTPS se sab encrypt ho jaata hai.

## Risk agar nahi kiya:
Network pe koi bhi password, tokens, orders intercept kar sakta hai.

## Kahan karna hai: DO Server pe (code change nahi)

```bash
# DO Server pe chalao:
apt-get install -y certbot python3-certbot-nginx

# Domain chahiye SSL ke liye — pehle ek domain kharido (GoDaddy/Namecheap ~₹500/year)
# Domain ka A Record → 68.183.247.209 pe point karo
# Phir yeh chalao:
certbot --nginx -d yourdomain.com

# Auto-renewal setup:
systemctl enable certbot.timer
```

## Test karo:
Browser mein `https://yourdomain.com` kholo — green lock aana chahiye.

## Note:
Domain nahi hai toh yeh step baad mein karo. Baaki steps bina domain ke bhi ho sakte hain.

---

# STEP 2 — Helmet.js (HTTP Security Headers)

## Kya hai:
Helmet Express app mein 15+ security headers automatically add karta hai jo XSS, clickjacking, MIME sniffing attacks rokta hai.

## Risk agar nahi kiya:
Browser-based attacks jaise clickjacking (koi tumhari app ko apni site pe embed kar sakta hai) aur XSS possible rehte hain.

## Kahan karna hai: `artifacts/api-server/`

### Install karo:
```bash
pnpm --filter @workspace/api-server add helmet
```

### Code change — `artifacts/api-server/src/app.ts`:
```typescript
import helmet from "helmet";  // YEH ADD KARO top pe

// app.use(express.json()); se PEHLE add karo:
app.use(helmet({
  crossOriginEmbedderPolicy: false,  // Socket.io ke liye zaroori
  contentSecurityPolicy: false,       // React app ke liye (baad mein configure karenge)
}));
```

### Final app.ts dikhega aisa:
```typescript
import express from "express";
import cors from "cors";
import helmet from "helmet";  // NEW
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requestLogger } from "./middleware/request-logger";

const app = express();
app.set("etag", false);

app.use(pinoHttp({ ... }));

app.use(helmet({              // NEW — pehle CORS se pehle
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false,
}));

app.use(cors({ ... }));
// ... baaki sab same
```

## Test karo:
```bash
curl -I http://68.183.247.209/api/health
# Response mein yeh headers aane chahiye:
# x-content-type-options: nosniff
# x-frame-options: SAMEORIGIN
# x-xss-protection: 0
```

---

# STEP 3 — Request Size Limit

## Kya hai:
Koi bhi 100MB ka request maar ke server crash kar sakta hai. Limit lagao.

## Risk agar nahi kiya:
DDoS / server crash / out of memory.

## Kahan karna hai: `artifacts/api-server/src/app.ts`

### Code change:
```typescript
// CHANGE karo yeh line:
app.use(express.json());

// SE:
app.use(express.json({ limit: "1mb" }));  // 1MB se zyada body reject
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
```

## Test karo:
```bash
# 2MB payload bhejo — 413 aana chahiye
curl -X POST http://68.183.247.209/api/orders/place \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "print('x' * 2000000)")"
# Response: 413 Payload Too Large
```

---

# STEP 4 — Error Messages Hide Karo

## Kya hai:
Abhi `err.message` seedha client ko jaata hai — server ke internal details leak hote hain.

## Risk agar nahi kiya:
Hacker ko database errors, stack traces, file paths pata chal jaate hain.

## Kahan karna hai: `artifacts/api-server/src/app.ts`

### Code change — Error handler:
```typescript
// ABHI (dangerous):
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.warn({ err: err.message }, "Unhandled middleware error");
  res.status(500).json({ success: false, error: err.message });
});

// HONA CHAHIYE (safe):
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled middleware error");  // full error sirf log mein

  // Client ko generic message — internal details nahi
  const isOperational = (err as any).isOperational === true;
  res.status(500).json({
    success: false,
    error: isOperational ? err.message : "Internal server error"
  });
});
```

## Test karo:
App mein koi invalid route call karo — response mein stack trace ya database errors nahi aane chahiye.

---

# STEP 5 — CORS Production Lockdown

## Kya hai:
Abhi Replit ke saare `.replit.dev` domains allow hain — production mein yeh hona nahi chahiye.

## Risk agar nahi kiya:
Koi bhi Replit app tumhari production API call kar sakti hai.

## Kahan karna hai: `artifacts/api-server/src/app.ts`

### Code change:
```typescript
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:5173", "http://localhost:8081"];

const isDev = process.env.NODE_ENV !== "production";

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      // Sirf dev mein Replit domains allow karo
      if (isDev && /\.replit\.dev$/.test(origin)) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
  }),
);
```

### `.env` file update karo (DO server pe):
```bash
nano /var/www/trading/.env
# ALLOWED_ORIGINS=http://68.183.247.209,https://yourdomain.com
```

---

# STEP 6 — Webhook Security (Signature Verify)

## Kya hai:
Abhi koi bhi `/api/orders/postback` pe fake webhook maar sakta hai aur fake orders trigger kar sakta hai.

## Risk agar nahi kiya:
Fake order fills, fake P&L — trading data corrupt ho sakta hai.

## Kahan karna hai: `artifacts/api-server/src/routes/postback.ts`

### Code change:
```typescript
import crypto from "crypto";

// Webhook verify karne ka function
function verifyDhanSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Route pe lagao:
router.post("/postback", async (req, res) => {
  const signature = req.headers["x-dhan-signature"] as string;
  const secret = process.env.DHAN_WEBHOOK_SECRET ?? "";

  if (secret && signature) {
    const rawBody = JSON.stringify(req.body);
    if (!verifyDhanSignature(rawBody, signature, secret)) {
      logger.warn("Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  // ... baaki postback handling same
});
```

### `.env` mein add karo:
```
DHAN_WEBHOOK_SECRET=apna_secret_yahan
```

---

# STEP 7 — Brute Force Protection

## Kya hai:
Settings save, broker connect — koi bhi baar baar try kar sakta hai. Rate limit lagao per-IP.

## Risk agar nahi kiya:
Automated attacks se credentials guess ho sakte hain.

## Kahan karna hai: `artifacts/api-server/`

### Install karo:
```bash
pnpm --filter @workspace/api-server add express-rate-limit
```

### Naya middleware — `artifacts/api-server/src/middleware/global-rate-limit.ts`:
```typescript
import rateLimit from "express-rate-limit";

// Global limit — sabhi routes pe
export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 300,                     // max 300 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests, please try again later." },
});

// Strict limit — sensitive routes pe (settings save, broker connect)
export const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                      // max 20 requests per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many attempts, please try again later." },
});
```

### `artifacts/api-server/src/app.ts` mein lagao:
```typescript
import { globalRateLimit } from "./middleware/global-rate-limit";

app.use("/api", globalRateLimit);   // sabhi API routes pe
app.use("/api", router);
```

### Sensitive routes pe strict limit:
```typescript
// artifacts/api-server/src/routes/settings.ts mein:
import { strictRateLimit } from "../middleware/global-rate-limit";

router.post("/settings", strictRateLimit, async (req, res) => { ... });
router.post("/broker/connect", strictRateLimit, async (req, res) => { ... });
```

## Test karo:
```bash
# 301 baar request maaro — 429 aana chahiye
for i in {1..305}; do curl -s http://68.183.247.209/api/health; done
# Last kuch mein: 429 Too Many Requests
```

---

# STEP 8 — WebSocket Authentication

## Kya hai:
Abhi koi bhi WebSocket se connect ho sakta hai aur market data le sakta hai.

## Risk agar nahi kiya:
Unauthorized users real-time data access kar sakte hain, server pe load badh sakta hai.

## Kahan karna hai: `artifacts/api-server/src/index.ts`

### Code change:
```typescript
// Socket.io setup mein add karo:
const io = new SocketIO(server, {
  cors: { origin: ALLOWED_ORIGINS, credentials: true },

  // AUTH MIDDLEWARE — NEW
  allowRequest: (req, callback) => {
    // Simple API key check (Phase 2A mein Clerk token se replace karein)
    const token = new URL(req.url ?? "", "http://x").searchParams.get("token");
    const validToken = process.env.WS_ACCESS_TOKEN;

    if (!validToken) return callback(null, true);  // Dev mein skip

    if (token === validToken) {
      callback(null, true);
    } else {
      callback("Unauthorized", false);
    }
  },
});
```

### `.env` mein add karo:
```
WS_ACCESS_TOKEN=ek_random_strong_token_yahan
```

### Frontend mein add karo — `artifacts/trading-platform/src/lib/market-socket.ts`:
```typescript
// Socket connect karte waqt token bhejo:
const socket = io(BASE_URL, {
  path: `${BASE}api/socket.io`,
  query: {
    token: import.meta.env.VITE_WS_TOKEN  // .env mein set karo
  }
});
```

### Frontend `.env`:
```
VITE_WS_TOKEN=same_token_jo_server_pe_set_kiya
```

---

# STEP 9 — Audit Logging

## Kya hai:
Kaun, kab, kya kiya — sab log. Order place kiya? Log. Settings change ki? Log. Kill switch toggle? Log.

## Risk agar nahi kiya:
Kuch galat ho toh pata nahi chalega kab aur kaise hua.

## Kahan karna hai: `artifacts/api-server/src/lib/audit-logger.ts` (NAYA FILE)

### Naya file banao:
```typescript
import { logger } from "./logger";

type AuditAction =
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
  | "UNAUTHORIZED_ACCESS";

export function auditLog(action: AuditAction, details: Record<string, unknown>) {
  logger.info({
    audit: true,
    action,
    timestamp: new Date().toISOString(),
    ...details,
  }, `AUDIT: ${action}`);
}
```

### Har important route mein use karo:
```typescript
// orders.ts mein:
import { auditLog } from "../lib/audit-logger";

router.post("/place", async (req, res) => {
  // ... order place karo ...
  auditLog("ORDER_PLACED", {
    symbol: req.body.tradingSymbol,
    qty: req.body.quantity,
    side: req.body.transactionType,
    ip: req.ip,
  });
});

// risk.ts mein:
auditLog("KILL_SWITCH_ENABLED", { ip: req.ip });
```

## Test karo:
```bash
# DO server pe logs dekho:
pm2 logs dhan-api | grep "AUDIT"
```

---

# STEP 10 — Security Headers for Nginx

## Kya hai:
Nginx level pe extra security headers — Clickjacking, MIME type attacks band karo.

## Kahan karna hai: DO Server pe Nginx config

```bash
# DO Server pe:
nano /etc/nginx/sites-available/trading
```

### Nginx config mein add karo server block ke andar:
```nginx
server {
    listen 80;
    server_name _;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Hide Nginx version
    server_tokens off;

    root /var/www/trading/artifacts/trading-platform/dist/public;
    index index.html;

    location /api/ {
        proxy_pass http://localhost:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Rate limit at Nginx level bhi
        limit_req zone=api burst=20 nodelay;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Nginx rate limiting zone (http block mein — /etc/nginx/nginx.conf mein add karo)
# limit_req_zone $binary_remote_addr zone=api:10m rate=30r/m;
```

### Apply karo:
```bash
nginx -t && systemctl reload nginx
```

---

# STEP 11 — Environment Variable Security Audit

## Kya hai:
Sab secrets properly set hain ya nahi — check karo.

## DO Server pe check karo:
```bash
cat /var/www/trading/.env
```

### Sab yeh hone chahiye:
```env
NODE_ENV=production
DATABASE_URL=postgresql://trading_user:Trade%402024%23Secure@localhost:5432/trading_db
PORT=3001
ENCRYPTION_KEY=64_char_hex_string_yahan   # openssl rand -hex 32
ALLOWED_ORIGINS=http://68.183.247.209
DHAN_WEBHOOK_SECRET=random_strong_string   # openssl rand -hex 32
WS_ACCESS_TOKEN=random_strong_string       # openssl rand -hex 32
```

### Generate strong secrets:
```bash
openssl rand -hex 32   # DHAN_WEBHOOK_SECRET ke liye
openssl rand -hex 32   # WS_ACCESS_TOKEN ke liye
```

---

# STEP 12 — Firewall (UFW)

## Kya hai:
Sirf zaroorat ke ports khulo — baaki sab band karo.

## Kahan karna hai: DO Server pe

```bash
# UFW enable karo
ufw enable

# Sirf yeh ports allow karo:
ufw allow 22/tcp    # SSH — DO console access
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS (baad mein SSL lagane ke baad)

# Baaki sab automatically block
ufw status
```

### Verify karo port 3001 baahar se band hai:
```bash
# Yeh fail hona chahiye (sirf Nginx ke through accessible hona chahiye):
curl http://68.183.247.209:3001/api/health
# Connection refused aana chahiye
```

---
---

# Implementation Order — Ek Ek Karo

```
STEP 12: Firewall (pehle karo — sabse fast, no code change)
    ↓
STEP 2: Helmet.js (bahut easy — 5 min)
    ↓
STEP 3: Request size limit (2 line change)
    ↓
STEP 4: Error messages hide karo (5 min)
    ↓
STEP 5: CORS lockdown (10 min)
    ↓
STEP 7: Brute force protection (15 min)
    ↓
STEP 9: Audit logging (30 min)
    ↓
STEP 6: Webhook security (20 min)
    ↓
STEP 10: Nginx security headers (10 min — server pe)
    ↓
STEP 11: Env variable audit (5 min)
    ↓
STEP 8: WebSocket auth (30 min)
    ↓
STEP 1: HTTPS — domain kharidne ke baad
```

---

# Phase 2A ke Saath Jo Security Automatically Aayegi:

Jab Clerk Auth lagayenge (Phase 2A):
- Har API route authenticated hoga — unauthenticated access impossible
- JWT token validation automatic
- Session management Clerk karta hai (secure by default)
- Brute force on login Clerk handle karta hai

---

# Quick Security Checklist

| Step | Status | Time |
|---|---|---|
| STEP 1: HTTPS | ⬜ Pending | 30 min (domain ke baad) |
| STEP 2: Helmet.js | ⬜ Pending | 5 min |
| STEP 3: Request size limit | ⬜ Pending | 2 min |
| STEP 4: Error messages | ⬜ Pending | 5 min |
| STEP 5: CORS lockdown | ⬜ Pending | 10 min |
| STEP 6: Webhook security | ⬜ Pending | 20 min |
| STEP 7: Brute force | ⬜ Pending | 15 min |
| STEP 8: WebSocket auth | ⬜ Pending | 30 min |
| STEP 9: Audit logging | ⬜ Pending | 30 min |
| STEP 10: Nginx headers | ⬜ Pending | 10 min |
| STEP 11: Env audit | ⬜ Pending | 5 min |
| STEP 12: Firewall | ⬜ Pending | 5 min |
