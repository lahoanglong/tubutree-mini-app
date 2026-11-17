import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Check, ChevronRight, MapPin } from 'lucide-react';
import { fetchProductBundles } from '@tubutree/app-core/api/bundle';
import { fetchBoughtTogether, fetchRelated } from '@tubutree/app-core/api/catalog';
import { fetchProductCompare } from '@tubutree/app-core/api/product-compare';
import { addonRows, comboView } from '@tubutree/app-core/commerce/bundle-view';
import { pdpVideoUrls } from '@tubutree/app-core/commerce/pdp-media';
import { parseRichText } from '@tubutree/app-core/rich-text';
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
import { ProductViewTracker } from './product-view-tracker';
import { PdpChatButton, PdpContentKitRow, PdpCoupons, PdpFlashBar, PdpFreeship, PdpGroupBuyRow, PdpLowStock, PdpPointsEarn, PdpShippingRow, PdpSold, PdpSubscribeRow } from './pdp-extras';
import { PdpAddOns, PdpAddOnScope } from './pdp-addons';
import { PdpBundles } from './pdp-bundles';
import { compareRows } from './compare-view';
import { PdpCompare } from './pdp-compare';
import { PdpRails } from './pdp-rails';
import { PdpRebuyRow } from './pdp-rebuy';
import { PdpLayout } from '@/components/layouts/pdp-layout';
import { PdpDescription, PdpIngredients, PdpPromises, PdpRating } from './pdp-sections';
import { PdpStory } from './pdp-story';
import BackLink from '@/components/back-link';
import { PAGE_WIDE } from '@/lib/page-frame';
import { phoneBand, phoneBandPad, phoneBrandLabel } from '@/lib/phone-ui';

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
  const [related, boughtTogether, bundles, flashAll, publicConfig, compare] = await Promise.all([
    orUndefined(fetchRelated(http, product.slug)),
    orUndefined(fetchBoughtTogether(http, product.slug)),
    orUndefined(fetchProductBundles(http, product.slug)),
    // Giờ vàng đổi theo giờ và theo số suất còn: giữ ngắn như Trang chủ (lib/home-initial.ts), nên hạn làm mới của trang này thực tế là 60 giây.
    orUndefined(fetchActiveFlashSalesNoSync(createServerHttp({ revalidate: FLASH_REVALIDATE_S }))),
    orUndefined(publicConfigQuery(http).queryFn()),
    // Cờ so sánh tắt thì máy chủ trả 404: coi như không có bảng.
    orUndefined(fetchProductCompare(http, product.slug)),
  ]);
  // Hết giờ rồi thì không đưa vào HTML: lần tải ngay sau đó sẽ không còn, thanh Giờ vàng biến mất và trang nhảy.
  const generatedAt = Date.now();
  const flash = flashAll ? toFlashSeed(flashAll.filter((it) => new Date(it.endAt).getTime() > generatedAt)) : undefined;
  const hasFlash = (flash ?? []).some((f) => product.variations.some((v) => v.id === f.variationId));
  // Có Giờ vàng ở sản phẩm này thì mở sẵn đúng phân loại mà AddToCart sẽ chốt khi danh sách về (cùng `defaultVariationFor`), để giá không đổi hai lần.
  const initialVariation = (hasFlash ? defaultVariationFor({ slug: product.slug }, product.variations, runningFlash(flash ?? [], generatedAt), generatedAt) : undefined) ?? product.variations.find((v) => v.stock > 0) ?? product.variations[0];

  const images = galleryImages(product);
  // Ảnh đầu của từng biến thể (Pancake): chọn biến thể thì thư viện ảnh nhảy tới ảnh đó.
  const variationImages = Object.fromEntries(product.variations.flatMap((v) => (v.imageUrl ? [[v.id, v.imageUrl.trim()] as const] : [])));
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
  // Đổi trả và vận chuyển khai cho hàng Tubu Tree giao; hàng của gian hàng đối tác có phí và hạn riêng nên không khai thay họ.
  const productPolicy = fromStore
    ? undefined
    : {
        returnWindowDays: publicConfig?.returnWindowDays,
        shipping: publicConfig ? { freeThreshold: publicConfig.freeshipThreshold, flatFee: publicConfig.shippingFlatFee } : undefined,
      };
  // Khối "Gợi ý mua kèm hợp vị" và các dải cuối trang dùng chung một bộ món (hook `useFbt`): chỉ chuyển các trường giá và tồn, không chuyển cả phân loại.
  const fbtHost = {
    name: product.name,
    thumbnail: product.thumbnail ?? product.images[0] ?? null,
    variations: product.variations.map((v) => ({ id: v.id, name: v.name, retailPrice: v.retailPrice, salePrice: v.salePrice, stock: v.stock })),
    blockedReason: unavailableText,
  };
  // Khối mua kèm lấy combo/mua kèm giá tốt trước nếu có bộ thật đang chạy, xét bằng đúng hàm vẽ của `PdpBundles` trên cùng dữ liệu và mốc giờ dựng trang.
  const hasBundles =
    !!bundles &&
    ((bundles.combos ?? []).some((b) => comboView(b, bundlesFetchedAt) !== null) || addonRows(bundles.addons ?? [], bundlesFetchedAt).length > 0);
  const showShortDesc = !!shortDesc && shortDesc !== description;
  const hasIngredients = (product.ingredients ?? []).length > 0;
  const hasDescription = parseRichText(product.description).length > 0;
  const hasCompare = compareRows(compare) !== null;

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
      <ProductViewTracker
        slug={product.slug}
        hasVideo={pdpVideoUrls(product.videos).length > 0}
        imageCount={images.length}
        inStock={!unavailableText && product.variations.some((v) => v.stock > 0)}
      />
      <FlashSalesSeed items={flash} now={generatedAt}>
      <PdpSelectionProvider initialId={initialVariation?.id ?? ''}>
      <PdpAddOnScope hasBundles={hasBundles} productId={product.id} slug={product.slug} initialBoughtTogether={boughtTogether} {...fbtHost}>
        {/*
          Thứ tự khối theo `PDP_BLOCK_ORDER` (app-core, chung với Mini App), mỗi gốc khối có `data-pdp-block`; khối không có dữ liệu thì không có phần tử.
          Thứ tự HTML là thứ tự nhìn ở điện thoại và thứ tự Tab/TalkBack ở mọi khổ: cột thông tin không còn xếp lại bằng `order`, nên nút "Thêm vào giỏ"
          ở máy tính đứng ngay sau giá. Từ lg phần dưới là lưới hai cột xếp dày (`grid-flow-row-dense`): Mô tả lấp ô cạnh Thành phần, Đánh giá cạnh So sánh,
          còn câu chuyện, mua kèm, cam kết và các dải gợi ý chiếm cả hàng; vì vậy ở lg thứ tự nhìn của Câu chuyện và Mô tả đảo nhau so với HTML (chấp nhận).
        */}
        <PdpLayout
          gallery={
            <div data-pdp-block="gallery" className="min-w-0">
              <ProductGallery images={images} videos={product.videos} name={product.name} variationImages={variationImages} pdpSlug={product.slug} />
              {/* Giờ vàng: giá deal nằm ngay dưới ảnh (đồng hồ, đã bán, giới hạn mua); hết giờ thì thanh biến mất, giá thường quay lại. */}
              <PdpFlashBar product={product} />
            </div>
          }
          info={
            // Điện thoại: mỗi khối là một dải trắng riêng trên nền canvas như Mini App; cột thông tin tự nó không tô nền.
            <div data-testid="pdp-info" className="flex min-w-0 flex-col">
              <div data-pdp-block="main" data-section="pdp-main" className={`flex min-w-0 flex-col ${phoneBandPad} max-md:py-4`}>
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
                    className="tubu-hit-44 inline-flex min-h-11 min-w-11 max-w-full items-center gap-1 text-xs text-[var(--color-text-secondary)]"
                  >
                    <MapPin className="h-3.5 w-3.5 flex-none text-[color:var(--color-text-brand)]" aria-hidden="true" />
                    <span className="min-w-0 truncate">{originLink.label}</span>
                  </Link>
                )}
                </div>
                <div className="flex flex-none items-center">
                  <WishlistHeart productId={product.id} pdpSlug={product.slug} />
                  <ShareButton title={product.name} path={`/san-pham/${encodeURIComponent(product.slug)}`} description={shortDesc} pdpSlug={product.slug} />
                </div>
              </div>
              <h1 className="font-display text-2xl font-semibold text-stone-900 max-md:font-[family-name:var(--font-ui)] max-md:text-lg max-md:leading-[1.44] sm:text-3xl max-md:sm:text-lg">{product.name}</h1>
              {/* Giờ vàng: dòng giá trống nên "Đã bán" ở dòng đánh giá (PdpSold chọn chỗ); rỗng cả hai thì dòng không chiếm chỗ. */}
              <div className="mt-1.5 flex items-center justify-between gap-2 empty:hidden">
                <PdpRating average={product.ratingAvg} count={product.reviewCount} />
                {soldText && <PdpSold text={soldText} product={product} slot="rating" />}
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 empty:hidden">
                <PdpPrice product={product} />
                {soldText && <PdpSold text={soldText} product={product} slot="price" />}
              </div>
              <PdpPointsEarn product={product} initialConfig={publicConfig} />
              {/* Gian hàng tạm nghỉ thì khối mua không dựng ("Tạm thời chưa mua được"), nên không nhắc chốt sớm. */}
              {!unavailableText && <PdpLowStock slug={product.slug} variations={product.variations} />}
              </div>

              {/* Gốc AddToCart là `contents` ở điện thoại; khung khối này là khối thường nên chip và Số lượng nằm đúng chỗ HTML (lớp `order` bên trong không còn tác dụng).
                  Hàng chip không tự có đệm trên (vốn nối tiếp dải Vận chuyển), nên khung tách dải và đệm thay; một phân loại thì dải Số lượng tự tách. */}
              {product.variations.length > 0 && (
                <div
                  data-pdp-block="variations"
                  className={`min-w-0 ${product.variations.length > 1 ? 'max-md:mt-2 max-md:bg-[var(--color-bg-surface)] max-md:pt-4' : ''}`}
                >
                  <AddToCart slug={product.slug} variations={product.variations} blockedReason={unavailableText} productName={product.name} thumbnail={product.thumbnail} pdpSlug={product.slug} />
                </div>
              )}

              {/* "Bạn đã mua · Mua lại" đứng trước "Đặt định kỳ" (lối phụ); cả hai rỗng thì dải không chiếm chỗ. */}
              <div data-section="pdp-subscribe" className={`${phoneBandPad} max-md:pb-4 empty:hidden`}>
                <PdpRebuyRow productId={product.id} slug={product.slug} productName={product.name} variations={product.variations} blocked={!!unavailableText} />
                {!retailOnly && <PdpSubscribeRow slug={product.slug} variations={product.variations} initialConfig={publicConfig} />}
              </div>

              <div data-pdp-block="shipping" className="mt-3 max-md:mt-2">
                {/* Dòng thông tin kiểu Mini App: Ưu đãi › và Vận chuyển › (mở chính sách vận chuyển). */}
                <div data-section="pdp-offers" className={`${phoneBandPad} empty:hidden`}>
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
                {/* Lưu ý dài (gian hàng tạm nghỉ, hàng đối tác chỉ bán giá lẻ) là chữ thường dưới dòng, không nằm trong nút "Vận chuyển ›". */}
                {(unavailableText || partnerNote) && (
                  <div data-testid="pdp-shipping-notes" data-section="pdp-notes" className={`flex flex-col gap-1 py-2 ${phoneBandPad}`}>
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

              {(showShortDesc || product.certifications.length > 0) && (
                <div data-pdp-block="benefits" className={`mt-3 ${phoneBand}`}>
                  {showShortDesc && (
                    <p data-testid="pdp-short-desc" className="whitespace-pre-line break-words text-stone-600 max-md:text-sm max-md:text-[var(--color-text-secondary)]">
                      {shortDesc}
                    </p>
                  )}
                  {product.certifications.length > 0 && (
                    <div data-testid="pdp-certs" data-section="pdp-certs" className={`flex flex-wrap gap-2 ${showShortDesc ? 'mt-3' : ''}`}>
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
                </div>
              )}
            </div>
          }
          below={
            // Gốc khối nằm trong khung lưới `empty:hidden`: khối tự ẩn (trả null) thì ô lưới cũng không chiếm chỗ.
            <div data-testid="pdp-below-cols" className="min-w-0 lg:grid lg:grid-flow-row-dense lg:grid-cols-2 lg:items-start lg:gap-x-8">
              <div className={`min-w-0 empty:hidden ${hasDescription ? '' : 'lg:col-span-2'}`}>
                <PdpIngredients ingredients={product.ingredients} />
              </div>
              <div className="min-w-0 empty:hidden lg:col-span-2">
                <PdpStory product={product} />
              </div>
              <div className={`min-w-0 empty:hidden ${hasIngredients ? '' : 'lg:col-span-2'}`}>
                <PdpDescription source={product.description} />
              </div>
              <div className="min-w-0 empty:hidden lg:col-span-2">
                <PdpAddOns
                  bundles={
                    // Điện thoại: Combo/Mua kèm là hai dải trắng riêng như Mini App. Lớp dải đặt ở đây vì khối combo (pdp-bundles) tự nó chỉ có đệm dọc.
                    <div data-section="pdp-bundles" className="md:mt-8 max-md:[&>div]:mt-2 max-md:[&_section]:bg-[var(--color-bg-surface)] max-md:[&_section]:p-4">
                      <PdpBundles slug={product.slug} productName={product.name} initialBundles={bundles} initialFetchedAt={bundlesFetchedAt} />
                    </div>
                  }
                  fbt={{ productId: product.id, slug: product.slug, initialBoughtTogether: boughtTogether, ...fbtHost }}
                />
              </div>
              {/* Đọc tham số ?danh-gia= (mở form cho đúng lần mua) cần Suspense để phần còn lại của trang vẫn dựng sẵn được. */}
              <div className={`min-w-0 ${hasCompare ? '' : 'lg:col-span-2'}`}>
                <Suspense fallback={<ProductReviewsFallback />}>
                  <ProductReviews slug={product.slug} />
                </Suspense>
              </div>
              {hasCompare && (
                <div className="min-w-0">
                  <PdpCompare data={compare} />
                </div>
              )}
              <div className="min-w-0 lg:col-span-2">
                <PdpPromises
                  fulfillerKind={product.fulfiller?.kind}
                  initialConfig={publicConfig}
                  rows={
                    <>
                      {!retailOnly && <PdpGroupBuyRow productId={product.id} slug={product.slug} />}
                      <PdpContentKitRow slug={product.slug} />
                    </>
                  }
                >
                  <PdpChatButton productName={product.name} productSlug={product.slug} />
                </PdpPromises>
              </div>
              {/* Điện thoại: trang không đệm (ảnh tràn mép), nên dải gợi ý tự đệm 16px; các khối trên là dải trắng tự đệm. */}
              <div className="min-w-0 empty:hidden max-md:px-4 max-md:pb-6 lg:col-span-2">
                <PdpRails productId={product.id} slug={product.slug} brand={product.brand} initialRelated={related} />
              </div>
            </div>
          }
        />
      </PdpAddOnScope>
      </PdpSelectionProvider>
      </FlashSalesSeed>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(productJsonLd(product, productUrl, productPolicy)) }} />
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
