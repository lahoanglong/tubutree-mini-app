import { useQuery } from '@tanstack/react-query';
import { fetchProducts } from '../../services/shop-api';
import { vi } from '../../i18n/vi';
import { Heading } from '../ui/text';
import { CatalogGrid } from './catalog-grid';

const SUGGESTED_LIMIT = 4;

/**
 * Kệ "Có thể bạn thích" dưới màn rỗng hoặc không tìm thấy (giỏ trống, SP/gian hàng không còn): khách từ link sàn hoặc
 * CTV vào đúng ngõ cụt thì vẫn có chỗ đi tiếp. Là phần phụ — đang tải, lỗi hay hết hàng thì không vẽ gì, để màn bên trên
 * không nhảy và không thêm một khối lỗi thứ hai.
 */
export function SuggestedRail({ listSource }: { listSource: string }) {
  const q = useQuery({
    queryKey: ['products', 'suggested-rail'],
    queryFn: () => fetchProducts({ limit: SUGGESTED_LIMIT, sort: 'best_seller' }),
    staleTime: 60_000,
  });
  const items = (q.data?.data ?? []).filter((p) => p.inStock !== false);
  if (items.length === 0) return null;
  return (
    <section aria-label={vi.suggested.title} style={{ padding: '16px 16px 0' }}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        {vi.suggested.title}
      </Heading>
      <CatalogGrid products={items} listSource={listSource} />
    </section>
  );
}
