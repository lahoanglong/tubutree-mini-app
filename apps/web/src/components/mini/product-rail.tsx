'use client';

// Nguồn: apps/miniapp/src/components/ui/product-rail.tsx
import type { ReactNode } from 'react';
import type { CardVariant } from '@tubutree/app-core/commerce/product-card-view';
import type { ProductCard as ProductCardType } from '@/lib/api';
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
 * đủ chiều cao, nên thẻ cùng kệ thẳng hàng giá dù tên 1 hay 2 dòng. `arrows`: nút ‹ › từ md cho chuột. `bleed`: kệ tràn ra sát mép màn
 * hình bù lề 16px của trang (trang web có lề, Mini App thì kệ tự đã sát mép).
 */
export function RailShell({ label, arrows = true, bleed = true, children }: { label: string; arrows?: boolean; bleed?: boolean; children: ReactNode }) {
  return (
    <ScrollRow label={label} arrows={arrows} style={{ padding: 'var(--rail-pad-block)', ...(bleed ? { margin: '0 -16px', maxWidth: 'none' } : null) }}>
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
  items: readonly ProductCardType[];
  variant: RailVariant;
  rankFrom?: number;
  /** Tên vùng cuộn cho trình đọc màn hình. */
  label: string;
  showBrand?: boolean;
  /** Đang tải: vẽ `skeletonCount` khung chờ cùng số đo với thẻ thật. */
  loading?: boolean;
  skeletonCount?: number;
  /** Số thẻ đầu tải ảnh ngay (kệ ở màn hình đầu); mặc định 0. */
  priorityCount?: number;
  onOpen?: (product: ProductCardType, index: number) => void;
}

export function ProductRail({ items, variant, rankFrom, label, showBrand, loading = false, skeletonCount = 6, priorityCount = 0, onOpen }: ProductRailProps) {
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
                rank={rankFrom === undefined ? undefined : rankFrom + i}
                showBrand={showBrand}
                priority={i < priorityCount}
                onOpen={onOpen ? () => onOpen(p, i) : undefined}
              />
            </RailCell>
          ))}
    </RailShell>
  );
}
