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
import { PdpChatButton, PdpContentKitRow, PdpCoupons, PdpFlashBar, PdpFreeship, PdpGroupBuyRow, PdpLowStock, PdpPointsEarn, PdpShippingRow, PdpSold, PdpSubscribeRow } from './pdp-extras';
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
  const bundlesFetchedAt = Date.now();
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
            // Điện thoại: mỗi khối là một dải trắng riêng cách nhau 8px trên nền canvas như Mini App; thứ tự các khối con do `max-md:order-N`
            // (bảng thứ tự ở comment dưới). Cột thông tin tự nó không tô nền.
            <div data-testid="pdp-info" className="flex min-w-0 flex-col">
              <div
                data-section="pdp-main"
                className={`flex min-w-0 flex-col max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pt-4 ${product.certifications.length > 0 ? '' : 'max-md:pb-4'}`}
              >
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
              {/* Gian hàng tạm nghỉ thì khối mua không dựng ("Tạm thời chưa mua được"), nên không nhắc chốt sớm. */}
              {!unavailableText && <PdpLowStock slug={product.slug} variations={product.variations} />}
              {shortDesc && shortDesc !== description && (
                <p data-testid="pdp-short-desc" className="mt-3 whitespace-pre-line break-words text-stone-600 max-md:mt-2 max-md:text-sm max-md:text-[var(--color-text-secondary)]">
                  {shortDesc}
                </p>
              )}

              </div>

              {/* Dòng thông tin kiểu Mini App: Ưu đãi › và Vận chuyển ›; "Phân loại ›" nằm trong khối mua (cùng chỗ giữ trạng thái chọn). */}
              <div data-section="pdp-offers" className="mt-3 max-md:order-3 max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:empty:hidden">
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
              </div>
              {/* Lưu ý dài (gian hàng tạm nghỉ, hàng đối tác chỉ bán giá lẻ) là chữ thường dưới dòng, không nằm trong nút "Vận chuyển ›". Điện thoại: cuối dải Phân loại như Mini App. */}
              {(unavailableText || partnerNote) && (
                  <div
                    data-testid="pdp-shipping-notes"
                    data-section="pdp-notes"
                    className="flex flex-col gap-1 py-2 max-md:order-6 max-md:bg-[var(--color-bg-surface)] max-md:px-4"
                  >
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

              {/*
                Thứ tự trong HTML là thứ tự đọc và bấm Tab ở máy tính: khối mua rồi mới tới chứng nhận và "Đặt định kỳ" (lối phụ), nên nút
                "Thêm vào giỏ" không bị đẩy xuống dưới khung 1280×800. Điện thoại xếp lại bằng `max-md:order-N` theo thứ tự của Mini App:
                thông tin chính 0, chứng nhận 1, Đặt định kỳ 2 (chỉ web: ngoại lệ có chủ đích), Ưu đãi + Vận chuyển 3, Phân loại 4,
                chip phân loại 5, ghi chú vận chuyển 6, Combo/Mua kèm 8, Đánh giá nhanh 9, Số lượng 10, Mở nhóm mua chung + Nội dung bán hàng 11.
                Phân loại, chip và Số lượng là ruột của AddToCart (gốc `contents`).
                Hệ quả: thứ tự nhìn và thứ tự Tab/TalkBack lệch nhau ở điện thoại. Tab đi Ưu đãi/Vận chuyển, Phân loại, chip, rồi Số lượng
                (trong DOM đứng ngay sau chip, trên màn hình nằm sau Combo và Đánh giá nhanh), thanh dính đáy, rồi mới tới chứng nhận, Đặt định kỳ,
                Combo, Đánh giá nhanh. Chấp nhận để Số lượng và nút mua giữ chỗ cũ ở máy tính; nút mua thật của điện thoại ở thanh dính đáy
                nên không phụ thuộc thứ tự này. Muốn khớp hoàn toàn thì tách hàng Số lượng khỏi AddToCart và dựng lại sau Đánh giá nhanh.
                Bộ hết hạn hay tắt khi trang ISR đã cũ thì khối KHÔNG bị gỡ (PdpBundles giữ chỗ, ghi "Đã kết thúc"), nên chỗ này không nhảy; chỉ bộ
                mới hiện sau khi tải (máy chủ lỗi lúc dựng, hay bộ vừa tạo sau lần dựng trang) là chèn thêm, như Mini App.
              */}
              {product.variations.length > 0 && (
                <div className="max-md:contents">
                  <AddToCart slug={product.slug} variations={product.variations} blockedReason={unavailableText} productName={product.name} thumbnail={product.thumbnail} />
                </div>
              )}
              {product.certifications.length > 0 && (
                <div
                  data-testid="pdp-certs"
                  data-section="pdp-certs"
                  className="mt-3 flex flex-wrap gap-2 max-md:order-1 max-md:mt-0 max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-4 max-md:pt-2.5"
                >
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
                <div data-section="pdp-subscribe" className="max-md:order-2 max-md:flex max-md:flex-col max-md:bg-[var(--color-bg-surface)] max-md:px-4 max-md:pb-4 max-md:empty:hidden">
                  <PdpSubscribeRow slug={product.slug} variations={product.variations} />
                </div>
              )}

              {/* Điện thoại: Combo/Mua kèm là hai dải trắng riêng như Mini App. Lớp dải đặt ở đây vì khối combo (pdp-bundles) tự nó chỉ có đệm dọc. */}
              <div
                data-section="pdp-bundles"
                className="max-md:order-8 max-md:[&>div]:mt-2 max-md:[&_section]:bg-[var(--color-bg-surface)] max-md:[&_section]:p-4"
              >
                <PdpBundles slug={product.slug} productName={product.name} initialBundles={bundles} initialFetchedAt={bundlesFetchedAt} />
              </div>
              {/* Q8: Đánh giá nhanh ngay sau Combo/Mua kèm, như Mini App; danh sách đầy đủ giữ chỗ cũ ở `below`. */}
              <div className="max-md:order-9">
                <PdpQuickReviews slug={product.slug} />
              </div>
              <div data-section="pdp-groupbuy" className="max-md:order-11">
                {!retailOnly && <PdpGroupBuyRow productId={product.id} slug={product.slug} />}
                <PdpContentKitRow slug={product.slug} />
              </div>
            </div>
          }
          below={
            <div className="min-w-0">
              <PdpIngredients ingredients={product.ingredients} />
              <PdpPromises>
                <PdpChatButton productName={product.name} productSlug={product.slug} />
              </PdpPromises>
              {description && <PdpDescription text={description} />}

              {/* Đọc tham số ?danh-gia= (mở form cho đúng lần mua) cần Suspense để phần còn lại của trang vẫn dựng sẵn được. */}
              <Suspense fallback={<ProductReviewsFallback />}>
                <ProductReviews slug={product.slug} />
              </Suspense>

              {/* Điện thoại: trang không đệm (ảnh tràn mép), nên dải gợi ý tự đệm 16px; các khối trên là dải trắng tự đệm. */}
              <div className="max-md:px-4 max-md:pb-6">
                <PdpRails productId={product.id} slug={product.slug} brand={product.brand} initialRelated={related} initialBoughtTogether={boughtTogether} />
              </div>
            </div>
          }
        />
      </PdpSelectionProvider>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl)) }} />
    </main>
  );
}
