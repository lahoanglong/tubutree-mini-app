import { Check } from 'lucide-react';
import { parseRichText } from '@tubutree/app-core/rich-text';
import type { ProductDetail } from '@/lib/api';
import { PdpPrice } from '@/components/flash-price';
import { PdpSelectionProvider } from '@/components/pdp-selection';
import ProductGallery from '@/components/product-gallery';
import { StickyActionBar } from '@/components/sticky-action-bar';
import { brandAccent } from '@/components/mini/brand-accent';
import { PdpLayout } from '@/components/layouts/pdp-layout';
import { ui, uiBar } from '@/lib/guest-ui';
import { phoneBand, phoneBandPad } from '@/lib/phone-ui';
import { galleryImages, plainText } from '@/lib/product-seo';
import { PdpDescription, PdpIngredients, PdpRating } from '../[slug]/pdp-sections';
import { PdpStory } from '../[slug]/pdp-story';
import { PREVIEW_COPY } from './preview-copy';

/**
 * Phần nội dung của trang sản phẩm thật (app/san-pham/[slug]/page.tsx) dựng lại bằng CHÍNH các thành phần PDP: thư viện ảnh + video, tên, giá, mô tả ngắn,
 * chứng nhận, Thành phần, Câu chuyện, Mô tả (lọc HTML lúc hiển thị bằng `parseRichText`). Bỏ mọi thứ ghi sự kiện, gọi giỏ hay dẫn khỏi trang
 * (theo dõi lượt xem, đã xem gần đây, tim, chia sẻ, chat, mua kèm, đánh giá, dải gợi ý): MSS nhúng trang trong iframe nên link dẫn sang trang
 * khác của Tubu (không nhúng được) chỉ làm khung trắng. Nút mua là nút `disabled` thật, không có mã thêm giỏ phía sau.
 * Lớp chữ của tên, nhãn hàng và mô tả ngắn viết theo mốc md tăng dần cho cùng số đo với trang thật (trang thật viết bằng `max-md:`).
 */
export function PreviewProduct({ product }: { product: ProductDetail }) {
  const images = galleryImages(product);
  const variationImages = Object.fromEntries(product.variations.flatMap((v) => (v.imageUrl ? [[v.id, v.imageUrl.trim()] as const] : [])));
  const initialVariation = product.variations.find((v) => v.stock > 0) ?? product.variations[0];
  const description = plainText(product.description);
  const shortDesc = plainText(product.shortDesc);
  const showShortDesc = !!shortDesc && shortDesc !== description;
  const hasIngredients = (product.ingredients ?? []).length > 0;
  const hasDescription = parseRichText(product.description).length > 0;
  const buy = (className: string) => (
    <button type="button" disabled data-testid="preview-buy" aria-describedby="preview-buy-note" className={className}>
      {PREVIEW_COPY.buy}
    </button>
  );

  return (
    <PdpSelectionProvider initialId={initialVariation?.id ?? ''}>
      <p id="preview-buy-note" className="sr-only">
        {PREVIEW_COPY.buyDisabledNote}
      </p>
      <PdpLayout
        gallery={
          <div data-pdp-block="gallery" className="min-w-0">
            <ProductGallery images={images} videos={product.videos} name={product.name} variationImages={variationImages} />
          </div>
        }
        info={
          <div data-testid="pdp-info" className="flex min-w-0 flex-col">
            <div data-pdp-block="main" data-section="pdp-main" className={`flex min-w-0 flex-col py-4 md:py-0 ${phoneBandPad}`}>
              <p
                data-testid="preview-brand"
                className="inline-flex min-h-11 items-center gap-1.5 text-xs text-[var(--color-text-secondary)] md:text-sm md:font-semibold md:text-[var(--color-text-brand)]"
              >
                <span aria-hidden="true" className="h-2 w-2 rounded-full md:hidden" style={{ background: brandAccent(product.brand) }} />
                {product.brand}
              </p>
              <h1 className="font-[family-name:var(--font-ui)] text-lg font-semibold leading-[1.44] text-[var(--color-text-primary)] md:font-display md:text-3xl">{product.name}</h1>
              <div className="mt-1.5 flex items-center justify-between gap-2 empty:hidden">
                <PdpRating average={product.ratingAvg} count={product.reviewCount} />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-3 empty:hidden">
                <PdpPrice product={product} />
              </div>
              <div className="mt-4 hidden md:block">{buy(`${ui.btnPrimary} w-full`)}</div>
            </div>

            {(showShortDesc || product.certifications.length > 0) && (
              <div data-pdp-block="benefits" className={`mt-3 ${phoneBand}`}>
                {showShortDesc && (
                  <p data-testid="pdp-short-desc" className="whitespace-pre-line break-words text-sm text-[var(--color-text-secondary)] md:text-base">
                    {shortDesc}
                  </p>
                )}
                {product.certifications.length > 0 && (
                  <div data-testid="pdp-certs" className={`flex flex-wrap gap-2 ${showShortDesc ? 'mt-3' : ''}`}>
                    {product.certifications.map((c) => (
                      <span
                        key={c}
                        className="flex items-center gap-1 rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-brand)] md:rounded-control md:border md:border-[var(--color-border-subtle)]"
                      >
                        <Check className="h-3.5 w-3.5 text-[var(--color-text-brand)]" aria-hidden="true" />
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
          <div data-testid="pdp-below-cols" className="min-w-0 pb-6 lg:grid lg:grid-flow-row-dense lg:grid-cols-2 lg:items-start lg:gap-x-8">
            <div className={`min-w-0 empty:hidden ${hasDescription ? '' : 'lg:col-span-2'}`}>
              <PdpIngredients ingredients={product.ingredients} />
            </div>
            <div className="min-w-0 empty:hidden lg:col-span-2">
              <PdpStory product={product} />
            </div>
            <div className={`min-w-0 empty:hidden ${hasIngredients ? '' : 'lg:col-span-2'}`}>
              <PdpDescription source={product.description} />
            </div>
          </div>
        }
      />
      <StickyActionBar label={PREVIEW_COPY.banner}>{buy(`${uiBar.primary} w-full`)}</StickyActionBar>
    </PdpSelectionProvider>
  );
}
