# Allo Inventory

A Next.js 16 inventory reservation system for multi-warehouse retail. Customers reserve stock for 10 minutes while completing payment, preventing oversell under concurrency.

**GitHub:** https://github.com/ddini3323/inventory  
**Live demo:** *(add Vercel URL after deploying)*

---

## How to run locally

### Prerequisites
- Node.js 20+
- A hosted Postgres database ([Neon](https://neon.tech) free tier)
- An [Upstash Redis](https://upstash.com) database (free tier)

### Setup

```bash
git clone https://github.com/ddini3323/inventory.git
cd inventory
npm install
```

Copy and fill in env vars:

```bash
cp .env.example .env.local
```

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Neon → Connection string (pooled) |
| `UPSTASH_REDIS_REST_URL` | Upstash → REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash → REST Token |
| `CRON_SECRET` | Any random string — `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for local dev |

### Apply schema and seed

```bash
npx prisma generate
npx prisma db push
npm run db:seed
```

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## How to verify concurrency protection locally

Two test scripts are included. Both require the dev server to be running (`npm run dev`).

```bash
# Prove no oversell: 5 concurrent reservation requests, only N succeed
node --env-file=.env.local race-condition-test.js

# Full lifecycle: race → hold → expiry → recovery
node --env-file=.env.local lifecycle-test.js
```

### What the lifecycle test demonstrates

| Phase | What happens | Expected result |
|---|---|---|
| **Race** | Person A and B reserve simultaneously | A gets 201, B gets 409 |
| **Hold** | B retries while A holds the reservation | B still gets 409 (stock locked) |
| **Expiry** | A's reservation times out (10 min) | Stock returned, cron releases it |
| **Recovery** | B tries again after expiry | B gets 201 — stock is theirs now |

---

## How expiry works

**Primary — lazy cleanup on reads:** `GET /api/products` calls `releaseExpiredReservations()` before returning data. Every time the product listing is viewed, any expired PENDING reservations are released and stock is restored. This means expiry is effectively real-time — it resolves the moment the next user loads the page.

**Secondary — Vercel Cron (hourly):** `vercel.json` schedules `GET /api/cron/expire` once per hour as a safety net. The route is authenticated via `Authorization: Bearer $CRON_SECRET`. It catches any reservations that expired between page loads (e.g. if no one visits the site for a while).

**Why not a background worker?** Vercel serverless doesn't support persistent processes. Lazy-read gives immediate cleanup on every page load; the hourly cron is a backstop for idle periods.

---

## Concurrency correctness

The reservation endpoint uses a single conditional SQL `UPDATE` inside a Prisma interactive transaction:

```sql
UPDATE "Inventory"
SET "reservedUnits" = "reservedUnits" + <quantity>
WHERE "productId"   = <id>
  AND "warehouseId" = <id>
  AND ("totalUnits" - "reservedUnits") >= <quantity>
```

If two requests arrive simultaneously for the last unit:

1. Both hit Postgres concurrently.
2. Postgres serialises writes to the same row — one `UPDATE` succeeds (1 row affected), the other runs *after* the first commits and finds the condition false (0 rows affected).
3. The route that gets 0 rows returns **409 Conflict**; the winner gets **201 Created**.

No application-level locks, no Redis distributed locks — Postgres row-level exclusion is sufficient and correct for a single primary DB.

---

## Idempotency

`POST /api/reservations` and `POST /api/reservations/:id/confirm` accept an optional `Idempotency-Key` header.

- **First request:** result stored in Upstash Redis at `idempotency:{key}` with 24h TTL.
- **Duplicate request (same key):** cached response returned immediately with `Idempotency-Replayed: true` header. No DB write.

Safe for clients to retry on network errors without double-charging or double-reserving.

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Set these environment variables in the Vercel dashboard (Settings → Environment Variables), using the **pooled** Neon connection string for `DATABASE_URL`:

```
DATABASE_URL        postgresql://user:pass@ep-xxx-pooler.neon.tech/dbname?sslmode=require
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
CRON_SECRET
NEXT_PUBLIC_APP_URL  https://your-vercel-url.vercel.app
```

After deploying, seed the production database once:

```bash
DATABASE_URL="<pooled-neon-url>" npx prisma db seed
```

---

## Trade-offs and things I'd add with more time

**Would add:**
- **Auth/user sessions** — reservations are anonymous; a real system attaches them to users and shows "my orders".
- **Quantity > 1 in the UI** — the API already supports arbitrary quantity; the Reserve button hardcodes 1.
- **Optimistic UI refresh** — after confirm/cancel, stock counts on the listing page update on next navigation. `router.refresh()` or SWR revalidation would fix this.
- **Playwright E2E test** — asserting the 409 race condition would be the most valuable automated test in this codebase.
- **Pagination** on the product list.

**Deliberate simplifications:**
- `NEXT_PUBLIC_APP_URL` internal fetch in server components — a real app would call Prisma directly from server components rather than round-tripping through its own API. The API-first structure keeps all endpoints directly inspectable and testable.
- No auth — this is a demo, not a production system.
