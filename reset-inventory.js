// Resets Air Runner Pro @ LA Warehouse to totalUnits=2, reservedUnits=0
// Uses raw pg to avoid any Prisma/bash quoting issues
const fs = require("fs");
const path = require("path");

// Load .env.local manually
const envPath = path.join(__dirname, ".env.local");
const envLines = fs.readFileSync(envPath, "utf8").split("\n");
for (const line of envLines) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^"|"$/g, "");
}

const { Pool } = require("pg");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 20000,
  });

  try {
    // Find Air Runner Pro
    const { rows: products } = await pool.query(
      `SELECT id, name FROM "Product" WHERE name ILIKE '%Air Runner%' LIMIT 1`
    );
    if (products.length === 0) {
      console.error("Product 'Air Runner Pro' not found");
      process.exit(1);
    }
    const product = products[0];
    console.log("Product:", product.name, product.id);

    // Find LA Warehouse
    const { rows: warehouses } = await pool.query(
      `SELECT id, name FROM "Warehouse" WHERE name ILIKE '%Los Angeles%' OR name ILIKE '%LA%' LIMIT 1`
    );
    if (warehouses.length === 0) {
      console.error("LA Warehouse not found");
      process.exit(1);
    }
    const warehouse = warehouses[0];
    console.log("Warehouse:", warehouse.name, warehouse.id);

    // Reset inventory: 2 total, 0 reserved
    const { rowCount } = await pool.query(
      `UPDATE "Inventory"
       SET "totalUnits" = 2, "reservedUnits" = 0
       WHERE "productId" = $1 AND "warehouseId" = $2`,
      [product.id, warehouse.id]
    );

    if (rowCount === 0) {
      console.error("No inventory row found for this product+warehouse");
      process.exit(1);
    }

    // Also release any stale PENDING reservations for this product+warehouse
    const { rowCount: released } = await pool.query(
      `UPDATE "Reservation"
       SET status = 'RELEASED', "releasedAt" = NOW()
       WHERE "productId" = $1 AND "warehouseId" = $2 AND status = 'PENDING'`,
      [product.id, warehouse.id]
    );
    console.log("Released stale reservations:", released);

    // Verify
    const { rows: inv } = await pool.query(
      `SELECT "totalUnits", "reservedUnits" FROM "Inventory"
       WHERE "productId" = $1 AND "warehouseId" = $2`,
      [product.id, warehouse.id]
    );
    console.log("Inventory after reset:", inv[0]);
    console.log("Ready for race condition test.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
