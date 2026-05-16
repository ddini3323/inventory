import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis, IDEMPOTENCY_TTL } from "@/lib/redis";
import { ReserveSchema } from "@/lib/schemas";
export const dynamic = "force-dynamic";
const RESERVATION_TTL_MS = 10 * 60 * 1000;
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const parsed = ReserveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  const { productId, warehouseId, quantity } = parsed.data;
  const ikey = req.headers.get("Idempotency-Key");
  if (ikey && redis) {
    const cached = await redis.get<object>(`idempotency:${ikey}`);
    if (cached) return NextResponse.json(cached, { status: 200, headers: { "Idempotency-Replayed": "true" } });
  }
  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedUnits" = "reservedUnits" + ${quantity}
        WHERE "productId"   = ${productId}
          AND "warehouseId" = ${warehouseId}
          AND ("totalUnits" - "reservedUnits") >= ${quantity}
      `;
      if (Number(updated) === 0) throw Object.assign(new Error("No stock"), { code: "INSUFFICIENT_STOCK" });
      return tx.reservation.create({ data: { productId, warehouseId, quantity, status: "PENDING",
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS), idempotencyKey: ikey ?? undefined },
        include: { product: true, warehouse: true } });
    }, { maxWait: 20000, timeout: 30000 });
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "Not enough stock." }, { status: 409 });
    throw err;
  }
  const rb = { id: reservation.id, productId: reservation.productId, warehouseId: reservation.warehouseId,
    quantity: reservation.quantity, status: reservation.status, expiresAt: reservation.expiresAt.toISOString(),
    confirmedAt: reservation.confirmedAt?.toISOString() ?? null, releasedAt: reservation.releasedAt?.toISOString() ?? null,
    createdAt: reservation.createdAt.toISOString(),
    product: { name: reservation.product.name, sku: reservation.product.sku, price: Number(reservation.product.price) },
    warehouse: { name: reservation.warehouse.name, location: reservation.warehouse.location } };
  if (ikey && redis) await redis.set(`idempotency:${ikey}`, rb, { ex: IDEMPOTENCY_TTL });
  return NextResponse.json(rb, { status: 201 });
}
