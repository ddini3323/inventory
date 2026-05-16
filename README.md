# Allo Inventory

A Next.js inventory reservation system for multi-warehouse retail. Customers can reserve stock for 10 minutes while completing payment, preventing oversell under concurrency.

**Live demo:** *(add your Vercel URL here after deploying)*

---

## How to run locally

### Prerequisites
- Node.js 20+
- A hosted Postgres database (Neon free tier works well)
- An Upstash Redis database (free tier)

### Setup

git clone <repo>
cd allo-inventory
npm install

Copy and fill in env vars:

cp .env.example .env.local

| Variable | Where to get it |
|---|---|
| DATABASE_URL | Neon: Connection string (pooled, with ?pgbouncer=true) |
| DIRECT_URL | Neon: Connection string (direct, no pgbouncer) |
| UPSTASH_REDIS_REST_URL | Upstash: REST URL |
| UPSTASH_REDIS_REST_TOKEN | Upstash: REST Token |
| CRON_SECRET | Any random string (openssl rand -hex 32) |
| NEXT_PUBLIC_APP_URL | http://localhost:3000 for local dev |

### Apply schema and seed

npx prisma generate
npx prisma db push
npm run db:seed

### Run

npm run dev

Open http://localhost:3000

---

## How expiry works in production

**Primary: Vercel Cron** -- vercel.json schedules GET /api/cron/expire every 2 minutes. The route is authenticated via Authorization: Bearer CRON_SECRET. It finds all PENDING reservations where expiresAt < NOW(), atomically decrements reservedUnits on Inventory, and marks each reservation RELEASED -- in a per-row transaction so concurrent cron executions are safe.

**Secondary: lazy cleanup on reads** -- GET /api/products calls the same releaseExpiredReservations() helper before returning data. This ensures stock counts are accurate before being shown to a user even if the cron hasn't fired yet.

**Why not a long-running background worker?** Vercel serverless doesn't support persistent processes. The cron + lazy-read combo gives sub-2-minute staleness at zero infra cost.

---

## Concurrency correctness

The reservation endpoint uses a single conditional SQL UPDATE inside a Prisma interactive transaction:

UPDATE "Inventory"
SET "reservedUnits" = "reservedUnits" + <quantity>
WHERE "productId" = <id>
  AND "warehouseId" = <id>
  AND ("totalUnits" - "reservedUnits") >= <quantity>

If two requests arrive simultaneously for the last unit:
1. Both hit Postgres concurrently.
2. Postgres serialises writes to the same row -- one UPDATE succeeds (1 row affected), the other runs after the first commits and finds the condition false (0 rows affected).
3. The route that gets 0 rows returns 409; the other creates the reservation and returns 201.

No application-level locks, no Redis distributed locks -- Postgres row-level exclusion is sufficient and correct for a single primary DB.

---

## Idempotency (bonus)

POST /api/reservations and POST /api/reservations/:id/confirm accept an optional Idempotency-Key header.

- On first request: result is stored in Upstash Redis at idempotency:{key} with 24h TTL.
- On duplicate request (same key): cached response returned immediately with Idempotency-Replayed: true header. No DB write.

---

## Trade-offs and things to do with more time

**Would add:**
- Auth/user sessions -- reservations are anonymous; a real system attaches them to users.
- Quantity > 1 in the UI -- the API supports arbitrary quantity; the Reserve button hardcodes 1.
- Optimistic UI refresh -- after confirming/cancelling, stock counts on the listing page update on the next navigation; router.refresh() would fix this.
- E2E tests -- a Playwright test asserting the 409 race condition would be the most valuable test in this codebase.
- Pagination on the product list.

**Deliberate simplifications:**
- NEXT_PUBLIC_APP_URL internal fetch in server components: a real app would import Prisma directly from server components rather than round-tripping through its own API. I kept the API-first structure so all endpoints are directly inspectable and testable.
- No auth -- this is a demo.
