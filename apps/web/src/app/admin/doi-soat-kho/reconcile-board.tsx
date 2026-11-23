'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { ProductEditDrawer } from '@/components/admin/product-edit-drawer';
import { ADMIN_TABULAR } from '@/components/admin/tabular-nums';
import { BTN_SECONDARY, FIELD_XS, ListSkeleton, LoadError, Notice, ToneBadge, chipClass } from '@/components/admin/ui';
import { useDebounced } from '@/lib/use-debounced';
import { actionErrorText } from '@/lib/admin-error-text';
import { buildCategoryTree } from '@/lib/category-tree';
import { formatDateTime } from '@/lib/format-date';
import { listAdminCategories, type CategoryOption } from '@/lib/product-categories';
import type { Tone } from '@/lib/recycling';
import {
  RECONCILE_FLAGS,
  downloadPancakeReconcileCsv,
  getPancakeReconcile,
  isReconcileFlag,
  type ReconcileFlag,
  type ReconcileRow,
} from './reconcile-api';

const FLAG_META: Record<ReconcileFlag, { label: string; tone: Tone; hint: string }> = {
  NEGATIVE_LOCAL: { label: 'Tồn âm', tone: 'danger', hint: 'Cửa hàng ghi tồn dưới 0: đã bán quá số có.' },
  ZERO_LOCAL_PANCAKE_POSITIVE: { label: 'Hết ở cửa hàng, Pancake còn', tone: 'danger', hint: 'Khách thấy hết hàng trong khi kho Pancake còn hàng chưa ai giữ.' },
  DRIFT: { label: 'Lệch tồn', tone: 'warning', hint: 'Tồn cửa hàng khác (Pancake − đang giữ chỗ) quá ngưỡng.' },
  UNLINKED: { label: 'Chưa gắn Pancake', tone: 'info', hint: 'Biến thể đang bán nhưng chưa có mã Pancake: tồn không tự đồng bộ.' },
  NEVER_SYNCED: { label: 'Chưa đồng bộ lần nào', tone: 'neutral', hint: 'Đã gắn Pancake nhưng chưa nhận số tồn nào từ Pancake.' },
};

const DRIFT_OPTIONS = [0, 1, 3, 5, 10, 20] as const;
const CATEGORY_KEY = ['admin-category-options'] as const;

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
/** Trần ô tìm, bằng `@MaxLength` của `PancakeReconcileQuery.q` ở API (input-limits.spec đối chiếu). */
const RECONCILE_SEARCH_MAX = 100;

/**
 * Bộ lọc nằm trên URL (`/admin/doi-soat-kho?flag=UNLINKED&q=nuoc`) để bảng kiểm Giờ G và đồng nghiệp mở thẳng đúng nhóm dòng.
 * Chỉ đọc sau khi mount (bảng chỉ dựng sau khi biết quyền, nên luôn ở trình duyệt).
 */
function readUrlFilters(): { flag: ReconcileFlag | null; q: string } {
  if (typeof window === 'undefined') return { flag: null, q: '' };
  const sp = new URLSearchParams(window.location.search);
  const flag = sp.get('flag');
  return { flag: isReconcileFlag(flag) ? flag : null, q: (sp.get('q') ?? '').slice(0, RECONCILE_SEARCH_MAX) };
}

function writeUrlFilters(flag: ReconcileFlag | null, q: string) {
  if (typeof window === 'undefined') return;
  const sp = new URLSearchParams();
  if (flag) sp.set('flag', flag);
  if (q) sp.set('q', q);
  const qs = sp.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}

/**
 * Bảng đối soát tồn Pancake: chỉ đọc. Mỗi dòng là một biến thể có ít nhất một cờ, xếp cờ nặng trước rồi lệch nhiều trước.
 * `canEdit` (ADMIN) mở ngăn kéo sửa sản phẩm ngay trên trang; nhân viên KHO chỉ xem vì API sửa sản phẩm chỉ nhận ADMIN.
 */
export function ReconcileBoard({ canEdit }: { canEdit: boolean }) {
  const [initial] = useState(readUrlFilters);
  const [minDrift, setMinDrift] = useState<number>(3);
  const [flag, setFlag] = useState<ReconcileFlag | null>(initial.flag);
  const [search, setSearch] = useState(initial.q);
  const term = useDebounced(search.trim(), 300);
  const [editing, setEditing] = useState<string | null>(null);
  // Giữ bảng cũ trong lúc tải kết quả tìm mới: gõ từng chữ không làm bảng nháy về khung chờ.
  const q = useQuery({ queryKey: ['admin-pancake-reconcile', minDrift, term], queryFn: () => getPancakeReconcile(minDrift, term), placeholderData: keepPreviousData });
  const csv = useMutation({ mutationFn: () => downloadPancakeReconcileCsv(minDrift, term, flag) });
  useEffect(() => writeUrlFilters(flag, term), [flag, term]);
  const cats = useQuery({ queryKey: CATEGORY_KEY, queryFn: listAdminCategories, staleTime: 30_000, enabled: canEdit && editing !== null });
  const categories = useMemo<CategoryOption[]>(
    () =>
      buildCategoryTree(cats.data?.items ?? []).flatMap((root) => [
        { id: root.id, name: root.name, productCount: root.productCount, hasChildren: root.children.length > 0 },
        ...root.children.map((c) => ({ id: c.id, name: `${root.name} › ${c.name}`, productCount: c.productCount, hasChildren: false })),
      ]),
    [cats.data],
  );

  const report = q.data;
  // Chữ tóm tắt theo đúng từ khoá của dữ liệu đang hiện (keepPreviousData giữ số cũ trong lúc tải từ khoá mới).
  const shownTerm = report?.q ?? term;
  const rows: ReconcileRow[] = useMemo(() => (report ? (flag ? report.rows.filter((r) => r.flags.includes(flag)) : report.rows) : []), [report, flag]);
  // Số trên chip đếm mọi biến thể, còn bảng chỉ có các dòng nặng nhất API trả về: dòng nằm ngoài phần cắt thì nói rõ, không báo "khớp Pancake".
  const hidden = report ? (flag ? report.counts[flag] : report.counts.withIssues) - rows.length : 0;

  return (
    <section className={`space-y-3 ${ADMIN_TABULAR}`} aria-labelledby="reconcile-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="reconcile-title" className="text-base font-semibold">
          Biến thể cần xem
        </h2>
        <div className="flex items-end gap-2">
          <label className="text-xs text-stone-600">
            Ngưỡng lệch
            <select
              value={minDrift}
              onChange={(e) => setMinDrift(Number(e.target.value))}
              className={`${FIELD_XS} mt-1 block min-h-[44px]`}
              aria-describedby="reconcile-drift-hint"
            >
              {DRIFT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Mọi mức lệch' : `Lệch trên ${n}`}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className={`${BTN_SECONDARY} min-h-[44px]`}>
            {q.isFetching ? 'Đang tải…' : 'Tải lại'}
          </button>
        </div>
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-stone-600">
          Tìm SKU hoặc tên sản phẩm
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={RECONCILE_SEARCH_MAX}
            placeholder="Vd: TB-NRC hoặc nuoc rua chen"
            className={`${FIELD_XS} mt-1 block min-h-[44px] w-full`}
            data-reconcile-search
          />
        </label>
        <button
          type="button"
          onClick={() => csv.mutate()}
          disabled={csv.isPending || !report}
          aria-busy={csv.isPending || undefined}
          className={`${BTN_SECONDARY} inline-flex min-h-[44px] shrink-0 items-center gap-1.5`}
          title="Mọi dòng lệch khớp bộ lọc, không cắt như bảng, kèm cột Cách xử lý"
          data-reconcile-csv
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          {csv.isPending ? 'Đang tải…' : 'Tải CSV'}
        </button>
      </div>
      {csv.isError && (
        <Notice tone="danger" role="alert">
          Không tải được file CSV: {actionErrorText(csv.error)}
        </Notice>
      )}
      <p id="reconcile-drift-hint" className="text-xs text-stone-500">
        Tồn cửa hàng đúng ra = số Pancake lần đồng bộ gần nhất − số đang giữ chỗ cho đơn chưa đẩy. Trang chỉ đọc: sửa tồn ở Pancake rồi chờ lượt đồng bộ kế tiếp.
      </p>

      {q.isLoading && <ListSkeleton label="Đang tải bảng đối soát tồn" rows={4} className="h-16" />}
      {q.isError && <LoadError message={actionErrorText(q.error)} onRetry={() => q.refetch()} retrying={q.isFetching} />}

      {report && (
        <>
          <p className="text-sm text-stone-700" data-reconcile-summary>
            Đã quét {report.counts.scanned} biến thể{shownTerm ? ` khớp «${shownTerm}»` : ''} ({report.counts.linked} đã gắn Pancake), {report.counts.withIssues} cần xem.
            {report.lastSyncedAt ? ` Pancake đồng bộ gần nhất ${formatDateTime(report.lastSyncedAt)}.` : ' Chưa nhận số tồn nào từ Pancake.'}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc theo loại lệch">
            <button type="button" aria-pressed={flag === null} onClick={() => setFlag(null)} className={chipClass(flag === null)}>
              Tất cả ({report.counts.withIssues})
            </button>
            {RECONCILE_FLAGS.filter((f) => report.counts[f] > 0 || flag === f).map((f) => (
              <button key={f} type="button" aria-pressed={flag === f} onClick={() => setFlag(flag === f ? null : f)} className={chipClass(flag === f)}>
                {FLAG_META[f].label} ({report.counts[f]})
              </button>
            ))}
          </div>
          {hidden > 0 && (
            <Notice tone="warning" role="status">
              Còn {hidden} dòng{flag ? ` «${FLAG_META[flag].label}»` : ''} chưa hiện: bảng chỉ có {report.rows.length} dòng nặng nhất. Bấm «Tải CSV» để có đủ mọi dòng, hoặc tìm theo SKU.
            </Notice>
          )}
          {rows.length === 0 && hidden === 0 ? (
            <p className="rounded-card border border-stone-200 bg-stone-0 px-3 py-6 text-center text-sm text-stone-600">
              {shownTerm && report.counts.scanned === 0
                ? `Không có SKU hay sản phẩm kho Tubu nào khớp «${shownTerm}».`
                : flag
                  ? `Không có dòng «${FLAG_META[flag].label}»${shownTerm ? ` khớp «${shownTerm}»` : ''}.`
                  : shownTerm
                    ? `Các biến thể khớp «${shownTerm}» không có dòng lệch nào.`
                    : 'Không có biến thể nào lệch. Tồn cửa hàng khớp Pancake.'}
            </p>
          ) : (
            <ul
              className={`divide-y divide-stone-200 rounded-card border border-stone-200 bg-stone-0 ${q.isPlaceholderData ? 'opacity-60' : ''}`}
              aria-busy={q.isPlaceholderData || undefined}
              data-reconcile-rows
            >
              {rows.map((r) => (
                <li key={r.variationId} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2" data-sku={r.sku}>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-stone-900">
                      {r.productName}
                      {r.variationName && r.variationName !== r.productName ? <span className="font-normal text-stone-600"> · {r.variationName}</span> : null}
                    </p>
                    <p className="text-xs text-stone-500">
                      SKU {r.sku}
                      {!r.productActive && ' · sản phẩm đang ẩn'}
                      {r.lastSyncedAt && ` · đồng bộ ${formatDateTime(r.lastSyncedAt)}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.flags.map((f) => (
                        <span key={f} title={FLAG_META[f].hint}>
                          <ToneBadge tone={FLAG_META[f].tone}>{FLAG_META[f].label}</ToneBadge>
                        </span>
                      ))}
                    </div>
                    <dl className="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-700">
                      <div className="flex gap-1">
                        <dt>Cửa hàng</dt>
                        <dd className={`font-semibold ${r.stock < 0 ? 'text-danger-fg' : ''}`}>{r.stock}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Pancake</dt>
                        <dd className="font-semibold">{r.pancakeStock ?? '—'}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>Giữ chỗ</dt>
                        <dd className="font-semibold">{r.reservedStock}</dd>
                      </div>
                      {r.drift !== null && (
                        <div className="flex gap-1">
                          <dt>Lệch</dt>
                          <dd className={`font-semibold ${r.flags.includes('DRIFT') ? 'text-warning-fg' : ''}`}>{signed(r.drift)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(r.productId)}
                      className={`${BTN_SECONDARY} min-h-[44px] min-w-[44px] shrink-0`}
                      aria-label={`Sửa sản phẩm ${r.productName}`}
                    >
                      Sửa sản phẩm
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canEdit && editing && (
        <ProductEditDrawer id={editing} categories={categories} onClose={() => setEditing(null)} onSaved={() => void q.refetch()} />
      )}
    </section>
  );
}
