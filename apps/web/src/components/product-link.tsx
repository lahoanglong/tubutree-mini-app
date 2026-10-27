'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { cardPricing } from '@/lib/flash-price';
import { productHref } from '@/lib/product-href';
import { useActiveFlashSales } from '@/lib/use-flash-sales';

/** Liên kết của thẻ sản phẩm: thẻ đang ghi giá Giờ vàng thì trang chi tiết mở đúng phân loại đó (`?v=`), như Mini App truyền `state.variationId`. */
export function ProductLink({
  product,
  className,
  children,
}: {
  product: { slug: string; basePrice: number; salePrice?: number | null };
  className?: string;
  children: ReactNode;
}) {
  const pricing = cardPricing(product, useActiveFlashSales());
  return (
    <Link href={productHref(product.slug, pricing.flashVariationId)} className={className}>
      {children}
    </Link>
  );
}
