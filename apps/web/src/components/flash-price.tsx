'use client';

import { Zap } from 'lucide-react';
import { cardPricing, runningFlash, variationPricing } from '@/lib/flash-price';
import { usePdpSelection } from './pdp-selection';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { formatVnd } from '@/lib/api';

type PricedProduct = { slug: string; basePrice: number; salePrice?: number | null; repVariationId?: string; pinnedVariationId?: string };

type PdpVariation = { id: string; retailPrice: number; salePrice?: number | null };

/**
 * Giá lớn ở đầu trang chi tiết, theo phân loại đang chọn (cùng số với nút "Thêm vào giỏ"): giá đang bán + Giờ vàng của phân loại đó,
 * giá gốc gạch và nhãn giảm. Chưa chọn phân loại nào thì ghi "Từ" giá thấp nhất.
 */
export function PdpPrice({ product }: { product: PricedProduct & { variations: PdpVariation[] } }) {
  const flash = runningFlash(useActiveFlashSales());
  const selectedId = usePdpSelection()?.selectedId;
  const selected = product.variations.find((v) => v.id === selectedId);
  if (!selected) {
    const pricing = cardPricing(product, flash);
    return (
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span data-testid="pdp-price" className="text-2xl font-bold text-stone-900">
          {product.variations.length > 1 ? `Từ ${formatVnd(pricing.price)}` : formatVnd(pricing.price)}
        </span>
      </div>
    );
  }
  const pricing = variationPricing(selected, flash);
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span data-testid="pdp-price" className="text-2xl font-bold text-stone-900">
        {formatVnd(pricing.price)}
      </span>
      {pricing.hasSale && <span className="text-sm text-stone-500 line-through">{formatVnd(pricing.originalPrice)}</span>}
      {pricing.isFlash ? (
        <span
          data-testid="pdp-flash-badge"
          className="inline-flex items-center gap-0.5 rounded-full bg-promo-solid px-2 py-0.5 text-xs font-bold text-stone-900"
        >
          <Zap className="h-3 w-3" aria-hidden="true" />
          Giờ vàng -{pricing.salePct}%
        </span>
      ) : (
        pricing.hasSale &&
        pricing.salePct > 0 && (
          <span data-testid="pdp-sale-badge" className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-bold text-danger-fg max-md:hidden">
            -{pricing.salePct}%
          </span>
        )
      )}
    </div>
  );
}
