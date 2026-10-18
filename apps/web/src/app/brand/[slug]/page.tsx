import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Award, BadgeCheck, Sparkles, Leaf } from 'lucide-react';
import { getBrand, formatSold } from '@/lib/api';
import { ProductPriceRow } from '@/components/flash-price';
import { EmptyState } from '@/components/empty-state';
import { BrandActions, BrandDealerBlock } from './brand-actions';

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) return { title: 'Nhãn hàng — Tubu Tree' };
  const title = `${b.name}${b.isVerified ? ' ✓' : ''} — Tubu Tree`;
  const description = b.tagline ?? 'Nhãn hàng sống xanh trên Tubu Tree';
  const img = b.coverUrl ?? b.logoUrl ?? b.products?.[0]?.thumbnail ?? undefined;
  return {
    title,
    description,
    openGraph: { title, description, images: img ? [img] : [], type: 'website' },
  };
}

export default async function BrandPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const b = await getBrand(slug);
  if (!b) notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      {b.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.coverUrl} alt={b.name} className="mb-4 h-44 w-full rounded-card object-cover" />
      )}
      <div className="flex min-w-0 items-center gap-3">
        {b.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={b.logoUrl} alt={b.name} className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-stone-0" />
        )}
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 break-words font-display text-2xl font-semibold text-stone-900">
            {b.name}
            {b.isVerified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-forest-600 px-2 py-0.5 font-ui text-xs font-medium text-stone-0">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Chính hãng
              </span>
            )}
          </h1>
          {b.tagline && <p className="text-stone-600">{b.tagline}</p>}
        </div>
      </div>

      <BrandActions slug={b.slug} name={b.name} followerCount={b.followerCount} />

      {b.certifications.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold text-stone-900">
            <Award className="h-4 w-4 text-forest-600" aria-hidden="true" />
            <span>Chứng nhận</span>
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {b.certifications.map((c) => (
              <span
                key={c.code}
                className="flex items-center gap-1 whitespace-nowrap rounded-control border border-forest-200 bg-forest-50 px-3 py-1.5 text-sm text-forest-800"
              >
                <Leaf className="h-3.5 w-3.5 text-forest-600" aria-hidden="true" />
                <span>{c.label}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {b.promotions.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold text-stone-900">
            <Sparkles className="h-4 w-4 text-promo-solid" aria-hidden="true" />
            <span>Khuyến mãi</span>
          </h2>
          <div className="space-y-2">
            {b.promotions.map((p) => (
              <div
                key={p.id}
                className="rounded-card border border-promo-solid/30 bg-promo-bg p-3"
                style={p.themeColor ? { borderColor: p.themeColor } : undefined}
              >
                <p className="font-semibold text-promo-fg">{p.title}</p>
                {p.subtitle && <p className="text-sm text-stone-600">{p.subtitle}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {b.products.length === 0 && (
        <EmptyState
          title="Nhãn hàng chưa có sản phẩm đang bán"
          body="Nhãn đang cập nhật sản phẩm. Bạn có thể xem các sản phẩm khác trên Tubu Tree."
          actionHref="/"
          actionLabel="Xem sản phẩm trên Tubu Tree"
        />
      )}
      {b.products.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-display font-semibold text-stone-900">Sản phẩm</h2>
          <div className="grid grid-cols-2 gap-3">
            {b.products.map((p) => (
              <Link
                key={p.id}
                href={`/san-pham/${encodeURIComponent(p.slug)}`}
                className="block overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card transition hover:shadow-raised"
              >
                {p.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.thumbnail}
                    alt={p.name}
                    className="aspect-square w-full object-cover"
                    width={400}
                    height={400}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center bg-forest-50 text-forest-600">
                    <Leaf className="h-10 w-10 text-forest-600" aria-hidden="true" />
                  </div>
                )}
                <div className="p-2">
                  <p className="line-clamp-2 text-sm text-stone-900">{p.name}</p>
                  <ProductPriceRow
                    product={p}
                    className="mt-1 flex items-baseline gap-1.5"
                    priceClassName="font-bold text-stone-900"
                    originalClassName="text-xs text-stone-500 line-through"
                  />
                  {formatSold(p.sold) && <p className="mt-0.5 text-xs text-stone-500">{formatSold(p.sold)}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <BrandDealerBlock rewards={b.dealerRewards} />

      {b.story && (
        <section className="mt-6">
          <h2 className="mb-2 font-display font-semibold text-stone-900">Câu chuyện thương hiệu</h2>
          <p className="whitespace-pre-line break-words text-stone-700">{b.story}</p>
        </section>
      )}
    </main>
  );
}
