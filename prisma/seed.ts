import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 1,
  connectionTimeoutMillis: 10000,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const [nyc, la, chicago] = await Promise.all([
    prisma.warehouse.upsert({
      where: { id: "wh_nyc" }, update: {},
      create: { id: "wh_nyc", name: "New York Fulfillment", location: "New York, NY" },
    }),
    prisma.warehouse.upsert({
      where: { id: "wh_la" }, update: {},
      create: { id: "wh_la", name: "LA Distribution", location: "Los Angeles, CA" },
    }),
    prisma.warehouse.upsert({
      where: { id: "wh_chi" }, update: {},
      create: { id: "wh_chi", name: "Midwest Hub", location: "Chicago, IL" },
    }),
  ]);

  const products = await Promise.all([
    prisma.product.upsert({
      where: { sku: "SHOE-AIR-001" }, update: {},
      create: { id: "prod_shoe_001", name: "Air Runner Pro", sku: "SHOE-AIR-001",
        description: "Lightweight performance running shoe with responsive foam",
        price: 129.99, imageUrl: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400" },
    }),
    prisma.product.upsert({
      where: { sku: "BAG-PACK-002" }, update: {},
      create: { id: "prod_bag_002", name: "Urban Commuter Backpack", sku: "BAG-PACK-002",
        description: "30L waterproof backpack with laptop compartment",
        price: 89.99, imageUrl: "https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400" },
    }),
    prisma.product.upsert({
      where: { sku: "WATCH-STEEL-003" }, update: {},
      create: { id: "prod_watch_003", name: "Classic Steel Watch", sku: "WATCH-STEEL-003",
        description: "Minimalist stainless steel watch, 40mm case",
        price: 249.99, imageUrl: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400" },
    }),
    prisma.product.upsert({
      where: { sku: "JACKET-DOWN-004" }, update: {},
      create: { id: "prod_jacket_004", name: "Mountain Down Jacket", sku: "JACKET-DOWN-004",
        description: "650-fill down jacket, packable, DWR finish",
        price: 199.99, imageUrl: "https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400" },
    }),
    prisma.product.upsert({
      where: { sku: "HEADPHONES-005" }, update: {},
      create: { id: "prod_hp_005", name: "Studio Headphones", sku: "HEADPHONES-005",
        description: "Over-ear wireless headphones, 30h battery, ANC",
        price: 179.99, imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400" },
    }),
  ]);

  const inventoryData = [
    { productId: "prod_shoe_001",  warehouseId: "wh_nyc", totalUnits: 15, reservedUnits: 0 },
    { productId: "prod_shoe_001",  warehouseId: "wh_la",  totalUnits: 1,  reservedUnits: 0 },
    { productId: "prod_bag_002",   warehouseId: "wh_nyc", totalUnits: 8,  reservedUnits: 0 },
    { productId: "prod_bag_002",   warehouseId: "wh_la",  totalUnits: 5,  reservedUnits: 0 },
    { productId: "prod_bag_002",   warehouseId: "wh_chi", totalUnits: 3,  reservedUnits: 0 },
    { productId: "prod_watch_003", warehouseId: "wh_nyc", totalUnits: 2,  reservedUnits: 0 },
    { productId: "prod_watch_003", warehouseId: "wh_la",  totalUnits: 1,  reservedUnits: 0 },
    { productId: "prod_jacket_004",warehouseId: "wh_nyc", totalUnits: 10, reservedUnits: 0 },
    { productId: "prod_jacket_004",warehouseId: "wh_chi", totalUnits: 7,  reservedUnits: 0 },
    { productId: "prod_hp_005",    warehouseId: "wh_nyc", totalUnits: 4,  reservedUnits: 0 },
    { productId: "prod_hp_005",    warehouseId: "wh_la",  totalUnits: 4,  reservedUnits: 0 },
    { productId: "prod_hp_005",    warehouseId: "wh_chi", totalUnits: 4,  reservedUnits: 0 },
  ];

  for (const inv of inventoryData) {
    await prisma.inventory.upsert({
      where: { productId_warehouseId: { productId: inv.productId, warehouseId: inv.warehouseId } },
      update: { totalUnits: inv.totalUnits, reservedUnits: inv.reservedUnits },
      create: inv,
    });
  }

  console.log("Seed complete:", { warehouses: 3, products: products.length, inventoryRows: inventoryData.length });
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
