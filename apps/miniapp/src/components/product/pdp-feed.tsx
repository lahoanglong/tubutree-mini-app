import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { ProductGrid } from '../ui/product-grid';
import { SectionHeader } from '../ui/section-header';

/** "Có thể bạn cũng thích": lưới cuối trang để xem xong một món vẫn có chỗ đi tiếp. Rỗng thì không dựng khối (không tiêu đề trơ). */
export function PdpFeed({ items }: { items: readonly ProductCardData[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="pdp-feed-title" style={{ padding: '8px 16px 16px' }}>
      <SectionHeader id="pdp-feed-title" title={fillCopy('pdp.alsoLike')} />
      <ProductGrid items={items} variant="grid" listSource="pdp_feed" />
    </section>
  );
}
