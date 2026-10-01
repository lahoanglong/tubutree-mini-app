import { useEffect, useRef } from 'react';
import type { ProductDetail } from '../services/shop-api';
import { recordRecentlyViewed } from '../utils/recently-viewed';

type Recordable = Pick<ProductDetail, 'slug' | 'name' | 'thumbnail' | 'images' | 'basePrice' | 'salePrice'>;

/** Ghi "Đã xem gần đây" MỘT lần cho mỗi slug khi PDP tải thành công (spec 5b.4). */
export function useRecordRecentlyViewed(product: Recordable | undefined): void {
  const recordedSlug = useRef<string | null>(null);
  useEffect(() => {
    if (!product || recordedSlug.current === product.slug) return;
    recordedSlug.current = product.slug;
    recordRecentlyViewed({
      slug: product.slug,
      name: product.name,
      // `?? null` chốt cuối: helper lưu loại bỏ mục có thumbnail undefined (isItem chỉ nhận string|null).
      thumbnail: product.thumbnail ?? product.images?.[0] ?? null,
      price: product.salePrice ?? product.basePrice,
    });
  }, [product]);
}
