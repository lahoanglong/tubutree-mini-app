'use client';

import { useQuery } from '@tanstack/react-query';
import { recentlyViewedQuery } from '@tubutree/app-core/queries/catalog';
import { browseText } from '@/lib/browse-text';
import { coreHttp } from '@/lib/core-http';
import { useRecentlyViewed } from '@/lib/use-recently-viewed';
import { ProductCard } from '@/components/mini/product-card';
import { RailCell, RailShell } from '@/components/mini/product-rail';

/**
 * "Đã xem gần đây": thẻ `rail-sm` của bộ thẻ chung. Dữ liệu lưu ở máy chỉ có slug, tên, ảnh (không có đánh giá hay id), nên thẻ dựng từ
 * chúng với `id = slug`: không đủ dữ kiện cho nhãn "Mới" hay "Tubu chọn" (thẻ `rail-sm` không có nhãn đầu tên) và không có tim. Tên và ảnh
 * đọc từ localStorage nên thẻ hiện ngay. GIÁ không lưu (giá đổi theo Giờ vàng/khuyến mãi): hỏi giá hiện hành theo slug và để `ProductCard`
 * tính Giờ vàng như thẻ ở lưới, nên hai nơi trên một trang không lệch giá. Chưa có giá (đang tải, lỗi mạng, API cũ) thì thẻ không in giá
 * (`hidePrice`); sản phẩm đã ẩn hoặc chưa duyệt thì thẻ biến mất.
 */
export function RecentlyViewedRail({ title = browseText.recentlyViewed }: { title?: string }) {
  const stored = useRecentlyViewed();
  const slugs = stored.map((it) => it.slug);
  const live = useQuery({ ...recentlyViewedQuery(coreHttp, slugs), enabled: slugs.length > 0, staleTime: 30_000 });
  const bySlug = new Map((live.data ?? []).map((p) => [p.slug, p]));
  const items = live.isSuccess ? stored.filter((it) => bySlug.has(it.slug)) : stored;
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="py-2">
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900">{title}</h2>
      <RailShell label={title}>
        {items.map((it) => {
          const product = bySlug.get(it.slug);
          return (
            <RailCell key={it.slug} variant="rail-sm">
              <ProductCard
                // Tên và ảnh luôn là của lần xem; chỉ giá và còn hàng lấy từ dữ liệu hiện hành.
                product={{
                  id: it.slug,
                  brand: '',
                  basePrice: 0,
                  salePrice: null,
                  isFeatured: false,
                  inStock: true,
                  ...product,
                  slug: it.slug,
                  name: it.name,
                  thumbnail: it.thumbnail ?? product?.thumbnail ?? null,
                }}
                variant="rail-sm"
                hidePrice={!product}
              />
            </RailCell>
          );
        })}
      </RailShell>
    </section>
  );
}
