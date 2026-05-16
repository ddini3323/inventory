# Deployment & Testing Guide

Step-by-step instructions to set up, deploy, and verify the Allo Inventory app from scratch.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Local Setup](#2-local-setup)
3. [Database Setup (Neon)](#3-database-setup-neon)
4. [Redis Setup (Upstash)](#4-redis-setup-upstash)
5. [Environment Variables](#5-environment-variables)
6. [Run Locally](#6-run-locally)
7. [Deploy to Vercel](#7-deploy-to-vercel)
8. [Verify the Live App](#8-verify-the-live-app)
9. [Testing — UI Walkthrough](#9-testing--ui-walkthrough)
10. [Testing — Race Condition Proof](#10-testing--race-condition-proof)
11. [Testing — Full Lifecycle](#11-testing--full-lifecycle)
12. [API Reference](#12-api-reference)

---

## 1. Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 20+ | https://nodejs.org |
| Git | any | https://git-scm.com |
| A Neon account | free | https://neon.tech |
| An Upstash account | free | https://upstash.com |
| A Vercel account | free (Hobby) | https://vercel.com |

---

## 2. Local Setup

```bash
# Clone the repository
git clone https://github.com/ddini3323/inventory.git
cd inventory

# Install dependencies
npm install
```

---

## 3. Database Setup (Neon)

1. Log in to [neon.tech](https://neon.tech) and create a new project.
2. Once created, go to **Dashboard → Connection Details**.
3. Copy two connection strings:
   - **Pooled connection** (for the app at runtime) — has `-pooler` in the hostname
   - **Direct connection** (for migrations) — no `-pooler`

Example format:
```
Pooled:  postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require
Direct:  postgresql://user:password@ep-xxx.region.aws.neon.tech/dbname?sslmode=require
```

> Use the **pooled** URL as `DATABASE_URL` in all environments.

---

## 4. Redis Setup (Upstash)

1. Log in to [upstash.com](https://upstash.com) and create a new Redis database.
2. Choose region closest to your Vercel deployment (e.g. US-East-1).
3. Go to the database page and copy:
   - **REST URL** → `UPSTASH_REDIS_REST_URL`
   - **REST Token** → `UPSTASH_REDIS_REST_TOKEN`

> Redis is used for idempotency keys only. The app works without it (idempotency is skipped if Redis is unavailable).

---

## 5. Environment Variables

Copy the example file:

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in all values:

```env
# Neon PostgreSQL — use the POOLED connection string
DATABASE_URL="postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require"

# Upstash Redis
UPSTASH_REDIS_REST_URL="https://your-instance.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token"

# Any random secret — used to authenticate the cron endpoint
CRON_SECRET="run: openssl rand -hex 32"

# Local dev URL
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

Generate a cron secret:
```bash
# Mac/Linux
openssl rand -hex 32

# Windows PowerShell
[System.BitConverter]::ToString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).Replace("-","").ToLower()
```

---

## 6. Run Locally

**Apply schema and seed database:**

```bash
npx prisma generate
npx prisma db push
npm run db:seed
```

Expected seed output:
```
Seeded 2 warehouses
Seeded 5 products
Seeded inventory across warehouses
Done.
```

**Start the dev server:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you should see 5 products listed.

---

## 7. Deploy to Vercel

### Step 1 — Connect GitHub to Vercel

1. Go to [vercel.com/account/login-connections](https://vercel.com/account/login-connections)
2. Click **Connect** next to GitHub and authorize Vercel.

### Step 2 — Import the repository

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to `ddini3323/inventory`
3. Framework: **Next.js** (auto-detected — do not change)
4. Root directory: `./` (do not change)
5. **Do not override** Build Command, Output Directory, or Development Command

### Step 3 — Add environment variables

Before clicking Deploy, expand **Environment Variables** and add:

| Name | Value | Environments |
|---|---|---|
| `DATABASE_URL` | Neon pooled connection string | Production, Preview, Development |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL | Production, Preview, Development |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST Token | Production, Preview, Development |
| `CRON_SECRET` | Your random secret | Production, Preview, Development |

> `NEXT_PUBLIC_APP_URL` is **not required** on Vercel — the app uses `VERCEL_URL` automatically.

### Step 4 — Deploy

Click **Deploy**. The build takes 2–3 minutes.

Once complete, Vercel shows a production URL like:
```
https://inventory-xxx.vercel.app
```

### Step 5 — Verify env vars are set (if redeploying via CLI)

```powershell
cd inventory
npx vercel --prod
```

Answer the prompts:
```
Link to existing project? → Y
Select project → inventory
```

---

## 8. Verify the Live App

Open your production URL. You should see:

- ✓ Product listing page with 5 products and stock counts
- ✓ Each product shows available stock per warehouse
- ✓ "Reserve" button on products with available stock
- ✓ Greyed-out button on out-of-stock items

Check the API directly:
```bash
curl https://your-app.vercel.app/api/products
```

Should return a JSON array of 5 products with inventory data.

---

## 9. Testing — UI Walkthrough

### Reserve a product

1. Open the app in your browser
2. Click **Reserve** on any in-stock product (e.g. Air Runner Pro)
3. You are taken to the checkout page with a **10-minute countdown timer**
4. You have two options:
   - **Confirm purchase** → stock is permanently deducted, status becomes CONFIRMED
   - **Cancel** → stock is immediately returned, status becomes RELEASED

### Test expiry

1. Reserve a product but do **not** confirm
2. Wait for the 10-minute timer to reach 0
3. Go back to the product listing (or refresh it)
4. The stock count is restored — the expired reservation was cleaned up

### Test out-of-stock

1. Reserve the last unit of a product
2. Open the product listing in another browser tab
3. That product now shows **0 available** — the Reserve button is disabled

---

## 10. Testing — Race Condition Proof

Requires the dev server running locally (`npm run dev`).

```bash
node --env-file=.env.local race-condition-test.js
```

**What it does:** Fires 5 concurrent `POST /api/reservations` requests for 1 available unit simultaneously.

**Expected output:**
```
=== Test 1: 1 unit(s) available, 5 concurrent requests ===
Inventory before: { totalUnits: 1, reservedUnits: 0 }

Results (5 concurrent):
  [ 1] ✓ WON   HTTP 201  (3527ms)
  [ 2] ✗ LOST  HTTP 409  (4350ms)
  [ 3] ✗ LOST  HTTP 409  (4090ms)
  [ 4] ✗ LOST  HTTP 409  (3840ms)
  [ 5] ✗ LOST  HTTP 409  (4200ms)
Summary: 1 won (201), 4 lost (409), 0 connection errors
Inventory after: { totalUnits: 1, reservedUnits: 1 }
PASS: 1 unit(s) reserved, 1 x 201 — no oversell

=== Test 2: 3 unit(s) available, 5 concurrent requests ===
...
PASS: 3 unit(s) reserved, 3 x 201 — no oversell

✓ Race condition protection verified — Postgres atomic UPDATE prevents oversell.
```

**How it works:** A single `UPDATE ... WHERE (totalUnits - reservedUnits) >= quantity` inside a Postgres transaction guarantees exactly one winner per available unit. No application-level locks needed.

---

## 11. Testing — Full Lifecycle

Requires the dev server running locally (`npm run dev`).

```bash
node --env-file=.env.local lifecycle-test.js
```

**What it tests:**

| Phase | Scenario | Expected |
|---|---|---|
| **Race** | A and B both reserve the last unit at the same instant | A gets 201, B gets 409 |
| **Hold** | B retries while A holds the reservation | B still gets 409 (stock locked) |
| **Expiry** | A's reservation times out without confirming | Stock returned, cron releases it |
| **Recovery** | B tries again after expiry | B gets 201 — new 10-min timer |

**Expected output:**
```
Phase 1 — Race       : PASS  (1 of 2 simultaneous requests succeeded)
Phase 2 — Hold       : PASS  (stock locked at 0 during reservation)
Phase 3 — Expiry     : PASS  (cron released stock after timeout)
Phase 4 — Recovery   : PASS  (second person succeeded after expiry)

✓ Full lifecycle verified.
```

---

## 12. API Reference

All endpoints return JSON. Base URL: `https://your-app.vercel.app`

### `GET /api/products`
Returns all products with per-warehouse stock counts.
- Also runs expiry cleanup before returning (lazy cleanup).

```bash
curl https://your-app.vercel.app/api/products
```

---

### `POST /api/reservations`
Creates a reservation (holds stock for 10 minutes).

```bash
curl -X POST https://your-app.vercel.app/api/reservations \
  -H "Content-Type: application/json" \
  -d '{"productId":"prod_shoe_001","warehouseId":"wh_la","quantity":1}'
```

| Response | Meaning |
|---|---|
| `201 Created` | Reservation created, 10-min hold active |
| `409 Conflict` | Not enough stock available |
| `422 Unprocessable` | Invalid request body |

Optional header: `Idempotency-Key: <uuid>` — safe to retry without double-reserving.

---

### `GET /api/reservations/:id`
Returns a single reservation by ID.

```bash
curl https://your-app.vercel.app/api/reservations/RESERVATION_ID
```

---

### `POST /api/reservations/:id/confirm`
Confirms a reservation (completes the purchase). Must be PENDING and not expired.

```bash
curl -X POST https://your-app.vercel.app/api/reservations/RESERVATION_ID/confirm
```

| Response | Meaning |
|---|---|
| `200 OK` | Confirmed, stock permanently deducted |
| `409 Conflict` | Already confirmed or released |
| `410 Gone` | Reservation expired |

---

### `POST /api/reservations/:id/release`
Cancels a reservation and returns stock.

```bash
curl -X POST https://your-app.vercel.app/api/reservations/RESERVATION_ID/release
```

---

### `GET /api/cron/expire`
Releases all expired PENDING reservations. Called automatically by Vercel Cron (daily).

```bash
curl https://your-app.vercel.app/api/cron/expire \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Returns: `{ "released": N, "timestamp": "..." }`

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Can't reach database server at 127.0.0.1` | `DATABASE_URL` not set in Vercel env vars | Add it in Vercel → Settings → Environment Variables |
| `Routes Manifest Could Not Be Found` | Build Command overridden to blank | Set Build Command to `next build` in Vercel project settings |
| `409` on every reservation attempt | Stock is 0 — run `reset-inventory.js` | `node --env-file=.env.local reset-inventory.js` |
| Page loads but shows no products | Database not seeded | Run `npm run db:seed` |
