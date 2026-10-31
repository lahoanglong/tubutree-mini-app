import { useQuery } from '@tanstack/react-query';
import { useRecentlyViewed } from '../../hooks/use-recently-viewed';
import { fetchProductsBySlugs } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { ProductCard } from '../ui/product-card';
import { RailCell, RailShell } from '../ui/product-rail';
import { Heading } from '../ui/text';

/**
 * "Đã xem gần đây" (spec 5b.4): thẻ `rail-sm` của bộ thẻ chung. Dữ liệu lưu ở máy chỉ có slug, tên, ảnh (không có đánh giá hay id), nên
 * thẻ dựng từ chúng với `id = slug`: không đủ dữ kiện cho nhãn "Mới" hay "Tubu chọn" (thẻ `rail-sm` không có nhãn đầu tên) và không có tim.
 * Tên + ảnh đọc đồng bộ từ localStorage nên thẻ hiện ngay và không nhảy bố cục khi mount. GIÁ thì KHÔNG lưu (R4-BUYER-5): hỏi giá hiện
 * hành theo slug và để `ProductCard` tính Giờ vàng như thẻ ở lưới, nên hai nơi cùng màn hình không bao giờ lệch giá. Chưa có giá (đang tải,
 * lỗi mạng, API cũ) thì thẻ không in giá (`hidePrice`) thay vì in giá cũ; sản phẩm đã ẩn/chưa duyệt thì thẻ biến mất.
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
  const items = productsQ.isSuccess ? stored.filter((it) => live.has(it.slug)) : stored;
  if (items.length === 0) return null;
  return (
    <div style={{ padding: '8px 0 4px' }}>
      <div style={{ padding: '0 16px 8px' }}>
        <Heading variant="title-sm" as="h2">
          {title}
        </Heading>
      </div>
      <RailShell label={title}>
        {items.map((it) => {
          const product = live.get(it.slug);
          return (
            <RailCell key={it.slug} variant="rail-sm">
              <ProductCard
                // Tên và ảnh luôn là của lần xem (như trước đây); chỉ giá và còn hàng lấy từ dữ liệu hiện hành.
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
                listSource="recently_viewed"
                hidePrice={!product}
              />
            </RailCell>
          );
        })}
      </RailShell>
    </div>
  );
}
