import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRecentlyViewed } from '../../hooks/use-recently-viewed';
import { pruneRecentlyViewed } from '../../utils/recently-viewed';
import { fetchProductsBySlugs } from '../../services/shop-api';
import { shelf } from '@tubutree/app-core/merch/shelves';
import { vi } from '../../i18n/vi';
import { ProductCard } from '../ui/product-card';
import { RailCell, RailShell } from '../ui/product-rail';
import { Section } from '../ui/section';
import { SectionHeader } from '../ui/section-header';

/**
 * "Đã xem gần đây" (spec 5b.4): thẻ `rail-sm` của bộ thẻ chung. Dữ liệu lưu ở máy chỉ có slug, tên, ảnh (không có đánh giá hay id), nên
 * thẻ dựng từ chúng với `id = slug`: không đủ dữ kiện cho nhãn "Mới" hay "Tubu chọn" (thẻ `rail-sm` không có nhãn đầu tên) và không có tim.
 * Tên + ảnh đọc đồng bộ từ localStorage nên thẻ hiện ngay và không nhảy bố cục khi mount. GIÁ thì KHÔNG lưu (R4-BUYER-5): hỏi giá hiện
 * hành theo slug và để `ProductCard` tính Giờ vàng như thẻ ở lưới, nên hai nơi cùng màn hình không bao giờ lệch giá. Chưa có giá (đang tải,
 * lỗi mạng, API cũ) thì thẻ không in giá (`hidePrice`) thay vì in giá cũ; sản phẩm đã ẩn/chưa duyệt thì thẻ biến mất.
 * Kho lưu giữ 20 món nhưng dải chỉ hiện `shelf('browse.recent').maxItems` món mới xem nhất, tính sau khi bỏ món đã gỡ.
 */
export function RecentlyViewedRail({ title = vi.browse.recentlyViewed }: { title?: string }) {
  const stored = useRecentlyViewed();
  const slugs = stored.map((it) => it.slug);
  const productsQ = useQuery({
    queryKey: ['recently-viewed-products', slugs.join(',')],
    queryFn: () => fetchProductsBySlugs(slugs),
    enabled: slugs.length > 0,
    staleTime: 30_000,
  });
  const live = new Map((productsQ.data ?? []).map((p) => [p.slug, p]));
  // API đã trả lời: mục không còn (ẩn/gỡ) bị xoá khỏi máy, để kho không giữ mục chết.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!productsQ.isSuccess) return;
    const keep = new Set((productsQ.data ?? []).map((p) => p.slug));
    const nextSlugs = slugs.filter((s) => keep.has(s));
    // Khoá truy vấn đổi theo danh sách slug sau khi xoá: nạp sẵn dữ liệu cho khoá mới để thẻ không chớp (mất giá, ảnh cũ) và không gọi thừa.
    if (nextSlugs.length > 0 && nextSlugs.length !== slugs.length) {
      queryClient.setQueryData(['recently-viewed-products', nextSlugs.join(',')], (productsQ.data ?? []).filter((p) => keep.has(p.slug)));
    }
    pruneRecentlyViewed(keep, new Set(slugs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productsQ.isSuccess, productsQ.data]);
  const items = (productsQ.isSuccess ? stored.filter((it) => live.has(it.slug)) : stored).slice(0, shelf('browse.recent').maxItems);
  if (items.length === 0) return null;
  return (
    <Section id="browse-recent">
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} />
      </div>
      <RailShell label={title}>
        {items.map((it) => {
          const product = live.get(it.slug);
          return (
            <RailCell key={it.slug} variant="rail-sm">
              <ProductCard
                // Tên là của lần xem; ảnh, giá và còn hàng lấy từ dữ liệu hiện hành (URL ảnh lưu ở máy chỉ là dự phòng khi chưa có dữ liệu hiện hành).
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
                  // Ảnh hiện hành thắng: URL lưu ở máy có thể là ảnh cũ đã bị thay và không còn trong danh sách của /img.
                  thumbnail: product?.thumbnail ?? it.thumbnail ?? null,
                }}
                variant="rail-sm"
                listSource="recently_viewed"
                hidePrice={!product}
              />
            </RailCell>
          );
        })}
      </RailShell>
    </Section>
  );
}
