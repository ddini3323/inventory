# Implementation Guide

A full walkthrough of how the Allo Inventory reservation system was designed and built — frontend, backend, database, and tooling.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Implementation Steps](#4-implementation-steps)
5. [Backend — API Routes](#5-backend--api-routes)
6. [Backend — Database Design](#6-backend--database-design)
7. [Backend — Concurrency Protection](#7-backend--concurrency-protection)
8. [Backend — Reservation Expiry](#8-backend--reservation-expiry)
9. [Backend — Idempotency](#9-backend--idempotency)
10. [Frontend — Pages & Components](#10-frontend--pages--components)
11. [Frontend — UI Flow](#11-frontend--ui-flow)
12. [Testing Strategy](#12-testing-strategy)

---

## 1. Project Overview

**Problem:** A multi-warehouse retail system where multiple customers can simultaneously try to buy the last available unit. Without protection, two customers could both "buy" the same item — an oversell.

**Solution:** A reservation system with a 10-minute hold. When a customer clicks Reserve:
- Stock is atomically locked for exactly that customer
- No other customer can reserve the same unit during the hold
- If the customer doesn't confirm within 10 minutes, stock is returned
- The mechanism that prevents two simultaneous reservations succeeding is a single Postgres `UPDATE` with a `WHERE` clause that checks availability — Postgres row-level locking handles the race automatically

---

## 2. Tech Stack

### Core Framework
| Tool | Version | Purpose |
|---|---|---|
| **Next.js** | 16.2.6 | Full-stack React framework (App Router) |
| **React** | 19.2.4 | UI rendering |
| **TypeScript** | 5.x | Type safety across frontend and backend |
| **Tailwind CSS** | 4.x | Utility-first styling |

### Backend & Database
| Tool | Version | Purpose |
|---|---|---|
| **Prisma** | 7.x | ORM — schema definition, migrations, query builder |
| **@prisma/adapter-pg** | 7.x | Postgres driver adapter for Prisma |
| **pg (node-postgres)** | latest | Raw Postgres connection pooling |
| **Neon** | — | Serverless hosted PostgreSQL database |
| **Upstash Redis** | — | Serverless hosted Redis (idempotency keys) |
| **@upstash/redis** | 1.x | Upstash Redis client |
| **Zod** | 4.x | Runtime request body validation |

### Deployment & Infrastructure
| Tool | Purpose |
|---|---|
| **Vercel** | Hosting, serverless functions, cron jobs |
| **Vercel Cron** | Scheduled reservation expiry (daily) |
| **GitHub** | Source control and CI/CD trigger |

### Development Tools
| Tool | Purpose |
|---|---|
| **ts-node** | Run TypeScript seed scripts directly |
| **dotenv** | Load `.env.local` in Prisma config and seed scripts |
| **node --env-file** | Load env vars for test scripts (Node 20+) |

---

## 3. Project Structure

```
allo-inventory/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (nav, global styles)
│   ├── page.tsx                  # Product listing page (server component)
│   ├── components/
│   │   ├── ProductList.tsx       # Product grid (client component)
│   │   └── ReserveButton.tsx     # Reserve button with warehouse select
│   ├── reservations/
│   │   └── [id]/
│   │       ├── page.tsx          # Checkout page (server component)
│   │       └── ReservationClient.tsx  # Countdown timer + confirm/cancel
│   └── api/
│       ├── products/route.ts          # GET /api/products
│       ├── warehouses/route.ts        # GET /api/warehouses
│       ├── reservations/
│       │   ├── route.ts               # POST /api/reservations
│       │   └── [id]/
│       │       ├── route.ts           # GET /api/reservations/:id
│       │       ├── confirm/route.ts   # POST /api/reservations/:id/confirm
│       │       └── release/route.ts   # POST /api/reservations/:id/release
│       └── cron/
│           └── expire/route.ts        # GET /api/cron/expire
│
├── lib/
│   ├── prisma.ts          # Prisma client singleton with pg.Pool
│   ├── redis.ts           # Upstash Redis client (optional)
│   ├── expiry.ts          # releaseExpiredReservations() helper
│   └── schemas.ts         # Zod validation schemas
│
├── prisma/
│   ├── schema.prisma      # Database schema
│   └── seed.ts            # Database seed script
│
├── prisma.config.ts       # Prisma config (loads .env.local for CLI)
├── next.config.ts         # Next.js config (Turbopack root fix)
├── vercel.json            # Vercel cron schedule
│
├── race-condition-test.js # Concurrent reservation proof
├── lifecycle-test.js      # Full end-to-end lifecycle proof
├── reset-inventory.js     # Test helper — reset DB state
│
├── ARCHITECTURE.md        # System diagrams (Mermaid)
├── DEPLOYMENT.md          # Step-by-step deploy & test guide
└── docs/
    └── WORKING_RECORD.md  # Captured live test output
```

---

## 4. Implementation Steps

### Step 1 — Scaffold the project
```bash
npx create-next-app@latest allo-inventory --typescript --tailwind --app --no-src-dir
```
- App Router enabled (not Pages Router)
- TypeScript strict mode
- Tailwind CSS for styling

### Step 2 — Install dependencies
```bash
npm install prisma @prisma/client @prisma/adapter-pg pg @upstash/redis zod
npm install -D ts-node dotenv
```

### Step 3 — Define the database schema

Created `prisma/schema.prisma` with 4 models:
- `Product` — items for sale
- `Warehouse` — fulfilment locations
- `Inventory` — stock levels per product per warehouse (`totalUnits`, `reservedUnits`)
- `Reservation` — holds with status (PENDING / CONFIRMED / RELEASED) and expiry

Key design choice: `Inventory` tracks both `totalUnits` and `reservedUnits` separately. Available stock = `totalUnits - reservedUnits`. This allows atomic increment/decrement without SELECT + UPDATE race conditions.

### Step 4 — Set up Prisma with the pg driver adapter

Standard Prisma uses its own binary engine. For Neon serverless, we use `@prisma/adapter-pg` which connects via the `pg` npm package directly.

Critical fix discovered during implementation:
```typescript
// ❌ Wrong — PrismaPg internal pool times out on Neon
const adapter = new PrismaPg({ connectionString });

// ✅ Correct — pre-create the pool, pass it in
const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 20000 });
const adapter = new PrismaPg(pool);
```

### Step 5 — Build the API routes

Built 6 API routes in the Next.js App Router:
1. `GET /api/products` — list products with stock, runs expiry cleanup
2. `POST /api/reservations` — atomic reservation with race condition protection
3. `GET /api/reservations/:id` — fetch single reservation
4. `POST /api/reservations/:id/confirm` — confirm purchase
5. `POST /api/reservations/:id/release` — cancel reservation
6. `GET /api/cron/expire` — expiry cleanup (authenticated)

### Step 6 — Implement concurrency protection

The core of the system — a single SQL `UPDATE` inside a Prisma transaction:
```sql
UPDATE "Inventory"
SET "reservedUnits" = "reservedUnits" + 1
WHERE "productId"   = 'prod_shoe_001'
  AND "warehouseId" = 'wh_la'
  AND ("totalUnits" - "reservedUnits") >= 1
```
If the `WHERE` clause is false (no stock), 0 rows are updated → 409 returned. Postgres serialises concurrent writes to the same row, so only one of two simultaneous requests can win.

### Step 7 — Build the expiry system

Created `lib/expiry.ts` with `releaseExpiredReservations()`:
- Finds all PENDING reservations where `expiresAt < NOW()`
- For each: atomically decrements `reservedUnits` AND marks reservation as RELEASED in one transaction
- Called in two places: `GET /api/products` (lazy) and `GET /api/cron/expire` (scheduled)

### Step 8 — Add idempotency via Redis

`POST /api/reservations` accepts an optional `Idempotency-Key` header:
- On first request: stores the response in Redis with 24h TTL
- On retry with same key: returns cached response with `Idempotency-Replayed: true` header
- No double-reservation possible on network retry

### Step 9 — Build the frontend

Two pages:
1. **Product listing** (`app/page.tsx`) — server component, queries Prisma directly, shows all products with per-warehouse stock
2. **Checkout** (`app/reservations/[id]/page.tsx`) — server component for initial data, client component (`ReservationClient.tsx`) for the countdown timer and actions

Key client components:
- `ProductList.tsx` — responsive grid of product cards
- `ReserveButton.tsx` — warehouse selector + reserve button, handles POST to API
- `ReservationClient.tsx` — countdown timer, confirm/cancel buttons, status banners

### Step 10 — Seed the database

Created `prisma/seed.ts` with:
- 3 warehouses (LA, NYC, Chicago)
- 5 products (shoes, watch, backpack, jacket, headphones)
- Inventory entries with varied stock levels across warehouses

### Step 11 — Write proof tests

Two Node.js scripts to prove the system works:
- `race-condition-test.js` — 5 concurrent requests prove no oversell
- `lifecycle-test.js` — 4-phase test proving the full reserve → hold → expire → recover flow

### Step 12 — Deploy to Vercel

- Pushed code to GitHub (`https://github.com/ddini3323/inventory`)
- Connected Vercel to the repo
- Set environment variables in Vercel dashboard
- Fixed two production-specific issues:
  1. Added `export const dynamic = "force-dynamic"` to prevent Next.js from pre-rendering DB-dependent pages at build time
  2. Server components changed to call Prisma directly (not internal HTTP fetch) — serverless functions can't reliably call themselves over HTTP

---

## 5. Backend — API Routes

### `GET /api/products`

```
1. Call releaseExpiredReservations() — clean up any expired holds
2. Query all products with inventories and warehouses via Prisma
3. Map to response shape: available = totalUnits - reservedUnits
4. Return JSON array
```

### `POST /api/reservations`

```
1. Parse and validate request body with Zod
2. Check Idempotency-Key header → return cached response if exists
3. Open Prisma interactive transaction:
   a. Run conditional UPDATE on Inventory
   b. If 0 rows updated → throw INSUFFICIENT_STOCK error
   c. Create Reservation row with expiresAt = NOW() + 10 minutes
4. Store result in Redis if Idempotency-Key present
5. Return 201 with reservation data
```

### `POST /api/reservations/:id/confirm`

```
1. Load reservation, verify status = PENDING and not expired
2. Open Prisma interactive transaction:
   a. Decrement BOTH reservedUnits AND totalUnits (permanent sale)
   b. Update reservation status to CONFIRMED with confirmedAt timestamp
3. Return 200 with updated reservation
```

### `POST /api/reservations/:id/release`

```
1. Load reservation, verify status = PENDING
2. Open Prisma interactive transaction:
   a. Decrement reservedUnits only (stock returned, not sold)
   b. Update reservation status to RELEASED with releasedAt timestamp
3. Return 200 with updated reservation
```

### `GET /api/cron/expire`

```
1. Verify Authorization: Bearer <CRON_SECRET> header
2. Call releaseExpiredReservations()
3. Return { released: N, timestamp }
```

---

## 6. Backend — Database Design

### Schema decisions

**`Inventory` has two unit fields, not one:**
```
totalUnits    — physical units in the warehouse
reservedUnits — units currently held by PENDING reservations
available     — computed: totalUnits - reservedUnits (not stored)
```

Why: This allows atomic single-row updates. We never need to count reservations at query time — we just increment/decrement `reservedUnits` transactionally.

**`Reservation` status is an enum:**
```
PENDING   — active hold, stock locked
CONFIRMED — purchase complete, stock permanently deducted
RELEASED  — cancelled or expired, stock returned
```

**On Confirm:** both `reservedUnits` AND `totalUnits` decrease (item is sold)
**On Release:** only `reservedUnits` decreases (item goes back on shelf)

---

## 7. Backend — Concurrency Protection

The entire race condition protection is a single SQL statement:

```sql
UPDATE "Inventory"
SET "reservedUnits" = "reservedUnits" + <quantity>
WHERE "productId"   = <id>
  AND "warehouseId" = <id>
  AND ("totalUnits" - "reservedUnits") >= <quantity>
```

**Why this works:**
- Postgres acquires a row-level lock when executing an `UPDATE`
- Two concurrent transactions targeting the same row are serialised — one runs first, the other waits
- The first transaction succeeds: condition is true, 1 row updated
- The second transaction runs after the first commits: condition is now false (stock exhausted), 0 rows updated
- The application checks the row count: 0 rows = throw `INSUFFICIENT_STOCK` = return 409

**What was NOT needed:**
- Redis distributed locks
- Application-level mutexes
- `SELECT FOR UPDATE` (unnecessary overhead)
- Advisory locks

Postgres row-level exclusion is sufficient and correct for a single primary DB.

---

## 8. Backend — Reservation Expiry

Two-layer expiry system:

### Layer 1 — Lazy cleanup on reads (real-time)
`GET /api/products` calls `releaseExpiredReservations()` before returning data. Every page load cleans up expired holds — stock counts shown to users are always accurate.

### Layer 2 — Vercel Cron (safety net)
`vercel.json` schedules the cron endpoint once per day. Catches any reservations that expired between page loads.

```json
{
  "crons": [{ "path": "/api/cron/expire", "schedule": "0 0 * * *" }]
}
```

The cron endpoint is authenticated with `Authorization: Bearer $CRON_SECRET` to prevent public triggering.

### Expiry logic
```typescript
// Find all expired pending reservations
const expired = await prisma.reservation.findMany({
  where: { status: "PENDING", expiresAt: { lt: new Date() } }
});

// For each: atomically return stock and mark released
for (const r of expired) {
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE "Inventory"
      SET "reservedUnits" = GREATEST(0, "reservedUnits" - ${r.quantity})
      WHERE "productId" = ${r.productId} AND "warehouseId" = ${r.warehouseId}
    `,
    prisma.reservation.update({
      where: { id: r.id, status: "PENDING" },
      data: { status: "RELEASED", releasedAt: new Date() }
    })
  ]);
}
```

`GREATEST(0, ...)` prevents `reservedUnits` from going negative if called twice concurrently.

---

## 9. Backend — Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` support idempotency keys:

```
Client → POST /api/reservations
         Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

Server → check Redis for key "idempotency:550e8400-..."
         if found → return cached response + Idempotency-Replayed: true header
         if not found → process normally → store result in Redis (24h TTL)
```

**Why this matters:** If a network error causes the client to retry, the second request returns the original response without creating a second reservation. Safe for payment integrations.

Redis is **optional** — if `UPSTASH_REDIS_REST_URL` is not set, idempotency is silently skipped and the app works normally.

---

## 10. Frontend — Pages & Components

### Server Components (run on the server, no client JavaScript)

**`app/page.tsx`** — Product listing
- Calls `releaseExpiredReservations()` then queries Prisma directly
- Returns product data to `ProductList` client component
- `export const dynamic = "force-dynamic"` — always fresh, never cached

**`app/reservations/[id]/page.tsx`** — Checkout page
- Queries Prisma directly for the reservation by ID
- Returns data to `ReservationClient` client component
- `export const dynamic = "force-dynamic"` — always fresh

### Client Components (run in the browser)

**`ProductList.tsx`**
- Renders the product grid
- Passes each product to a card with `ReserveButton`

**`ReserveButton.tsx`**
- Shows warehouse stock levels
- Dropdown to select warehouse (only shows warehouses with available stock)
- On click: `POST /api/reservations` → redirect to `/reservations/:id`

**`ReservationClient.tsx`**
- Countdown timer (`setInterval` every 1 second)
- Real-time status: PENDING (with timer), CONFIRMED, RELEASED, EXPIRED
- Confirm button: `POST /api/reservations/:id/confirm`
- Cancel button: `POST /api/reservations/:id/release`
- Colour-coded status banners: green (confirmed), amber (urgent <60s), red (expired), grey (released)

---

## 11. Frontend — UI Flow

```
Home (/)
  └─ Product grid
       └─ [click Reserve]
            └─ POST /api/reservations
                 └─ redirect to /reservations/:id
                      ├─ Countdown timer (10 min)
                      ├─ [click Confirm] → POST .../confirm → "Purchase confirmed" banner
                      ├─ [click Cancel]  → POST .../release → "Reservation cancelled" banner
                      └─ [timer hits 0]  → "Reservation expired" banner
                           └─ [click Back to products] → /
```

### Status banner states

| State | Colour | Shown when |
|---|---|---|
| Counting down (>60s) | Blue | PENDING, timer > 60s |
| Urgent (<60s) | Amber | PENDING, timer ≤ 60s |
| Expired | Red | PENDING, timer = 0 |
| Confirmed | Green | status = CONFIRMED |
| Cancelled | Grey | status = RELEASED |

---

## 12. Testing Strategy

### Automated tests (scripts)

| Script | What it proves |
|---|---|
| `race-condition-test.js` | No oversell under concurrent load — DB invariant checked after all requests |
| `lifecycle-test.js` | Full flow correctness — race, hold, expiry, recovery all pass |
| `reset-inventory.js` | Test helper — resets a product to a known state before testing |

### Manual UI testing

| Scenario | How to test |
|---|---|
| Happy path | Reserve → Confirm → see "Purchase confirmed" |
| Cancel | Reserve → Cancel → stock restored on product page |
| Expiry | Reserve → wait 10 min → see "Expired" → stock restored |
| Out of stock | Reserve last unit → open product page in second tab → button disabled |
| Race condition | Open two tabs, click Reserve simultaneously on last unit |

### API testing (curl)

All endpoints are directly testable with `curl`. See [DEPLOYMENT.md](DEPLOYMENT.md#12-api-reference) for full curl examples.

### What was not built (known gaps)

| Gap | Reason |
|---|---|
| Playwright E2E tests | Time constraint — would be highest-value addition |
| Unit tests for expiry logic | Logic is simple enough to prove with integration tests |
| Auth/user sessions | Out of scope for demo |
| Pagination | 5 seed products — not needed at this scale |
