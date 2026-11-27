'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getExternalClaimFunnel, type ExternalClaimFunnelPeriod } from '@/lib/admin-client';
import { groupThousands } from '@/lib/external-claims';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/shop-client';
import { DlRow, LoadError, chipClass } from './ui';

const PERIODS: { value: ExternalClaimFunnelPeriod; label: string }[] = [
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
];

/** 0,1234 → "12,3%". */
export function funnelRateText(rate: number): string {
  const pct = Number.isFinite(rate) ? Math.max(0, rate) * 100 : 0;
  return `${pct.toFixed(1).replace('.', ',')}%`;
}

/**
 * Số liệu đơn sàn → Điểm Xanh → mua lại trên Mini App hoặc web (W43), cho ADMIN, CSKH và KE_TOAN. Chỉ đơn sàn khách quét hoặc gõ mã
 * vận đơn; đơn chốt qua chat không tính. Chỉ số đếm và tổng, không có tên hay SĐT khách.
 */
export function ExternalClaimsFunnelCard() {
  const [period, setPeriod] = useState<ExternalClaimFunnelPeriod>('30d');
  const q = useQuery({
    queryKey: ['admin-external-claims-funnel', period],
    queryFn: () => getExternalClaimFunnel(period),
    // API giữ kết quả 60 giây cho mỗi kỳ: đổi qua lại giữa các chip trong khoảng đó không cần hỏi lại.
    staleTime: 60_000,
  });
  const f = q.data;
  const n = groupThousands;

  return (
    <section aria-labelledby="external-funnel-title" data-external-funnel className="rounded-card border border-stone-200 bg-stone-0 p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="external-funnel-title" className="font-display text-sm font-semibold text-stone-900">
          Phễu tích điểm đơn sàn
        </h3>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Khoảng thời gian">
          {PERIODS.map((p) => (
            <button key={p.value} type="button" aria-pressed={period === p.value} onClick={() => setPeriod(p.value)} className={chipClass(period === p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {q.isError ? (
        <div className="mt-3">
          <LoadError onRetry={() => q.refetch()} retrying={q.isFetching}>
            Không tải được số liệu.
          </LoadError>
        </div>
      ) : !f ? (
        <p role="status" className="mt-3 text-xs text-stone-500">
          Đang tải…
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-stone-800 sm:grid-cols-2">
            <DlRow label="Lượt gửi mã">
              {n(f.submissions.total)} (quét {n(f.submissions.scan)}, gõ tay {n(f.submissions.typed)})
            </DlRow>
            <DlRow label="Đơn sàn tìm thấy">{n(f.matchedOrders)}</DlRow>
            <DlRow label="SĐT trên đơn khác SĐT thành viên">
              {n(f.phoneMismatch.rejected)} lượt bị từ chối, {n(f.phoneMismatch.review)} yêu cầu phải duyệt
            </DlRow>
            <DlRow label="Mã chưa tìm thấy đơn">{n(f.unmatched)}</DlRow>
            <DlRow label="Đang chờ cộng">
              {n(f.pending.claims)} yêu cầu, {n(f.pending.points)} điểm
            </DlRow>
            <DlRow label="Đã cộng điểm">
              {n(f.credited.claims)} yêu cầu, {n(f.credited.points)} điểm, {n(f.credited.users)} khách
            </DlRow>
            <DlRow label="Quay lại mua trên Mini App hoặc web" className="sm:col-span-2">
              {n(f.converted.users)} khách ({funnelRateText(f.converted.rate)} số khách đã cộng điểm), {n(f.converted.orders)} đơn,{' '}
              {formatVnd(f.converted.gmv)}
            </DlRow>
          </dl>
          <p className="mt-2 text-xs text-stone-500">
            Tính lúc {formatDateTime(f.to)}. Chỉ đơn sàn khách quét hoặc gõ mã vận đơn, không gồm đơn chốt qua chat. Bản app cũ không ghi cách
            nhập nên quét cộng gõ tay có thể nhỏ hơn tổng.
          </p>
        </>
      )}
    </section>
  );
}
