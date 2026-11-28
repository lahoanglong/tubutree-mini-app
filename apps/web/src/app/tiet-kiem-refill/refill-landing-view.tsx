'use client';

// Nguồn: apps/miniapp/src/pages/refill-deals.tsx
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { refillLandingBottleCaption, refillLandingCopy, refillLandingIntro, refillLandingQuery, refillLandingRows, type RefillLandingDTO } from '@tubutree/app-core/refill/refill-landing';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { EmptyState } from '@/components/empty-state';
import { Skeleton, Text } from '@/components/mini';
import { PdpRefillOffer } from '@/components/mini/pdp-refill-offer';
import { RefillNextDelivery } from '@/components/refill/refill-next-delivery';
import { RepurchaseDueCard } from '@/components/refill/repurchase-due-card-lazy';
import { useRefillOfferAdd } from '@/components/refill/use-refill-offer-add';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { trackWebEvent } from '@/lib/analytics';
import { coreHttp } from '@/lib/core-http';
import { loadErrorText } from '@/lib/error-text';

const GRID = 'grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4';
const addButtonOf = (i: number) => document.querySelector(`[data-refill-row="${i}"] [data-testid="pdp-refill-add"]`);

/**
 * Trang "Tiết kiệm với Refill" của web: mỗi hàng là chai khách đang dùng (dòng phụ "Thay cho …") và thẻ gói Refill cùng số với trang chi tiết chai,
 * "+ Thêm" một chạm (khách chưa đăng nhập theo cùng đường giỏ khách/đăng nhập của trang chi tiết). HTML máy chủ (ISR 5 phút) vẽ sẵn; giá cuối do giỏ tính lại.
 * `refill_swap_shown` ghi một lần mỗi lượt xem có thẻ, `refill_swap_applied` mỗi lần thêm (surface `landing`).
 * Khách có gói định kỳ đang chạy của một gói Refill thấy thẻ "Kỳ Refill tới" (ngày giao, giá định kỳ so giá lẻ, dời +7 ngày một chạm) trên danh sách.
 */
export default function RefillLandingView({ initial, initialFetchedAt }: { initial?: RefillLandingDTO; initialFetchedAt?: number }) {
  const query = refillLandingQuery(coreHttp);
  const q = useQuery({ ...query, ...(initial ? { initialData: initial, initialDataUpdatedAt: initialFetchedAt } : {}) });
  const rows = refillLandingRows(q.data);
  const refill = useRefillOfferAdd('landing', query.queryKey);
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || rows.length === 0) return;
    shown.current = true;
    trackWebEvent('refill_swap_shown', { surface: 'landing' });
  }, [rows.length]);
  const busy = refill.busyVariationId;

  return (
    <>
      <PageHeader title={refillLandingCopy('title')} subtitle={rows.length > 0 ? refillLandingIntro(rows) : undefined} backHref="/san-pham" />
      <RefillNextDelivery landing={q.data} />
      <RepurchaseDueCard surface="refill_landing" />
      <div style={{ marginTop: 'var(--space-stack-md)' }}>
        {q.isLoading ? (
          <div className={GRID} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={96} radius="var(--radius-card)" />
            ))}
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState message={loadErrorText(q.error)} onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={refillLandingCopy('empty')} actionHref="/san-pham" actionLabel={fillCopy('flash.emptyCta')} />
        ) : (
          <section aria-labelledby="refill-landing-list-title" data-testid="refill-landing-list">
            <h2 id="refill-landing-list-title" className="sr-only">
              {refillLandingCopy('listLabel', { n: rows.length })}
            </h2>
            <ul className={`${GRID} tabular-nums`} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((row, i) => (
                <li key={row.key} data-refill-row={i} data-testid="refill-landing-row" style={{ minWidth: 0 }}>
                  <Text variant="caption" tone="secondary" as="p" className="truncate" data-testid="refill-landing-bottle">
                    {refillLandingBottleCaption(row)}
                  </Text>
                  <PdpRefillOffer
                    view={row.view}
                    surface="landing"
                    busy={busy === row.view.variationId}
                    blocked={busy !== null && busy !== row.view.variationId}
                    onAdd={(v) => refill.add(v, addButtonOf(i))}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {refill.feedback}
    </>
  );
}
