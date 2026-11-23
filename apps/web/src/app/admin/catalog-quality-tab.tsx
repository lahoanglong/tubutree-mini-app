'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COPY_DRAFT_MAX_BATCH, type CatalogAuditResponse } from '@tubutree/shared-types';
import { findProductCopyFallback } from '@tubutree/app-core/commerce/product-copy-fallback';
import { buildPancakeFixCsv, pancakeFixCsvFilename } from '@tubutree/app-core/commerce/catalog-pancake-csv';
import {
  auditProductDtos,
  CATALOG_ISSUE_KINDS,
  CATALOG_ISSUE_LABELS,
  COPY_STATUS_LABELS,
  COPY_STATUSES,
  type CatalogIssueKind,
  type CatalogIssueRow,
  type CopyStatus,
} from '@tubutree/app-core/commerce/catalog-quality-audit';
import Link from 'next/link';
import { ApiError } from '@/lib/client-api';
import { loadErrorText } from '@/lib/admin-error-text';
import { BTN_SECONDARY, LoadError, Notice } from '@/components/admin/ui';
import { AdvisorStatsCard } from './advisor-stats-card';
import { CatalogCategoryBulk } from './catalog-category-bulk';
import { CatalogCopyReview, type CurrentCopy } from './catalog-copy-review';
import { Count, FilterChip } from './catalog-filter-chip';
import { CatalogIngredientsFill } from './catalog-ingredients-fill';
import { CatalogIssueList } from './catalog-issue-list';
import { CatalogSeoBulk } from './catalog-seo-bulk';
import { downloadCsvText, getCatalogAudit } from './catalog-quality-api';
import { PancakeZeroPriceCard } from './pancake-zero-price-card';

const hasFallbackCopy = (slug: string) => findProductCopyFallback(slug) !== undefined;

/** `missing_ingredients` không phải loại lỗi của lần kiểm (app-core) mà là lọc nội dung: SKU đang bán chưa có thành phần (INCI). */
type IssueFilter = CatalogIssueKind | 'all' | 'missing_ingredients';
type CopyFilter = CopyStatus | 'any';

/**
 * Bộ lọc mang trên link (Giờ G mở `/admin?tab=catalogQuality&filter=missing_ingredients`). Chỉ nhận loại lỗi có thật hoặc `missing_ingredients`;
 * giá trị lạ thì bỏ qua, như trang Admin bỏ qua tham số lạ của tab khác.
 */
function urlIssueFilter(): Exclude<IssueFilter, 'all'> | null {
  if (typeof window === 'undefined') return null;
  const f = new URLSearchParams(window.location.search).get('filter');
  if (f === 'missing_ingredients') return f;
  return f !== null && (CATALOG_ISSUE_KINDS as readonly string[]).includes(f) ? (f as CatalogIssueKind) : null;
}

const loadFailureText = (e: unknown): string =>
  e instanceof ApiError && e.status === 403
    ? 'Tài khoản này không có quyền xem mục Kiểm tra catalog (chỉ dành cho quản trị viên).'
    : `Không đọc được catalog. ${loadErrorText(e)}`;

export function CatalogQualityTab() {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CatalogAuditResponse | null>(null);
  const [filter, setFilter] = useState<IssueFilter>('all');
  const [copyFilter, setCopyFilter] = useState<CopyFilter>('any');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const busy = useRef(false);
  // apiFetch không nhận tín hiệu huỷ: rời tab thì bỏ kết quả về muộn thay vì ghi vào component đã gỡ.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    setRunning(true);
    setError(null);
    try {
      const res = await getCatalogAudit();
      if (!alive.current) return false;
      setData(res);
      const ids = new Set(res.products.map((p) => p.id));
      setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
      return true;
    } catch (e) {
      if (alive.current) setError(loadFailureText(e));
      return false;
    } finally {
      busy.current = false;
      if (alive.current) setRunning(false);
    }
  }, []);

  // Link mang bộ lọc thì đi thẳng tới danh sách: đặt bộ lọc và tự chạy lần kiểm, khỏi phải tìm nút "Kiểm tra ngay".
  useEffect(() => {
    const f = urlIssueFilter();
    if (f === null) return;
    setFilter(f);
    void run();
  }, [run]);

  const result = useMemo(() => (data ? auditProductDtos(data.products, { hasFallbackCopy }) : null), [data]);
  const csv = useMemo(() => (data && result ? buildPancakeFixCsv(result, data.products) : null), [data, result]);
  // Dòng đầu là tiêu đề cột.
  const csvRows = csv ? Math.max(0, csv.split('\r\n').length - 1) : 0;
  const current = useMemo(
    () => new Map<string, CurrentCopy>((data?.products ?? []).map((p) => [p.id, { shortDesc: p.shortDesc, description: p.description, hasIngredients: p.hasIngredients }])),
    [data],
  );

  const activeProducts = (data?.products ?? []).filter((p) => p.isActive);
  const missingIngredients = activeProducts.filter((p) => !p.hasIngredients).map((p) => ({ id: p.id, name: p.name, brand: p.brand }));
  const missingIds = new Set(missingIngredients.map((p) => p.id));
  const storyKnown = activeProducts.filter((p) => p.hasStoryConfig !== undefined);
  const storyCustom = storyKnown.filter((p) => p.hasStoryConfig).length;

  const allRows = result?.rows ?? [];
  const flaggedById = new Map(allRows.filter((r) => r.id !== undefined).map((r) => [r.id!, r]));
  // SKU không có lỗi nào thì mô tả gốc không trống (trống là lỗi `empty_native_description`), nên tình trạng mô tả của dòng dựng thêm là `native`.
  const missingRows: CatalogIssueRow[] = activeProducts
    .filter((p) => missingIds.has(p.id))
    .map((p) => flaggedById.get(p.id) ?? { slug: p.slug, name: p.name, id: p.id, pancakeId: p.pancakeId, isActive: p.isActive, inStock: p.inStock, copyStatus: 'native', issues: [] });
  const baseRows = filter === 'missing_ingredients' ? missingRows : allRows.filter((r) => filter === 'all' || r.issues.some((i) => i.kind === filter));
  const rows = baseRows.filter((r) => copyFilter === 'any' || r.copyStatus === copyFilter);
  // Lọc "Thiếu thành phần" có dòng không nằm trong `allRows` (SKU không lỗi), nên đếm chip tình trạng mô tả trên chính danh sách đó để số khớp với dòng hiện ra.
  const countRows = filter === 'missing_ingredients' ? missingRows : allRows;
  const copyCounts = COPY_STATUSES.reduce<Record<CopyStatus, number>>(
    (acc, s) => ({ ...acc, [s]: countRows.filter((r) => r.copyStatus === s).length }),
    { native: 0, fallback: 0, none: 0, unknown: 0 },
  );
  const emptyRows = rows.filter((r) => r.id !== undefined && r.issues.some((i) => i.kind === 'empty_native_description'));
  // Dòng dựng thêm của SKU thiếu thành phần cũng tick được, nên tìm dòng đã chọn trên cả hai nguồn (không trùng vì dòng có lỗi đã dùng lại dòng của `allRows`).
  const selectableRows = [...allRows, ...missingRows.filter((r) => !flaggedById.has(r.id!))];
  const selectedRows = selectableRows.filter((r) => r.id !== undefined && selected.has(r.id));

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!on) next.delete(id);
      else if (next.size < COPY_DRAFT_MAX_BATCH) next.add(id);
      return next;
    });
  const selectEmpty = () => setSelected(new Set(emptyRows.slice(0, COPY_DRAFT_MAX_BATCH).map((r) => r.id!)));
  const afterSave = (savedIds: readonly string[]) => {
    setSelected((prev) => new Set([...prev].filter((id) => !savedIds.includes(id))));
    return run();
  };
  const exportCsv = () => {
    if (csv && csvRows > 0) downloadCsvText(csv, pancakeFixCsvFilename());
  };

  return (
    <div className="space-y-4">
      <section aria-labelledby="catalog-quality-title" className="rounded-card border border-stone-200 bg-stone-0">
        <h2 id="catalog-quality-title" className="m-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls="catalog-quality-body"
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left font-display text-lg font-semibold text-stone-900"
          >
            <span>Kiểm tra chất lượng Catalog</span>
            <span aria-hidden="true" className="text-sm text-stone-500">
              {open ? 'Thu gọn' : 'Mở rộng'}
            </span>
          </button>
        </h2>
        {/* Thu gọn chỉ ẩn (hidden), không gỡ thân khối khỏi cây: gỡ đi thì bản nháp thành phần, ô đã chọn và duyệt mô tả chưa lưu mất sạch. */}
        <div hidden={!open}>
          <div id="catalog-quality-body" className="space-y-3 border-t border-stone-200 p-3" aria-busy={running}>
            <p className="max-w-2xl text-sm text-stone-600">
              Tìm sản phẩm thiếu ảnh, ảnh lệch tên, giá hoặc tồn kho sai, biến thể chưa đặt tên và mô tả gốc còn trống, kể cả sản phẩm đang ẩn. Số liệu đọc thẳng từ cơ sở dữ liệu. Sửa giá, tồn và ảnh trong Pancake rồi chờ đồng bộ và bấm Kiểm tra lại; mô tả thì nhờ AI soạn bản nháp rồi duyệt lưu ngay tại đây.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={`${BTN_SECONDARY} aria-disabled:opacity-50`}
                aria-disabled={running || undefined}
                aria-busy={running || undefined}
                onClick={() => void run()}
              >
                {running ? 'Đang kiểm tra' : data || error ? 'Kiểm tra lại' : 'Kiểm tra ngay'}
              </button>
              {running && (
                <span role="status" className="text-sm text-stone-600">
                  Đang đọc catalog
                </span>
              )}
            </div>
            {error && !running && <LoadError onRetry={() => void run()}>{error}</LoadError>}
            {data && result && (
              <>
                {data.truncated && (
                  <Notice tone="warning" role="status">
                    Catalog vượt trần đọc của máy chủ nên danh sách đã bị cắt: các sản phẩm ngoài trần chưa được kiểm.
                  </Notice>
                )}
                <p role="status" className="text-sm text-stone-700">
                  {result.summary.flagged === 0
                    ? `Đã kiểm ${result.summary.total} sản phẩm, không có lỗi.`
                    : `Đã kiểm ${result.summary.total} sản phẩm: ${result.summary.flagged} sản phẩm cần sửa, trong đó ${result.summary.flaggedInStock} đang còn hàng.`}
                </p>
                <p className="text-sm text-stone-600">
                  Mô tả trên {result.summary.total} sản phẩm:{' '}
                  {COPY_STATUSES.filter((s) => s !== 'unknown' || result.summary.copy.unknown > 0).map((s, i) => (
                    <span key={s}>
                      {i > 0 && ' · '}
                      {COPY_STATUS_LABELS[s]}: <span className="tabular-nums">{result.summary.copy[s]}</span>
                    </span>
                  ))}
                </p>
                <p data-testid="catalog-content-coverage" className="text-sm text-stone-600">
                  {`Trên ${activeProducts.length} sản phẩm đang bán: thành phần (INCI) có ${activeProducts.length - missingIngredients.length}, thiếu ${missingIngredients.length}`}
                  {storyKnown.length > 0 && ` · câu chuyện tuỳ chỉnh ở Story Studio ${storyCustom}, dùng kịch bản mẫu ${storyKnown.length - storyCustom}`}.
                </p>
                <div role="group" aria-label="Lọc theo loại lỗi" className="flex flex-wrap gap-2">
                  <FilterChip active={filter === 'all'} onPress={() => setFilter('all')}>
                    Tất cả <Count n={result.summary.flagged} />
                  </FilterChip>
                  {CATALOG_ISSUE_KINDS.map((k) => (
                    <FilterChip key={k} active={filter === k} onPress={() => setFilter(k)}>
                      {CATALOG_ISSUE_LABELS[k]} <Count n={result.summary.byKind[k]} />
                    </FilterChip>
                  ))}
                  <FilterChip active={filter === 'missing_ingredients'} onPress={() => setFilter('missing_ingredients')}>
                    Thiếu thành phần <Count n={missingIngredients.length} />
                  </FilterChip>
                </div>
                <Link
                  href="/admin/catalog-wp-images"
                  className="inline-flex min-h-[44px] items-center text-sm font-medium text-forest-700 underline underline-offset-2 sm:min-h-[36px]"
                >
                  Bổ sung ảnh hàng loạt (kéo-thả, dán ảnh)
                </Link>
                <div role="group" aria-label="Lọc theo tình trạng mô tả" className="flex flex-wrap gap-2">
                  <FilterChip active={copyFilter === 'any'} onPress={() => setCopyFilter('any')}>
                    Mọi tình trạng mô tả
                  </FilterChip>
                  {COPY_STATUSES.filter((s) => s !== 'unknown' || copyCounts.unknown > 0).map((s) => (
                    <FilterChip key={s} active={copyFilter === s} onPress={() => setCopyFilter(s)}>
                      {COPY_STATUS_LABELS[s]} <Count n={copyCounts[s]} />
                    </FilterChip>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button type="button" className={BTN_SECONDARY} disabled={csvRows === 0} onClick={exportCsv}>
                    Xuất CSV sửa Pancake
                  </button>
                  <span className="text-sm text-stone-600">
                    {csvRows === 0 ? (
                      'Không có biến thể lỗi nào để xuất (giá sai, tồn giả, chưa đặt tên).'
                    ) : (
                      <>
                        Sẽ xuất <span className="tabular-nums">{csvRows}</span> dòng biến thể lỗi, kể cả biến thể và sản phẩm đang ẩn.
                      </>
                    )}
                  </span>
                </div>
                <CatalogIngredientsFill products={missingIngredients} total={activeProducts.length} onSaved={() => run()} />
                <CatalogSeoBulk />
                <CatalogCopyReview
                  selected={selectedRows.map((r) => ({ id: r.id!, name: r.name }))}
                  current={current}
                  emptyCount={emptyRows.length}
                  auditBusy={running}
                  onSelectEmpty={selectEmpty}
                  onSaved={afterSave}
                />
                {rows.length === 0 ? (
                  <p className="text-sm text-stone-500">Không có sản phẩm nào thuộc bộ lọc này.</p>
                ) : (
                  <CatalogIssueList rows={rows} selected={selected} selectionFull={selected.size >= COPY_DRAFT_MAX_BATCH} missingIngredients={missingIds} onToggle={toggle} />
                )}
              </>
            )}
          </div>
        </div>
      </section>
      <CatalogCategoryBulk />
      <PancakeZeroPriceCard />
      <AdvisorStatsCard />
    </div>
  );
}
