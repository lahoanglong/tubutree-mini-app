'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSourceReport, type ReportRange, type SourceReport, type SourceReportBy } from '@/lib/admin-reports-client';
import { SOURCES_MAX_DAYS, formatPct, rangeError } from '@/lib/admin-reports';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { Notice, ScrollRegion, LoadError, chipClass } from './ui';

/**
 * Khách mới theo nguồn chạm đầu (sàn, thẻ hộp hàng, OA, CTV...) × tuần: đo chiến dịch kéo khách về app có ra đơn không. Số "đang tăng" là
 * tuần mà kỳ 30 ngày chưa đóng (khách tuần đó còn có thể đặt thêm), không phải tuần kém.
 */
export function ReportsSourcesSection({ range }: { range: ReportRange }) {
  const error = rangeError(range.from, range.to, SOURCES_MAX_DAYS);
  const [by, setBy] = useState<SourceReportBy>('source');
  const q = useQuery({
    queryKey: ['admin-report-sources', range.from, range.to, by],
    queryFn: () => getSourceReport(range, by),
    enabled: !error,
  });

  return (
    <section className="space-y-3" aria-labelledby="reports-sources-title">
      <h3 id="reports-sources-title" className="text-base font-semibold text-stone-900">
        Nguồn khách theo tuần
      </h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Nhóm báo cáo nguồn theo">
        <button type="button" aria-pressed={by === 'source'} className={chipClass(by === 'source')} onClick={() => setBy('source')}>
          Theo nguồn
        </button>
        <button type="button" aria-pressed={by === 'campaign'} className={chipClass(by === 'campaign')} onClick={() => setBy('campaign')}>
          Theo đợt thẻ, chiến dịch
        </button>
      </div>
      {error && (
        <Notice tone="warning" role="alert">
          {error} Báo cáo nguồn nối khách với đơn của họ nên giới hạn {SOURCES_MAX_DAYS} ngày.
        </Notice>
      )}
      {!error && q.isLoading && <p className="text-sm text-stone-500">Đang tải báo cáo nguồn…</p>}
      {!error && q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được báo cáo nguồn khách.</LoadError>}
      {q.data && !error && <SourcesBody report={q.data} by={by} />}
    </section>
  );
}

function SourcesBody({ report, by }: { report: SourceReport; by: SourceReportBy }) {
  const dim = by === 'campaign' ? 'Chiến dịch' : 'Nguồn';
  if (report.rows.length === 0) {
    return (
      <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-sm text-stone-500">
        Không có khách mới nào trong khoảng ngày này.
      </p>
    );
  }
  const d = report.windowDays;
  return (
    <>
      <Notice>
        Khách mới = tài khoản tạo trong khoảng ngày (không tính quản trị/nhân viên, và khách cũ được gắn nguồn lúc gộp khách). Đơn là đơn còn hiệu
        lực (đã xác nhận trở đi, không huỷ/trả). Có đơn đầu = đặt trong {d} ngày sau khi tạo tài khoản; có đơn 2 = đặt đơn thứ hai trong {d} ngày sau đơn
        đầu; doanh thu tính {d} ngày đầu theo cùng định nghĩa với Tổng quan chỉ số (đã thu, trừ hoàn một phần). &quot;Không rõ&quot; là tài khoản chưa ghi nguồn. Theo đợt thẻ: link in trên thẻ có card=&lt;đợt&gt; được ghi thành chiến dịch card-&lt;đợt&gt;; &quot;Không thuộc chiến dịch nào&quot; là khách vào không qua link có đợt.
      </Notice>
      <SourceTable
        label={`Tổng theo ${dim.toLowerCase()} trong khoảng ngày`}
        rows={report.bySource.map((r) => ({ key: r.source, first: r.label, second: null, ...r, open1: false, open2: false }))}
        totals={report.totals}
        firstHeader={dim}
        showWeek={false}
      />
      <SourceTable
        label={`Theo tuần và ${dim.toLowerCase()}`}
        rows={report.rows.map((r) => ({
          key: `${r.week}|${r.source}`,
          first: `Tuần ${formatDate(r.week)}`,
          second: r.label,
          ...r,
          open1: !r.firstWindowClosed,
          open2: !r.secondWindowClosed,
        }))}
        firstHeader="Tuần (từ thứ Hai)"
        secondHeader={dim}
        showWeek
      />
      <p className="text-xs text-stone-500">
        {formatDate(report.range.from)} – {formatDate(report.range.to)}. Tuần ở hai đầu khoảng chỉ gồm khách tạo trong các ngày đã chọn. Nguồn ngoài 40
        nguồn đông khách nhất gộp vào &quot;Nguồn khác&quot;.
      </p>
    </>
  );
}

interface TableRow {
  key: string;
  first: string;
  second: string | null;
  newUsers: number;
  firstOrderUsers: number;
  secondOrderUsers: number;
  revenue: number;
  open1: boolean;
  open2: boolean;
}

function SourceTable({
  label,
  rows,
  totals,
  firstHeader,
  secondHeader = 'Nguồn',
  showWeek,
}: {
  label: string;
  rows: TableRow[];
  totals?: { newUsers: number; firstOrderUsers: number; secondOrderUsers: number; revenue: number };
  firstHeader: string;
  secondHeader?: string;
  showWeek: boolean;
}) {
  const growing = <span className="ml-1 text-stone-500">(đang tăng)</span>;
  return (
    <ScrollRegion label={label} className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
      <table className="w-full min-w-[640px] text-left text-xs">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-stone-50 text-stone-500">
          <tr>
            <th className="px-3 py-2 font-medium">{firstHeader}</th>
            {showWeek && <th className="px-3 py-2 font-medium">{secondHeader}</th>}
            <th className="px-3 py-2 text-right font-medium">Khách mới</th>
            <th className="px-3 py-2 text-right font-medium">Có đơn đầu</th>
            <th className="px-3 py-2 text-right font-medium">Có đơn 2</th>
            <th className="px-3 py-2 text-right font-medium">Doanh thu</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={r.key} data-source-row={r.key}>
              <td className="px-3 py-2 font-medium text-stone-900">{r.first}</td>
              {showWeek && <td className="px-3 py-2 text-stone-700">{r.second}</td>}
              <td className="px-3 py-2 text-right text-stone-700">{r.newUsers}</td>
              <td className="px-3 py-2 text-right text-stone-700">
                {r.firstOrderUsers} <span className="text-stone-500">({formatPct(r.firstOrderUsers, r.newUsers)})</span>
                {r.open1 && growing}
              </td>
              <td className="px-3 py-2 text-right text-stone-700">
                {r.secondOrderUsers} <span className="text-stone-500">({formatPct(r.secondOrderUsers, r.firstOrderUsers)} của có đơn đầu)</span>
                {r.open2 && growing}
              </td>
              <td className="px-3 py-2 text-right text-stone-900">
                {formatVnd(r.revenue)}
                {r.open1 && growing}
              </td>
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot className="bg-stone-50 font-medium text-stone-900">
            <tr data-source-total>
              <td className="px-3 py-2">Cộng</td>
              <td className="px-3 py-2 text-right">{totals.newUsers}</td>
              <td className="px-3 py-2 text-right">{totals.firstOrderUsers}</td>
              <td className="px-3 py-2 text-right">{totals.secondOrderUsers}</td>
              <td className="px-3 py-2 text-right">{formatVnd(totals.revenue)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollRegion>
  );
}
