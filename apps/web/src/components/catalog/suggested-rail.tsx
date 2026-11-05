'use client';

import { useQuery } from '@tanstack/react-query';
import { suggestedRailQuery } from '@tubutree/app-core/queries/catalog';
import { Heading, ProductGrid } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';

/**
 * Kệ "Có thể bạn thích" dưới màn rỗng hoặc không tìm thấy (giỏ trống, sản phẩm không còn; bản web của `suggested-rail.tsx`). Là phần phụ: đang tải, lỗi hay hết hàng thì không vẽ gì,
 * để màn bên trên không nhảy và không thêm khối lỗi thứ hai.
 */
export function SuggestedRail({ flush = false }: { flush?: boolean } = {}) {
  const q = useQuery({ ...suggestedRailQuery(coreHttp), staleTime: 60_000 });
  const items = (q.data?.data ?? []).filter((p) => p.inStock !== false);
  if (items.length === 0) return null;
  // `flush`: đặt trong khung đã có đệm ngang (cột kết quả của trang Danh mục); không thêm đệm và bề rộng tối đa lần nữa kẻo lùi vào hai lần.
  return (
    <section aria-label="Có thể bạn thích" className={flush ? 'pt-6' : 'px-4 pt-4 max-md:pb-4 md:mx-auto md:max-w-5xl'}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        Có thể bạn thích
      </Heading>
      <ProductGrid items={items} variant="grid" />
    </section>
  );
}
