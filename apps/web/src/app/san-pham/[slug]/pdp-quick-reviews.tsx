'use client';

import { useQuery } from '@tanstack/react-query';
import { formatRating } from '@tubutree/app-core/commerce/card-meta';
import { pickQuickReviews } from '@tubutree/app-core/commerce/pdp-view';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { fetchProductReviews } from '@/lib/reviews-client';
import { Stars } from './product-reviews';
import { pdpBand, pdpSectionTitle } from './pdp-sections';

/**
 * "Đánh giá nhanh" (Q8): điểm + 2 đánh giá đầu, ưu tiên có ảnh. Dùng chung khoá `['reviews', slug]` với danh sách đầy đủ phía dưới nên
 * không gọi API thêm. Chưa có đánh giá có chữ, đang tải hay lỗi thì không dựng khối (danh sách đầy đủ lo phần báo lỗi).
 */
export function PdpQuickReviews({ slug }: { slug: string }) {
  const q = useQuery({ queryKey: ['reviews', slug], queryFn: () => fetchProductReviews(slug) });
  const picked = pickQuickReviews(q.data?.items ?? []);
  if (!q.data || picked.length === 0) return null;
  const { average, count } = q.data;
  return (
    <section
      aria-label="Đánh giá nhanh"
      data-section="pdp-quick-reviews"
      className={pdpBand}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className={pdpSectionTitle}>{fillCopy('pdp.reviews')}</h2>
          <Stars value={average} small />
          <span className="text-xs text-stone-600">
            {formatRating(average)} · {count}
          </span>
        </div>
        <button
          type="button"
          onClick={() => document.getElementById('danh-gia')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="min-h-11 whitespace-nowrap text-xs font-semibold text-[var(--color-text-brand)]"
        >
          {fillCopy('pdp.reviewsAll', { n: count })}
        </button>
      </div>
      <ul className="mt-1 flex flex-col gap-3">
        {picked.map((r) => (
          <li key={r.id} data-testid="quick-review" className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <Stars value={r.rating} small spoken="score" />
              <span className="text-xs text-stone-500">{r.author}</span>
            </div>
            <p className="line-clamp-3 text-sm text-stone-800">{r.comment}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
