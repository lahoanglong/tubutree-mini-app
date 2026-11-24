import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../../services/shop-api';
import { viSuggested } from '../../i18n/vi-catalog';
import { Heading } from '../ui/text';
import { CatalogGrid } from './catalog-grid';

const SUGGESTED_LIMIT = 4;

/**
 * Kệ "Có thể bạn thích" dưới màn rỗng hoặc không tìm thấy (giỏ trống, SP/gian hàng không còn): khách từ link sàn hoặc
 * CTV vào đúng ngõ cụt thì vẫn có chỗ đi tiếp. Là phần phụ — đang tải, lỗi hay hết hàng thì không vẽ gì, để màn bên trên
 * không nhảy và không thêm một khối lỗi thứ hai.
 */
export function SuggestedRail({ listSource, title = viSuggested.title, limit = SUGGESTED_LIMIT }: { listSource: string; title?: string; limit?: number }) {
  const q = useQuery({
    queryKey: ['products', 'suggested-rail', limit],
    queryFn: () => fetchProducts({ limit, sort: 'best_seller' }),
    staleTime: 60_000,
  });
  const items = (q.data?.data ?? []).filter((p) => p.inStock !== false);
  if (items.length === 0) return null;
  return (
    <section aria-label={title} style={{ padding: '16px 16px 0' }}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        {title}
      </Heading>
      <CatalogGrid products={items} listSource={listSource} />
    </section>
  );
}
