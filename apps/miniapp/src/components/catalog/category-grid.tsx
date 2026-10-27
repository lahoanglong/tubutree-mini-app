import type { CSSProperties } from 'react';
import { SEGMENT_ENTRIES, type CategoryEntry } from '../../hooks/use-categories';
import { vi } from '../../i18n/vi';
import { Icon } from '../ui/icon';
import { ScrollRow } from '../ui/scroll-row';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

/** Một hàng cuộn ngang thay cho lưới ô to: 7 danh mục xếp lưới 2 cột đẩy món đầu xuống giữa màn thứ hai. Cao 44px = vùng chạm tối thiểu. */
const ROW: CSSProperties = { gap: 8, padding: '4px 16px 8px', margin: '0 -16px', maxWidth: 'none' };
const ITEM_HEIGHT = 44;

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
        <div data-testid="category-grid-loading" aria-hidden="true" className="scroll-x" style={ROW}>
          {Array.from({ length: placeholderCount }, (_, i) => (
            <div key={i} style={{ flex: '0 0 auto' }}>
              <Skeleton width={112} height={ITEM_HEIGHT} radius="var(--radius-pill)" />
            </div>
          ))}
        </div>
      ) : (
        <ScrollRow label={`${title} (vuốt ngang)`} style={ROW}>
          {entries.map((e) => (
            <button
              key={`${e.kind}:${e.key}`}
              type="button"
              className="tubu-press"
              onClick={() => onSelect(e)}
              style={{
                flex: '0 0 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                minHeight: ITEM_HEIGHT,
                padding: '0 14px',
                boxSizing: 'border-box',
                whiteSpace: 'nowrap',
                fontFamily: 'inherit',
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              {e.image ? (
                <img src={e.image} alt="" width={24} height={24} loading="lazy" style={{ flex: '0 0 auto', borderRadius: 6, objectFit: 'cover' }} />
              ) : (
                <Icon icon={e.icon} size="md" tone="brand" style={{ flex: '0 0 auto' }} />
              )}
              <Text variant="body-sm" style={{ fontWeight: 600 }}>
                {e.label}
              </Text>
            </button>
          ))}
        </ScrollRow>
      )}
    </section>
  );
}
