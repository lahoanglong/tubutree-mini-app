'use client';

import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import type { ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { boughtTogetherQuery, relatedQuery } from '@tubutree/app-core/queries/catalog';
import { ProductRail } from '@/components/mini/product-rail';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { pdpSectionTitle } from './pdp-sections';

const FIVE_MIN = 5 * 60_000;

function Rail({ title, icon, products, loading }: { title: string; icon?: boolean; products: CoreProductCard[] | undefined; loading: boolean }) {
  if (loading) {
    return (
      <section aria-busy="true" className="mt-8">
        <Skeleton width={160} height={20} />
        <div className="mt-3">
          <ProductRail items={[]} variant="rail-md" label={title} loading skeletonCount={4} />
        </div>
      </section>
    );
  }
  // Dải phụ: lỗi hoặc rỗng thì ẩn hẳn, như Mini App; trang vẫn đủ nội dung chính.
  if (!products || products.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className={`${pdpSectionTitle} flex items-center gap-1.5`}>
        {icon && <ShoppingCart className="h-5 w-5" aria-hidden="true" />}
        {title}
      </h2>
      <div className="mt-3">
        <ProductRail items={products} variant="rail-md" label={title} />
      </div>
    </section>
  );
}

/**
 * "Thường mua kèm" và "Cùng nhà {nhãn}". Danh sách đầu do server dựng sẵn (liên kết nội bộ cho công cụ tìm kiếm); thiếu thì tải ở
 * trình duyệt. Giá Giờ vàng trên thẻ khớp giá thật qua `ProductCard`.
 */
export function PdpRails({
  slug,
  brand,
  initialRelated,
  initialBoughtTogether,
}: {
  slug: string;
  brand: string;
  initialRelated?: CoreProductCard[];
  initialBoughtTogether?: CoreProductCard[];
}) {
  const together = useQuery({ ...boughtTogetherQuery(coreHttp, slug), initialData: initialBoughtTogether, staleTime: FIVE_MIN, retry: 0 });
  const related = useQuery({ ...relatedQuery(coreHttp, slug), initialData: initialRelated, staleTime: FIVE_MIN, retry: 0 });
  return (
    <>
      <Rail title="Thường mua kèm" icon products={together.data} loading={together.isPending} />
      <Rail title={`Cùng nhà ${brand}`} products={related.data} loading={related.isPending} />
    </>
  );
}
