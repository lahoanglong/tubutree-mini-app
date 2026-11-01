'use client';

import { cardPricing, runningFlash, variationPricing, type VariationPricing } from '@/lib/flash-price';
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
  return <PriceRow pricing={pricing} flash={pricing.isFlash} />;
}

/**
 * Một dòng giá cho cả hai trường hợp: giá thường/giảm (`pdp-price`) và giá Giờ vàng (`pdp-flash-price`). Giờ vàng ở máy tính (từ lg): thanh Giờ vàng
 * nằm ở cột ảnh, xa nút mua, nên cột thông tin cũng nêu giá deal; điện thoại và md không lặp vì giá đã ở thanh dưới ảnh. Testid riêng để
 * `pdp-price` vẫn nghĩa là "giá lớn thường".
 */
function PriceRow({ pricing, flash }: { pricing: VariationPricing; flash: boolean }) {
  const deal = flash || pricing.hasSale;
  return (
    <div data-testid={flash ? 'pdp-flash-price' : undefined} className={`mt-2 flex-wrap items-baseline gap-x-2 gap-y-1 ${flash ? 'hidden lg:flex' : 'flex'}`}>
      {/* Giá đang giảm màu giá deal (cam đậm, không đỏ) như PriceTag tone="deal" của Mini App; giá thường giữ chữ đen. */}
      <span data-testid={flash ? 'pdp-flash-price-value' : 'pdp-price'} className={`text-2xl font-bold ${deal ? 'text-[color:var(--color-text-price-deal)]' : 'text-stone-900'}`}>
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
