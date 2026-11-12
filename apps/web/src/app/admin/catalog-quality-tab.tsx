'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { findProductCopyFallback } from '@tubutree/app-core/commerce/product-copy-fallback';
import { isAbortError, loadCatalogForAudit, type CatalogAuditProgress, type CatalogAuditSource } from '@tubutree/app-core/commerce/catalog-audit-loader';
import {
  auditCatalogProducts,
  CATALOG_ISSUE_KINDS,
  CATALOG_ISSUE_LABELS,
  type CatalogAuditResult,
  type CatalogIssueKind,
} from '@tubutree/app-core/commerce/catalog-quality-audit';
import { apiFetch } from '@/lib/client-api';
import { BTN_SECONDARY, LoadError } from '@/components/admin/ui';

interface ListItem {
  slug: string;
  name: string;
  thumbnail?: string | null;
  inStock?: boolean;
}

/** Đọc catalog công khai (cùng nguồn khách thấy): danh sách theo trang rồi mô tả gốc từng sản phẩm. Không gửi phiên quản trị vì đường này công khai. */
const SOURCE: CatalogAuditSource = {
  async listPage(page, limit) {
    const res = await apiFetch<{ data: ListItem[]; meta: { total: number } }>(`/products?page=${page}&limit=${limit}`, { auth: false });
    return {
      rows: res.data.map((p) => ({ slug: p.slug, name: p.name, thumbnail: p.thumbnail ?? null, inStock: p.inStock !== false })),
      total: res.meta.total,
    };
  },
  async readDescription(slug) {
    const p = await apiFetch<{ description?: string | null }>(`/products/${encodeURIComponent(slug)}`, { auth: false });
    return p.description ?? null;
  },
};

const BADGE_TONE: Record<CatalogIssueKind, string> = {
  known_media_mismatch: 'bg-danger-bg text-danger-fg',
  missing_thumbnail: 'bg-warning-bg text-warning-fg',
  empty_native_description: 'bg-stone-100 text-stone-700',
};

const hasFallbackCopy = (slug: string) => findProductCopyFallback(slug) !== undefined;

type Filter = CatalogIssueKind | 'all';

export function CatalogQualityTab() {
  const [open, setOpen] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<CatalogAuditProgress | null>(null);
  const [error, setError] = useState(false);
  const [result, setResult] = useState<CatalogAuditResult | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const busy = useRef(false);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setError(false);
    setProgress(null);
    try {
      const load = await loadCatalogForAudit(SOURCE, { signal: c.signal, onProgress: setProgress });
      setResult(auditCatalogProducts(load.products, { hasFallbackCopy }));
      setUnreadable(load.unreadable.length);
      setFilter('all');
    } catch (e) {
      if (!isAbortError(e)) setError(true);
    } finally {
      busy.current = false;
      if (ctrl.current === c) ctrl.current = null;
      if (!c.signal.aborted) {
        setRunning(false);
        setProgress(null);
      }
    }
  }, []);

  const rows = result?.rows.filter((r) => filter === 'all' || r.issues.some((i) => i.kind === filter)) ?? [];
  const progressText = progress ? (progress.stage === 'list' ? `Đang đọc danh sách ${progress.done}/${progress.total}` : `Đang đọc mô tả ${progress.done}/${progress.total}`) : 'Đang bắt đầu';

  return (
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
      {open && (
        <div id="catalog-quality-body" className="space-y-3 border-t border-stone-200 p-3" aria-busy={running}>
          <p className="max-w-2xl text-sm text-stone-600">
            Tìm sản phẩm thiếu ảnh, ảnh lệch tên và mô tả gốc còn trống để sửa ngay trong Pancake. Số liệu lấy từ catalog đang hiện cho khách, nên sửa xong cần chờ đồng bộ rồi bấm Kiểm tra lại.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={BTN_SECONDARY} disabled={running} onClick={() => void run()}>
              {running ? 'Đang kiểm tra' : result || error ? 'Kiểm tra lại' : 'Kiểm tra ngay'}
            </button>
            {running && (
              <span role="status" className="text-sm text-stone-600">
                {progressText}
              </span>
            )}
          </div>
          {error && !running && <LoadError onRetry={() => void run()}>Không đọc được catalog. Kiểm tra mạng rồi thử lại.</LoadError>}
          {result && !error && (
            <>
              <p role="status" className="text-sm text-stone-700">
                {result.summary.flagged === 0
                  ? `Đã kiểm ${result.summary.total} sản phẩm, không có lỗi.`
                  : `Đã kiểm ${result.summary.total} sản phẩm: ${result.summary.flagged} sản phẩm cần sửa, trong đó ${result.summary.flaggedInStock} đang còn hàng.`}
              </p>
              {unreadable > 0 && (
                <p className="text-sm text-warning-fg">Chưa đọc được mô tả của {unreadable} sản phẩm nên chưa kiểm phần mô tả của chúng. Bấm Kiểm tra lại để đọc lại.</p>
              )}
              <div role="group" aria-label="Lọc theo loại lỗi" className="flex flex-wrap gap-2">
                <FilterChip active={filter === 'all'} onPress={() => setFilter('all')}>
                  Tất cả ({result.summary.flagged})
                </FilterChip>
                {CATALOG_ISSUE_KINDS.map((k) => (
                  <FilterChip key={k} active={filter === k} onPress={() => setFilter(k)}>
                    {CATALOG_ISSUE_LABELS[k]} ({result.summary.byKind[k]})
                  </FilterChip>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-stone-500">Không có sản phẩm nào thuộc loại lỗi này.</p>
              ) : (
                <ul className="divide-y divide-stone-200 rounded-control border border-stone-200" aria-label="Sản phẩm cần sửa">
                  {rows.map((r) => (
                    <li key={r.slug} className="space-y-1.5 p-3">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 break-words text-sm font-medium text-stone-900">{r.name}</span>
                        {r.inStock === false && <span className="rounded-full bg-stone-100 px-2 text-[11px] font-medium leading-5 text-stone-600">Hết hàng</span>}
                      </div>
                      <div className="break-all font-mono text-[11px] text-stone-500">{r.slug}</div>
                      <ul className="space-y-1">
                        {r.issues.map((i) => (
                          <li key={i.kind} className="flex items-start gap-2 text-sm text-stone-700">
                            <span className={`shrink-0 rounded-full px-2 text-[11px] font-semibold leading-5 ${BADGE_TONE[i.kind]}`}>{CATALOG_ISSUE_LABELS[i.kind]}</span>
                            <span className="min-w-0 break-words">{i.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function FilterChip({ active, onPress, children }: { active: boolean; onPress: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPress}
      className={`min-h-[44px] rounded-full border px-3 text-sm font-medium sm:min-h-[36px] ${active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50'}`}
    >
      {children}
    </button>
  );
}
