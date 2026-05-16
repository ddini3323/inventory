import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { redis, IDEMPOTENCY_TTL } from "@/lib/redis";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ikey = req.headers.get("Idempotency-Key");
  if (ikey && redis) {
    const cached = await redis.get<object>(`idempotency:confirm:${ikey}`);
    if (cached) return NextResponse.json(cached, { headers: { "Idempotency-Replayed": "true" } });
  }
  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      const r = await tx.reservation.findUnique({ where: { id } });
      if (!r) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
      if (r.status !== "PENDING") throw Object.assign(new Error("Wrong status"), { code: "WRONG_STATUS", status: r.status });
      if (r.expiresAt < new Date()) throw Object.assign(new Error("Expired"), { code: "EXPIRED" });
      await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedUnits" = GREATEST(0, "reservedUnits" - ${r.quantity}),
            "totalUnits"    = GREATEST(0, "totalUnits"    - ${r.quantity})
        WHERE "productId"   = ${r.productId}
          AND "warehouseId" = ${r.warehouseId}
      `;
      return tx.reservation.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() },
        include: { product: true, warehouse: true } });
    }, { maxWait: 20000, timeout: 30000 });
  } catch (err: unknown) {
    const e = err as { code?: string; status?: string };
    if (e.code === "NOT_FOUND") return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    if (e.code === "EXPIRED") return NextResponse.json({ error: "Reservation has expired" }, { status: 410 });
    if (e.code === "WRONG_STATUS") return NextResponse.json({ error: "Cannot confirm: already " + e.status?.toLowerCase() }, { status: 409 });
    throw err;
  }
  const body = { id: reservation.id, status: reservation.status,
    confirmedAt: reservation.confirmedAt?.toISOString(),
    product: { name: reservation.product.name, sku: reservation.product.sku },
    warehouse: { name: reservation.warehouse.name }, quantity: reservation.quantity };
  if (ikey && redis) await redis.set(`idempotency:confirm:${ikey}`, body, { ex: IDEMPOTENCY_TTL });
  return NextResponse.json(body);
}
