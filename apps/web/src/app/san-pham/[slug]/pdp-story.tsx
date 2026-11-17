'use client';

import { useCallback, useMemo } from 'react';
import type { ProductDetail as CoreProductDetail } from '@tubutree/app-core/api/catalog';
import { storyProductWithoutLead } from '@tubutree/app-core/commerce/pdp-info';
import { hasOwnStory, resolveStoryConfig } from '@tubutree/app-core/commerce/product-story';
import { ProductStoryShowcase } from '@/components/mini/product-story-showcase';
import { usePdpSelection } from '@/components/pdp-selection';
import type { ProductDetail } from '@/lib/api';
import { pdpBand } from './pdp-sections';

/**
 * Dải câu chuyện sản phẩm trên trang chi tiết: MỘT bản ở phần dưới trang (sau Thành phần), mọi khổ. Chỉ vẽ khi sản phẩm có câu chuyện riêng đang bật
 * (`hasOwnStory`: đã lưu, hoặc viết tay theo slug); kịch bản tự sinh từ thành phần hay cấp nhãn chỉ lặp lại khối Thành phần nên không vẽ. Khung ảnh của dải không lặp ảnh đầu thư viện
 * ngay phía trên (`storyProductWithoutLead`). Phân loại dùng chung với giá và nút mua qua `PdpSelectionProvider`.
 * Khung toàn màn không mở từ đây: dải đã kể đủ các chương ngay trên trang, nút mua nằm ở khối mua; khung toàn màn chỉ còn cho Reel ở Trang chủ.
 */
export function PdpStory({ product }: { product: ProductDetail }) {
  const selection = usePdpSelection();
  const pick = useCallback(
    (id: string) => {
      if (!selection) return;
      selection.userPicked.current = true;
      selection.setSelectedId(id);
    },
    [selection],
  );
  // Kiểu của web chưa khai `attributes` của phân loại và `storyConfig` (máy chủ vẫn trả); dải câu chuyện không đọc `attributes`, chỉ cần khớp hợp đồng chung với Mini.
  const core = useMemo<CoreProductDetail | null>(() => {
    const full: CoreProductDetail = { ...product, variations: product.variations.map((v) => ({ attributes: {}, ...v })) };
    const config = hasOwnStory(full) ? resolveStoryConfig(full) : null;
    return config ? storyProductWithoutLead(full, config) : null;
  }, [product]);

  if (!core) return null;
  return (
    <section
      data-testid="pdp-story"
      data-section="pdp-story"
      data-pdp-block="story"
      className={`${pdpBand} min-w-0 md:rounded-card md:bg-[var(--color-bg-surface)] md:p-6`}
    >
      <ProductStoryShowcase product={core} selectedVariationId={selection?.selectedId} onSelectVariation={selection ? pick : undefined} />
    </section>
  );
}
