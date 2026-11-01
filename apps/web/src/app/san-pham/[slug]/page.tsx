import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight } from 'lucide-react';
import { fetchProductBundles } from '@tubutree/app-core/api/bundle';
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
import { PdpChatButton, PdpContentKitRow, PdpCoupons, PdpFlashBar, PdpFreeship, PdpGroupBuyRow, PdpPointsEarn, PdpShippingRow, PdpSold, PdpSubscribeRow } from './pdp-extras';
import { PdpBundles } from './pdp-bundles';
import { PdpQuickReviews } from './pdp-quick-reviews';
import { PdpRails } from './pdp-rails';
import { PdpLayout } from '@/components/layouts/pdp-layout';
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
  const [related, boughtTogether, bundles] = await Promise.all([
    orUndefined(fetchRelated(http, product.slug)),
    orUndefined(fetchBoughtTogether(http, product.slug)),
    orUndefined(fetchProductBundles(http, product.slug)),
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
  const soldText = formatSold(product.sold);
  const fromStore = product.fulfiller?.kind === 'MERCHANT' || product.fulfiller?.kind === 'UNAVAILABLE';

  return (
    <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
      <BackLink
        href="/"
        crumbs={[
          { label: 'Trang chủ', href: '/' },
          { label: product.brand, href: `/san-pham?brand=${encodeURIComponent(product.brand)}` },
          { label: product.name },
        ]}
      >
        ← Về trang chủ
      </BackLink>
      <PdpSelectionProvider initialId={(product.variations.find((v) => v.stock > 0) ?? product.variations[0])?.id ?? ''}>
        <PdpLayout
          gallery={
            <div className="min-w-0">
              <ProductGallery images={images} name={product.name} />
              {/* Giờ vàng: giá deal nằm ngay dưới ảnh (đồng hồ, đã bán, giới hạn mua); hết giờ thì thanh biến mất, giá thường quay lại. */}
              <PdpFlashBar product={product} />
            </div>
          }
          info={
            <div data-testid="pdp-info" className="flex min-w-0 flex-col max-md:bg-stone-0 max-md:p-4">
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
              {/* Giờ vàng: dòng giá trống nên "Đã bán" ở dòng đánh giá (PdpSold chọn chỗ); rỗng cả hai thì dòng không chiếm chỗ. */}
              <div className="mt-1.5 flex items-center justify-between gap-2 empty:hidden">
                <PdpRating average={product.ratingAvg} count={product.reviewCount} />
                {soldText && <PdpSold text={soldText} product={product} slot="rating" />}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 empty:hidden max-md:flex-nowrap">
                <PdpPrice product={product} />
                {soldText && <PdpSold text={soldText} product={product} slot="price" />}
              </div>
              <PdpPointsEarn product={product} />
              {shortDesc && shortDesc !== description && (
                <p data-testid="pdp-short-desc" className="mt-3 whitespace-pre-line break-words text-stone-600 max-md:mt-2 max-md:text-sm max-md:text-[var(--color-text-secondary)]">
                  {shortDesc}
                </p>
              )}

              {/* Dòng thông tin kiểu Mini App: Ưu đãi › và Vận chuyển ›; "Phân loại ›" nằm trong khối mua (cùng chỗ giữ trạng thái chọn). */}
              <div className="mt-3">
                <PdpCoupons productId={product.id} />
                {(fulfillerText || !fromStore) && (
                  <PdpShippingRow pressable={!fromStore}>
                    {fulfillerText && (
                      <p
                        data-testid="pdp-fulfiller"
                        className={`text-sm text-stone-700 ${fulfillerIsTubu ? 'max-md:text-xs max-md:font-semibold max-md:text-[var(--color-text-brand)]' : ''}`}
                      >
                        {fulfillerText}
                      </p>
                    )}
                    {!fromStore && <PdpFreeship />}
                  </PdpShippingRow>
                )}
                {/* Lưu ý dài (gian hàng tạm nghỉ, hàng đối tác chỉ bán giá lẻ) là chữ thường dưới dòng, không nằm trong nút "Vận chuyển ›". */}
                {(unavailableText || partnerNote) && (
                  <div data-testid="pdp-shipping-notes" className="flex flex-col gap-1 py-2">
                    {unavailableText && (
                      <p
                        data-testid="pdp-unavailable"
                        role="status"
                        className="flex items-start gap-1.5 rounded-control bg-warning-bg px-3 py-2 text-sm font-medium text-warning-fg"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{unavailableText}</span>
                      </p>
                    )}
                    {partnerNote && (
                      <p data-testid="pdp-partner-note" className="text-xs text-stone-600">
                        {partnerNote}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/*
                Thứ tự trong HTML là thứ tự đọc và bấm Tab ở máy tính: khối mua rồi mới tới chứng nhận và "Đặt định kỳ" (lối phụ), nên nút
                "Thêm vào giỏ" không bị đẩy xuống dưới khung 1280×800. Điện thoại kéo chứng nhận và "Đặt định kỳ" lên trước khối mua như Mini App
                bằng `order` (các hàng này hiển thị liền nhau nên lệch thứ tự Tab chỉ vài bước).
              */}
              {product.variations.length > 0 && (
                <div className="max-md:order-2">
                  <AddToCart slug={product.slug} variations={product.variations} blockedReason={unavailableText} productName={product.name} thumbnail={product.thumbnail} />
                </div>
              )}
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
              {!retailOnly && (
                <div className="max-md:order-1">
                  <PdpSubscribeRow slug={product.slug} variations={product.variations} />
                </div>
              )}

              <div className="max-md:order-3">
                {!retailOnly && <PdpGroupBuyRow productId={product.id} slug={product.slug} />}
                <PdpContentKitRow slug={product.slug} />
                <PdpBundles slug={product.slug} productName={product.name} initialBundles={bundles} />
              </div>
            </div>
          }
          below={
            /* Điện thoại: trang không đệm (ảnh tràn mép), nên các khối dưới tự đệm lại 16px. */
            <div className="min-w-0 max-md:px-4 max-md:py-6">
              {/* Q8: Đánh giá nhanh ngay sau Combo/Mua kèm (cuối khối thông tin), như Mini App; danh sách đầy đủ giữ chỗ cũ. */}
              <PdpQuickReviews slug={product.slug} />
              <PdpIngredients ingredients={product.ingredients} />
              <PdpPromises>
                <PdpChatButton productName={product.name} productSlug={product.slug} />
              </PdpPromises>
              {description && <PdpDescription text={description} />}

              {/* Đọc tham số ?danh-gia= (mở form cho đúng lần mua) cần Suspense để phần còn lại của trang vẫn dựng sẵn được. */}
              <Suspense fallback={<ProductReviewsFallback />}>
                <ProductReviews slug={product.slug} />
              </Suspense>

              <PdpRails productId={product.id} slug={product.slug} brand={product.brand} initialRelated={related} initialBoughtTogether={boughtTogether} />
            </div>
          }
        />
      </PdpSelectionProvider>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl)) }} />
    </main>
  );
}
