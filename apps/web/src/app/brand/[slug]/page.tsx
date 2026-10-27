import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Award, BadgeCheck, Sparkles, Leaf, MapPin } from 'lucide-react';
import { getBrand, type ProductCard as ProductCardData } from '@/lib/api';
import ProductCard from '@/components/product-card';
import { EmptyState } from '@/components/empty-state';
import { safeHexColor } from '@/lib/safe-color';
import { BrandActions, BrandDealerBlock, BrandPromoCode } from './brand-actions';
import { PAGE_WIDE } from '@/lib/page-frame';
import { GRID_PRODUCTS } from '@/lib/product-grid';

// Admin gỡ đăng không làm mới được trang này, nên hạn ngắn để nhãn bị gỡ không còn hiện lâu; vẫn dựng phía server cho SEO.
export const revalidate = 60;

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
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:p-0 max-md:pb-[calc(90px+var(--safe-bottom))]`}>
      {/* Điện thoại: dải bìa tràn mép 96px (xanh đậm khi chưa có ảnh) và avatar đè lên như StorePageShell của Mini App. */}
      {b.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={b.coverUrl} alt={b.name} className="mb-4 h-44 w-full rounded-card object-cover max-md:mb-0 max-md:h-24 max-md:rounded-none" />
      ) : (
        <div data-testid="brand-cover-band" aria-hidden="true" className="hidden h-24 bg-forest-700 max-md:block" />
      )}
      <div className="max-md:px-4">
        <div className="flex min-w-0 items-center gap-3 max-md:flex-col max-md:items-start max-md:gap-0">
          {b.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={b.logoUrl}
              alt={b.name}
              className="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-stone-0 max-md:-mt-8 max-md:h-16 max-md:w-16 max-md:border-[3px] max-md:border-[var(--color-bg-surface)] max-md:ring-0"
            />
          ) : (
            <span
              data-testid="brand-avatar-fallback"
              aria-hidden="true"
              className="hidden h-16 w-16 shrink-0 place-items-center rounded-full border-[3px] border-[var(--color-bg-surface)] bg-[var(--color-action-primary-bg)] text-[var(--color-text-inverse)] max-md:-mt-8 max-md:grid"
            >
              <Leaf className="h-6 w-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 max-md:mt-2">
            <h1 className="flex flex-wrap items-center gap-2 break-words font-display text-2xl font-semibold text-stone-900 max-md:flex-col max-md:items-start max-md:gap-2">
              {b.name}
              {b.isVerified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-forest-600 px-2 py-0.5 font-ui text-xs font-medium text-stone-0">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Chính hãng
                </span>
              )}
            </h1>
            {b.tagline && <p className="text-stone-600 max-md:mt-1 max-md:text-sm">{b.tagline}</p>}
          </div>
        </div>

        <BrandActions slug={b.slug} name={b.name} followerCount={b.followerCount} />

      {b.certifications.length > 0 && (
        <section className="mt-5 max-md:mt-4">
          <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold text-stone-900">
            <Award className="h-4 w-4 text-forest-600 max-md:hidden" aria-hidden="true" />
            <span>Chứng nhận</span>
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {b.certifications.map((c) => (
              <span
                key={c.code}
                className="flex items-center gap-1 whitespace-nowrap rounded-control border border-forest-200 bg-forest-50 px-3 py-1.5 text-sm text-forest-800 max-md:rounded-full max-md:border-0 max-md:bg-[var(--color-status-success-bg)] max-md:px-2 max-md:py-[3px] max-md:text-caption max-md:text-[var(--color-status-success-fg)]"
              >
                <Leaf className="h-3.5 w-3.5 text-forest-600" aria-hidden="true" />
                <span>{c.label}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {b.promotions.length > 0 && (
        <section className="mt-5 max-md:mt-4">
          <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold text-stone-900">
            <Sparkles className="h-4 w-4 text-promo-solid" aria-hidden="true" />
            <span>Khuyến mãi</span>
          </h2>
          <div className="space-y-2">
            {b.promotions.map((p) => (
              <div
                key={p.id}
                className="rounded-card border border-promo-solid/30 bg-promo-bg p-3"
                style={safeHexColor(p.themeColor) ? { borderColor: safeHexColor(p.themeColor) } : undefined}
              >
                <p className="font-semibold text-promo-fg">{p.title}</p>
                {p.subtitle && <p className="text-sm text-stone-600">{p.subtitle}</p>}
                <BrandPromoCode code={p.couponCode} />
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
        <section className="mt-6 max-md:mt-4">
          <h2 className="mb-3 font-display font-semibold text-stone-900">Sản phẩm</h2>
          <div className={GRID_PRODUCTS}>
            {b.products.map((p) => (
              // Payload sản phẩm của trang nhãn không kèm `brand` (mọi sản phẩm thuộc nhãn này): dùng tên nhãn của trang như Mini App.
              <ProductCard key={p.id} product={{ ...p, brand: b.name } as ProductCardData} />
            ))}
          </div>
        </section>
      )}

      <BrandDealerBlock rewards={b.dealerRewards} />

      {(b.story || b.origin || b.storyImages.length > 0) && (
        <section className="mt-6 max-md:mt-4">
          <h2 className="mb-2 font-display font-semibold text-stone-900">Câu chuyện thương hiệu</h2>
          {b.origin && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-stone-900">
                <MapPin className="h-4 w-4 flex-none text-[color:var(--color-text-brand)]" aria-hidden="true" />
                Xuất xứ: {b.origin}
              </span>
              <Link href="/cau-chuyen" className="inline-flex min-h-11 flex-none items-center justify-center rounded-control bg-[var(--color-action-secondary-bg)] px-4 text-sm font-semibold text-[color:var(--color-action-secondary-fg)]">
                Xem trên bản đồ
              </Link>
            </div>
          )}
          {b.story && <p className="whitespace-pre-line break-words text-sm text-[color:var(--color-text-secondary)] md:text-base md:text-stone-700">{b.story}</p>}
          {b.storyImages.length > 0 && (
            <div role="region" aria-label="Ảnh câu chuyện thương hiệu" className="mt-3 flex gap-2 overflow-x-auto max-md:-mx-4 max-md:px-4">
              {b.storyImages.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt={`${b.name}, ảnh ${i + 1}`} loading="lazy" className="h-40 w-60 flex-none rounded-card bg-[var(--color-bg-subtle)] object-cover" />
              ))}
            </div>
          )}
        </section>
      )}
      </div>
    </main>
  );
}
