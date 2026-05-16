"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
export default function ReservationClient({ reservation: initial }: { reservation: any }) {
  const router = useRouter();
  const [reservation, setReservation] = useState(initial);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    function tick() { setSecondsLeft(Math.max(0, Math.floor((new Date(reservation.expiresAt).getTime() - Date.now()) / 1000))); }
    tick(); if (reservation.status !== "PENDING") return;
    const id = setInterval(tick, 1000); return () => clearInterval(id);
  }, [reservation.expiresAt, reservation.status]);
  const confirm = useCallback(async () => {
    setLoading("confirm"); setError(null);
    try {
      const res = await fetch(`/api/reservations/${reservation.id}/confirm`, { method: "POST" });
      const data = await res.json();
      if (res.status === 410) { setError("Your reservation expired."); return; }
      if (!res.ok) { setError(data.error ?? "Error"); return; }
      setReservation((prev: any) => ({ ...prev, status: "CONFIRMED", confirmedAt: data.confirmedAt }));
    } finally { setLoading(null); }
  }, [reservation.id]);
  const cancel = useCallback(async () => {
    setLoading("cancel"); setError(null);
    try {
      const res = await fetch(`/api/reservations/${reservation.id}/release`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Error"); return; }
      setReservation((prev: any) => ({ ...prev, status: "RELEASED", releasedAt: data.releasedAt }));
    } finally { setLoading(null); }
  }, [reservation.id]);
  const mins = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const secs = String(secondsLeft % 60).padStart(2, "0");
  const isExpired = reservation.status === "PENDING" && secondsLeft === 0;
  const total = (reservation.product.price * reservation.quantity).toFixed(2);
  return (<div className="max-w-lg mx-auto"><div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
    {reservation.product.imageUrl && <img src={reservation.product.imageUrl} alt="" className="w-full h-52 object-cover" />}
    <div className="p-6 space-y-6">
      <div><div className="flex justify-between items-start">
        <h2 className="text-xl font-semibold">{reservation.product.name}</h2>
        <span className="text-indigo-600 font-bold">${total}</span></div>
        <p className="text-sm text-gray-400">{reservation.product.sku}</p>
        <p className="text-sm text-gray-600">{reservation.warehouse.name} &mdash; {reservation.warehouse.location}</p>
        <p className="text-sm text-gray-600">Qty: {reservation.quantity}</p></div>
      <StatusBanner status={reservation.status} isExpired={isExpired} mins={mins} secs={secs} confirmedAt={reservation.confirmedAt} releasedAt={reservation.releasedAt} />
      {error && <div className="text-sm text-red-700 bg-red-50 rounded p-3">{error}</div>}
      {reservation.status === "PENDING" && !isExpired && (<div className="flex gap-3">
        <button onClick={confirm} disabled={!!loading} className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50">{loading === "confirm" ? "Processing..." : "Confirm purchase"}</button>
        <button onClick={cancel} disabled={!!loading} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200 disabled:opacity-50">{loading === "cancel" ? "Cancelling..." : "Cancel"}</button>
      </div>)}
      {(isExpired || reservation.status !== "PENDING") && (<button onClick={() => router.push("/")} className="w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-semibold hover:bg-gray-200">Back to products</button>)}
    </div></div></div>);
}

function StatusBanner({ status, isExpired, mins, secs, confirmedAt, releasedAt }:
  { status: string; isExpired: boolean; mins: string; secs: string; confirmedAt: string | null; releasedAt: string | null }) {
  if (status === "CONFIRMED") return (
    <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
      <p className="text-green-800 font-semibold">Purchase confirmed</p>
      {confirmedAt && <p className="text-green-600 text-sm">{new Date(confirmedAt).toLocaleString()}</p>}
    </div>);
  if (status === "RELEASED") return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3">
      <p className="text-gray-700 font-semibold">Reservation cancelled</p>
      {releasedAt && <p className="text-gray-500 text-sm">Returned at {new Date(releasedAt).toLocaleString()}</p>}
    </div>);
  if (isExpired) return (
    <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
      <p className="text-red-700 font-semibold">Reservation expired</p>
      <p className="text-red-600 text-sm">The hold was released. Place a new order.</p>
    </div>);
  const urgent = parseInt(mins) === 0 && parseInt(secs) <= 60;
  const bg = urgent ? "bg-amber-50 border-amber-200" : "bg-indigo-50 border-indigo-200";
  const fg = urgent ? "text-amber-700" : "text-indigo-700";
  const numCls = urgent ? "text-amber-700" : "text-indigo-800";
  return (<div className={`rounded-xl px-4 py-3 border ${bg}`}>
    <p className={`text-sm font-medium ${fg}`}>Reserved - expires in</p>
    <p className={`text-3xl font-mono font-bold mt-1 ${numCls}`}>{mins}:{secs}</p>
    <p className="text-xs text-gray-500">Complete your purchase before the timer runs out.</p>
  </div>);
}
