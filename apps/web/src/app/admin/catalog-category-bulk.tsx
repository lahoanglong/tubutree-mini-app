'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AdminImage } from '@/components/admin/admin-image';
import { useToastedMessage } from '@/components/admin/admin-toast';
import { FIELD_CLASS, LoadError, Notice } from '@/components/admin/ui';
import { actionErrorText, loadErrorText } from '@/lib/admin-error-text';
import { ApiError } from '@/lib/client-api';
import {
  getCategorySuggestions,
  postCategoryApply,
  type CategorySuggestionList,
  type CategorySuggestionRow,
} from './catalog-quality-api';

// Như "Duyệt SEO sản phẩm": màn dùng được trên điện thoại nên mọi nút và ô nhập giữ 44px ở mọi cỡ màn.
const TOUCH = 'min-h-[44px]';
const BTN_BASE = `${TOUCH} rounded-control px-3.5 py-1.5 text-sm font-medium aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;
const BTN_PRIMARY_44 = `${BTN_BASE} bg-forest-600 text-stone-0 hover:bg-forest-700`;
const BTN_SECONDARY_44 = `${BTN_BASE} border border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50`;
const FIELD_44 = `block w-full ${TOUCH} ${FIELD_CLASS}`;
/** Trần DTO (CategoryApplyItemDto.categoryIds = PRODUCT_CATEGORIES_MAX ở apps/api). */
const CATEGORIES_PER_PRODUCT_MAX = 10;

type Filter = 'all' | 'auto' | 'review';

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi');

const percent = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * Gán danh mục cho sản phẩm CHƯA CÓ danh mục theo gợi ý của máy chủ (luật theo tên và nhãn hàng, `category-suggest.ts` ở apps/api).
 * Không có gì tự ghi: admin xem, sửa danh mục từng dòng, chọn dòng rồi bấm "Áp dụng N sản phẩm". Máy chủ ghi cả lô hoặc không ghi gì; dòng nào đã có
 * danh mục hay vừa bị sửa từ lúc mở bảng thì cả lô bị từ chối (409), bảng tự tải lại và giữ lựa chọn của các dòng còn lại.
 */
export function CatalogCategoryBulk() {
  const [data, setData] = useState<CategorySuggestionList | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Lỗi (dòng chưa chọn danh mục, 409 kèm tên sản phẩm) đứng cạnh bảng cần sửa; chỉ báo thành công lên toast.
  const inlineMsg = useToastedMessage(msg, { successOnly: true });
  const searchId = useId();
  const loadBusy = useRef(false);
  const saveBusy = useRef(false);
  // apiFetch không nhận tín hiệu huỷ: rời màn thì bỏ kết quả về muộn.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async (): Promise<boolean> => {
    if (loadBusy.current) return false;
    loadBusy.current = true;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getCategorySuggestions();
      if (!alive.current) return false;
      // Sản phẩm vừa có danh mục rời bảng: bỏ lựa chọn và bản sửa của nó, giữ của các dòng còn lại.
      const ids = new Set(res.items.map((i) => i.id));
      setData(res);
      setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))));
      return true;
    } catch (e) {
      if (alive.current)
        setLoadError(`Không đọc được danh sách gợi ý danh mục. ${loadErrorText(e)}`);
      return false;
    } finally {
      loadBusy.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const autoMin = data?.autoMin ?? 0.9;
  const isAuto = useCallback(
    (r: CategorySuggestionRow) =>
      r.suggestion.categoryIds.length > 0 && r.suggestion.confidence >= autoMin,
    [autoMin],
  );
  const autoIds = useMemo(() => rows.filter(isAuto).map((r) => r.id), [rows, isAuto]);
  const catName = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c.name])),
    [data],
  );

  const shown = useMemo(() => {
    const q = fold(query.trim());
    return rows.filter(
      (r) =>
        (filter === 'all' || (filter === 'auto') === isAuto(r)) &&
        (q === '' || fold(`${r.name} ${r.brand}`).includes(q)),
    );
  }, [rows, filter, query, isAuto]);

  const catsOf = (r: CategorySuggestionRow): string[] => drafts[r.id] ?? r.suggestion.categoryIds;
  const toggleRow = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleCat = (r: CategorySuggestionRow, catId: string) => {
    const cur = catsOf(r);
    if (!cur.includes(catId) && cur.length >= CATEGORIES_PER_PRODUCT_MAX) {
      setMsg({ ok: false, text: `Mỗi sản phẩm tối đa ${CATEGORIES_PER_PRODUCT_MAX} danh mục.` });
      return;
    }
    const next = cur.includes(catId) ? cur.filter((id) => id !== catId) : [...cur, catId];
    setDrafts((prev) => ({ ...prev, [r.id]: next }));
    // Sửa danh mục của một dòng là muốn áp dụng dòng đó.
    if (next.length > 0) toggleRow(r.id, true);
  };

  const selectAuto = () => {
    if (autoIds.length === 0) {
      setMsg({ ok: false, text: `Không có gợi ý nào từ ${percent(autoMin)}: chọn tay từng dòng.` });
      return;
    }
    setSelected((prev) => new Set([...prev, ...autoIds]));
  };

  const apply = async () => {
    if (saveBusy.current || selected.size === 0) return;
    const chosen = rows.filter((r) => selected.has(r.id));
    const empty = chosen.filter((r) => catsOf(r).length === 0);
    if (empty.length > 0) {
      setMsg({
        ok: false,
        text: `Chưa chọn danh mục cho: ${empty.map((r) => `"${r.name}"`).join(', ')}. Chọn danh mục hoặc bỏ chọn dòng đó.`,
      });
      return;
    }
    const items = chosen.map((r) => ({
      productId: r.id,
      categoryIds: catsOf(r),
      expectedUpdatedAt: r.updatedAt,
    }));
    saveBusy.current = true;
    setSaving(true);
    setMsg(null);
    try {
      const res = await postCategoryApply(items);
      if (!alive.current) return;
      setMsg({ ok: true, text: `Đã gán danh mục cho ${res.applied} sản phẩm.` });
      await load();
    } catch (e) {
      if (!alive.current) return;
      const stale = e instanceof ApiError && e.status === 409;
      setMsg({
        ok: false,
        text: stale
          ? `${actionErrorText(e)} Bảng đã tải lại; các dòng còn lại giữ nguyên lựa chọn.`
          : actionErrorText(e),
      });
      if (stale) await load();
    } finally {
      saveBusy.current = false;
      if (alive.current) setSaving(false);
    }
  };

  const cannotApply = saving || selected.size === 0;

  return (
    <div
      role="region"
      aria-labelledby="category-bulk-title"
      className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3"
    >
      <h3
        id="category-bulk-title"
        className="m-0 font-display text-base font-semibold text-stone-900"
      >
        Gán danh mục hàng loạt
      </h3>
      <p className="max-w-2xl text-sm text-stone-600">
        Sản phẩm chưa có danh mục không hiện khi khách lọc theo danh mục. Gợi ý dựa vào tên và nhãn
        hàng; bạn xem, sửa rồi mới bấm Áp dụng.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BTN_SECONDARY_44}
          aria-disabled={loading || undefined}
          aria-busy={loading || undefined}
          onClick={() => void load()}
        >
          {loading ? 'Đang tải…' : data ? 'Tải lại danh sách' : 'Mở bảng gợi ý'}
        </button>
        {data?.truncated && (
          <Notice tone="warning" role="status">
            Danh sách vượt trần đọc của máy chủ nên đã bị cắt.
          </Notice>
        )}
      </div>
      {loadError && !loading && <LoadError onRetry={() => load()}>{loadError}</LoadError>}
      {data && (
        <>
          <p data-testid="category-bulk-summary" className="m-0 text-sm text-stone-700">
            <span className="tabular-nums">{data.summary.total}</span> sản phẩm chưa có danh mục (
            <span className="tabular-nums">{data.summary.onSale}</span> đang bán):{' '}
            <span className="tabular-nums">{data.summary.autoReady}</span> gợi ý chắc chắn (từ{' '}
            {percent(autoMin)}), <span className="tabular-nums">{data.summary.needsReview}</span>{' '}
            cần xem.
          </p>
          {rows.length > 0 && (
            <>
              <div role="group" aria-label="Lọc gợi ý danh mục" className="flex flex-wrap gap-2">
                <Chip active={filter === 'all'} onPress={() => setFilter('all')}>
                  Tất cả <span className="tabular-nums">({rows.length})</span>
                </Chip>
                <Chip active={filter === 'auto'} onPress={() => setFilter('auto')}>
                  Chắc chắn <span className="tabular-nums">({autoIds.length})</span>
                </Chip>
                <Chip active={filter === 'review'} onPress={() => setFilter('review')}>
                  Cần xem <span className="tabular-nums">({rows.length - autoIds.length})</span>
                </Chip>
              </div>
              <div>
                <label htmlFor={searchId} className="text-xs font-medium text-stone-700">
                  Tìm theo tên hoặc thương hiệu
                </label>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ví dụ: nước rửa chén, Pơ Lang"
                  className={`mt-1 ${FIELD_44}`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={BTN_SECONDARY_44} onClick={selectAuto}>
                  Chọn mọi gợi ý từ {percent(autoMin)}{' '}
                  <span className="tabular-nums">({autoIds.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => void apply()}
                  aria-disabled={cannotApply || undefined}
                  aria-busy={saving || undefined}
                  className={BTN_PRIMARY_44}
                >
                  {saving ? 'Đang áp dụng…' : `Áp dụng ${selected.size} sản phẩm`}
                </button>
              </div>
            </>
          )}
          {inlineMsg && (
            <Notice
              tone={inlineMsg.ok ? 'success' : 'danger'}
              role={inlineMsg.ok ? 'status' : 'alert'}
            >
              {inlineMsg.text}
            </Notice>
          )}
          {rows.length === 0 ? (
            <p className="text-sm text-stone-600">Mọi sản phẩm đều đã có danh mục.</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-stone-600">
              Không có sản phẩm nào khớp với bộ lọc và từ khoá này.
            </p>
          ) : (
            <ul className="m-0 list-none divide-y divide-stone-200 rounded-control border border-stone-200 p-0">
              {shown.map((r) => (
                <li
                  key={r.id}
                  data-testid={`category-row-${r.id}`}
                  className="grid min-w-0 grid-cols-[44px_48px_minmax(0,1fr)] items-start gap-x-2 p-2"
                >
                  <CategoryRow
                    row={r}
                    auto={isAuto(r)}
                    cats={catsOf(r)}
                    categories={data.categories}
                    catName={catName}
                    checked={selected.has(r.id)}
                    onCheck={(on) => toggleRow(r.id, on)}
                    onToggleCat={(id) => toggleCat(r, id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function CategoryRow({
  row,
  auto,
  cats,
  categories,
  catName,
  checked,
  onCheck,
  onToggleCat,
}: {
  row: CategorySuggestionRow;
  auto: boolean;
  cats: readonly string[];
  categories: ReadonlyArray<{ id: string; name: string }>;
  catName: ReadonlyMap<string, string>;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onToggleCat: (id: string) => void;
}) {
  const reasons = [...new Set(row.suggestion.matches.map((m) => m.rule))].join('; ');
  const chosen = cats.map((id) => catName.get(id) ?? id).join(', ');
  return (
    <>
      <label
        className={`inline-flex ${TOUCH} min-w-[44px] shrink-0 cursor-pointer items-center justify-center`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`Chọn ${row.name}`}
          className="h-5 w-5 accent-forest-600"
        />
      </label>
      <span className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-control border border-stone-200 bg-stone-50">
        {row.thumbnail ? (
          <AdminImage src={row.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="px-1 text-center text-[10px] leading-tight text-stone-500">
            Chưa có ảnh
          </span>
        )}
      </span>
      <div className="min-w-0">
        <h4 className="m-0 break-words text-sm font-semibold text-stone-900">{row.name}</h4>
        <p className="m-0 break-words text-xs text-stone-600">
          {row.brand}
          {!row.onSale && (
            <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">
              Đang ẩn
            </span>
          )}
        </p>
        <p
          data-testid={`category-confidence-${row.id}`}
          className="m-0 break-words text-xs text-stone-600"
        >
          {row.suggestion.categoryIds.length === 0 ? (
            <span className="font-medium text-warning-fg">Chưa có gợi ý: chọn tay</span>
          ) : (
            <>
              <span
                className={`font-medium tabular-nums ${auto ? 'text-forest-700' : 'text-warning-fg'}`}
              >
                {auto ? 'Chắc chắn' : 'Cần xem'} {percent(row.suggestion.confidence)}
              </span>
              {reasons && <span> · {reasons}</span>}
            </>
          )}
        </p>
      </div>
      {/* Trải hết bề ngang dòng: ở 360px tên danh mục và chip không bị ép vào cột hẹp cạnh ảnh. Đóng thì chỉ một dòng danh mục đang chọn. */}
      <details className="group col-span-3 mt-1 min-w-0">
        <summary
          className={`flex ${TOUCH} min-w-0 cursor-pointer list-none items-center gap-2 text-sm [&::-webkit-details-marker]:hidden`}
        >
          <span
            data-testid={`category-chosen-${row.id}`}
            className={`min-w-0 flex-1 break-words ${cats.length === 0 ? 'text-danger-fg' : 'text-stone-800'}`}
          >
            {cats.length === 0 ? 'Chưa chọn danh mục' : chosen}
          </span>
          <span className="shrink-0 text-xs font-medium text-forest-700 underline group-open:no-underline">
            Sửa danh mục
          </span>
        </summary>
        <div
          role="group"
          aria-label={`Danh mục của ${row.name}`}
          className="flex flex-wrap gap-1.5 pb-1"
        >
          {categories.map((c) => {
            const on = cats.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggleCat(c.id)}
                className={`${TOUCH} rounded-full border px-3 text-xs font-medium ${on ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50'}`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </details>
    </>
  );
}

function Chip({
  active,
  onPress,
  children,
}: {
  active: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onPress}
      className={`${TOUCH} rounded-full border px-3 text-sm font-medium ${active ? 'border-forest-600 bg-forest-600 text-stone-0' : 'border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50'}`}
    >
      {children}
    </button>
  );
}
