# Multi-User SaaS Plan — Dhan Algo Trader
## Confirmed Decisions & Full Implementation Blueprint

---

## Current State (Phase 1 — Complete)

- Single user app — koi login nahi
- Ek hi Dhan account ke credentials — directly `.env` mein
- DO server pe deployed: `http://68.183.247.209`
- PostgreSQL database ready
- PM2 + Nginx running

---

## Confirmed Decisions (In-Conversation)

| Decision | Chosen Option |
|----------|---------------|
| Login system | Email + Password + Google OAuth |
| Auth provider | Clerk |
| Payment | UPI / Bank Transfer / QR Code (manual) |
| License | Manual license key generation |
| Automatic billing | NOT now — future option |
| Master ID/mapping | `clerk_user_id` — sab tables link |
| Admin panel | Haan — separate admin role |
| Per-user Dhan creds | Haan — encrypted in DB per user |

---

---

# PHASE 2A — Login System (Clerk Auth)

## Kya Milega:
- Email + Password login
- Google OAuth login (optional)
- Forgot password (email reset — automatic)
- Session management (7 days)
- Brute force protection (Clerk built-in)
- JWT token — har API request pe verify

## Login Screen Design:

```
┌─────────────────────────────────┐
│       Dhan Algo Trader          │
│                                 │
│  Email                          │
│  [trader@gmail.com         ]    │
│                                 │
│  Password                       │
│  [••••••••••               ]    │
│                                 │
│  [       Login       ]          │
│                                 │
│  ──────── OR ────────           │
│                                 │
│  [G  Continue with Google ]     │
│                                 │
│  Don't have account? Sign Up    │
│  Forgot Password?               │
└─────────────────────────────────┘
```

## Post-Login Flow:

```
Login success (Clerk JWT issued)
        ↓
License check:
  Active?  → Dashboard (full access)
  Expired? → Renewal page "Contact admin to renew"
  Pending? → "Enter your license key" page
        ↓
Dhan credentials set hain?
  Haan → Trading ready — sab features available
  Nahi → Settings page "Add your Dhan credentials to start trading"
```

## Security:

| Feature | Implementation |
|---------|----------------|
| Password storage | Clerk handles — bcrypt |
| Session | JWT — 7 days validity |
| Brute force | Clerk auto-blocks after failed attempts |
| 2FA | Clerk built-in — future mein enable |
| HTTPS only | Login sirf HTTPS pe |

---

---

# PHASE 2B — License Key System

## Payment Options (Confirmed):

```
User "Activate Account" page pe aata hai:
┌─────────────────────────────────────────┐
│  Choose Payment Method                  │
│                                         │
│  UPI:         yourname@upi              │
│  Bank:        HDFC | AC: XXXXXXXX       │
│               IFSC: HDFC0XXXXXX         │
│  QR Code:     [QR Image]                │
│                                         │
│  Plans:                                 │
│  • Monthly  — ₹XXX/month               │
│  • Quarterly — ₹XXX/3 months            │
│  • Annual   — ₹XXXX/year               │
│                                         │
│  After payment, WhatsApp/Email us:      │
│  [WhatsApp: +91 XXXXXXXXXX]             │
│  Payment screenshot + your email        │
└─────────────────────────────────────────┘
```

## License Key Generation Flow:

```
User payment karta hai
        ↓
Screenshot WhatsApp pe bhejta hai
        ↓
Tum verify karte ho (UPI/bank app)
        ↓
Admin panel mein:
  User dhundho → Email se
  Plan select karo (30d / 90d / 1yr)
  "Generate Key" click karo
        ↓
System generate karta hai:
  ALGO-2026-XKZP-9QRT  ← unique key
        ↓
Tum user ko bhejte ho (WhatsApp/Email)
        ↓
User dashboard mein enter karta hai
        ↓
Account active — trading shuru
```

## License Key Format:
```
ALGO - YYYY - XXXX - XXXX
  │     │       │      │
  │     │       │      └── Random 4-char alphanumeric
  │     │       └───────── Random 4-char alphanumeric
  │     └───────────────── Year of generation
  └─────────────────────── Product prefix
```

---

---

# DATABASE SCHEMA (Phase 2)

## Master Mapping — `clerk_user_id` is the key:

```
clerk_user_id = "user_2abc123xyz"  ← Clerk ka unique ID (permanent)
      │
      ├─→ users table        (profile, email, name)
      ├─→ licenses table     (key, status, expiry)
      └─→ settings table     (Dhan credentials — encrypted)
```

## Tables:

### 1. `users` table (new):
```sql
clerk_user_id  TEXT PRIMARY KEY   -- Clerk's user ID
email          TEXT NOT NULL
name           TEXT
role           TEXT DEFAULT 'user' -- 'user' or 'admin'
created_at     TIMESTAMP
```

### 2. `licenses` table (new):
```sql
id             SERIAL PRIMARY KEY
clerk_user_id  TEXT NOT NULL REFERENCES users(clerk_user_id)
license_key    TEXT UNIQUE NOT NULL  -- ALGO-2026-XXXX-XXXX
status         TEXT DEFAULT 'pending'
               -- 'pending' | 'active' | 'expired' | 'revoked'
plan           TEXT   -- 'monthly' | 'quarterly' | 'annual'
activated_at   TIMESTAMP
expires_at     TIMESTAMP             -- auto-expiry yahan
payment_note   TEXT                  -- "UPI ref: XXXXXXXXXX"
created_at     TIMESTAMP
```

### 3. `settings` table (existing — extend karni hai):
```sql
-- Add column:
clerk_user_id  TEXT REFERENCES users(clerk_user_id)
-- Existing columns same rahenge
-- dhan_client_id, access_token — already encrypted
```

---

---

# AUTO-EXPIRY SYSTEM

## Har API Request Pe Check:

```typescript
// Middleware — har route pe chalega
async function licenseCheck(req, res, next) {
  const userId = req.auth.userId;  // Clerk JWT se

  const license = await db
    .select()
    .from(licensesTable)
    .where(eq(licensesTable.clerkUserId, userId))
    .limit(1);

  if (!license.length || license[0].status !== 'active') {
    return res.status(403).json({ error: 'License inactive' });
  }

  if (new Date(license[0].expiresAt) < new Date()) {
    // Auto-expire karo
    await db.update(licensesTable)
      .set({ status: 'expired' })
      .where(eq(licensesTable.clerkUserId, userId));

    return res.status(403).json({ error: 'License expired. Contact admin.' });
  }

  next();
}
```

## Daily Midnight Cron Job:

```
Roz 00:00 IST pe chalega:
  → Saari licenses check karo
  → expires_at < today → status = 'expired'
  → expires_at = 3 din baad → "Renewal reminder" email bhejo (future)
```

---

---

# AUTO-LOGOUT SYSTEM

## 3 Triggers:

### 1. License Expire:
```
User API call karta hai
  → 403 response aata hai
  → Frontend: "Session ended — license expired"
  → Automatically logout page pe redirect
  → "Contact admin to renew your license"
```

### 2. Admin Revoke:
```
Admin "Revoke" click karta hai
  → status = 'revoked' DB mein
  → Agle API call pe: 403
  → Frontend: "Account suspended — contact admin"
  → Logout
```

### 3. Normal Clerk Session Expire:
```
7 din baad Clerk JWT expire hota hai
  → Clerk automatically logout karta hai
  → Login page pe redirect
```

---

---

# ADMIN PANEL

## Admin Kaun Hoga:
- Sirf tum — `role = 'admin'` in users table
- Alag login nahi — same email se login karo
- Admin role detect hoti hai → admin panel access milta hai

## Admin Panel Features:

### Users List:
```
┌────────────────────┬──────────┬────────────┬───────────────────────┐
│ Email              │ Status   │ Expires    │ Actions               │
├────────────────────┼──────────┼────────────┼───────────────────────┤
│ user1@gmail.com    │ ● Active │ 2027-04-24 │ [Extend] [Revoke]     │
│ user2@gmail.com    │ ○ Pending│ —          │ [Activate] [Delete]   │
│ user3@gmail.com    │ ✕ Expired│ 2026-03-31 │ [Renew] [Delete]      │
│ user4@gmail.com    │ ✕ Revoked│ —          │ [Restore] [Delete]    │
└────────────────────┴──────────┴────────────┴───────────────────────┘
```

### Generate License Key:
```
User: user2@gmail.com
Plan: [Monthly ▼] [Quarterly ▼] [Annual ▼]
Note: UPI ref XXXXXXXXXX — ₹999 received

[Generate & Activate Key]
  → Key: ALGO-2026-XKZP-9QRT
  → Copy karo → WhatsApp pe bhejo
```

### Extend / Renew:
```
User: user1@gmail.com
Current expiry: 2027-04-24
Extend by: [30 days] [90 days] [1 year]
Note: Renewal payment received

[Extend License]
  → New expiry: 2028-04-24
```

### Stats Dashboard (Admin):
```
Total Users:    12
Active:         8
Expired:        3
Pending:        1

Revenue this month: Manual tracking — UPI app dekho
```

---

---

# PER-USER DHAN CREDENTIALS

## Kaise Store Hoga:

```
User settings page mein fill karta hai:
  Dhan Client ID: 1001XXXXX
  Access Token:   eyJhbGciOiJIUzI1NiJ9...
  [Save]
        ↓
Backend:
  1. AES-256 se encrypt karo (ENCRYPTION_KEY from .env)
  2. DB mein save karo — clerk_user_id ke saath
        ↓
Jab order place karo:
  1. clerk_user_id se credentials uthao
  2. Decrypt karo
  3. Us user ke liye Dhan API call karo
  4. Response sirf us user ko
```

## Security:
- Har user ka data alag row mein
- `clerk_user_id` filter se dusre ka data impossible
- Tokens encrypted — DB leak ho bhi jaaye toh plain text nahi
- Admin bhi tokens plain text mein nahi dekh sakta (sirf masked)

---

---

# API MIDDLEWARE CHAIN (Phase 2)

```
Request aata hai
        ↓
[1] Clerk JWT verify karo
    → Invalid token → 401 Unauthorized
        ↓
[2] License check karo
    → No license / expired / revoked → 403 Forbidden
        ↓
[3] User ka data load karo (clerk_user_id se)
    → Dhan credentials decrypt karo
        ↓
[4] Existing guards chalao
    → Kill switch check
    → Daily loss limit check
    → Margin check
        ↓
[5] Dhan API call karo
        ↓
[6] Response user ko bhejo
```

---

---

# IMPLEMENTATION PHASES

## Phase 2A — Login System
**Estimated time: 2-3 weeks**
- [ ] Clerk setup (email + Google OAuth)
- [ ] Login / Signup page banao
- [ ] JWT middleware — har API route pe
- [ ] `users` table banao
- [ ] Settings table mein `clerk_user_id` add karo
- [ ] Per-user Dhan credentials (existing encryption use karo)
- [ ] Logout functionality

## Phase 2B — License Key System
**Estimated time: 1 week**
- [ ] `licenses` table banao
- [ ] License check middleware
- [ ] "Enter License Key" page banao
- [ ] Admin panel — basic version
  - [ ] Users list
  - [ ] Generate key
  - [ ] Activate / Revoke / Extend
- [ ] Auto-expiry (har request pe check)
- [ ] Midnight cron job (daily expiry sweep)

## Phase 2C — Admin Panel (Full)
**Estimated time: 1 week**
- [ ] Admin role detection
- [ ] Stats dashboard
- [ ] Payment notes field
- [ ] User details view
- [ ] Renewal flow

## Phase 2D — Polish
**Estimated time: 1 week**
- [ ] Expiry reminder (3 days before — email)
- [ ] "Contact admin" page with payment details
- [ ] User can see their own license status
- [ ] Better error pages

---

---

# WHAT COMES BEFORE PHASE 2

## Pehle karo (abhi):
1. **Security hardening** — 12 steps (docs/security-hardening-guide.md)
2. **Domain + HTTPS** — SSL certificate lao
3. **Test karo** — sab features working hain

## Phir Phase 2 shuru karo:
- Foundation strong hogi toh multi-user pe zero risk

---

---

# QUICK REFERENCE — Confirmed Choices

| Topic | Decision |
|-------|----------|
| Auth provider | Clerk |
| Login method | Email + Password + Google OAuth |
| Password reset | Clerk automatic email |
| Session length | 7 days (Clerk default) |
| Mapping key | `clerk_user_id` (Clerk's unique ID) |
| Payment method | UPI / Bank Transfer / QR Code |
| License type | Manual key generation |
| Key format | `ALGO-YYYY-XXXX-XXXX` |
| Auto-expiry | Haan — DB mein `expires_at` |
| Auto-logout | Haan — 403 → frontend logout |
| Admin panel | Haan — same app, alag role |
| Per-user Dhan creds | Haan — AES-256 encrypted |
| Razorpay | Nahi — future option only |
