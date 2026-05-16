import { prisma } from "@/lib/prisma";
import { releaseExpiredReservations } from "@/lib/expiry";
import ProductList from "./components/ProductList";

export const dynamic = "force-dynamic";

type StockEntry = { warehouseId: string; warehouseName: string; warehouseLocation: string; available: number; total: number; reserved: number };
type Product = { id: string; name: string; sku: string; description: string | null; price: number; imageUrl: string | null; stock: StockEntry[] };

async function getProducts(): Promise<Product[]> {
  await releaseExpiredReservations();
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: {
      inventories: { include: { warehouse: true }, orderBy: { warehouse: { name: "asc" } } },
    },
  });
  return products.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    description: p.description,
    price: Number(p.price),
    imageUrl: p.imageUrl,
    stock: p.inventories.map((inv) => ({
      warehouseId: inv.warehouseId,
      warehouseName: inv.warehouse.name,
      warehouseLocation: inv.warehouse.location,
      available: inv.totalUnits - inv.reservedUnits,
      total: inv.totalUnits,
      reserved: inv.reservedUnits,
    })),
  }));
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
