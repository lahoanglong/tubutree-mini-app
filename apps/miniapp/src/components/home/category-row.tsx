import type { CategoryEntry } from '../../hooks/use-categories';
import { homeCopy } from '@tubutree/app-core/home-copy';
import { Icon } from '../ui/icon';
import { ScrollRow } from '../ui/scroll-row';
import { Skeleton } from '../ui/skeleton';
import { Heading, Text } from '../ui/text';

const ITEM_WIDTH = 72;
const CIRCLE = 56;

export interface CategoryRowProps {
  entries: CategoryEntry[];
  isLoading: boolean;
  onSelect: (entry: CategoryEntry) => void;
  placeholderCount?: number;
}

/** Danh mục một hàng cuộn ngang ở Trang chủ: ô tròn có ảnh hoặc biểu tượng, nhãn tối đa hai dòng. */
export function CategoryRow({ entries, isLoading, onSelect, placeholderCount = 5 }: CategoryRowProps) {
  return (
    <section aria-label={homeCopy.categories.title} style={{ padding: '4px 0 8px' }}>
      <div style={{ padding: '8px 16px 4px' }}>
        <Heading variant="title-sm" as="h2">
          {homeCopy.categories.title}
        </Heading>
      </div>
      <ScrollRow label={homeCopy.categories.rail} style={{ gap: 8, padding: '4px 16px 8px' }}>
        {isLoading
          ? Array.from({ length: placeholderCount }, (_, i) => (
              <div key={i} data-testid="category-row-skeleton" aria-hidden="true" style={{ flex: `0 0 ${ITEM_WIDTH}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <Skeleton width={CIRCLE} height={CIRCLE} radius="var(--radius-pill)" />
                <Skeleton width={48} height={16} />
              </div>
            ))
          : entries.map((e) => (
              <button
                key={`${e.kind}:${e.key}`}
                type="button"
                className="tubu-press"
                onClick={() => onSelect(e)}
                style={{
                  flex: `0 0 ${ITEM_WIDTH}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  minHeight: 44,
                  padding: 0,
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span
                  aria-hidden
                  style={{ width: CIRCLE, height: CIRCLE, borderRadius: 'var(--radius-pill)', background: 'var(--color-bg-subtle)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}
                >
                  {e.image ? (
                    <img src={e.image} alt="" width={CIRCLE} height={CIRCLE} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <Icon icon={e.icon} size="lg" tone="brand" />
                  )}
                </span>
                <Text
                  variant="caption"
                  style={{ textAlign: 'center', fontWeight: 600, width: '100%', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}
                >
                  {e.label}
                </Text>
              </button>
            ))}
      </ScrollRow>
    </section>
  );
}
