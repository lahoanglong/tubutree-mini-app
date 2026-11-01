import type { ReviewItem } from '@tubutree/app-core/api/reviews';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { pickQuickReviews } from '@tubutree/app-core/commerce/pdp-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { Stars } from '../reviews-section';
import { SectionTitle } from '../ui/section-title';
import { Text } from '../ui/text';

export interface PdpQuickReviewsProps {
  average: number;
  count: number;
  items: readonly ReviewItem[];
  /** Cuộn tới danh sách đầy đủ (giữ ở chỗ cũ). */
  onSeeAll: () => void;
}

/** "Đánh giá nhanh" (Q8): điểm + 2 đánh giá đầu, ưu tiên có ảnh. Không có đánh giá nào có chữ thì không dựng khối. */
export function PdpQuickReviews({ average, count, items, onSeeAll }: PdpQuickReviewsProps) {
  const picked = pickQuickReviews(items);
  if (picked.length === 0) return null;
  return (
    <section aria-label="Đánh giá nhanh" style={{ background: 'var(--color-bg-surface)', padding: 16, marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <SectionTitle block>{fillCopy('pdp.reviews')}</SectionTitle>
          <Stars value={average} size={14} />
          <Text variant="caption" tone="secondary" as="span">
            {formatRating(average)} · {count}
          </Text>
        </div>
        <button
          type="button"
          className="tubu-press"
          onClick={onSeeAll}
          style={{ minHeight: 44, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'var(--type-label-size)', fontWeight: 600, color: 'var(--color-text-brand)', whiteSpace: 'nowrap' }}
        >
          {fillCopy('pdp.reviewsAll', { n: count })}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
        {picked.map((r) => (
          <div key={r.id} data-testid="quick-review" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Stars value={r.rating} size={12} />
              <Text variant="caption" tone="tertiary" as="span">
                {r.author}
              </Text>
            </div>
            <Text
              variant="body-sm"
              as="p"
              style={{ margin: 0, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {r.comment}
            </Text>
          </div>
        ))}
      </div>
    </section>
  );
}
