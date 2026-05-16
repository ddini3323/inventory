"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
type StockEntry = { warehouseId: string; warehouseName: string; warehouseLocation: string; available: number };
type Product = { id: string; name: string; sku: string; description: string | null; price: number; imageUrl: string | null; stock: StockEntry[] };
export default function ProductList({ products }: { products: Product[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function reserve(productId: string, warehouseId: string) {
    const key = `${productId}:${warehouseId}`;
    setLoading(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/reservations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, warehouseId, quantity: 1 }),
      });
      const data = await res.json();
      if (res.status === 409) { setErrors((prev) => ({ ...prev, [key]: data.error ?? "Not enough stock." })); return; }
      if (!res.ok) { setErrors((prev) => ({ ...prev, [key]: data.error ?? "Error." })); return; }
      router.push(`/reservations/${data.id}`);
    } finally { setLoading(null); }
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product) => (
        <div key={product.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm flex flex-col">
          {product.imageUrl && <img src={product.imageUrl} alt={product.name} className="w-full h-48 object-cover" />}
          <div className="p-5 flex flex-col flex-1">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h2 className="font-semibold text-gray-900 text-lg">{product.name}</h2>
              <span className="text-indigo-600 font-bold">${product.price.toFixed(2)}</span>
            </div>
            <p className="text-xs text-gray-400 mb-2">{product.sku}</p>
            {product.description && <p className="text-sm text-gray-600 mb-4 flex-1">{product.description}</p>}
            <div className="border-t border-gray-100 pt-4 space-y-2">
              {product.stock.map((s) => {
                const key = `${product.id}:${s.warehouseId}`;
                const err = errors[key]; const busy = loading === key; const oos = s.available === 0;
                return (
                  <div key={s.warehouseId}>
                    <div className="flex items-center justify-between gap-2">
                      <div><p className="text-sm font-medium text-gray-800">{s.warehouseName}</p>
                        <p className="text-xs text-gray-400">{s.warehouseLocation}</p></div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StockBadge available={s.available} />
                        <button onClick={() => reserve(product.id, s.warehouseId)} disabled={oos || busy}
                          className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${oos ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : busy ? 'bg-indigo-300 text-white cursor-wait' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                          {busy ? "..." : oos ? "Sold out" : "Reserve"}
                        </button>
                      </div>
                    </div>
                    {err && <p className="mt-1 text-xs text-red-600 bg-red-50 rounded px-2 py-1">{err}</p>}
                  </div>);
              })}
            </div>
          </div>
        </div>))}
    </div>);
}
function StockBadge({ available }: { available: number }) {
  if (available === 0) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600">Out of stock</span>;
  if (available <= 2) return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{available} left</span>;
  return <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{available} in stock</span>;
}
