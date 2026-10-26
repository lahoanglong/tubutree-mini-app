import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, Truck } from 'lucide-react';
import { fetchBoughtTogether, fetchRelated } from '@tubutree/app-core/api/catalog';
import { formatSold, getProduct, pdpFulfillerText, pdpPartnerNote, pdpUnavailableText } from '@/lib/api';
import AddToCart from '@/components/add-to-cart';
import { PdpPrice } from '@/components/flash-price';
import { PdpSelectionProvider } from '@/components/pdp-selection';
import ProductGallery from '@/components/product-gallery';
import ShareButton from '@/components/share-button';
import { WishlistHeart } from '@/components/catalog/wishlist-heart';
import { brandAccent } from '@/components/mini/brand-accent';
import { createServerHttp } from '@/lib/core-http-server';
import { isRetailOnly } from '@/lib/pdp-logic';
import { galleryImages, jsonLdScript, plainText, productJsonLd } from '@/lib/product-seo';
import { SITE_URL } from '@/lib/site';
import { ProductReviews, ProductReviewsFallback } from './product-reviews';
import { PdpChatButton, PdpContentKitRow, PdpCoupons, PdpFlashMeta, PdpFreeship, PdpGroupBuyRow, PdpPointsEarn, PdpSubscribeRow } from './pdp-extras';
import { PdpRails } from './pdp-rails';
import { PdpDescription, PdpIngredients, PdpPromises, PdpRating } from './pdp-sections';
import BackLink from '@/components/back-link';
import { PAGE_WIDE } from '@/lib/page-frame';

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

/** Dải gợi ý chỉ là phần phụ: lỗi thì bỏ, để trình duyệt tự tải lại; không được làm hỏng cả trang sản phẩm. */
const orUndefined = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const http = createServerHttp();
  const [related, boughtTogether] = await Promise.all([
    orUndefined(fetchRelated(http, product.slug)),
    orUndefined(fetchBoughtTogether(http, product.slug)),
  ]);

  const images = galleryImages(product);
  const description = plainText(product.description);
  const shortDesc = plainText(product.shortDesc);
  const productUrl = `${SITE_URL}/san-pham/${encodeURIComponent(product.slug)}`;
  const fulfillerText = pdpFulfillerText(product);
  const unavailableText = pdpUnavailableText(product);
  const partnerNote = unavailableText ? null : pdpPartnerNote(product);
  const fulfillerIsTubu = fulfillerText === 'Tubu Tree giao hàng';
  const retailOnly = isRetailOnly(product);
  const fromStore = product.fulfiller?.kind === 'MERCHANT' || product.fulfiller?.kind === 'UNAVAILABLE';

  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
      <BackLink href="/">
        ← Về trang chủ
      </BackLink>
      <div className="mt-2 grid grid-cols-1 gap-8 max-md:mt-0 max-md:gap-0 md:grid-cols-2">
        <ProductGallery images={images} name={product.name} />
        <PdpSelectionProvider initialId={(product.variations.find((v) => v.stock > 0) ?? product.variations[0])?.id ?? ''}>
        <div data-testid="pdp-info" className="min-w-0 max-md:bg-stone-0 max-md:p-4">
          <div className="flex items-center justify-between gap-2">
            {/* Như Mini App: tên nhãn mở danh mục lọc theo nhãn (brandBrowsePath), không rẽ sang trang nhãn. */}
            <Link
              href={`/san-pham?brand=${encodeURIComponent(product.brand)}`}
              aria-label={`Xem sản phẩm nhãn ${product.brand}`}
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-forest-700 underline max-md:text-xs max-md:text-[var(--color-text-secondary)] max-md:no-underline"
            >
              <span
                data-testid="brand-dot"
                aria-hidden="true"
                className="hidden h-2 w-2 rounded-full max-md:block"
                style={{ background: brandAccent(product.brand) }}
              />
              {product.brand}
              <ChevronRight className="hidden h-4 w-4 text-[var(--color-text-tertiary)] max-md:block" aria-hidden="true" />
            </Link>
            <div className="flex items-center">
              <WishlistHeart productId={product.id} />
              <ShareButton title={product.name} path={`/san-pham/${encodeURIComponent(product.slug)}`} />
            </div>
          </div>
          <h1 className="font-display text-2xl font-semibold text-stone-900 max-md:font-[family-name:var(--font-ui)] max-md:text-lg max-md:leading-[1.44] sm:text-3xl max-md:sm:text-lg">{product.name}</h1>
          <PdpRating average={product.ratingAvg} count={product.reviewCount} />
          <div className="flex flex-wrap items-baseline gap-x-3 max-md:flex-nowrap">
            <PdpPrice product={product} />
            {formatSold(product.sold) && <span className="mt-2 text-sm text-stone-500 max-md:ml-auto max-md:text-xs">{formatSold(product.sold)}</span>}
          </div>
          <PdpPointsEarn product={product} />
          <PdpFlashMeta />
          {shortDesc && (
            <p data-testid="pdp-short-desc" className="mt-3 whitespace-pre-line break-words text-stone-600 max-md:mt-2 max-md:text-sm max-md:text-[var(--color-text-secondary)]">
              {shortDesc}
            </p>
          )}
          {unavailableText ? (
            <p
              data-testid="pdp-unavailable"
              role="status"
              className="mt-2 flex items-start gap-1.5 rounded-control bg-warning-bg px-3 py-2 text-sm font-medium text-warning-fg"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{unavailableText}</span>
            </p>
          ) : (
            fulfillerText && (
              <p
                data-testid="pdp-fulfiller"
                className={`mt-2 flex items-start gap-1.5 text-sm text-stone-700 ${fulfillerIsTubu ? 'max-md:text-xs max-md:font-semibold max-md:text-[var(--color-text-brand)]' : ''}`}
              >
                <Truck className="mt-0.5 h-4 w-4 shrink-0 text-forest-600" aria-hidden="true" />
                <span>{fulfillerText}</span>
              </p>
            )
          )}
          {partnerNote && (
            <p data-testid="pdp-partner-note" className="mt-1 text-xs text-stone-600">
              {partnerNote}
            </p>
          )}
          {!fromStore && <PdpFreeship />}

          {product.certifications.length > 0 && (
            <div data-testid="pdp-certs" className="mt-3 flex flex-wrap gap-2">
              {product.certifications.map((c) => (
                <span
                  key={c}
                  className="flex items-center gap-1 rounded-control border border-forest-200 bg-forest-50 px-2.5 py-1 text-xs font-medium text-forest-800 max-md:rounded-full max-md:border-0 max-md:bg-[var(--color-bg-subtle)] max-md:text-[var(--color-text-brand)]"
                >
                  <Check className="h-3.5 w-3.5 text-forest-600" aria-hidden="true" />
                  <span>{c}</span>
                </span>
              ))}
            </div>
          )}

          <PdpCoupons productId={product.id} />
          {!retailOnly && <PdpSubscribeRow slug={product.slug} variations={product.variations} />}

          {product.variations.length > 0 && (
            <AddToCart slug={product.slug} variations={product.variations} blockedReason={unavailableText} />
          )}

          {!retailOnly && <PdpGroupBuyRow productId={product.id} slug={product.slug} />}
          <PdpContentKitRow slug={product.slug} />
        </div>
        </PdpSelectionProvider>
      </div>

      {/* Điện thoại: trang không đệm (ảnh tràn mép), nên các khối dưới tự đệm lại 16px. */}
      <div className="max-md:px-4 max-md:py-6">
      <PdpIngredients ingredients={product.ingredients} />
      <PdpPromises>
        <PdpChatButton productName={product.name} productSlug={product.slug} />
      </PdpPromises>
      {description && <PdpDescription text={description} />}

      {/* Đọc tham số ?danh-gia= (mở form cho đúng lần mua) cần Suspense để phần còn lại của trang vẫn dựng sẵn được. */}
      <Suspense fallback={<ProductReviewsFallback />}>
        <ProductReviews slug={product.slug} />
      </Suspense>

      <PdpRails slug={product.slug} brand={product.brand} initialRelated={related} initialBoughtTogether={boughtTogether} />
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl)) }} />
    </main>
  );
}
