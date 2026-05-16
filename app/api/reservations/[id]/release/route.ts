import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let reservation;
  try {
    reservation = await prisma.$transaction(async (tx) => {
      const r = await tx.reservation.findUnique({ where: { id } });
      if (!r) throw Object.assign(new Error("Not found"), { code: "NOT_FOUND" });
      if (r.status !== "PENDING") throw Object.assign(new Error("Wrong status"), { code: "WRONG_STATUS", status: r.status });
      await tx.$executeRaw`
        UPDATE "Inventory"
        SET "reservedUnits" = GREATEST(0, "reservedUnits" - ${r.quantity})
        WHERE "productId"   = ${r.productId}
          AND "warehouseId" = ${r.warehouseId}
      `;
      return tx.reservation.update({ where: { id }, data: { status: "RELEASED", releasedAt: new Date() },
        include: { product: true, warehouse: true } });
    }, { maxWait: 20000, timeout: 30000 });
  } catch (err: unknown) {
    const e = err as { code?: string; status?: string };
    if (e.code === "NOT_FOUND") return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
    if (e.code === "WRONG_STATUS") return NextResponse.json({ error: "Cannot release: already " + e.status?.toLowerCase() }, { status: 409 });
    throw err;
  }
  return NextResponse.json({ id: reservation.id, status: reservation.status,
    releasedAt: reservation.releasedAt?.toISOString(),
    product: { name: reservation.product.name },
    warehouse: { name: reservation.warehouse.name }, quantity: reservation.quantity });
}
