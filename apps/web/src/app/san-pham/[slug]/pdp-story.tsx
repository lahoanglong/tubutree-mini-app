'use client';

import { useCallback, useMemo } from 'react';
import type { ProductDetail as CoreProductDetail } from '@tubutree/app-core/api/catalog';
import { resolveStoryConfig } from '@tubutree/app-core/commerce/product-story';
import { ProductStoryShowcase } from '@/components/mini/product-story-showcase';
import { usePdpSelection } from '@/components/pdp-selection';
import type { ProductDetail } from '@/lib/api';

/**
 * Dải câu chuyện sản phẩm trên trang chi tiết. Hai bản, mỗi lúc một bản hiện (như hai bộ nút mua): `phone` ở cột thông tin ngay sau khối mua như đặc tả
 * (cột thông tin và phần dưới là hai ô riêng của PdpLayout nên không xen kẽ được bằng `order`), `wide` ở đầu phần dưới từ md. Phân loại dùng chung với giá và nút mua qua `PdpSelectionProvider`.
 * Khung toàn màn không mở từ đây: dải đã kể đủ các chương ngay trên trang, nút mua nằm ở khối mua; khung toàn màn chỉ còn cho Reel ở Trang chủ.
 */
export function PdpStory({ product, placement = 'wide' }: { product: ProductDetail; placement?: 'phone' | 'wide' }) {
  const selection = usePdpSelection();
  const pick = useCallback(
    (id: string) => {
      if (!selection) return;
      selection.userPicked.current = true;
      selection.setSelectedId(id);
    },
    [selection],
  );
  const config = useMemo(() => resolveStoryConfig(product), [product]);
  // Kiểu của web chưa khai `attributes` của phân loại; dải câu chuyện không đọc nó, chỉ cần khớp hợp đồng chung với Mini.
  const core = useMemo<CoreProductDetail>(() => ({ ...product, variations: product.variations.map((v) => ({ attributes: {}, ...v })) }), [product]);

  if (!config) return null;
  return (
    <section data-testid="pdp-story" data-section="pdp-story" className={`min-w-0 bg-[var(--color-bg-surface)] p-4 md:rounded-card md:p-6 ${placement === 'phone' ? 'tubu-pdp-order-7 mt-2 md:hidden' : 'hidden md:block'}`}>
      <ProductStoryShowcase product={core} selectedVariationId={selection?.selectedId} onSelectVariation={selection ? pick : undefined} />
    </section>
  );
}
