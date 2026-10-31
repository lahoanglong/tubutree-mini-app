'use client';

import type { CSSProperties, ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import { HUB_CATEGORY_MAX } from '@tubutree/app-core/browse/hub';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '@/lib/browse-categories';
import { Icon, Section, SectionHeader, Skeleton, Text } from '@/components/mini';

/** 4 cột ở điện thoại (như Mini App); màn rộng thêm cột để 9 ô (8 danh mục + "Tất cả") vừa một hàng ở lg. */
const GRID = 'grid grid-cols-4 gap-2 md:grid-cols-5 lg:grid-cols-9';
const TILE_MIN_HEIGHT = 88;
const MEDIA = 40;

export interface CategoryTilesProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  /** Số ô chờ khi đang tải (cộng thêm ô "Tất cả"); caller biết trước số ô thật thì truyền vào để khung chờ khớp. */
  placeholderCount: number;
  onSelect: (entry: CategoryEntry) => void;
  onSelectAll: () => void;
}

const TILE_STYLE: CSSProperties = {
  minHeight: TILE_MIN_HEIGHT,
  minWidth: 0,
  padding: '8px 4px',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 6,
  fontFamily: 'inherit',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
};

function Tile({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <button type="button" className="tubu-press" aria-label={label} onClick={onPress} style={TILE_STYLE}>
      <span
        aria-hidden="true"
        style={{ width: MEDIA, height: MEDIA, flex: '0 0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-control)', background: 'var(--color-bg-media)', overflow: 'hidden' }}
      >
        {children}
      </span>
      <Text
        variant="caption"
        data-tile-label=""
        style={{ fontWeight: 600, textAlign: 'center', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere', maxWidth: '100%' }}
      >
        {label}
      </Text>
    </button>
  );
}

/**
 * Ô danh mục ở hub (nguồn: apps/miniapp/src/components/catalog/category-tiles.tsx): tối đa `HUB_CATEGORY_MAX` ô rồi ô "Tất cả" (mở
 * danh sách không lọc). Là `<button>` thật; tên truy cập là nhãn (ảnh/icon trang trí). Chưa có cây danh mục thì `entries` là 4 phân
 * khúc dự phòng, hub vẫn đủ lối vào.
 */
export function CategoryTiles({ entries, isLoading, placeholderCount, onSelect, onSelectAll }: CategoryTilesProps) {
  const title = fillCopy('browse.categories');
  return (
    <Section id="browse-categories" label={title}>
      <SectionHeader title={title} />
      {isLoading ? (
        <div data-testid="category-grid-loading" aria-hidden="true" className={GRID}>
          {Array.from({ length: placeholderCount + 1 }, (_, i) => (
            <Skeleton key={i} height={TILE_MIN_HEIGHT} radius="var(--radius-control)" />
          ))}
        </div>
      ) : (
        <div className={GRID}>
          {entries.slice(0, HUB_CATEGORY_MAX).map((e) => (
            <Tile key={`${e.kind}:${e.key}`} label={e.label} onPress={() => onSelect(e)}>
              {e.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.image} alt="" width={MEDIA} height={MEDIA} loading="lazy" style={{ width: MEDIA, height: MEDIA, objectFit: 'cover' }} />
              ) : (
                <Icon icon={e.icon} size="md" tone="brand" />
              )}
            </Tile>
          ))}
          <Tile label={fillCopy('browse.all')} onPress={onSelectAll}>
            <Icon icon={LayoutGrid} size="md" tone="brand" />
          </Tile>
        </div>
      )}
    </Section>
  );
}
