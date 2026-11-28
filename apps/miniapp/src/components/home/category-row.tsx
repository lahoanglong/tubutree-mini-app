import { memo, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { LayoutGrid } from 'lucide-react';
import type { CategoryEntry } from '../../hooks/use-categories';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { brandJumpHref, brandShowcase, hasBrandChoice } from '@tubutree/app-core/merch/brand-showcase';
import { BRAND_BAR_HEIGHT, CATEGORY_GRID_MAX_CELLS, CATEGORY_LABEL_HEIGHT, CATEGORY_TILE_SIZE, categorySkeletonCells, homeCategoryEntries, SHORTCUT_TINT_VARS, type ShortcutTint } from '@tubutree/app-core/home-layout';
import { fetchBrands } from '../../services/shop-api';
import { haptic } from '../../utils/haptic';
import { Chip } from '../ui/chip';
import { Icon } from '../ui/icon';
import { ScrollRow } from '../ui/scroll-row';
import { SectionHeader } from '../ui/section-header';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';

const TILE = CATEGORY_TILE_SIZE;
const LABEL_HEIGHT = CATEGORY_LABEL_HEIGHT;
const MAX_CELLS = CATEGORY_GRID_MAX_CELLS;
const TINTS: ShortcutTint[] = ['forest', 'sage', 'clay', 'amber', 'sky', 'rose'];
/** Bề ngang khung chờ của chip thương hiệu (tên nhãn dài ngắn khác nhau). */
const BRAND_SKELETON_WIDTHS = [76, 92, 68, 84, 72];
const BRAND_ROW = { display: 'flex', gap: 'var(--space-inline-sm)', padding: 'var(--space-stack-xs) var(--space-inset-page)' } as const;

export interface CategoryRowProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  /** Có thì ô cuối lưới là "Tất cả" dẫn vào Danh mục. */
  onSeeAll?: () => void;
  /** Số danh mục của lần tải trước; khung chờ vẽ số ô này cộng ô "Tất cả" (tối đa một hàng) để bằng chiều cao lưới thật. */
  placeholderCount?: number;
}

const cellStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  minHeight: 44,
  minWidth: 0,
  padding: 0,
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

/**
 * Nhãn nhỏ 12px/600 (token `label`; 13px của `caption` làm "Mỹ phẩm thiên nhiên" và "Nông sản & Thực phẩm" cần ba dòng nên bị "…" ở dòng hai). Tối đa hai dòng, ngắt ở dấu cách,
 * vùng nhãn cao cố định để mọi ô thẳng hàng. `overflowWrap: anywhere` chỉ cứu từ đơn dài hơn cả cột (chữ nước ngoài): cắt bằng overflow thì mất chữ cuối mà không có "…".
 */
function Label({ children }: { children: string }) {
  return (
    <Text
      variant="label"
      style={{ textAlign: 'center', width: '100%', height: LABEL_HEIGHT, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
    >
      {children}
    </Text>
  );
}

/**
 * Thanh chip thương hiệu dưới lưới Danh mục (lối duyệt theo thương hiệu DUY NHẤT của Trang chủ từ W47): chip theo số sản phẩm giảm dần, "Tubu Tree" cuối
 * (`brandShowcase`), chạm thì mở trang của nhãn (không có thì danh sách lọc theo nhãn). Thương hiệu đến từ khối gộp `/home` (cùng khoá với tab Danh mục).
 * Đang tải thì giữ chỗ `BRAND_BAR_HEIGHT`; cửa hàng không có ít nhất hai nhãn thật (`hasBrandChoice`), lỗi hay rỗng thì không vẽ gì.
 */
function BrandBar() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['brands'], queryFn: fetchBrands, staleTime: 60_000, retry: false });
  const brands = useMemo(() => (hasBrandChoice(q.data) ? brandShowcase(q.data) : []), [q.data]);
  if (q.isLoading) {
    return (
      <div data-testid="home-brand-bar" aria-hidden="true" style={{ ...BRAND_ROW, height: BRAND_BAR_HEIGHT, overflow: 'hidden', boxSizing: 'border-box' }}>
        {BRAND_SKELETON_WIDTHS.map((w, i) => (
          <Skeleton key={i} width={w} height={36} radius="var(--radius-pill)" style={{ flex: 'none' }} />
        ))}
      </div>
    );
  }
  if (brands.length === 0) return null;
  return (
    <div data-testid="home-brand-bar" style={{ height: BRAND_BAR_HEIGHT }}>
      <ScrollRow label={homeCopy.categories.brands} style={BRAND_ROW}>
        {brands.map((b) => (
          <Chip
            key={b.key}
            onPress={() => {
              haptic('light');
              navigate(brandJumpHref(b, 'mini'));
            }}
          >
            {b.brand}
          </Chip>
        ))}
      </ScrollRow>
    </div>
  );
}

/**
 * Danh mục ở Trang chủ: MỘT hàng 5 ô, ô vuông bo 56px nền màu xoay vòng (có ảnh thì vẽ ảnh), nhãn tối đa hai dòng. Bốn danh mục đầu (theo thứ tự `entries`) rồi ô "Tất cả" dẫn vào tab Danh mục,
 * nơi có đủ danh mục; không xếp hai hàng, không cuộn ngang (lưới đầy đủ đã ở tab Danh mục, một chạm từ thanh đáy). Đọc trái sang phải như thứ tự đọc của trình đọc màn hình, "Tất cả" luôn cuối.
 */
export const CategoryRow = memo(function CategoryRow({ entries, isLoading, onSelect, onSeeAll, placeholderCount = MAX_CELLS - 1 }: CategoryRowProps) {
  const skeletonCells = categorySkeletonCells(placeholderCount);
  const shown = homeCategoryEntries(entries, onSeeAll !== undefined);
  return (
    <section aria-label={homeCopy.categories.title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={homeCopy.categories.title} />
      </div>
      <div data-testid="category-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 20%)', padding: '4px 16px 8px' }}>
        {isLoading
          ? Array.from({ length: skeletonCells }, (_, i) => (
              <div key={i} data-testid="category-row-skeleton" aria-hidden="true" style={{ ...cellStyle, cursor: 'default' }}>
                <Skeleton width={TILE} height={TILE} radius="var(--radius-card)" />
                <div style={{ height: LABEL_HEIGHT, width: '100%', display: 'flex', justifyContent: 'center' }}>
                  <Skeleton width={48} height={16} />
                </div>
              </div>
            ))
          : (
            <>
              {shown.map((e, i) => {
                const tint = SHORTCUT_TINT_VARS[TINTS[i % TINTS.length]!];
                return (
                  <button key={`${e.kind}:${e.key}`} type="button" className="tubu-press" onClick={() => onSelect(e)} style={cellStyle}>
                    <span
                      aria-hidden
                      data-testid="category-tile"
                      style={{ width: TILE, height: TILE, borderRadius: 'var(--radius-card)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center', overflow: 'hidden' }}
                    >
                      {e.image ? (
                        <img src={e.image} alt="" width={TILE} height={TILE} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={hideBrokenImage} />
                      ) : (
                        <Icon icon={e.icon} size="lg" tone="current" />
                      )}
                    </span>
                    <Label>{e.label}</Label>
                  </button>
                );
              })}
              {onSeeAll && (
                <button type="button" aria-label={homeCopy.categories.allAria} className="tubu-press" onClick={onSeeAll} style={cellStyle}>
                  <span aria-hidden style={{ width: TILE, height: TILE, borderRadius: 'var(--radius-card)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
                    <Icon icon={LayoutGrid} size="lg" tone="current" />
                  </span>
                  <Label>{homeCopy.categories.all}</Label>
                </button>
              )}
            </>
          )}
      </div>
      <BrandBar />
    </section>
  );
});
