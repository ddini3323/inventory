import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/expiry";

export const dynamic = "force-dynamic";

export async function GET() {
  await releaseExpiredReservations();
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: {
      inventories: { include: { warehouse: true }, orderBy: { warehouse: { name: "asc" } } },
    },
  });
  const data = products.map((p) => ({
    id: p.id, name: p.name, sku: p.sku, description: p.description,
    price: Number(p.price), imageUrl: p.imageUrl,
    stock: p.inventories.map((inv) => ({
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouse.name,
      warehouseLocation: inv.warehouse.location,
      available: inv.totalUnits - inv.reservedUnits,
      total: inv.totalUnits,
      reserved: inv.reservedUnits,
    })),
  }));
  return NextResponse.json(data);
}
