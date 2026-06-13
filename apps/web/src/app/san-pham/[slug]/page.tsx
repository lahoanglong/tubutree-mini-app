import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getProduct, formatVnd } from '@/lib/api';
import AddToCart from '@/components/add-to-cart';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: 'Không tìm thấy sản phẩm — Tubu Tree' };
  const title = `${product.name} — ${product.brand} | Tubu Tree`;
  const description = product.shortDesc ?? product.description.slice(0, 160);
  return {
    title,
    description,
    openGraph: { title, description, images: product.thumbnail ? [product.thumbnail] : [] },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const price = product.salePrice ?? product.basePrice;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className="text-sm text-green-600">
        ← Về trang chủ
      </Link>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="flex aspect-square items-center justify-center rounded-xl bg-green-50 text-7xl">
          {product.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.thumbnail} alt={product.name} className="h-full w-full rounded-xl object-cover" />
          ) : (
            '🌿'
          )}
        </div>
        <div>
          <div className="text-sm font-semibold text-green-600">{product.brand}</div>
          <h1 className="text-2xl font-bold text-neutral-900">{product.name}</h1>
          <div className="mt-2 text-2xl font-bold text-clay-700">{formatVnd(price)}</div>
          {product.shortDesc && <p className="mt-3 text-neutral-600">{product.shortDesc}</p>}

          {product.certifications.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {product.certifications.map((c) => (
                <span key={c} className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">
                  ✓ {c}
                </span>
              ))}
            </div>
          )}

          {product.variations.length > 0 && <AddToCart variations={product.variations} />}
        </div>
      </div>

      {product.description && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Mô tả sản phẩm</h2>
          <p className="mt-2 whitespace-pre-line text-neutral-600">{product.description}</p>
        </section>
      )}
    </main>
  );
}
