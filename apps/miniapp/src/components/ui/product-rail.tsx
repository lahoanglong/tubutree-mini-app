import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { ProductCard } from './product-card';
import { ScrollRow } from './scroll-row';

export interface ProductRailProps {
  items: readonly ProductCardData[];
  variant: Extract<CardVariant, 'rail-sm' | 'rail-md' | 'rank' | 'flash'>;
  rankFrom?: number;
  /** Tên vùng cuộn cho trình đọc màn hình. */
  label: string;
  listSource?: string;
  showBrand?: boolean;
  onOpen?: (product: ProductCardData, index: number) => void;
}

/** Hai bề rộng kệ duy nhất (token `--tile-w-*`): thẻ 128 cho Giờ vàng, Đã xem, kệ hạng; thẻ 148 cho Bán chạy, Mua lại, Thường mua kèm. */
const WIDTH: Record<ProductRailProps['variant'], string> = {
  'rail-sm': 'var(--tile-w-sm)',
  flash: 'var(--tile-w-sm)',
  rank: 'var(--tile-w-sm)',
  'rail-md': 'var(--tile-w-md)',
};

/**
 * Kệ ngang. Đệm của kệ chừa chỗ cho bóng và vòng focus của thẻ (cuộn ngang cắt phần tràn); mỗi ô kệ là một hộp flex để thẻ giãn
 * đủ chiều cao ô, nên thẻ cùng kệ thẳng hàng giá dù tên 1 hay 2 dòng.
 */
export function ProductRail({ items, variant, rankFrom, label, listSource, showBrand, onOpen }: ProductRailProps) {
  return (
    <ScrollRow label={label} style={{ padding: 'var(--rail-pad-block)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', width: 'max-content', minWidth: '100%' }}>
        {items.map((p, i) => (
          <div key={p.id} style={{ flex: '0 0 auto', width: WIDTH[variant], display: 'flex' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <ProductCard
                product={p}
                variant={variant}
                rank={rankFrom === undefined ? undefined : rankFrom + i}
                listSource={listSource}
                showBrand={showBrand}
                onOpen={onOpen ? () => onOpen(p, i) : undefined}
              />
            </div>
          </div>
        ))}
      </div>
    </ScrollRow>
  );
}
