'use client';

import { ShoppingCart } from 'lucide-react';
import type { ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductGrid } from '@/components/mini/product-grid';
import { ProductRail } from '@/components/mini/product-rail';
import { Skeleton } from '@/components/ui/skeleton';
import { pdpSectionTitle } from './pdp-sections';

/** Khoảng cách phía trên của mỗi dải gợi ý cuối trang. */
const RAIL_GAP = 'mt-8 max-md:mt-4';

/**
 * Một dải thẻ ngang có tiêu đề (dải thương hiệu ở cuối trang, dải "Khách thường mua cùng" ở khối mua kèm). `label` là tên đọc của dải khi khác tiêu đề
 * nhìn thấy (dải thương hiệu: tiêu đề bỏ tên, nhãn đọc giữ tên). `flush`: dải nằm trong một dải trắng đã có đệm, nên không tự đặt khoảng cách phía trên.
 */
export function Rail({ title, label = title, icon, products, loading, shelf, flush = false }: { title: string; label?: string; icon?: boolean; products: CoreProductCard[] | undefined; loading: boolean; shelf: string; flush?: boolean }) {
  const gap = flush ? undefined : RAIL_GAP;
  if (loading) {
    return (
      <section aria-busy="true" className={gap}>
        <Skeleton width={160} height={20} />
        <div className="mt-3">
          <ProductRail items={[]} variant="rail-md" label={label} loading skeletonCount={4} />
        </div>
      </section>
    );
  }
  // Dải phụ: lỗi hoặc rỗng thì ẩn hẳn, như Mini App; trang vẫn đủ nội dung chính.
  if (!products || products.length === 0) return null;
  return (
    <section className={gap}>
      <h2 className={`${pdpSectionTitle} flex items-center gap-1.5`}>
        {icon && <ShoppingCart className="h-5 w-5" aria-hidden="true" />}
        {title}
      </h2>
      <div className="mt-3">
        <ProductRail items={products} variant="rail-md" label={label} shelf={shelf} />
      </div>
    </section>
  );
}

/** "Có thể bạn cũng thích": lưới cuối trang để xem xong một món vẫn có chỗ đi tiếp. Rỗng thì không dựng khối (không tiêu đề trơ). */
export function PdpFeed({ items }: { items: readonly CoreProductCard[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pdp-feed-title" className={RAIL_GAP}>
      <h2 id="pdp-feed-title" className={pdpSectionTitle}>
        {fillCopy('pdp.alsoLike')}
      </h2>
      <div className="mt-3">
        <ProductGrid items={items} variant="grid" shelf="pdpFeed" />
      </div>
    </section>
  );
}
