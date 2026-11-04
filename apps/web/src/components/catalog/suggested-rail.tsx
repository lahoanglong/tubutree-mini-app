'use client';

import { useQuery } from '@tanstack/react-query';
import { suggestedRailQuery } from '@tubutree/app-core/queries/catalog';
import { Heading, ProductGrid } from '@/components/mini';
import { coreHttp } from '@/lib/core-http';

/**
 * Kệ "Có thể bạn thích" dưới màn rỗng hoặc không tìm thấy (giỏ trống, sản phẩm không còn; bản web của `suggested-rail.tsx`). Là phần phụ: đang tải, lỗi hay hết hàng thì không vẽ gì,
 * để màn bên trên không nhảy và không thêm khối lỗi thứ hai.
 */
export function SuggestedRail() {
  const q = useQuery({ ...suggestedRailQuery(coreHttp), staleTime: 60_000 });
  const items = (q.data?.data ?? []).filter((p) => p.inStock !== false);
  if (items.length === 0) return null;
  return (
    <section aria-label="Có thể bạn thích" className="px-4 pt-4 max-md:pb-4 md:mx-auto md:max-w-5xl">
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        Có thể bạn thích
      </Heading>
      <ProductGrid items={items} variant="grid" />
    </section>
  );
}
