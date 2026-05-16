# Architecture

## System Overview

```mermaid
graph TB
    subgraph Client["Browser / Client"]
        UI["Next.js UI\n(App Router)"]
    end

    subgraph Vercel["Vercel (Serverless)"]
        direction TB
        SC["Server Components\n/app/page.tsx\n/app/reservations/[id]/page.tsx"]
        API1["POST /api/reservations"]
        API2["GET  /api/reservations/:id"]
        API3["POST /api/reservations/:id/confirm"]
        API4["POST /api/reservations/:id/release"]
        API5["GET  /api/products"]
        API6["GET  /api/cron/expire"]
        CRON["Vercel Cron\n(every 2 min)"]
    end

    subgraph Data["External Data Layer"]
        PG["Neon PostgreSQL\n(Serverless Postgres)"]
        REDIS["Upstash Redis\n(Idempotency Keys)"]
    end

    UI --> SC
    SC --> API1
    SC --> API5
    UI --> API1
    UI --> API3
    UI --> API4
    CRON -->|Bearer CRON_SECRET| API6
    API1 --> PG
    API1 --> REDIS
    API3 --> PG
    API4 --> PG
    API5 --> PG
    API6 --> PG
```

---

## Database Schema

```mermaid
erDiagram
    Product {
        string id PK
        string name
        string sku
        string description
        decimal price
        string imageUrl
    }

    Warehouse {
        string id PK
        string name
        string location
    }

    Inventory {
        string productId  FK
        string warehouseId FK
        int    totalUnits
        int    reservedUnits
    }

    Reservation {
        string   id PK
        string   productId  FK
        string   warehouseId FK
        int      quantity
        enum     status
        datetime expiresAt
        datetime confirmedAt
        datetime releasedAt
        string   idempotencyKey
    }

    Product ||--o{ Inventory : "stocked in"
    Warehouse ||--o{ Inventory : "holds"
    Product ||--o{ Reservation : "reserved via"
    Warehouse ||--o{ Reservation : "reserved from"
```

---

## Reservation Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING : POST /api/reservations\n(stock available → 201)
    [*] --> Rejected : POST /api/reservations\n(no stock → 409)

    PENDING --> CONFIRMED : POST /api/reservations/:id/confirm\n(within 10 min)
    PENDING --> RELEASED  : POST /api/reservations/:id/release\n(user cancels)
    PENDING --> RELEASED  : expiresAt passed\n(cron or lazy cleanup)

    CONFIRMED --> [*] : sale complete\ntotalUnits decremented
    RELEASED  --> [*] : stock returned\nreservedUnits decremented
    Rejected  --> [*]
```

---

## Race Condition — Sequence Diagram

Two users hitting the last unit simultaneously:

```mermaid
sequenceDiagram
    participant A as Person A
    participant B as Person B
    participant API as API Route
    participant PG as Postgres

    A->>API: POST /api/reservations (qty=1)
    B->>API: POST /api/reservations (qty=1)

    note over API,PG: Both enter $transaction concurrently

    API->>PG: UPDATE Inventory SET reservedUnits = reservedUnits + 1\nWHERE (totalUnits - reservedUnits) >= 1
    API->>PG: UPDATE Inventory SET reservedUnits = reservedUnits + 1\nWHERE (totalUnits - reservedUnits) >= 1

    note over PG: Postgres serialises row writes.\nA's UPDATE lands first (1 row affected).\nB's UPDATE runs after — condition now false (0 rows).

    PG-->>API: A: 1 row updated ✓
    PG-->>API: B: 0 rows updated ✗

    API-->>A: 201 Created — reservation + 10 min timer
    API-->>B: 409 Conflict — "not enough stock"
```

---

## Expiry & Stock Recovery Flow

```mermaid
sequenceDiagram
    participant CRON as Vercel Cron (2 min)
    participant API as GET /api/cron/expire
    participant PG as Postgres

    CRON->>API: GET /api/cron/expire\nAuthorization: Bearer CRON_SECRET

    API->>PG: SELECT reservations WHERE status=PENDING\nAND expiresAt < NOW()

    PG-->>API: [list of expired reservations]

    loop for each expired reservation
        API->>PG: BEGIN TRANSACTION\n  UPDATE Inventory SET reservedUnits = reservedUnits - qty\n  UPDATE Reservation SET status = RELEASED\nCOMMIT
    end

    API-->>CRON: { released: N }

    note over API: GET /api/products also calls the same\nreleaseExpiredReservations() as lazy cleanup
```

---

## Key Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Concurrency safety | Postgres conditional UPDATE (no locks) | Row-level write serialization is sufficient for single primary DB; no deadlocks, no Redis locks |
| Expiry mechanism | Vercel Cron + lazy cleanup on reads | Serverless has no persistent processes; cron gives ≤2 min staleness at zero cost |
| Idempotency | Upstash Redis (24h TTL) | Prevents double-reserve/double-charge on network retries |
| ORM | Prisma 7 with `@prisma/adapter-pg` | Driver adapter pattern needed for Neon's serverless Postgres |
| Confirm semantics | Decrements both `reservedUnits` AND `totalUnits` | Confirm = permanent sale; release = stock returned (only `reservedUnits` decremented) |
