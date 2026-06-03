import Link from 'next/link';
import { getProducts, getBrands } from '@/lib/api';
import ProductCard from '@/components/product-card';

export const revalidate = 300;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const { brand } = await searchParams;
  const [products, brands] = await Promise.all([
    getProducts(brand ? { brand } : {}),
    getBrands(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <section className="mb-8 rounded-xl bg-gradient-to-br from-green-600 to-green-700 p-8 text-white">
        <h1 className="text-3xl font-bold">🌿 Tubu Tree</h1>
        <p className="mt-1 text-green-100">Sống xanh An Lành — Mỹ phẩm & đồ tiêu dùng thiên nhiên</p>
      </section>

      <div className="mb-5 flex flex-wrap gap-2">
        <Link
          href="/"
          className={`rounded-full px-4 py-1.5 text-sm ${!brand ? 'bg-green-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}
        >
          Tất cả
        </Link>
        {brands.map((b) => (
          <Link
            key={b.brand}
            href={`/?brand=${encodeURIComponent(b.brand)}`}
            className={`rounded-full px-4 py-1.5 text-sm ${brand === b.brand ? 'bg-green-600 text-white' : 'bg-neutral-100 text-neutral-600'}`}
          >
            {b.brand} ({b.count})
          </Link>
        ))}
      </div>

      {products.length === 0 ? (
        <p className="py-12 text-center text-neutral-400">
          Chưa có sản phẩm (API backend chưa chạy hoặc chưa seed).
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
