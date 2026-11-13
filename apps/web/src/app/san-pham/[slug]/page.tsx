import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, MapPin } from 'lucide-react';
import { fetchProductBundles } from '@tubutree/app-core/api/bundle';
import { fetchBoughtTogether, fetchRelated } from '@tubutree/app-core/api/catalog';
import { fetchActiveFlashSalesNoSync, toFlashSeed } from '@/lib/server-flash';
import { publicConfigQuery } from '@tubutree/app-core/queries/config';
import { formatSold, getProduct, pdpFulfillerText, pdpPartnerNote, pdpUnavailableText } from '@/lib/api';
import AddToCart from '@/components/add-to-cart';
import { PdpPrice } from '@/components/flash-price';
import { PdpSelectionProvider } from '@/components/pdp-selection';
import ProductGallery from '@/components/product-gallery';
import ShareButton from '@/components/share-button';
import { WishlistHeart } from '@/components/catalog/wishlist-heart';
import { brandAccent } from '@/components/mini/brand-accent';
import { pdpOriginLink } from '@/lib/brand-origins';
import { createServerHttp } from '@/lib/core-http-server';
import { defaultVariationFor, runningFlash } from '@/lib/flash-price';
import { FlashSalesSeed } from '@/lib/use-flash-sales';
import { isRetailOnly } from '@/lib/pdp-logic';
import { breadcrumbJsonLd, galleryImages, jsonLdScript, plainText, productJsonLd, productMetaDescription, productTitle } from '@/lib/product-seo';
import { ogBase, withBrand } from '@/lib/og';
import { SITE_URL } from '@/lib/site';
import { ProductReviews, ProductReviewsFallback } from './product-reviews';
import { RecordRecentlyViewed } from './record-recently-viewed';
import { PdpChatButton, PdpContentKitRow, PdpCoupons, PdpFlashBar, PdpFreeship, PdpGroupBuyRow, PdpLowStock, PdpPointsEarn, PdpShippingRow, PdpSold, PdpSubscribeRow, PdpTrustStrip } from './pdp-extras';
import { PdpBundles } from './pdp-bundles';
import { PdpQuickReviews } from './pdp-quick-reviews';
import { PdpFbt } from './pdp-fbt';
import { PdpRails } from './pdp-rails';
import { PdpLayout } from '@/components/layouts/pdp-layout';
import { PdpDescription, PdpIngredients, PdpPromises, PdpRating } from './pdp-sections';
import { PdpStory } from './pdp-story';
import BackLink from '@/components/back-link';
import { PAGE_WIDE } from '@/lib/page-frame';
import { phoneBandPad, phoneBrandLabel } from '@/lib/phone-ui';

export const revalidate = 300;
const FLASH_REVALIDATE_S = 60;

// Không dựng sẵn trang nào lúc build; trang đầu tiên của mỗi đường dẫn dựng khi có người vào rồi giữ theo revalidate (ISR thay vì dựng mỗi lượt).
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: 'Không tìm thấy sản phẩm' };
  const title = productTitle(product);
  const description = productMetaDescription(product);
  const path = `/san-pham/${encodeURIComponent(product.slug)}`;
  const images = galleryImages(product).slice(0, 4);
  return {
    title,
    description,
    // Canonical không kèm ?ref=/utm: link CTV chia sẻ là cùng một trang, không được tính là bản trùng.
    alternates: { canonical: path },
    openGraph: { ...ogBase, url: path, title: withBrand(title), description, images: images.length > 0 ? images : ogBase.images },
    twitter: { card: 'summary_large_image', title: withBrand(title), description, images: images.length > 0 ? images : ogBase.images.map((i) => i.url) },
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
  const [related, boughtTogether, bundles, flashAll, publicConfig] = await Promise.all([
    orUndefined(fetchRelated(http, product.slug)),
    orUndefined(fetchBoughtTogether(http, product.slug)),
    orUndefined(fetchProductBundles(http, product.slug)),
    // Giờ vàng đổi theo giờ và theo số suất còn: giữ ngắn như Trang chủ (lib/home-initial.ts), nên hạn làm mới của trang này thực tế là 60 giây.
    orUndefined(fetchActiveFlashSalesNoSync(createServerHttp({ revalidate: FLASH_REVALIDATE_S }))),
    orUndefined(publicConfigQuery(http).queryFn()),
  ]);
  // Hết giờ rồi thì không đưa vào HTML: lần tải ngay sau đó sẽ không còn, thanh Giờ vàng biến mất và trang nhảy.
  const generatedAt = Date.now();
  const flash = flashAll ? toFlashSeed(flashAll.filter((it) => new Date(it.endAt).getTime() > generatedAt)) : undefined;
  const hasFlash = (flash ?? []).some((f) => product.variations.some((v) => v.id === f.variationId));
  // Có Giờ vàng ở sản phẩm này thì mở sẵn đúng phân loại mà AddToCart sẽ chốt khi danh sách về (cùng `defaultVariationFor`), để giá không đổi hai lần.
  const initialVariation = (hasFlash ? defaultVariationFor({ slug: product.slug }, product.variations, runningFlash(flash ?? [], generatedAt), generatedAt) : undefined) ?? product.variations.find((v) => v.stock > 0) ?? product.variations[0];

  const images = galleryImages(product);
  const description = plainText(product.description);
  const shortDesc = plainText(product.shortDesc);
  const productUrl = `${SITE_URL}/san-pham/${encodeURIComponent(product.slug)}`;
  const fulfillerText = pdpFulfillerText(product);
  const unavailableText = pdpUnavailableText(product);
  const originLink = pdpOriginLink(product.brand);
  const partnerNote = unavailableText ? null : pdpPartnerNote(product);
  const fulfillerIsTubu = fulfillerText === 'Tubu Tree giao hàng';
  const retailOnly = isRetailOnly(product);
  const soldText = formatSold(product.sold);
  const fromStore = product.fulfiller?.kind === 'MERCHANT' || product.fulfiller?.kind === 'UNAVAILABLE';
  // Khối "Gợi ý mua kèm hợp vị" và các dải cuối trang dùng chung một bộ món (hook `useFbt`): chỉ chuyển các trường giá và tồn, không chuyển cả phân loại.
  const fbtHost = {
    name: product.name,
    thumbnail: product.thumbnail ?? product.images[0] ?? null,
    variations: product.variations.map((v) => ({ id: v.id, name: v.name, retailPrice: v.retailPrice, salePrice: v.salePrice, stock: v.stock })),
    blockedReason: unavailableText,
  };

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
      <RecordRecentlyViewed slug={product.slug} name={product.name} thumbnail={product.thumbnail ?? product.images[0] ?? null} />
      <FlashSalesSeed items={flash} now={generatedAt}>
      <PdpSelectionProvider initialId={initialVariation?.id ?? ''}>
        <PdpLayout
          gallery={
            <div className="min-w-0">
              <ProductGallery images={images} name={product.name} />
              {/* Giờ vàng: giá deal nằm ngay dưới ảnh (đồng hồ, đã bán, giới hạn mua); hết giờ thì thanh biến mất, giá thường quay lại. */}
              <PdpFlashBar product={product} />
            </div>
          }
          info={
            // Điện thoại: mỗi khối là một dải trắng riêng cách nhau 8px trên nền canvas như Mini App; thứ tự các khối con do lớp `tubu-pdp-order-N` (mini.css)
            // (bảng thứ tự ở comment dưới). Cột thông tin tự nó không tô nền.
            <div data-testid="pdp-info" className="flex min-w-0 flex-col">
              <div
                data-section="pdp-main"
                className={`flex min-w-0 flex-col ${phoneBandPad} max-md:pt-4 ${product.certifications.length > 0 ? '' : 'max-md:pb-4'}`}
              >
              <div className="flex items-center justify-between gap-2">
                {/* Nhãn và chip xuất xứ xuống dòng trong nhóm này (flex-wrap, min-w-0) để cụm Tim/Chia sẻ bên phải không bị đẩy tràn ở 320px. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3">
                {/* Như Mini App: tên nhãn mở danh mục lọc theo nhãn (brandBrowsePath), không rẽ sang trang nhãn. */}
                <Link
                  href={`/san-pham?brand=${encodeURIComponent(product.brand)}`}
                  aria-label={`Xem sản phẩm thương hiệu ${product.brand}`}
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
                {originLink && (
                  <Link
                    href={`/cau-chuyen?brand=${encodeURIComponent(originLink.id)}`}
                    data-testid="pdp-origin-link"
                    aria-label={originLink.ariaLabel}
                    className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-1 text-xs text-[var(--color-text-secondary)]"
                  >
                    <MapPin className="h-3.5 w-3.5 flex-none text-[color:var(--color-text-brand)]" aria-hidden="true" />
                    <span className="min-w-0 truncate">{originLink.label}</span>
                  </Link>
                )}
                </div>
                <div className="flex flex-none items-center">
                  <WishlistHeart productId={product.id} />
                  <ShareButton title={product.name} path={`/san-pham/${encodeURIComponent(product.slug)}`} description={shortDesc} />
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
              <PdpPointsEarn product={product} initialConfig={publicConfig} />
              {/* Gian hàng tạm nghỉ thì khối mua không dựng ("Tạm thời chưa mua được"), nên không nhắc chốt sớm. */}
              {!unavailableText && <PdpLowStock slug={product.slug} variations={product.variations} />}
              {shortDesc && shortDesc !== description && (
                <p data-testid="pdp-short-desc" className="mt-3 whitespace-pre-line break-words text-stone-600 max-md:mt-2 max-md:text-sm max-md:text-[var(--color-text-secondary)]">
                  {shortDesc}
                </p>
              )}

              </div>

              {/* Dòng thông tin kiểu Mini App: Ưu đãi › và Vận chuyển ›; chip phân loại và Số lượng nằm trong khối mua (cùng chỗ giữ trạng thái chọn). */}
              <div data-section="pdp-offers" className={`mt-3 tubu-pdp-order-3 max-md:mt-2 ${phoneBandPad} max-md:empty:hidden`}>
                <PdpCoupons productId={product.id} product={product} divider={Boolean(fulfillerText || !fromStore)} />
                {(fulfillerText || !fromStore) && (
                  <PdpShippingRow pressable={!fromStore}>
                    {fulfillerText && (
                      <p
                        data-testid="pdp-fulfiller"
                        className={`text-sm text-stone-700 ${fulfillerIsTubu ? phoneBrandLabel : ''}`}
                      >
                        {fulfillerText}
                      </p>
                    )}
                    {!fromStore && <PdpFreeship initialConfig={publicConfig} />}
                  </PdpShippingRow>
                )}
              </div>
              {/* Lưu ý dài (gian hàng tạm nghỉ, hàng đối tác chỉ bán giá lẻ) là chữ thường dưới dòng, không nằm trong nút "Vận chuyển ›". Điện thoại: ngay trên chip phân loại như Mini App. */}
              {(unavailableText || partnerNote) && (
                  <div
                    data-testid="pdp-shipping-notes"
                    data-section="pdp-notes"
                    className={`flex flex-col gap-1 py-2 tubu-pdp-order-4 ${phoneBandPad}`}
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
                "Thêm vào giỏ" không bị đẩy xuống dưới khung 1280×800. Điện thoại xếp lại bằng lớp `tubu-pdp-order-N` (mini.css) theo thứ tự của Mini App:
                thông tin chính 0, chứng nhận 1, Đặt định kỳ 2 (chỉ web: ngoại lệ có chủ đích), Ưu đãi + Vận chuyển 3, ghi chú vận chuyển 4,
                chip phân loại 5, Số lượng 6, dải câu chuyện 7, Combo/Mua kèm 8, Đánh giá nhanh 9, Mở nhóm mua chung + Nội dung bán hàng 11.
                Chip và Số lượng là ruột của AddToCart (gốc `contents`). Không có dòng "Phân loại ›" (chip đã đủ).
                Hệ quả: thứ tự nhìn và thứ tự Tab/TalkBack lệch nhau ở điện thoại. Tab đi Ưu đãi/Vận chuyển, chip, Số lượng (trong DOM
                đứng liền nhau và đúng chỗ trên màn hình), thanh dính đáy, rồi mới tới chứng nhận, Đặt định kỳ, Combo, Đánh giá nhanh.
                Chấp nhận để nút mua giữ chỗ cũ ở máy tính; nút mua thật của điện thoại ở thanh dính đáy nên không phụ thuộc thứ tự này.
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
                  className={`mt-3 flex flex-wrap gap-2 tubu-pdp-order-1 max-md:mt-0 ${phoneBandPad} max-md:pb-4 max-md:pt-2.5`}
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
                <div data-section="pdp-subscribe" className={`tubu-pdp-order-2 max-md:flex max-md:flex-col ${phoneBandPad} max-md:pb-4 max-md:empty:hidden`}>
                  <PdpSubscribeRow slug={product.slug} variations={product.variations} />
                </div>
              )}

              {/* Dải cam kết ngay dưới khối mua nhanh (chip, Số lượng): điện thoại order 7 đứng trước dải câu chuyện (cùng order, thứ tự HTML), như Mini App; máy tính ngay dưới khối mua. Rỗng thì ẩn. */}
              <div data-section="pdp-trust" className="tubu-pdp-order-7 empty:hidden">
                <PdpTrustStrip fulfillerKind={product.fulfiller?.kind} initialConfig={publicConfig} />
              </div>

              {/* Điện thoại: dải câu chuyện ngay dưới khối mua nhanh (chip, Số lượng), order 7 giữa Số lượng (6) và Combo (8); máy tính dùng bản ở `below`. */}
              <PdpStory product={product} placement="phone" />

              {/* "Gợi ý mua kèm hợp vị": ngay trên Combo/Mua kèm giá tốt (cùng order 8, đứng trước theo thứ tự HTML); ẩn hẳn khi không có bộ. */}
              {product.variations.length > 0 && (
                <div className="tubu-pdp-order-8">
                  <PdpFbt productId={product.id} slug={product.slug} initialBoughtTogether={boughtTogether} {...fbtHost} />
                </div>
              )}

              {/* Điện thoại: Combo/Mua kèm là hai dải trắng riêng như Mini App. Lớp dải đặt ở đây vì khối combo (pdp-bundles) tự nó chỉ có đệm dọc. */}
              <div
                data-section="pdp-bundles"
                className="tubu-pdp-order-8 max-md:[&>div]:mt-2 max-md:[&_section]:bg-[var(--color-bg-surface)] max-md:[&_section]:p-4"
              >
                <PdpBundles slug={product.slug} productName={product.name} initialBundles={bundles} initialFetchedAt={bundlesFetchedAt} />
              </div>
              {/* Q8: Đánh giá nhanh ngay sau Combo/Mua kèm, như Mini App; danh sách đầy đủ giữ chỗ cũ ở `below`. */}
              <div className="tubu-pdp-order-9">
                <PdpQuickReviews slug={product.slug} />
              </div>
              <div data-section="pdp-groupbuy" className="tubu-pdp-order-11">
                {!retailOnly && <PdpGroupBuyRow productId={product.id} slug={product.slug} />}
                <PdpContentKitRow slug={product.slug} />
              </div>
            </div>
          }
          below={
            <div className="min-w-0">
              {/* Dải câu chuyện nằm đầu phần dưới: máy tính có đủ bề ngang cho hai cột cuộn kể chuyện; mô tả và thành phần vẫn là chữ trong HTML ở dưới. */}
              <PdpStory product={product} placement="wide" />
              {/* Từ lg hai cột (nội dung bán hàng | đánh giá) để thanh phân bổ sao không kéo dài cả bề ngang 1200px; dưới lg vẫn xếp dọc như cũ. */}
              <div data-testid="pdp-below-cols" className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8">
                <div className="min-w-0">
                  <PdpIngredients ingredients={product.ingredients} />
                  <PdpPromises>
                    <PdpChatButton productName={product.name} productSlug={product.slug} />
                  </PdpPromises>
                  {description && <PdpDescription text={description} />}
                </div>

                {/* Đọc tham số ?danh-gia= (mở form cho đúng lần mua) cần Suspense để phần còn lại của trang vẫn dựng sẵn được. */}
                <div className="min-w-0">
                  <Suspense fallback={<ProductReviewsFallback />}>
                    <ProductReviews slug={product.slug} />
                  </Suspense>
                </div>
              </div>

              {/* Điện thoại: trang không đệm (ảnh tràn mép), nên dải gợi ý tự đệm 16px; các khối trên là dải trắng tự đệm. */}
              <div className="max-md:px-4 max-md:pb-6">
                <PdpRails productId={product.id} slug={product.slug} brand={product.brand} initialRelated={related} initialBoughtTogether={boughtTogether} fbt={fbtHost} />
              </div>
            </div>
          }
        />
      </PdpSelectionProvider>
      </FlashSalesSeed>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl)) }} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            breadcrumbJsonLd([
              { name: 'Trang chủ', href: '/' },
              { name: product.brand, href: `/san-pham?brand=${encodeURIComponent(product.brand)}` },
              { name: product.name, href: `/san-pham/${encodeURIComponent(product.slug)}` },
            ]),
          ),
        }}
      />
    </main>
  );
}
