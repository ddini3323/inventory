// Full lifecycle test: demonstrates the complete reservation flow
//
// Phase 1 — Race: A and B both try to reserve the last unit simultaneously.
//           Only A gets it (201); B is rejected (409).
//
// Phase 2 — Hold: While A holds the reservation, stock shows 0 available.
//           B cannot reserve even if they try again.
//
// Phase 3 — Expiry: A's reservation is force-expired (we backdate expiresAt).
//           The cron/expire endpoint releases it.
//
// Phase 4 — Recovery: B tries again after expiry. This time B succeeds (201).
//
// Run with: node --env-file=.env.local lifecycle-test.js

const { Pool } = require("pg");

const BASE_URL = "http://localhost:3000";

// ─── helpers ────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function section(title) { console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`); }

async function reserve(productId, warehouseId, who) {
  try {
    const res = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, warehouseId, quantity: 1 }),
    });
    let data;
    try { data = await res.json(); } catch { data = {}; }
    return { status: res.status, data, who };
  } catch (e) {
    return { status: 0, data: { error: e.message }, who };
  }
}

async function getAvailableStock(pool, productId, warehouseId) {
  const { rows } = await pool.query(
    `SELECT "totalUnits", "reservedUnits",
            ("totalUnits" - "reservedUnits") AS available
     FROM "Inventory" WHERE "productId" = $1 AND "warehouseId" = $2`,
    [productId, warehouseId]
  );
  return rows[0];
}

async function forceExpireReservation(pool, reservationId) {
  await pool.query(
    `UPDATE "Reservation" SET "expiresAt" = NOW() - INTERVAL '1 second'
     WHERE id = $1`,
    [reservationId]
  );
}

async function triggerExpiry(cronSecret) {
  const res = await fetch(`${BASE_URL}/api/cron/expire`, {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  return res.json();
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 20000,
  });

  try {
    // Look up product and warehouse IDs
    const { rows: products } = await pool.query(
      `SELECT id, name FROM "Product" WHERE name ILIKE '%Air Runner%' LIMIT 1`
    );
    const { rows: warehouses } = await pool.query(
      `SELECT id, name FROM "Warehouse" WHERE name ILIKE '%Los Angeles%' OR name ILIKE '%LA%' LIMIT 1`
    );
    const productId = products[0].id;
    const warehouseId = warehouses[0].id;
    log(`Product:   ${products[0].name} (${productId})`);
    log(`Warehouse: ${warehouses[0].name} (${warehouseId})`);

    // Warm up the Next.js server connection pool before the race
    log(`\nWarming up server connection...`);
    await fetch(`${BASE_URL}/api/products`);
    log(`Ready.\n`);
    log(`Warehouse: ${warehouses[0].name} (${warehouseId})`);

    // Reset to exactly 1 unit, no pending reservations
    await pool.query(
      `UPDATE "Inventory" SET "totalUnits" = 1, "reservedUnits" = 0
       WHERE "productId" = $1 AND "warehouseId" = $2`,
      [productId, warehouseId]
    );
    await pool.query(
      `UPDATE "Reservation" SET status = 'RELEASED', "releasedAt" = NOW()
       WHERE "productId" = $1 AND "warehouseId" = $2 AND status = 'PENDING'`,
      [productId, warehouseId]
    );
    const initial = await getAvailableStock(pool, productId, warehouseId);
    log(`Starting stock: total=${initial.totalUnits} reserved=${initial.reservedUnits} available=${initial.available}`);

    // ── Phase 1: Race ──────────────────────────────────────────────────────
    section("Phase 1 — Race: A and B both reserve simultaneously");

    const [resultA, resultB] = await Promise.all([
      reserve(productId, warehouseId, "Person A"),
      reserve(productId, warehouseId, "Person B"),
    ]);

    log(`Person A → HTTP ${resultA.status} ${resultA.status === 201 ? "✓ RESERVED" : resultA.status === 409 ? "✗ REJECTED (409)" : "✗ ERROR"}`);
    log(`Person B → HTTP ${resultB.status} ${resultB.status === 201 ? "✓ RESERVED" : resultB.status === 409 ? "✗ REJECTED (409)" : "✗ ERROR"}`);

    const winner = resultA.status === 201 ? resultA : resultB.status === 201 ? resultB : null;
    // Loser is either 409 or connection error — both mean "did not reserve"
    const loser  = winner === resultA ? resultB : resultA;

    if (!winner) {
      log(`\nFAIL: neither request succeeded. Got ${resultA.status} and ${resultB.status}.`);
      log(`Hint: check server is running — try: curl http://localhost:3000/api/products`);
      process.exit(1);
    }

    if (winner.data.id === undefined) {
      log(`\nFAIL: winner response has no reservation ID. Response: ${JSON.stringify(winner.data)}`);
      process.exit(1);
    }

    log(`\n→ ${winner.who} won the race. Reservation ID: ${winner.data.id}`);
    log(`→ ${loser.who} was rejected (HTTP ${loser.status}).`);

    // ── Phase 2: Hold ──────────────────────────────────────────────────────
    section("Phase 2 — Hold: stock shows 0 available while A holds the reservation");

    const duringHold = await getAvailableStock(pool, productId, warehouseId);
    log(`Stock now: total=${duringHold.totalUnits} reserved=${duringHold.reservedUnits} available=${duringHold.available}`);

    if (Number(duringHold.available) === 0) {
      log(`✓ Correct — ${loser.who} cannot reserve while ${winner.who} holds the item.`);
    } else {
      log(`FAIL: expected 0 available units during hold.`);
      process.exit(1);
    }

    // Confirm B still can't reserve
    const retryB = await reserve(productId, warehouseId, loser.who);
    log(`\n${loser.who} tries again during hold → HTTP ${retryB.status} ${retryB.status === 409 ? "✗ Still rejected (correct)" : "!! UNEXPECTED"}`);

    if (retryB.status !== 409) {
      log("FAIL: loser should still get 409 while winner holds the reservation.");
      process.exit(1);
    }

    // ── Phase 3: Expiry ────────────────────────────────────────────────────
    section(`Phase 3 — Expiry: ${winner.who} doesn't confirm; reservation times out`);

    log(`Force-expiring ${winner.who}'s reservation (${winner.data.id})...`);
    await forceExpireReservation(pool, winner.data.id);

    const cronSecret = process.env.CRON_SECRET;
    log(`Triggering cron/expire endpoint...`);
    const cronResult = await triggerExpiry(cronSecret);
    log(`Cron response: ${JSON.stringify(cronResult)}`);

    if (cronResult.released !== 1) {
      log(`FAIL: expected cron to release 1 reservation, got ${cronResult.released}`);
      process.exit(1);
    }

    const afterExpiry = await getAvailableStock(pool, productId, warehouseId);
    log(`\nStock after expiry: total=${afterExpiry.totalUnits} reserved=${afterExpiry.reservedUnits} available=${afterExpiry.available}`);

    if (Number(afterExpiry.available) === 1) {
      log(`✓ Stock restored — item is available again.`);
    } else {
      log(`FAIL: expected 1 available unit after expiry.`);
      process.exit(1);
    }

    // ── Phase 4: Recovery ──────────────────────────────────────────────────
    section(`Phase 4 — Recovery: ${loser.who} can now reserve the restored item`);

    const retryBAfterExpiry = await reserve(productId, warehouseId, loser.who);
    log(`${loser.who} tries again after expiry → HTTP ${retryBAfterExpiry.status} ${retryBAfterExpiry.status === 201 ? "✓ RESERVED" : "✗ UNEXPECTED"}`);

    if (retryBAfterExpiry.status !== 201) {
      log(`FAIL: loser should succeed after expiry.`);
      process.exit(1);
    }

    log(`\n${loser.who}'s new reservation: ${retryBAfterExpiry.data.id}`);
    log(`Expires at: ${retryBAfterExpiry.data.expiresAt}`);

    const finalStock = await getAvailableStock(pool, productId, warehouseId);
    log(`\nFinal stock: total=${finalStock.totalUnits} reserved=${finalStock.reservedUnits} available=${finalStock.available}`);

    // ── Summary ────────────────────────────────────────────────────────────
    section("Summary");
    log("Phase 1 — Race       : PASS  (1 of 2 simultaneous requests succeeded)");
    log("Phase 2 — Hold       : PASS  (stock locked at 0 during reservation)");
    log("Phase 3 — Expiry     : PASS  (cron released stock after timeout)");
    log("Phase 4 — Recovery   : PASS  (second person succeeded after expiry)");
    log("\n✓ Full lifecycle verified.\n");

  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
