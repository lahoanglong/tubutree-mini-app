'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { suggestedRailQuery } from '@tubutree/app-core/queries/catalog';
import { Heading } from '@/components/mini';
import { EmptyState } from '@/components/mini/empty-state';
import ProductCard from '@/components/product-card';
import { coreHttp } from '@/lib/core-http';
import { GRID_PRODUCTS } from '@/lib/product-grid';

/**
 * Kệ "Có thể bạn thích" dưới giỏ trống (bản web của `suggested-rail.tsx`). Là phần phụ: đang tải, lỗi hay hết hàng thì không vẽ gì,
 * để màn bên trên không nhảy và không thêm khối lỗi thứ hai.
 */
function SuggestedRail() {
  const q = useQuery({ ...suggestedRailQuery(coreHttp), staleTime: 60_000 });
  const items = (q.data?.data ?? []).filter((p) => p.inStock !== false);
  if (items.length === 0) return null;
  return (
    <section aria-label="Có thể bạn thích" className="px-4 max-md:pb-4 md:mx-auto md:max-w-5xl">
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        Có thể bạn thích
      </Heading>
      <div className={GRID_PRODUCTS}>
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}

/** Giỏ trống như Mini App: minh hoạ + lời mời + nút, rồi kệ gợi ý. Tải lười vì chỉ khách giỏ trống mới cần. */
export default function EmptyCart() {
  const router = useRouter();
  return (
    <>
      <EmptyState
        art="basket"
        heading="Giỏ còn trống đấy"
        body="Khám phá sản phẩm Tubu chọn riêng cho bạn"
        ctaLabel="Khám phá ngay"
        onCta={() => router.push('/san-pham')}
      />
      <SuggestedRail />
    </>
  );
}
