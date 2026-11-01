'use client';

import type { ProductCard as CoreProductCard } from '@tubutree/app-core/api/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductGrid } from '@/components/mini/product-grid';
import { pdpSectionTitle } from './pdp-sections';

/** "Có thể bạn cũng thích": lưới cuối trang để xem xong một món vẫn có chỗ đi tiếp. Rỗng thì không dựng khối (không tiêu đề trơ). */
export function PdpFeed({ items }: { items: readonly CoreProductCard[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pdp-feed-title" className="mt-8 max-md:mt-4">
      <h2 id="pdp-feed-title" className={pdpSectionTitle}>
        {fillCopy('pdp.alsoLike')}
      </h2>
      <div className="mt-3">
        <ProductGrid items={items} variant="grid" />
      </div>
    </section>
  );
}
