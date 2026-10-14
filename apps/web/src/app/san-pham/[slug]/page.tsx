import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { getProduct, formatVnd } from '@/lib/api';
import AddToCart from '@/components/add-to-cart';
import ProductGallery from '@/components/product-gallery';
import { galleryImages, jsonLdScript, plainText, productJsonLd } from '@/lib/product-seo';
import { SITE_URL } from '@/lib/site';
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
  const description = plainText(product.shortDesc ?? product.description).slice(0, 160);
  const path = `/san-pham/${encodeURIComponent(product.slug)}`;
  const images = galleryImages(product).slice(0, 4);
  return {
    title,
    description,
    // Canonical không kèm ?ref=/utm: link CTV chia sẻ là cùng một trang, không được tính là bản trùng.
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: 'Tubu Tree', locale: 'vi_VN', url: path, title, description, images },
    twitter: { card: images.length > 0 ? 'summary_large_image' : 'summary', title, description, images },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  const price = product.salePrice ?? product.basePrice;
  const images = galleryImages(product);
  const description = plainText(product.description);
  const shortDesc = plainText(product.shortDesc);
  const productUrl = `${SITE_URL}/san-pham/${encodeURIComponent(product.slug)}`;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/" className={ui.backLink}>
        ← Về trang chủ
      </Link>
      <div className="mt-2 grid gap-8 md:grid-cols-2">
        <ProductGallery images={images} name={product.name} />
        <div>
          {product.brandSlug ? (
            <Link
              href={`/brand/${encodeURIComponent(product.brandSlug)}`}
              className="inline-flex min-h-11 items-center text-sm font-semibold text-forest-700 underline"
            >
              {product.brand}
            </Link>
          ) : (
            <div className="text-sm font-semibold text-forest-700">{product.brand}</div>
          )}
          <h1 className="font-display text-2xl font-semibold text-stone-900 sm:text-3xl">{product.name}</h1>
          <div className="mt-2 text-2xl font-bold text-stone-900">{formatVnd(price)}</div>
          {shortDesc && <p className="mt-3 whitespace-pre-line break-words text-stone-600">{shortDesc}</p>}

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

      {description && (
        <section className="mt-8">
          <h2 className={ui.sectionTitle}>Mô tả sản phẩm</h2>
          <p className="mt-2 whitespace-pre-line break-words text-stone-700">{description}</p>
        </section>
      )}

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl)) }} />
    </main>
  );
}
