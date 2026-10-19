'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { downloadOrdersCsv } from '@/lib/admin-client';
import { downloadOrderItemsCsv, getRevenueReport, type ReportRange, type RevenueReport } from '@/lib/admin-reports-client';
import { REVENUE_MAX_DAYS, pivotRevenue, rangeError } from '@/lib/admin-reports';
import { formatVnd } from '@/lib/shop-client';
import { formatDate } from '@/lib/format-date';
import { BTN_SECONDARY, Notice, ScrollRegion, LoadError } from './ui';

/**
 * KPI theo khoảng ngày và bảng doanh thu ngày × kênh. "Doanh thu" là tiền đã thu thật (đơn huỷ/trả/hoàn không tính, trừ phần
 * đã hoàn một phần): đúng định nghĩa của thẻ "Tổng quan KPI" (mọi thời gian) nên cộng cả khoảng "từ đầu tới nay" sẽ ra cùng số.
 */
export function ReportsRevenueSection({ range }: { range: ReportRange }) {
  const error = rangeError(range.from, range.to, REVENUE_MAX_DAYS);
  const q = useQuery({
    queryKey: ['admin-report-revenue', range.from, range.to],
    queryFn: () => getRevenueReport(range),
    enabled: !error,
  });

  return (
    <section className="space-y-3" aria-labelledby="reports-revenue-title">
      <h3 id="reports-revenue-title" className="text-base font-semibold text-stone-900">
        Doanh thu theo ngày và kênh
      </h3>
      {error && <Notice tone="warning" role="alert">{error}</Notice>}
      {!error && q.isLoading && <p className="text-sm text-stone-500">Đang tải báo cáo…</p>}
      {!error && q.isError && <LoadError onRetry={() => void q.refetch()} retrying={q.isFetching}>Không tải được báo cáo doanh thu.</LoadError>}
      {q.data && !error && <RevenueBody report={q.data} />}
      <ExportButtons range={range} disabled={!!error} />
    </section>
  );
}

function RevenueBody({ report }: { report: RevenueReport }) {
  const t = report.totals;
  const pivot = pivotRevenue(report);
  const tiles: { label: string; value: string }[] = [
    { label: 'Doanh thu (đã thu)', value: formatVnd(t.revenue) },
    { label: 'Giá trị đặt (GMV)', value: formatVnd(t.gmv) },
    { label: 'Đơn đặt', value: String(t.orders) },
    { label: 'Đơn huỷ / trả', value: String(t.cancelled) },
    { label: 'Đã hoàn một phần', value: formatVnd(t.partialRefund) },
    { label: 'Khách mới', value: String(t.newUsers) },
  ];
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((x) => (
          <div key={x.label} data-kpi={x.label} className="rounded-card border border-stone-200 bg-stone-0 p-3 shadow-card">
            <dt className="text-xs text-stone-500">{x.label}</dt>
            <dd className="mt-1 text-base font-semibold text-stone-900">{x.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-stone-500">
        {formatDate(report.range.from)} – {formatDate(report.range.to)} ({report.range.days} ngày), tính theo {report.basis}. Doanh thu
        không gồm đơn huỷ, đơn trả, đơn đã hoàn tiền và COD đối tác tự thu; đã trừ phần hoàn một phần.
      </p>
      {pivot.rows.length === 0 ? (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-4 text-center text-sm text-stone-500">
          Không có đơn nào trong khoảng ngày này.
        </p>
      ) : (
        <ScrollRegion label="Doanh thu theo ngày và kênh" className="rounded-card border border-stone-200 bg-stone-0 shadow-card">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">Ngày</th>
                {pivot.columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Tổng</th>
                <th className="px-3 py-2 text-right font-medium">Đơn đặt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {pivot.rows.map((r) => (
                <tr key={r.day} data-day={r.day}>
                  <td className="px-3 py-2 font-medium text-stone-900">{formatDate(r.day)}</td>
                  {pivot.columns.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right text-stone-700">
                      {r.cells[c.key] ? formatVnd(r.cells[c.key]!) : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-medium text-stone-900">{formatVnd(r.total)}</td>
                  <td className="px-3 py-2 text-right text-stone-700">{r.orders}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-stone-50 font-medium text-stone-900">
              <tr data-total>
                <td className="px-3 py-2">Cộng</td>
                {pivot.columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 text-right">
                    {formatVnd(pivot.columnTotals[c.key] ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right">{formatVnd(pivot.grandTotal)}</td>
                <td className="px-3 py-2 text-right">{t.orders}</td>
              </tr>
            </tfoot>
          </table>
        </ScrollRegion>
      )}
    </>
  );
}

function ExportButtons({ range, disabled }: { range: ReportRange; disabled: boolean }) {
  const [busy, setBusy] = useState<'orders' | 'items' | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (kind: 'orders' | 'items') => {
    setMsg(null);
    setBusy(kind);
    try {
      const r = kind === 'orders' ? await downloadOrdersCsv({ from: range.from, to: range.to }) : await downloadOrderItemsCsv(range);
      setMsg({ ok: true, text: `Đã tải ${r.filename}.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Không xuất được CSV.' });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={disabled || busy !== null} onClick={() => void run('orders')} className={BTN_SECONDARY}>
          {busy === 'orders' ? 'Đang xuất…' : 'Xuất CSV đơn hàng'}
        </button>
        <button type="button" disabled={disabled || busy !== null} onClick={() => void run('items')} className={BTN_SECONDARY}>
          {busy === 'items' ? 'Đang xuất…' : 'Xuất CSV theo dòng hàng'}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        File đơn có thêm nền tảng, nguồn đơn, CTV giới thiệu và gian hàng; file dòng hàng mỗi sản phẩm một dòng. Cả hai theo ngày đặt trong
        khoảng đã chọn.
      </p>
      {msg && (
        <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </Notice>
      )}
    </div>
  );
}
