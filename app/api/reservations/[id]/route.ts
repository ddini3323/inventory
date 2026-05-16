import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await prisma.reservation.findUnique({ where: { id }, include: { product: true, warehouse: true } });
  if (!r) return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  return NextResponse.json({ id: r.id, productId: r.productId, warehouseId: r.warehouseId,
    quantity: r.quantity, status: r.status, expiresAt: r.expiresAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null, releasedAt: r.releasedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    product: { name: r.product.name, sku: r.product.sku, price: Number(r.product.price), imageUrl: r.product.imageUrl },
    warehouse: { name: r.warehouse.name, location: r.warehouse.location } });
}
