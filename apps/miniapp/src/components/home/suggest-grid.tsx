import type { CSSProperties, ReactNode } from 'react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { HOME_INTERLEAVE_AFTER } from '@tubutree/app-core/home-layout';
import { ProductCard } from '../ui/product-card';

// Cùng số đo với ProductGrid (lưới 2 cột, khe 12): ProductGrid không có chỗ chen một thẻ trải hết bề ngang và đặt `position` theo chỉ số trong lưới của nó.
const GRID_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-inline-md)', listStyle: 'none', margin: 0, padding: 0 };

export interface SuggestGridProps {
  products: readonly ProductCardData[];
  /** Ghi vào state điều hướng → `product_viewed.listSource` ở PDP, và là `shelf` của `product_card_click`. */
  listSource: string;
  /** Thẻ chen sau `HOME_INTERLEAVE_AFTER` thẻ đầu, trải hết bề ngang lưới. Lưới ngắn hơn mức đó thì không chen. */
  interleave?: ReactNode;
}

/** Lưới Gợi ý của Trang chủ: thẻ biến thể `grid`; `position` đếm liên tục qua thẻ chen (thẻ sau thẻ chen không đếm lại từ 1). */
export function SuggestGrid({ products, listSource, interleave }: SuggestGridProps) {
  const items: ReactNode[] = [];
  products.forEach((p, i) => {
    items.push(
      <li key={`${p.id}:${i}`} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <ProductCard product={p} variant="grid" listSource={listSource} position={i + 1} />
        </div>
      </li>,
    );
    // Cố định theo chỉ số thẻ (không theo tổng số thẻ): trang sau nối vào cuối không làm thẻ chen đổi chỗ hay dựng lại.
    if (interleave && i === HOME_INTERLEAVE_AFTER - 1) {
      items.push(
        <li key="interleave" data-testid="suggest-interleave" style={{ gridColumn: '1 / -1', minWidth: 0 }}>
          {interleave}
        </li>,
      );
    }
  });
  return (
    <ul role="list" data-testid="catalog-grid" style={GRID_STYLE}>
      {items}
    </ul>
  );
}
