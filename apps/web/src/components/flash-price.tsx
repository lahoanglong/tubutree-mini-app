'use client';

import { Zap } from 'lucide-react';
import { cardPricing } from '@/lib/flash-price';
import { useActiveFlashSales } from '@/lib/use-flash-sales';
import { formatVnd } from '@/lib/api';

type PricedProduct = { slug: string; basePrice: number; salePrice?: number | null };

/** Nhãn "-34%" trên ảnh thẻ sản phẩm; giá Giờ vàng thì ghi rõ "Giờ vàng". Không có giảm giá thì không vẽ gì. */
export function CardSaleBadge({ product, className }: { product: PricedProduct; className: string }) {
  const pricing = cardPricing(product, useActiveFlashSales());
  if (!pricing.hasSale || pricing.salePct <= 0) return null;
  return (
    <div className={className} data-flash={pricing.isFlash ? 'true' : undefined}>
      {pricing.isFlash ? (
        <span className="inline-flex items-center gap-0.5">
          <Zap className="h-3 w-3" aria-hidden="true" />
          Giờ vàng -{pricing.salePct}%
        </span>
      ) : (
        <>-{pricing.salePct}%</>
      )}
    </div>
  );
}

/** Giá thẻ sản phẩm: giá khách thật sự trả (gồm Giờ vàng) và giá gốc gạch, khớp giá trong giỏ và đơn. */
export function ProductPriceRow({
  product,
  className,
  priceClassName,
  originalClassName,
}: {
  product: PricedProduct;
  className: string;
  priceClassName: string;
  originalClassName: string;
}) {
  const pricing = cardPricing(product, useActiveFlashSales());
  return (
    <div className={className}>
      <span className={priceClassName}>{formatVnd(pricing.price)}</span>
      {pricing.hasSale && <span className={originalClassName}>{formatVnd(pricing.originalPrice)}</span>}
    </div>
  );
}

/** Giá lớn ở đầu trang chi tiết. Giá thường như cũ; có đợt Giờ vàng thì thêm giá gốc gạch và nhãn "Giờ vàng -34%". */
export function PdpPrice({ product }: { product: PricedProduct }) {
  const pricing = cardPricing(product, useActiveFlashSales());
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span data-testid="pdp-price" className="text-2xl font-bold text-stone-900">
        {formatVnd(pricing.price)}
      </span>
      {pricing.isFlash && (
        <>
          <span className="text-sm text-stone-500 line-through">{formatVnd(pricing.originalPrice)}</span>
          <span
            data-testid="pdp-flash-badge"
            className="inline-flex items-center gap-0.5 rounded-full bg-promo-solid px-2 py-0.5 text-xs font-bold text-stone-0"
          >
            <Zap className="h-3 w-3" aria-hidden="true" />
            Giờ vàng -{pricing.salePct}%
          </span>
        </>
      )}
    </div>
  );
}
