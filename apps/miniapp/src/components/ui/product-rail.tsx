import type { ReactNode } from 'react';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import { ProductCard } from './product-card';
import { ScrollRow } from './scroll-row';
import { ProductTileSkeleton } from './skeleton';

export type RailVariant = Extract<CardVariant, 'rail-sm' | 'rail-md' | 'rank' | 'flash'>;

/** Hai bề rộng kệ duy nhất (token `--tile-w-*`): thẻ 128 cho Giờ vàng, Đã xem, kệ hạng; thẻ 148 cho Bán chạy, Mua lại, Thường mua kèm. */
const WIDTH: Record<RailVariant, string> = {
  'rail-sm': 'var(--tile-w-sm)',
  flash: 'var(--tile-w-sm)',
  rank: 'var(--tile-w-sm)',
  'rail-md': 'var(--tile-w-md)',
};

/**
 * Khung kệ ngang. Đệm của kệ chừa chỗ cho bóng và vòng focus của thẻ (cuộn ngang cắt phần tràn); các ô xếp trong một hàng flex căng
 * đủ chiều cao, nên thẻ cùng kệ thẳng hàng giá dù tên 1 hay 2 dòng.
 */
export function RailShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ScrollRow label={label} style={{ padding: 'var(--rail-pad-block)' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', width: 'max-content', minWidth: '100%' }}>{children}</div>
    </ScrollRow>
  );
}

/** Một ô của kệ: bề rộng theo biến thể, thẻ bên trong giãn đủ chiều cao ô. */
export function RailCell({ variant, children }: { variant: RailVariant; children: ReactNode }) {
  return (
    <div style={{ flex: '0 0 auto', width: WIDTH[variant], display: 'flex' }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export interface ProductRailProps {
  items: readonly ProductCardData[];
  variant: RailVariant;
  rankFrom?: number;
  /** Hạng thật của từng thẻ (cùng chỉ số với `items`), thắng `rankFrom`: kệ đã bỏ món trùng kệ khác thì hạng không liền nhau, không được đánh số lại. */
  ranks?: readonly number[];
  /** Tên vùng cuộn cho trình đọc màn hình. */
  label: string;
  listSource?: string;
  showBrand?: boolean;
  /** Mặc định có tim yêu thích; màn dựng gian hàng truyền false cho khung xem trước (khung inert, chủ chưa phải khách). */
  showWishlist?: boolean;
  /** Đang tải: vẽ `skeletonCount` khung chờ cùng số đo với thẻ thật. */
  loading?: boolean;
  skeletonCount?: number;
  /** Ghi chú trong thẻ (dưới giá); thẻ còn lại của kệ giữ chỗ dòng đó nên giá vẫn thẳng hàng. */
  noteOf?: (product: ProductCardData, index: number) => string | undefined;
  onOpen?: (product: ProductCardData, index: number) => void;
}

export function ProductRail({ items, variant, rankFrom, ranks, label, listSource, showBrand, showWishlist, loading = false, skeletonCount = 6, noteOf, onOpen }: ProductRailProps) {
  const notes = noteOf ? items.map((p, i) => noteOf(p, i)) : null;
  const reserveNote = notes?.some((n) => !!n) ?? false;
  return (
    <RailShell label={label}>
      {loading
        ? Array.from({ length: skeletonCount }, (_, i) => (
            <RailCell key={i} variant={variant}>
              <ProductTileSkeleton variant={variant} brand={showBrand === false ? false : undefined} />
            </RailCell>
          ))
        : items.map((p, i) => (
            <RailCell key={p.id} variant={variant}>
              <ProductCard
                product={p}
                variant={variant}
                rank={ranks?.[i] ?? (rankFrom === undefined ? undefined : rankFrom + i)}
                listSource={listSource}
                showBrand={showBrand}
                showWishlist={showWishlist}
                note={notes?.[i] || (reserveNote ? '' : undefined)}
                onOpen={onOpen ? () => onOpen(p, i) : undefined}
              />
            </RailCell>
          ))}
    </RailShell>
  );
}
