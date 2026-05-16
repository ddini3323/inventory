# Working Test Record

Captured output from two live test runs against the local dev server (`npm run dev`)
connected to Neon PostgreSQL + Upstash Redis.

---

## Race Condition Test — `race-condition-test.js`

Fires 5 concurrent `POST /api/reservations` requests simultaneously.
The invariant: `reservedUnits` in the database must never exceed `totalUnits`.

```
node --env-file=.env.local race-condition-test.js
```

```
Product ID:   prod_shoe_001
Warehouse ID: wh_la

=== Test 1: 1 unit(s) available, 5 concurrent requests ===
Inventory before: { totalUnits: 1, reservedUnits: 0 }

Results (5 concurrent):
  [ 1] ✓ WON   HTTP 201  (3527ms)
  [ 2] ✗ LOST  HTTP 409  (4350ms)
  [ 3] ? ERR   HTTP 0    (3836ms)   ← Neon free-tier connection limit; no reservation created
  [ 4] ✗ LOST  HTTP 409  (4090ms)
  [ 5] ✗ LOST  HTTP 409  (3840ms)
Summary: 1 won (201), 3 lost (409), 1 connection errors
Inventory after: { totalUnits: 1, reservedUnits: 1 }
PASS: 1 unit(s) reserved, 1 x 201 — no oversell

=== Test 2: 3 unit(s) available, 5 concurrent requests ===
Inventory before: { totalUnits: 3, reservedUnits: 0 }

Results (5 concurrent):
  [ 1] ✓ WON   HTTP 201  (3256ms)
  [ 2] ✓ WON   HTTP 201  (1920ms)
  [ 3] ✗ LOST  HTTP 409  (5033ms)
  [ 4] ✓ WON   HTTP 201  (4518ms)
  [ 5] ✗ LOST  HTTP 409  (4775ms)
Summary: 3 won (201), 2 lost (409), 0 connection errors
Inventory after: { totalUnits: 3, reservedUnits: 3 }
PASS: 3 unit(s) reserved, 3 x 201 — no oversell

✓ Race condition protection verified — Postgres atomic UPDATE prevents oversell.
```

**Key result:** In both tests `reservedUnits` exactly equals the number of successful `201` responses.
No oversell occurred. The "connection error" in Test 1 is a Neon free-tier connection pool limit
under burst load — it did not create a reservation (DB confirms `reservedUnits: 1`, not 2).

---

## Full Lifecycle Test — `lifecycle-test.js`

Walks through the complete reservation flow end-to-end:

```
node --env-file=.env.local lifecycle-test.js
```

```
Product:   Air Runner Pro (prod_shoe_001)
Warehouse: LA Distribution (wh_la)

Warming up server connection...
Ready.

Starting stock: total=1 reserved=0 available=1

────────────────────────────────────────────────────────────
  Phase 1 — Race: A and B both reserve simultaneously
────────────────────────────────────────────────────────────
Person A → HTTP 201 ✓ RESERVED
Person B → HTTP 409 ✗ REJECTED (409)

→ Person A won the race. Reservation ID: cmp8d4gzc000lpklpw5xb4k6t
→ Person B was rejected (HTTP 409).

────────────────────────────────────────────────────────────
  Phase 2 — Hold: stock shows 0 available while A holds the reservation
────────────────────────────────────────────────────────────
Stock now: total=1 reserved=1 available=0
✓ Correct — Person B cannot reserve while Person A holds the item.

Person B tries again during hold → HTTP 409 ✗ Still rejected (correct)

────────────────────────────────────────────────────────────
  Phase 3 — Expiry: Person A doesn't confirm; reservation times out
────────────────────────────────────────────────────────────
Force-expiring Person A's reservation (cmp8d4gzc000lpklpw5xb4k6t)...
Triggering cron/expire endpoint...
Cron response: {"released":1,"timestamp":"2026-05-16T13:09:06.340Z"}

Stock after expiry: total=1 reserved=0 available=1
✓ Stock restored — item is available again.

────────────────────────────────────────────────────────────
  Phase 4 — Recovery: Person B can now reserve the restored item
────────────────────────────────────────────────────────────
Person B tries again after expiry → HTTP 201 ✓ RESERVED

Person B's new reservation: cmp8d4la3000mpklp69senper
Expires at: 2026-05-16T13:19:07.131Z

Final stock: total=1 reserved=1 available=0

────────────────────────────────────────────────────────────
  Summary
────────────────────────────────────────────────────────────
Phase 1 — Race       : PASS  (1 of 2 simultaneous requests succeeded)
Phase 2 — Hold       : PASS  (stock locked at 0 during reservation)
Phase 3 — Expiry     : PASS  (cron released stock after timeout)
Phase 4 — Recovery   : PASS  (second person succeeded after expiry)

✓ Full lifecycle verified.
```

### What each phase proves

| Phase | Scenario | Result |
|---|---|---|
| **Race** | A and B hit the endpoint at the same instant for the last unit | Exactly 1 wins (201), 1 loses (409) — Postgres serialises the row write |
| **Hold** | B retries while A holds the reservation | Still 409 — `available = totalUnits - reservedUnits = 0` |
| **Expiry** | A doesn't confirm within 10 min; cron fires | `reservedUnits` decremented back to 0, reservation marked `RELEASED` |
| **Recovery** | B tries again after stock is restored | 201 — new 10-min timer starts for B |
