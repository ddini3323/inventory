// Race condition proof: fire N concurrent reservation requests for a product.
// Run with: node --env-file=.env.local race-condition-test.js

const { Pool } = require("pg");

const BASE_URL = "http://localhost:3000";
// 5 concurrent stays within Neon free-tier's ~5 connection limit
const CONCURRENCY = 5;

async function getProductAndWarehouse(pool) {
  const { rows: products } = await pool.query(
    `SELECT id, name FROM "Product" WHERE name ILIKE '%Air Runner%' LIMIT 1`
  );
  const { rows: warehouses } = await pool.query(
    `SELECT id, name FROM "Warehouse" WHERE name ILIKE '%Los Angeles%' OR name ILIKE '%LA%' LIMIT 1`
  );
  return { productId: products[0].id, warehouseId: warehouses[0].id };
}

async function resetInventory(pool, productId, warehouseId, units) {
  await pool.query(
    `UPDATE "Inventory" SET "totalUnits" = $1, "reservedUnits" = 0
     WHERE "productId" = $2 AND "warehouseId" = $3`,
    [units, productId, warehouseId]
  );
  await pool.query(
    `UPDATE "Reservation" SET status = 'RELEASED', "releasedAt" = NOW()
     WHERE "productId" = $1 AND "warehouseId" = $2 AND status = 'PENDING'`,
    [productId, warehouseId]
  );
  const { rows } = await pool.query(
    `SELECT "totalUnits", "reservedUnits" FROM "Inventory"
     WHERE "productId" = $1 AND "warehouseId" = $2`,
    [productId, warehouseId]
  );
  return rows[0];
}

async function reserve(productId, warehouseId, idx) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/reservations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, warehouseId, quantity: 1 }),
    });
    const data = await res.json();
    const ms = Date.now() - start;
    return { idx, status: res.status, data, ms };
  } catch (e) {
    return { idx, status: 0, error: e.message, ms: Date.now() - start };
  }
}

async function runTest(pool, productId, warehouseId, availableUnits, testLabel) {
  console.log(`\n=== ${testLabel}: ${availableUnits} unit(s) available, ${CONCURRENCY} concurrent requests ===`);
  const inv = await resetInventory(pool, productId, warehouseId, availableUnits);
  console.log("Inventory before:", inv);

  const requests = Array.from({ length: CONCURRENCY }, (_, i) =>
    reserve(productId, warehouseId, i + 1)
  );
  const results = await Promise.all(requests);

  const won = results.filter((r) => r.status === 201);
  const lost = results.filter((r) => r.status === 409);
  const errors = results.filter((r) => r.status !== 201 && r.status !== 409);

  console.log(`\nResults (${CONCURRENCY} concurrent):`);
  results.forEach((r) => {
    const lbl = r.status === 201 ? "✓ WON " : r.status === 409 ? "✗ LOST" : "? ERR ";
    console.log(`  [${r.idx.toString().padStart(2)}] ${lbl}  HTTP ${r.status}  (${r.ms}ms)`);
  });
  console.log(`Summary: ${won.length} won (201), ${lost.length} lost (409), ${errors.length} connection errors`);

  // DB state is the real correctness invariant — HTTP errors don't create reservations
  const { rows } = await pool.query(
    `SELECT "totalUnits", "reservedUnits" FROM "Inventory"
     WHERE "productId" = $1 AND "warehouseId" = $2`,
    [productId, warehouseId]
  );
  const after = rows[0];
  console.log("Inventory after:", after);

  const dbReserved = Number(after.reservedUnits);
  if (dbReserved > availableUnits) {
    console.log(`FAIL: reservedUnits=${dbReserved} > totalUnits=${availableUnits} — OVERSELL DETECTED`);
    return false;
  }
  if (dbReserved !== won.length) {
    console.log(`FAIL: reservedUnits=${dbReserved} but ${won.length} requests returned 201 — count mismatch`);
    return false;
  }
  console.log(`PASS: ${dbReserved} unit(s) reserved, ${won.length} x 201 — no oversell`);
  return true;
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 20000,
  });

  try {
    const { productId, warehouseId } = await getProductAndWarehouse(pool);
    console.log(`Product ID:   ${productId}`);
    console.log(`Warehouse ID: ${warehouseId}`);

    const pass1 = await runTest(pool, productId, warehouseId, 1, "Test 1");
    const pass2 = await runTest(pool, productId, warehouseId, 3, "Test 2");

    if (pass1 && pass2) {
      console.log("\n✓ Race condition protection verified — Postgres atomic UPDATE prevents oversell.");
    } else {
      console.log("\n✗ One or more tests failed.");
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
