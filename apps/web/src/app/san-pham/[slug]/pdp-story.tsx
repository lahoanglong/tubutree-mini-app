'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ProductDetail as CoreProductDetail } from '@tubutree/app-core/api/catalog';
import { resolveStoryConfig } from '@tubutree/app-core/commerce/product-story';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductStoryShowcase } from '@/components/mini/product-story-showcase';
import { usePdpSelection } from '@/components/pdp-selection';
import type { ProductDetail } from '@/lib/api';

/**
 * Dải câu chuyện sản phẩm trên trang chi tiết. Hai bản, mỗi lúc một bản hiện (như hai bộ nút mua): `phone` ở cột thông tin ngay sau khối mua như đặc tả
 * (cột thông tin và phần dưới là hai ô riêng của PdpLayout nên không xen kẽ được bằng `order`), `wide` ở đầu phần dưới từ md. Phân loại dùng chung với giá và nút mua qua `PdpSelectionProvider`.
 * Thêm giỏ và Mua ngay ở khung toàn màn bấm lại đúng nút của khối mua (đóng khung trước), nên đăng nhập, bảng phân loại,
 * tồn kho và giá Giờ vàng giữ nguyên một đường xử lý.
 */
export function PdpStory({ product, placement = 'wide' }: { product: ProductDetail; placement?: 'phone' | 'wide' }) {
  const selection = usePdpSelection();
  const [open, setOpen] = useState(false);
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

  // Khối mua có hai bộ nút (thanh dính ở điện thoại, nút nội tuyến từ md), mỗi lúc chỉ một bộ hiện: bấm bộ đang hiện.
  const trigger = useCallback((selector: string) => {
    setOpen(false);
    window.setTimeout(() => {
      const all = Array.from(document.querySelectorAll<HTMLButtonElement>(selector));
      (all.find((b) => b.getClientRects().length > 0) ?? all[0])?.click();
    }, 0);
  }, []);

  if (!config) return null;
  return (
    <section data-testid="pdp-story" data-section="pdp-story" className={`min-w-0 bg-[var(--color-bg-surface)] p-4 md:rounded-card md:p-6 ${placement === 'phone' ? 'tubu-pdp-order-7 mt-2 md:hidden' : 'hidden md:block'}`}>
      <ProductStoryShowcase
        product={core}
        selectedVariationId={selection?.selectedId}
        onSelectVariation={selection ? pick : undefined}
      />
      <button
        type="button"
        data-testid="pdp-story-open"
        onClick={() => setOpen(true)}
        className="mt-4 flex min-h-11 w-full items-center justify-center rounded-control bg-[var(--color-action-secondary-bg)] px-4 font-semibold text-[var(--color-action-secondary-fg)] md:mx-auto md:w-fit"
      >
        {fillCopy('story.open')}
      </button>
      {open && (
        <ProductStoryShowcase
          product={core}
          fullscreen
          selectedVariationId={selection?.selectedId}
          onSelectVariation={selection ? pick : undefined}
          buyDisabled={selection?.buyable === false}
          onClose={() => setOpen(false)}
          onAddToCart={() => trigger('[data-testid="pdp-add-to-cart"]')}
          onBuyNow={() => trigger('[data-testid="buy-now"], [data-testid="pdp-buy-now"]')}
        />
      )}
    </section>
  );
}
