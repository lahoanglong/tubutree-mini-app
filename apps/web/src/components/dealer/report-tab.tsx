'use client';

import { Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { dealerReportQuery } from '@tubutree/app-core/queries/dealer';
import { coreHttp } from '@/lib/core-http';
import { formatVnd } from '@/lib/format-vnd';
import { skin } from '@/components/pro-shared/mini-skin';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { errText } from './dealer-shell';
import { RewardsCard } from './rewards-card';

/** Báo cáo quý: doanh số đã chốt, thưởng theo bậc, tiến tới bậc kế, kèm phần thưởng mốc. */
export function ReportTab() {
  const q = useQuery(dealerReportQuery(coreHttp));
  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-2.5">
        <Skeleton height={120} />
        <Skeleton height={80} />
      </div>
    );
  }
  if (!q.data) return <ErrorState message={errText(q.error)} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const progress = d.nextTier ? Math.min(100, Math.round((d.revenue / d.nextTier.min) * 100)) : 100;
  return (
    <div className="grid gap-4 pb-6 lg:grid-cols-2 lg:items-start">
      <div className="flex flex-col gap-4">
        <section aria-label={`Doanh số ${d.quarter}`} className="rounded-card bg-gradient-to-br from-stone-900 to-forest-800 p-4 text-stone-0 max-md:from-[var(--color-dealer-ink)] max-md:to-[var(--color-dealer-ink-soft)]">
          <div className="text-xs text-stone-100">Doanh số {d.quarter}</div>
          <div className="mt-0.5 text-3xl font-bold tabular-nums">{formatVnd(d.revenue)}</div>
          <div className="mt-0.5 text-xs text-stone-100">
            {d.orderCount} đơn đã chốt · Thưởng hiện tại {bonusPctText(d.bonusPct)} = <b className="text-promo-solid max-md:text-[var(--color-dealer-accent)]">{formatVnd(d.bonusAmount)}</b>
          </div>
          {d.pendingRevenue > 0 && (
            <div className="mt-0.5 text-xs text-stone-100">
              + {formatVnd(d.pendingRevenue)} ({d.pendingOrderCount} đơn) chờ thanh toán/đóng gói — chưa tính thưởng
            </div>
          )}
          {d.nextTier && (
            <div className="mt-3">
              <div
                role="progressbar"
                aria-label="Tiến tới bậc thưởng kế"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                className="h-2 overflow-hidden rounded-full bg-stone-0/20"
              >
                <div className="h-full rounded-full bg-promo-solid max-md:bg-[var(--color-dealer-accent)]" style={{ width: `${progress}%` }} />
              </div>
              <div className="mt-1.5 text-xs text-stone-100">
                Còn {formatVnd(d.nextTier.toNext)} để đạt thưởng {bonusPctText(d.nextTier.pct)}
              </div>
            </div>
          )}
        </section>

        <section aria-label="Bậc thưởng doanh số quý" className={`p-4 ${skin.card}`}>
          <h2 className="mb-2 text-base font-semibold text-stone-900">Bậc thưởng doanh số quý</h2>
          <ul>
            {d.tiers.map((t) => {
              const reached = d.revenue >= t.min;
              const tone = reached ? 'text-forest-700' : 'text-stone-600';
              return (
                <li key={t.min} className="flex justify-between border-b border-stone-200 py-2">
                  <span className={`inline-flex items-center gap-1 text-sm ${tone}`}>
                    {reached && <Check className="h-4 w-4 flex-none" aria-hidden="true" />}
                    Từ {formatVnd(t.min)}
                  </span>
                  <span className={`text-sm font-semibold ${tone}`}>thưởng {bonusPctText(t.pct)}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs text-stone-600">
            Thưởng tính trên đơn đại lý đặt trong quý đã thanh toán (hoặc ghi công nợ) và đã đóng gói/giao — không tính đơn chờ xử lý, huỷ, trả. Thưởng quý được cộng vào công nợ khoảng ngày 10 của quý kế tiếp.
          </p>
        </section>
      </div>

      <RewardsCard />
    </div>
  );
}
