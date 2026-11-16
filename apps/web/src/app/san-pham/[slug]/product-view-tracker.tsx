'use client';

import { useEffect, useRef } from 'react';
import { trackPurchase } from '@/lib/analytics';

/**
 * `product_viewed` một lần cho mỗi slug khi trang sản phẩm gắn vào trình duyệt. Các trường do trang server tính từ bản ISR nên đổi phân loại
 * hay tải lại tồn kho không phát lại. Không vẽ gì.
 */
export function ProductViewTracker({ slug, hasVideo, imageCount, inStock }: { slug: string; hasVideo: boolean; imageCount: number; inStock: boolean }) {
  const sent = useRef<string | null>(null);
  useEffect(() => {
    if (sent.current === slug) return;
    sent.current = slug;
    trackPurchase('product_viewed', { productSlug: slug, hasVideo, imageCount: Math.min(100, Math.max(0, Math.floor(imageCount))), inStock });
  }, [slug, hasVideo, imageCount, inStock]);
  return null;
}
