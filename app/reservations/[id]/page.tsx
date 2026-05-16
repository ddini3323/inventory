import { notFound } from "next/navigation";
import ReservationClient from "./ReservationClient";

async function getReservation(id: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const res = await fetch(`${base}/api/reservations/${id}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch reservation");
  return res.json();
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
