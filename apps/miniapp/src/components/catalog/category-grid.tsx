import type { CSSProperties } from 'react';
import { SEGMENT_ENTRIES, type CategoryEntry } from '../../hooks/use-categories';
import { vi } from '../../i18n/vi';
import { Icon } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 };
/** Viền 1px + đệm 12 + 1 dòng body-sm (22px) + đệm 12 + viền 1px = 48px — khung chờ cùng chiều cao. */
const ITEM_HEIGHT = 48;

export interface CategoryGridProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  title?: string;
  /**
   * Số ô chờ khi đang tải. Lúc này chưa biết sẽ có bao nhiêu danh mục thật, nên mặc định bằng số
   * phân khúc dự phòng (4) — số ô chắc chắn có khi API chưa trả danh mục nào dùng được. Caller biết
   * trước số ô thật (vd đã có cache) thì truyền vào để khung chờ khớp.
   */
  placeholderCount?: number;
}

/** Danh mục thật (có hàng) hoặc 4 phân khúc dự phòng (spec 5b.2) — dùng ở Trang chủ và trang Danh mục.
 * Mỗi ô là `<button>` thật nên Tab/Enter/Space hoạt động; tên truy cập = nhãn danh mục (icon trang trí). */
export function CategoryGrid({ entries, isLoading, onSelect, title = vi.browse.categories, placeholderCount = SEGMENT_ENTRIES.length }: CategoryGridProps) {
  return (
    <section aria-label={title} style={{ padding: '8px 16px' }}>
      <Heading variant="title-sm" as="h2" style={{ marginBottom: 8 }}>
        {title}
      </Heading>
      {isLoading ? (
        <div data-testid="category-grid-loading" aria-hidden="true" style={GRID}>
          {Array.from({ length: placeholderCount }, (_, i) => (
            <Skeleton key={i} height={ITEM_HEIGHT} radius="var(--radius-card)" />
          ))}
        </div>
      ) : (
        <div style={GRID}>
          {entries.map((e) => (
            <button
              key={`${e.kind}:${e.key}`}
              type="button"
              className="tubu-press"
              onClick={() => onSelect(e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minWidth: 0,
                minHeight: ITEM_HEIGHT,
                padding: 12,
                boxSizing: 'border-box',
                textAlign: 'left',
                fontFamily: 'inherit',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-card)',
              }}
            >
              <Icon icon={e.icon} size="sm" tone="brand" style={{ flex: '0 0 auto' }} />
              <Text variant="body-sm" style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.label}
              </Text>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
