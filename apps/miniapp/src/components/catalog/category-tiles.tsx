import type { CSSProperties } from 'react';
import { LayoutGrid } from 'lucide-react';
import { HUB_CATEGORY_MAX, HUB_TILE_HEIGHT, hubHasMoreCategories, hubPlaceholderTiles } from '@tubutree/app-core/browse/hub';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import type { CategoryEntry } from '../../hooks/use-categories';
import { haptic } from '../../utils/haptic';
import { Icon } from '../ui/icon';
import { Section } from '../ui/section';
import { SectionHeader } from '../ui/section-header';
import { Skeleton } from '../ui/skeleton';
import { Text } from '../ui/text';

const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 };
const MEDIA = 40;

export interface CategoryTilesProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  /** Số ô của lần tải trước (khung chờ tự chặn ở `HUB_CATEGORY_MAX` rồi cộng ô "Tất cả"); biết trước số ô thật thì khung chờ khớp lưới thật. */
  placeholderCount: number;
  onSelect: (entry: CategoryEntry) => void;
  onSelectAll: () => void;
}

function Tile({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="tubu-press"
      aria-label={label}
      onClick={() => {
        haptic('light');
        onPress();
      }}
      style={{
        minHeight: HUB_TILE_HEIGHT,
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
      }}
    >
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
 * Ô danh mục ở hub: 4 cột, tối đa `HUB_CATEGORY_MAX` ô rồi ô "Tất cả" (mở danh sách không lọc); quá trần thì tiêu đề thêm "Xem tất cả" cùng đích. Là `<button>` thật; tên truy cập là
 * nhãn (ảnh/icon trang trí). Chưa có cây danh mục thì `entries` là 4 phân khúc dự phòng, hub vẫn đủ lối vào.
 */
export function CategoryTiles({ entries, isLoading, placeholderCount, onSelect, onSelectAll }: CategoryTilesProps) {
  const title = fillCopy('browse.categories');
  return (
    <Section id="browse-categories" label={title}>
      <div style={{ padding: '0 16px' }}>
        <SectionHeader title={title} action={!isLoading && hubHasMoreCategories(entries.length) ? { onPress: onSelectAll } : undefined} />
        {isLoading ? (
          <div data-testid="category-grid-loading" aria-hidden="true" style={GRID}>
            {Array.from({ length: hubPlaceholderTiles(placeholderCount) }, (_, i) => (
              <Skeleton key={i} height={HUB_TILE_HEIGHT} radius="var(--radius-control)" />
            ))}
          </div>
        ) : (
          <div style={GRID}>
            {entries.slice(0, HUB_CATEGORY_MAX).map((e) => (
              <Tile key={`${e.kind}:${e.key}`} label={e.label} onPress={() => onSelect(e)}>
                {e.image ? (
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
      </div>
    </Section>
  );
}
