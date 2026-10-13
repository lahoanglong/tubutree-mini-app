import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Leaf, Check } from 'lucide-react';
import { getProduct, formatVnd } from '@/lib/api';
import AddToCart from '@/components/add-to-cart';
import { ui } from '@/lib/guest-ui';

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
      <Link href="/" className={ui.backLink}>
        ← Về trang chủ
      </Link>
      <div className="mt-2 grid gap-8 md:grid-cols-2">
        <div className="flex aspect-square items-center justify-center overflow-hidden rounded-sheet border border-stone-200 bg-forest-50 text-forest-600 shadow-card">
          {product.thumbnail ? (
            // Ảnh LCP của trang: tải sớm và ưu tiên cao thay vì để trình duyệt đoán. Chưa dùng
            // next/image vì ảnh sản phẩm đến từ host tuỳ ý (Pancake/Cloudinary/…) — bật
            // optimizer cho mọi host là biến nó thành proxy ảnh mở; cần chốt danh sách host
            // trước khi chuyển.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.thumbnail}
              alt={product.name}
              className="h-full w-full object-cover"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          ) : (
            <Leaf className="h-20 w-20 stroke-[1.5] text-forest-600" aria-hidden="true" />
          )}
        </div>
        <div>
          <div className="text-sm font-semibold text-forest-700">{product.brand}</div>
          <h1 className="font-display text-2xl font-semibold text-stone-900 sm:text-3xl">{product.name}</h1>
          <div className="mt-2 text-2xl font-bold text-stone-900">{formatVnd(price)}</div>
          {product.shortDesc && <p className="mt-3 text-stone-600">{product.shortDesc}</p>}

          {product.certifications.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {product.certifications.map((c) => (
                <span key={c} className="flex items-center gap-1 rounded-control border border-forest-200 bg-forest-50 px-2.5 py-1 text-xs font-medium text-forest-800">
                  <Check className="h-3.5 w-3.5 text-forest-600" aria-hidden="true" />
                  <span>{c}</span>
                </span>
              ))}
            </div>
          )}

          {product.variations.length > 0 && <AddToCart slug={product.slug} variations={product.variations} />}
        </div>
      </div>

      {product.description && (
        <section className="mt-8">
          <h2 className={ui.sectionTitle}>Mô tả sản phẩm</h2>
          <p className="mt-2 whitespace-pre-line text-stone-700">{product.description}</p>
        </section>
      )}
    </main>
  );
}
