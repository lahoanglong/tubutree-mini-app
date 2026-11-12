'use client';

import { useQuery } from '@tanstack/react-query';
import { LoadError, StatCardsSkeleton } from '@/components/admin/ui';
import { formatDateTime } from '@/lib/format-date';
import { loadErrorText } from '@/lib/admin-error-text';
import { getAdvisorStats } from './catalog-quality-api';

const percent = (part: number, total: number): string => `${Math.round((part / total) * 100)}%`;

/** Dấu thập phân kiểu Việt; chưa có mẫu thì gạch ngang thay vì "0 giây" (số 0 nghe như AI trả lời tức thì). */
const seconds = (ms: number | null): string => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} giây`);

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 rounded-control border border-stone-200 bg-stone-0 p-3">
      <div className="break-words text-xs text-stone-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums text-stone-900">{value}</div>
      {hint && <div className="break-words text-[11px] tabular-nums text-stone-500">{hint}</div>}
    </div>
  );
}

/** Thống kê trợ lý tư vấn khách (W127): số đếm nằm trong bộ nhớ của máy chủ API nên khởi động lại là về 0 và chưa có lượt bấm. */
export function AdvisorStatsCard() {
  const q = useQuery({ queryKey: ['admin-ai-advisor-stats'], queryFn: getAdvisorStats });
  const s = q.data;

  return (
    <section aria-labelledby="advisor-stats-title" className="rounded-card border border-stone-200 bg-stone-0 p-3">
      <h2 id="advisor-stats-title" className="m-0 font-display text-lg font-semibold text-stone-900">
        AI tư vấn khách
      </h2>
      <div className="mt-3 space-y-3" aria-busy={q.isFetching || undefined}>
        {q.isLoading ? (
          <StatCardsSkeleton label="Đang tải thống kê AI tư vấn" count={4} />
        ) : q.isError || !s ? (
          <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>
            {`Không tải được thống kê AI tư vấn. ${loadErrorText(q.error)}`}
          </LoadError>
        ) : (
          <>
            {s.total === 0 ? (
              <p className="max-w-2xl text-sm text-stone-600">Chưa có lượt hỏi nào từ lúc API khởi động. Khi khách hỏi trợ lý, số lượt và sản phẩm được gợi ý sẽ hiện ở đây.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Tổng lượt hỏi" value={String(s.total)} />
                  <StatCard label="AI trả lời" value={String(s.ok)} hint={percent(s.ok, s.total)} />
                  <StatCard label="Trả lời dự phòng" value={String(s.fallback)} hint={percent(s.fallback, s.total)} />
                  <StatCard label="Độ trễ p95" value={seconds(s.latencyP95Ms)} hint={s.latencySamples > 0 ? `trên ${s.latencySamples} lượt gần nhất` : undefined} />
                </div>
                <div>
                  <h3 className="m-0 text-sm font-semibold text-stone-800">Sản phẩm được gợi ý nhiều nhất</h3>
                  {s.topSkus.length === 0 ? (
                    <p className="mt-1 text-sm text-stone-500">Chưa có sản phẩm nào được gợi ý.</p>
                  ) : (
                    <ol className="mt-1 divide-y divide-stone-200 rounded-control border border-stone-200" aria-label="Sản phẩm được gợi ý nhiều nhất">
                      {s.topSkus.map((t) => (
                        <li key={t.slug} className="flex items-start justify-between gap-3 px-3 py-2 text-sm text-stone-800">
                          <span className="min-w-0 break-words">{t.name}</span>
                          <span className="shrink-0 tabular-nums text-stone-600">{t.count} lần</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </>
            )}
            <p className="max-w-2xl text-xs text-stone-500">
              Tính từ {formatDateTime(s.since)} (giờ Việt Nam); khởi động lại API là về 0. Chưa đo lượt bấm.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
