'use client';

import { LayoutGrid } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { CATEGORY_GRID_MAX_CELLS, CATEGORY_LABEL_HEIGHT, CATEGORY_SCROLL_COLUMNS, CATEGORY_TILE_SIZE, categoryGridScrolls, categorySkeletonCells, SHORTCUT_TINT_VARS, type ShortcutTint } from '@tubutree/app-core/home-layout';
import type { CategoryEntry } from '@/lib/browse-categories';
import { Icon, ScrollRow, SectionHeader, Skeleton, Text } from '@/components/mini';

const TILE = CATEGORY_TILE_SIZE;
const LABEL_HEIGHT = CATEGORY_LABEL_HEIGHT;
/** Khung chờ không bao giờ dài hơn một màn (2 hàng × 5 cột): ô vượt màn chỉ có khi đã có dữ liệu thật. */
const MAX_SKELETON_CELLS = CATEGORY_GRID_MAX_CELLS;
/** Điện thoại: hàng cuộn tràn ra mép màn như Mini (`.tubu-bleed` lùi lề trang, đệm 16px nằm trong hàng, cột thứ 6 thò ra mép). Chỉ dưới md, từ md hàng nằm trong khung trang nên không tràn ngang. */
const SCROLL_BLEED = 'tubu-bleed max-md:px-4';
const TINTS: ShortcutTint[] = ['forest', 'sage', 'clay', 'amber', 'sky', 'rose'];

// Tới 10 ô (kể cả "Tất cả"): xếp theo hàng, đọc trái sang phải như thứ tự đọc của trình đọc màn hình và "Tất cả" luôn ở cuối. Quá 10 ô mới xếp theo cột để cuộn ngang.
const ROW_FLOW = { gridTemplateColumns: 'repeat(5, 20%)' } as const;
const COLUMN_FLOW = { gridTemplateRows: 'repeat(2, auto)', gridAutoFlow: 'column', gridAutoColumns: `calc(100% / ${CATEGORY_SCROLL_COLUMNS})` } as const;

export interface CategoryRowProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  /** Có thì ô cuối lưới là "Tất cả" dẫn vào Danh mục. */
  onSeeAll?: () => void;
  /** Số danh mục của lần tải trước; khung chờ vẽ số ô này cộng ô "Tất cả" để bằng chiều cao lưới thật. */
  placeholderCount?: number;
}

const cellStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  minHeight: 44,
  minWidth: 0,
  padding: '0 2px',
  border: 'none',
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
} as const;

function Label({ children }: { children: string }) {
  return (
    <Text
      variant="caption"
      style={{ textAlign: 'center', fontWeight: 600, width: '100%', height: LABEL_HEIGHT, lineHeight: '16px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
    >
      {children}
    </Text>
  );
}

/**
 * Danh mục ở Trang chủ (Q7, bản web của `category-row.tsx` ở Mini App): lưới 2 hàng × 5 cột, ô vuông bo 56px nền màu xoay vòng (có ảnh thì vẽ ảnh),
 * nhãn tối đa hai dòng. Ô cuối là "Tất cả". Tới 10 ô xếp theo hàng; quá 10 ô thì lưới xếp theo cột và cuộn ngang (mỗi cột 1/5,5 bề rộng nên cột thứ 6 ló gần nửa cột; tiêu đề có "Xem tất cả", từ md có nút ‹ ›),
 * không cắt bớt danh mục. Lề âm chỉ áp dưới md qua lớp `.tubu-bleed` (bản cũ đặt lề âm inline ở mọi khổ nên từ md hàng cuộn tràn khung trang).
 */
export function CategoryRow({ entries, isLoading, onSelect, onSeeAll, placeholderCount = MAX_SKELETON_CELLS - 1 }: CategoryRowProps) {
  const skeletonCells = categorySkeletonCells(placeholderCount);
  const cells = isLoading ? skeletonCells : entries.length + (onSeeAll ? 1 : 0);
  const scrolls = categoryGridScrolls(cells);
  const flow = scrolls ? COLUMN_FLOW : ROW_FLOW;
  return (
    <section aria-label={homeCopy.categories.title}>
      <SectionHeader title={homeCopy.categories.title} action={scrolls && onSeeAll ? { onPress: onSeeAll } : undefined} />
      <ScrollRow
        label={homeCopy.categories.rail}
        arrows={scrolls}
        className={SCROLL_BLEED}
        style={{ display: 'grid', ...flow, rowGap: 8, paddingBlock: '4px 8px' }}
      >
        {isLoading ? (
          Array.from({ length: skeletonCells }, (_, i) => (
            <div key={i} data-testid="category-row-skeleton" aria-hidden="true" style={{ ...cellStyle, cursor: 'default' }}>
              <Skeleton width={TILE} height={TILE} radius="var(--radius-card)" />
              <div style={{ height: LABEL_HEIGHT, width: '100%', display: 'flex', justifyContent: 'center' }}>
                <Skeleton width={48} height={16} />
              </div>
            </div>
          ))
        ) : (
          <>
            {entries.map((e, i) => {
              const tint = SHORTCUT_TINT_VARS[TINTS[i % TINTS.length]!];
              return (
                <button key={`${e.kind}:${e.key}`} type="button" className="tubu-press" onClick={() => onSelect(e)} style={cellStyle}>
                  <span
                    aria-hidden
                    data-testid="category-tile"
                    style={{ width: TILE, height: TILE, borderRadius: 'var(--radius-card)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center', overflow: 'hidden' }}
                  >
                    {e.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.image} alt="" width={TILE} height={TILE} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
      </ScrollRow>
    </section>
  );
}
