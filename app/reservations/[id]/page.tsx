import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ReservationClient from "./ReservationClient";

export const dynamic = "force-dynamic";

async function getReservation(id: string) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: {
      product: { select: { name: true, sku: true, price: true, imageUrl: true } },
      warehouse: { select: { name: true, location: true } },
    },
  });
  if (!r) return null;
  return {
    id: r.id,
    quantity: r.quantity,
    status: r.status as "PENDING" | "CONFIRMED" | "RELEASED",
    expiresAt: r.expiresAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    releasedAt: r.releasedAt?.toISOString() ?? null,
    product: {
      name: r.product.name,
      sku: r.product.sku,
      price: Number(r.product.price),
      imageUrl: r.product.imageUrl,
    },
    warehouse: { name: r.warehouse.name, location: r.warehouse.location },
  };
}

export default async function ReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reservation = await getReservation(id);
  if (!reservation) notFound();
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>
        <p className="text-gray-500 mt-1 text-sm">Reservation ID: {reservation.id}</p>
      </div>
      <ReservationClient reservation={reservation} />
    </div>
  );
}
