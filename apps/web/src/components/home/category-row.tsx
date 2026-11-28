'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { brandJumpHref, brandShowcase, hasBrandChoice } from '@tubutree/app-core/merch/brand-showcase';
import { brandsQuery } from '@tubutree/app-core/queries/catalog';
import { BRAND_BAR_HEIGHT, CATEGORY_GRID_MAX_CELLS, CATEGORY_LABEL_HEIGHT, CATEGORY_TILE_GUTTER, CATEGORY_TILE_SIZE, categorySkeletonCells, homeCategoryEntries, SHORTCUT_TINT_VARS, type ShortcutTint } from '@tubutree/app-core/home-layout';
import type { CategoryEntry } from '@/lib/browse-categories';
import { coreHttp } from '@/lib/core-http';
import { fallBackToOriginal, sizedImage } from '@/lib/image-src';
import { Chip, Icon, ScrollRow, SectionHeader, Skeleton, Text } from '@/components/mini';

const TILE = CATEGORY_TILE_SIZE;
const LABEL_HEIGHT = CATEGORY_LABEL_HEIGHT;
/** Ô vuông co lại ở khổ rất hẹp để chừa khe với ô kề (xem `CATEGORY_TILE_GUTTER`); từ 375px vẫn đúng `TILE`. */
const TILE_FIT = { width: TILE, maxWidth: `calc(100% - ${CATEGORY_TILE_GUTTER * 2}px)`, aspectRatio: '1 / 1', flex: '0 0 auto' } as const;
const MAX_CELLS = CATEGORY_GRID_MAX_CELLS;
/** Điện thoại: hàng tràn ra mép màn như Mini (`.tubu-bleed` lùi lề trang, đệm 16px nằm trong hàng). Chỉ dưới md, từ md hàng nằm trong khung trang nên không tràn ngang. */
const BLEED = 'tubu-bleed max-md:px-4';
/**
 * Từ lg (một hàng 5 cột; ở md ô còn ~118px nên nhãn cạnh icon bị cắt, md giữ ô dọc như điện thoại): mỗi ô là một thẻ ngang (ô vuông bên trái, nhãn căn trái bên phải, nền sáng, viền nhẹ) cao bằng ô điện thoại (`CATEGORY_CELL_HEIGHT`)
 * để khối không nhảy khi danh mục về; icon 56px không còn trơ trọi giữa ô rộng 230px. Phải dùng `!` vì số đo điện thoại nằm inline (bản gốc Mini); dưới md không đổi gì.
 */
const CARD_MD =
  'lg:!min-h-[5.75rem] lg:!flex-row lg:!gap-3 lg:!rounded-card lg:!border lg:!border-solid lg:!border-[var(--color-border-subtle)] lg:!bg-[var(--color-bg-surface)] lg:!px-4 lg:!py-0 lg:!text-left lg:transition-[box-shadow,border-color] lg:hover:!border-[var(--color-border-default)] lg:hover:[box-shadow:var(--elevation-1)]';
const LABEL_MD = 'lg:!h-auto lg:!w-auto lg:!min-w-0 lg:!flex-1 lg:!text-left lg:!text-[length:var(--type-body-sm-size)] lg:!leading-[var(--type-body-sm-lh)]';
/** Từ md lưới là 5 cột bằng nhau cách đều 12px (điện thoại: 5 cột 20% sát nhau). */
const GRID_MD = 'lg:!grid-cols-5 lg:!gap-x-3';
const TINTS: ShortcutTint[] = ['forest', 'sage', 'clay', 'amber', 'sky', 'rose'];
/** Bề ngang khung chờ của chip thương hiệu (tên nhãn dài ngắn khác nhau). */
const BRAND_SKELETON_WIDTHS = [76, 92, 68, 84, 72];
const BRAND_ROW = { gap: 'var(--space-inline-sm)', paddingBlock: 'var(--space-stack-xs)' } as const;

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
function Label({ children, card = false }: { children: string; card?: boolean }) {
  return (
    <Text
      variant="label"
      className={card ? LABEL_MD : undefined}
      style={{ textAlign: 'center', width: '100%', height: LABEL_HEIGHT, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
    >
      {children}
    </Text>
  );
}

/**
 * Thanh chip thương hiệu dưới lưới Danh mục (bản web của thanh trong `category-row.tsx` ở Mini App; lối duyệt theo thương hiệu DUY NHẤT của Trang chủ từ W47):
 * chip theo số sản phẩm giảm dần, "Tubu Tree" cuối (`brandShowcase`), chạm thì mở trang của nhãn (không có thì danh sách lọc theo nhãn). Máy chủ dựng sẵn
 * danh sách thương hiệu (`HomeInitial.brands`) nên HTML đầu đã biết có vẽ thanh hay không; chỉ khi máy chủ không có thì giữ chỗ `BRAND_BAR_HEIGHT` trong lúc tải.
 * Cửa hàng không có ít nhất hai nhãn thật (`hasBrandChoice`), lỗi hay rỗng thì không vẽ gì.
 */
function BrandBar() {
  const router = useRouter();
  const q = useQuery({ ...brandsQuery(coreHttp), staleTime: 60_000, retry: false });
  const brands = useMemo(() => (hasBrandChoice(q.data) ? brandShowcase(q.data) : []), [q.data]);
  if (q.isLoading) {
    return (
      <div data-testid="home-brand-bar" aria-hidden="true" className={BLEED} style={{ ...BRAND_ROW, display: 'flex', height: BRAND_BAR_HEIGHT, overflow: 'hidden', boxSizing: 'border-box' }}>
        {BRAND_SKELETON_WIDTHS.map((w, i) => (
          <Skeleton key={i} width={w} height={36} radius="var(--radius-pill)" style={{ flex: 'none' }} />
        ))}
      </div>
    );
  }
  if (brands.length === 0) return null;
  return (
    <div data-testid="home-brand-bar" style={{ height: BRAND_BAR_HEIGHT }}>
      <ScrollRow label={homeCopy.categories.brands} className={BLEED} style={BRAND_ROW}>
        {brands.map((b) => (
          <Chip key={b.key} onPress={() => router.push(brandJumpHref(b, 'web'))}>
            {b.brand}
          </Chip>
        ))}
      </ScrollRow>
    </div>
  );
}

/**
 * Danh mục ở Trang chủ (bản web của `category-row.tsx` ở Mini App): MỘT hàng 5 ô, ô vuông bo 56px nền màu xoay vòng (có ảnh thì vẽ ảnh), nhãn tối đa hai dòng.
 * Bốn danh mục đầu (theo thứ tự `entries`) rồi ô "Tất cả" dẫn vào trang Danh mục, nơi có đủ danh mục; không xếp hai hàng, không cuộn ngang. Lề âm chỉ áp dưới md qua lớp `.tubu-bleed`
 * (bản cũ đặt lề âm inline ở mọi khổ nên từ md hàng cuộn tràn khung trang).
 */
export function CategoryRow({ entries, isLoading, onSelect, onSeeAll, placeholderCount = MAX_CELLS - 1 }: CategoryRowProps) {
  const skeletonCells = categorySkeletonCells(placeholderCount);
  const shown = homeCategoryEntries(entries, onSeeAll !== undefined);
  return (
    <section aria-label={homeCopy.categories.title}>
      <SectionHeader title={homeCopy.categories.title} />
      <div data-testid="category-grid" className={`${BLEED} ${GRID_MD}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 20%)', paddingBlock: '4px 8px' }}>
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
            {shown.map((e, i) => {
              const tint = SHORTCUT_TINT_VARS[TINTS[i % TINTS.length]!];
              return (
                <button key={`${e.kind}:${e.key}`} type="button" className={`tubu-press ${CARD_MD}`} onClick={() => onSelect(e)} style={cellStyle}>
                  <span
                    aria-hidden
                    data-testid="category-tile"
                    style={{ ...TILE_FIT, borderRadius: 'var(--radius-card)', background: tint.bg, color: tint.fg, display: 'grid', placeItems: 'center', overflow: 'hidden' }}
                  >
                    {e.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sizedImage(e.image, TILE).src} onError={fallBackToOriginal(e.image)} alt="" width={TILE} height={TILE} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <Icon icon={e.icon} size="lg" tone="current" />
                    )}
                  </span>
                  <Label card>{e.label}</Label>
                </button>
              );
            })}
            {onSeeAll && (
              <button type="button" aria-label={homeCopy.categories.allAria} className={`tubu-press ${CARD_MD}`} onClick={onSeeAll} style={cellStyle}>
                <span aria-hidden style={{ ...TILE_FIT, borderRadius: 'var(--radius-card)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
                  <Icon icon={LayoutGrid} size="lg" tone="current" />
                </span>
                <Label card>{homeCopy.categories.all}</Label>
              </button>
            )}
          </>
        )}
      </div>
      <BrandBar />
    </section>
  );
}
