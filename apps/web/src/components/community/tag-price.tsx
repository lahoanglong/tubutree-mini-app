'use client';

import { cardPricing } from '@/lib/flash-price';
import { formatVnd } from '@/lib/format-vnd';
import { useActiveFlashSales } from '@/lib/use-flash-sales';

/** Giá của sản phẩm gắn trong bài: giá khách trả trên thẻ sản phẩm (gồm Giờ vàng), cùng quy tắc với gợi ý tìm. */
export function TagPrice({ product, className }: { product: { slug: string; basePrice: number; salePrice?: number | null }; className: string }) {
  const pricing = cardPricing(product, useActiveFlashSales());
  return <span className={className}>{formatVnd(pricing.price)}</span>;
}
