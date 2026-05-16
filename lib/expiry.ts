import { prisma } from "./prisma";

export async function releaseExpiredReservations(): Promise<number> {
  const expired = await prisma.reservation.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { id: true, productId: true, warehouseId: true, quantity: true },
  });

  if (expired.length === 0) return 0;

  await Promise.all(
    expired.map((r) =>
      prisma.$transaction([
        prisma.$executeRaw`
          UPDATE "Inventory"
          SET "reservedUnits" = GREATEST(0, "reservedUnits" - ${r.quantity})
          WHERE "productId" = ${r.productId}
            AND "warehouseId" = ${r.warehouseId}
        `,
        prisma.reservation.update({
          where: { id: r.id, status: "PENDING" },
          data: { status: "RELEASED", releasedAt: new Date() },
        }),
      ])
    )
  );

  return expired.length;
}
