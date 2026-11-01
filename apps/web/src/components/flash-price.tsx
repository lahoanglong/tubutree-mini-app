'use client';

import { cardPricing, runningFlash, variationPricing } from '@/lib/flash-price';
import { usePdpSelection } from './pdp-selection';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { useFlashListExpiry } from '@/lib/use-flash-expiry';
import { formatVnd } from '@/lib/api';
import { Badge } from '@/components/mini/badge';

type PricedProduct = { slug: string; basePrice: number; salePrice?: number | null; repVariationId?: string; pinnedVariationId?: string };

type PdpVariation = { id: string; retailPrice: number; salePrice?: number | null };

/**
 * Giá lớn ở đầu trang chi tiết, theo phân loại đang chọn (cùng số với nút "Thêm vào giỏ"): giá đang bán, giá gốc gạch và nhãn giảm.
 * Chưa chọn phân loại nào thì ghi "Từ" giá thấp nhất. Phân loại đang Giờ vàng: giá deal nằm ở thanh Giờ vàng dưới ảnh (`PdpFlashBar`);
 * ở đây chỉ hiện thêm từ lg (khối `pdp-flash-price`), điện thoại và md không lặp.
 */
export function PdpPrice({ product }: { product: PricedProduct & { variations: PdpVariation[] } }) {
  const flash = runningFlash(useActiveFlashSales());
  useFlashListExpiry(flash);
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
  if (pricing.isFlash) {
    // Máy tính (từ lg): thanh Giờ vàng nằm ở cột ảnh, xa nút mua, nên giá deal cũng nêu ở cột thông tin. Điện thoại và md không lặp:
    // giá đã ở thanh dưới ảnh. Dùng testid riêng để `pdp-price` vẫn nghĩa là "giá lớn thường".
    return (
      <div data-testid="pdp-flash-price" className="mt-2 hidden flex-wrap items-baseline gap-x-2 gap-y-1 lg:flex">
        <span data-testid="pdp-flash-price-value" className="text-2xl font-bold text-[color:var(--color-text-price-deal)]">
          {formatVnd(pricing.price)}
        </span>
        {pricing.hasSale && <span className="text-sm text-stone-500 line-through">{formatVnd(pricing.originalPrice)}</span>}
        {pricing.salePct > 0 && (
          <Badge tone="promo" size="sm">
            -{pricing.salePct}%
          </Badge>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {/* Giá đang giảm màu giá deal (cam đậm, không đỏ) như PriceTag tone="deal" của Mini App; giá thường giữ chữ đen. */}
      <span data-testid="pdp-price" className={`text-2xl font-bold ${pricing.hasSale ? 'text-[color:var(--color-text-price-deal)]' : 'text-stone-900'}`}>
        {formatVnd(pricing.price)}
      </span>
      {pricing.hasSale && <span className="text-sm text-stone-500 line-through">{formatVnd(pricing.originalPrice)}</span>}
      {pricing.hasSale && pricing.salePct > 0 && (
        <span data-testid="pdp-sale-badge">
          <Badge tone="promo" size="sm">
            -{pricing.salePct}%
          </Badge>
        </span>
      )}
    </div>
  );
}
