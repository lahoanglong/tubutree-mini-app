'use client';

import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Bell, Download } from 'lucide-react';
import { ADMIN_TABULAR } from '@/components/admin/tabular-nums';
import { BTN_SECONDARY, FIELD_XS, ListSkeleton, LoadError, Notice, ToneBadge } from '@/components/admin/ui';
import { actionErrorText } from '@/lib/admin-error-text';
import type { Tone } from '@/lib/recycling';
import { useDebounced } from '@/lib/use-debounced';
import {
  RESTOCK_TARGET_DAYS_DEFAULT,
  RESTOCK_TARGET_DAYS_OPTIONS,
  downloadRestockPoCsv,
  getRestockPlan,
  type RestockPlanRow,
} from './restock-plan-api';

/** Trần ô tìm, bằng `@MaxLength` của `RestockPlanQuery.q` ở API (input-limits.spec đối chiếu). */
const PLAN_SEARCH_MAX = 100;

function urgencyBadge(r: RestockPlanRow, windowDays: number): { tone: Tone; label: string } {
  if (r.urgency === 'OUT') return { tone: 'danger', label: r.stock > 0 ? 'Hết hàng (đã giữ cho đại lý)' : 'Hết hàng' };
  if (r.coverDays === null) return { tone: 'neutral', label: `Chưa bán trong ${windowDays} ngày` };
  return { tone: r.urgency === 'LOW' ? 'warning' : 'neutral', label: `Đủ bán ${r.coverDays} ngày` };
}

/**
 * "Kế hoạch nhập hàng": mỗi dòng là một biến thể hàng kho Tubu nên đặt thêm, gấp nhất trước (hết hàng → sắp hết → còn lại), với số đề xuất
 * ghép từ tồn bán được, tốc độ bán 14 ngày và số khách đang chờ chuông báo hàng về. Một nút duy nhất: tải file đặt hàng nhà cung cấp.
 */
export function RestockPlanner() {
  const [days, setDays] = useState<number>(RESTOCK_TARGET_DAYS_DEFAULT);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 300);
  const q = useQuery({
    queryKey: ['admin-restock-plan', days, term, supplier],
    queryFn: () => getRestockPlan(days, term, supplier),
    placeholderData: keepPreviousData,
  });
  const csv = useMutation({ mutationFn: () => downloadRestockPoCsv(days, term, supplier) });

  const report = q.data;
  const shownTerm = report?.q ?? term;
  const suppliers = report?.suppliers ?? [];
  // Nhà cung cấp đang chọn có thể không còn dòng sau khi đổi ô tìm: giữ trong danh sách để ô chọn không nhảy giá trị.
  const supplierOptions = supplier && !suppliers.some((s) => s.name === supplier) ? [...suppliers, { name: supplier, rows: 0, units: 0 }] : suppliers;
  const hidden = report ? report.counts.needReorder - report.rows.length : 0;

  return (
    <section className={`space-y-3 ${ADMIN_TABULAR}`} aria-labelledby="restock-plan-title" data-restock-plan>
      <h2 id="restock-plan-title" className="sr-only">
        Biến thể nên nhập thêm
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <label className="min-w-0 text-xs text-stone-600">
          Nhập đủ bán
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${FIELD_XS} mt-1 block min-h-[44px] w-full`} data-restock-days>
            {RESTOCK_TARGET_DAYS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} ngày
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 text-xs text-stone-600">
          Nhà cung cấp
          <select
            value={supplier ?? ''}
            onChange={(e) => setSupplier(e.target.value || null)}
            className={`${FIELD_XS} mt-1 block min-h-[44px] w-full`}
            data-restock-supplier
          >
            <option value="">Tất cả</option>
            {supplierOptions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.rows})
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-stone-600">
          Tìm SKU, sản phẩm hoặc nhà cung cấp
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={PLAN_SEARCH_MAX}
            placeholder="Vd: TB-NRC hoặc nuoc rua chen"
            className={`${FIELD_XS} mt-1 block min-h-[44px] w-full`}
            data-restock-search
          />
        </label>
        <button
          type="button"
          onClick={() => csv.mutate()}
          disabled={csv.isPending || !report || report.counts.needReorder === 0}
          aria-busy={csv.isPending || undefined}
          className={`${BTN_SECONDARY} inline-flex min-h-[44px] shrink-0 items-center gap-1.5`}
          title="File đặt hàng: mọi dòng cần nhập khớp bộ lọc, xếp theo nhà cung cấp"
          data-restock-csv
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {csv.isPending ? 'Đang tải…' : 'Tải file đặt hàng'}
        </button>
      </div>
      {csv.isError && (
        <Notice tone="danger" role="alert">
          Không tải được file đặt hàng: {actionErrorText(csv.error)}
        </Notice>
      )}
      <p className="text-xs text-stone-500" data-restock-formula>
        Đề xuất = số bán {report?.windowDays ?? 14} ngày qua (trừ đơn đại lý) quy ra {days} ngày + khách chờ báo hàng về + đại lý đặt trước chưa có hàng −
        tồn bán được. Nhà cung cấp lấy theo thương hiệu sản phẩm; hàng của gian hàng đối tác không có ở đây.
      </p>

      {q.isLoading && <ListSkeleton label="Đang tải kế hoạch nhập hàng" rows={4} className="h-16" />}
      {q.isError && <LoadError message={actionErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />}

      {report && (
        <>
          <p className="text-sm text-stone-700" data-restock-summary>
            {report.counts.needReorder} biến thể cần nhập, tổng {report.counts.units} đơn vị ({report.counts.outOfStock} đang hết hàng).
            {report.counts.waiting > 0 ? ` ${report.counts.waiting} khách đang chờ báo hàng về.` : ''}
          </p>
          {hidden > 0 && (
            <Notice tone="warning" role="status">
              Còn {hidden} dòng chưa hiện: bảng chỉ có {report.rows.length} dòng gấp nhất. Tải file đặt hàng để có đủ mọi dòng, hoặc lọc theo nhà cung cấp.
            </Notice>
          )}
          {report.rows.length === 0 && hidden === 0 ? (
            <p className="rounded-card border border-stone-200 bg-stone-0 px-3 py-6 text-center text-sm text-stone-600" data-restock-empty>
              {shownTerm && report.counts.scanned === 0
                ? `Không có SKU, sản phẩm hay nhà cung cấp nào khớp «${shownTerm}».`
                : `Chưa có biến thể nào cần nhập${report.supplier ? ` của ${report.supplier}` : ''}: tồn hiện có đủ bán ${report.targetDays} ngày và không có khách chờ hàng về.`}
            </p>
          ) : (
            <ul
              className={`divide-y divide-stone-200 rounded-card border border-stone-200 bg-stone-0 ${q.isPlaceholderData ? 'opacity-60' : ''}`}
              aria-busy={q.isPlaceholderData || undefined}
              data-restock-rows
            >
              {report.rows.map((r) => {
                const badge = urgencyBadge(r, report.windowDays);
                return (
                  <li key={r.variationId} className="px-3 py-2" data-sku={r.sku}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 break-words text-sm font-medium text-stone-900">
                        {r.productName}
                        {r.variationName && r.variationName !== r.productName ? <span className="font-normal text-stone-600"> · {r.variationName}</span> : null}
                      </p>
                      <p className="shrink-0 text-right text-xs text-stone-600" data-restock-qty>
                        Nhập <span className="text-base font-semibold text-stone-900">{r.suggestedQty}</span>
                      </p>
                    </div>
                    <p className="break-words text-xs text-stone-500">
                      SKU {r.sku} · {r.supplier}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-700">
                      <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
                      <span>
                        Tồn <b className={r.stock < 0 ? 'text-danger-fg' : ''}>{r.stock}</b>
                      </span>
                      <span>
                        Bán {report.windowDays} ngày <b>{r.sold}</b>
                      </span>
                      {r.waiting > 0 && (
                        <span className="inline-flex items-center gap-1" data-restock-waiting>
                          <Bell aria-hidden="true" className="h-3.5 w-3.5" />
                          <b>{r.waiting}</b> khách chờ
                        </span>
                      )}
                      {r.backordered > 0 && (
                        <span>
                          Đại lý chờ <b>{r.backordered}</b>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
