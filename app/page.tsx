import ProductList from "./components/ProductList";

type StockEntry = { warehouseId: string; warehouseName: string; warehouseLocation: string; available: number; total: number; reserved: number };
type Product = { id: string; name: string; sku: string; description: string | null; price: number; imageUrl: string | null; stock: StockEntry[] };

async function getProducts(): Promise<Product[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/products`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch products");
  return res.json();
}

export default async function HomePage() {
  const products = await getProducts();
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Products</h1>
        <p className="text-gray-500 mt-1">Stock is available across warehouses. Reservations hold stock for 10 minutes.</p>
      </div>
      {products.length === 0 ? (
        <p className="text-gray-400 text-center py-20">No products found. Run the seed script.</p>
      ) : (
        <ProductList products={products} />
      )}
    </div>
  );
}
