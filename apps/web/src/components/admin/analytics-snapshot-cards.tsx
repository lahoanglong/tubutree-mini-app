'use client';

import { useQuery } from '@tanstack/react-query';
import type { CohortRepeatRowDTO, CohortRepeatWindowDTO, FunnelDailyDTO, PurchaseFunnelStep } from '@tubutree/shared-types';
import { apiFetch } from '@/lib/client-api';
import { ListSkeleton, LoadError, ScrollRegion } from '@/components/admin/ui';
import { formatCount, formatPct, ratioPct } from '@/components/admin/launch-watch-format';

export const getCohortRepeat = (months = 12) => apiFetch<CohortRepeatRowDTO[]>(`/admin/analytics/cohort-repeat?months=${months}`);
export const getFunnelDaily = (days = 30) => apiFetch<FunnelDailyDTO[]>(`/admin/analytics/funnel-daily?days=${days}`);

/** Số ngày gần nhất hiện trong bảng phễu theo ngày (API trả 30 ngày cho dòng tổng 7 ngày và về sau). */
const FUNNEL_TABLE_DAYS = 14;
const FUNNEL_SUMMARY_DAYS = 7;

const monthLabel = (ym: string) => `${ym.slice(5, 7)}/${ym.slice(0, 4)}`;
const dayLabel = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Ô "25% (3)" của một cửa sổ cohort; chưa đủ ngày theo dõi thì thêm dấu * (số còn tăng). */
export function cohortCell(w: CohortRepeatWindowDTO, newBuyers: number): string {
  return `${formatPct(ratioPct(w.count, newBuyers))} (${formatCount(w.count)})${w.complete ? '' : '*'}`;
}

/** Trung vị số ngày tới đơn 2; nhóm chưa đủ 90 ngày theo dõi mới chỉ có khách quay lại sớm nên số còn tăng (dấu *). */
export function medianCell(r: Pick<CohortRepeatRowDTO, 'medianDaysToSecondOrder' | 'd90'>): string {
  if (r.medianDaysToSecondOrder === null) return '—';
  return `${String(r.medianDaysToSecondOrder).replace('.', ',')} ngày${r.d90.complete ? '' : '*'}`;
}

function CohortCell({ w, newBuyers }: { w: CohortRepeatWindowDTO; newBuyers: number }) {
  return (
    <td className={`px-2 text-right ${w.complete ? 'text-stone-900' : 'text-stone-500'}`} title={w.complete ? undefined : 'Còn khách chưa đủ ngày theo dõi, số còn tăng'}>
      {cohortCell(w, newBuyers)}
    </td>
  );
}

/** Cohort tháng: % khách mua lần đầu trong tháng đã đặt đơn thứ 2 sau 30/60/90 ngày. */
export function CohortRepeatCard() {
  const q = useQuery({ queryKey: ['admin-analytics-cohort-repeat'], queryFn: () => getCohortRepeat(12) });
  return (
    <section aria-label="Khách quay lại theo tháng mua đầu" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-base font-semibold text-stone-900">Khách quay lại theo tháng mua đầu</h3>
      <p className="mt-0.5 text-xs text-stone-500">
        Mỗi dòng là nhóm khách có đơn đầu tiên trong tháng đó, và bao nhiêu % đã đặt đơn thứ 2 trong 30, 60, 90 ngày kể từ đơn đầu. Ô có dấu * còn
        khách chưa đủ ngày theo dõi nên số còn tăng. Tính lại mỗi đêm sau 3 giờ sáng.
      </p>
      <div className="mt-2">
        {q.isLoading ? (
          <ListSkeleton label="Đang tải khách quay lại theo tháng" rows={3} className="h-10" />
        ) : q.isError || !q.data ? (
          <LoadError message="Không tải được số khách quay lại theo tháng." onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : q.data.length === 0 ? (
          <p className="text-sm text-stone-500">Chưa có nhóm khách nào. Số liệu có sau đêm đầu tiên hệ thống chạy tổng hợp.</p>
        ) : (
          <ScrollRegion label="Khách quay lại theo tháng mua đầu">
            <table className="w-full min-w-[520px] text-sm tabular-nums">
              <thead>
                <tr className="text-left text-stone-500">
                  <th scope="col" className="py-1 pr-2 font-medium">Tháng</th>
                  <th scope="col" className="px-2 text-right font-medium">Khách mới</th>
                  <th scope="col" className="px-2 text-right font-medium">30 ngày</th>
                  <th scope="col" className="px-2 text-right font-medium">60 ngày</th>
                  <th scope="col" className="px-2 text-right font-medium">90 ngày</th>
                  <th scope="col" className="pl-2 text-right font-medium">Trung vị tới đơn 2</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.cohortMonth} className="border-t border-stone-200">
                    <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{monthLabel(r.cohortMonth)}</th>
                    <td className="px-2 text-right font-medium">{formatCount(r.newBuyers)}</td>
                    <CohortCell w={r.d30} newBuyers={r.newBuyers} />
                    <CohortCell w={r.d60} newBuyers={r.newBuyers} />
                    <CohortCell w={r.d90} newBuyers={r.newBuyers} />
                    <td
                      className={`pl-2 text-right ${r.d90.complete ? 'text-stone-700' : 'text-stone-500'}`}
                      title={r.d90.complete || r.medianDaysToSecondOrder === null ? undefined : 'Chưa đủ 90 ngày theo dõi: mới tính khách quay lại sớm, số còn tăng'}
                    >
                      {medianCell(r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </div>
    </section>
  );
}

const FUNNEL_COLUMNS: ReadonlyArray<{ step: PurchaseFunnelStep; label: string }> = [
  { step: 'product_viewed', label: 'Xem SP' },
  { step: 'add_or_buy', label: 'Giỏ/Mua ngay' },
  { step: 'checkout_started', label: 'Thanh toán' },
  { step: 'place_order_click', label: 'Bấm Đặt hàng' },
  { step: 'order_placed', label: 'Đặt thành công' },
];

const stepTotal = (d: FunnelDailyDTO, step: PurchaseFunnelStep) => d.rows.find((r) => r.step === step)?.total ?? 0;

/** Tổng phiên và đơn đặt thành công của `days` ngày cuối (web + Mini App). */
export function funnelRecentTotals(rows: readonly FunnelDailyDTO[], days: number): { sessions: number; placed: number; pct: number | null } {
  const recent = rows.slice(-days);
  const sessions = recent.reduce((s, d) => s + d.sessions.total, 0);
  const placed = recent.reduce((s, d) => s + stepTotal(d, 'order_placed'), 0);
  return { sessions, placed, pct: ratioPct(placed, sessions) };
}

/** Phễu mua đã chốt theo ngày VN (bảng `funnel_daily_snapshot`): giữ được cả sau khi sự kiện thô bị dọn. */
export function FunnelDailyCard() {
  const q = useQuery({ queryKey: ['admin-analytics-funnel-daily'], queryFn: () => getFunnelDaily(30) });
  const rows = q.data ?? [];
  const sum = funnelRecentTotals(rows, FUNNEL_SUMMARY_DAYS);
  return (
    <section aria-label="Phễu mua theo ngày" className="mt-4 rounded-card border border-stone-200 bg-stone-0 p-3">
      <h3 className="text-base font-semibold text-stone-900">Phễu mua theo ngày</h3>
      <p className="mt-0.5 text-xs text-stone-500">
        Số phiên qua từng bước, web và Mini App cộng lại, chốt mỗi đêm theo ngày giờ Việt Nam. Số đã chốt được giữ cả khi sự kiện thô cũ đã được dọn.
      </p>
      <div className="mt-2">
        {q.isLoading ? (
          <ListSkeleton label="Đang tải phễu mua theo ngày" rows={3} className="h-10" />
        ) : q.isError || !q.data ? (
          <LoadError message="Không tải được phễu mua theo ngày." onRetry={() => q.refetch()} retrying={q.isFetching} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-stone-500">Chưa có ngày nào được chốt. Số liệu có sau đêm đầu tiên hệ thống chạy tổng hợp.</p>
        ) : (
          <>
            <p data-funnel-summary className="text-sm text-stone-900 tabular-nums">
              {FUNNEL_SUMMARY_DAYS} ngày gần nhất: <strong>{formatCount(sum.sessions)}</strong> phiên, <strong>{formatCount(sum.placed)}</strong> phiên đặt
              thành công ({formatPct(sum.pct)})
            </p>
            <ScrollRegion label="Phễu mua theo ngày" className="mt-2">
              <table className="w-full min-w-[600px] text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-stone-500">
                    <th scope="col" className="py-1 pr-2 font-medium">Ngày</th>
                    <th scope="col" className="px-2 text-right font-medium">Phiên</th>
                    {FUNNEL_COLUMNS.map((c) => (
                      <th key={c.step} scope="col" className="px-2 text-right font-medium">{c.label}</th>
                    ))}
                    <th scope="col" className="pl-2 text-right font-medium">Đặt/phiên</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(-FUNNEL_TABLE_DAYS).reverse().map((d) => (
                    <tr key={d.date} className="border-t border-stone-200">
                      <th scope="row" className="py-2 pr-2 text-left font-normal text-stone-900">{dayLabel(d.date)}</th>
                      <td className="px-2 text-right font-medium">{formatCount(d.sessions.total)}</td>
                      {FUNNEL_COLUMNS.map((c) => (
                        <td key={c.step} className="px-2 text-right">{formatCount(stepTotal(d, c.step))}</td>
                      ))}
                      <td className="pl-2 text-right text-stone-700">{formatPct(ratioPct(stepTotal(d, 'order_placed'), d.sessions.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          </>
        )}
      </div>
    </section>
  );
}
