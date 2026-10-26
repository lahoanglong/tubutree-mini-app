'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ASSIGN_MAX,
  assignCategory,
  listCategoryOptions,
  listCategoryProducts,
  listPancakeCategories,
  type CategoryProduct,
} from '@/lib/product-categories';
import { ProductEditDrawer } from './product-edit-drawer';
import { useConfirm } from './confirm-dialog';
import { useDebounced } from './search-picker';
import { BTN_SECONDARY, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, Notice, ToneBadge, chipClass } from './ui';

const LIST_KEY = ['admin-category-products'] as const;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * "Danh mục sản phẩm": đồng bộ Pancake không gán danh mục, nên đây là nơi gán/gỡ danh mục hàng loạt cho sản phẩm
 * (lọc "chưa có danh mục", chỉ hàng Pancake, đang bán mà thiếu ảnh, tìm theo tên/SKU) và sửa ảnh, mô tả của từng sản phẩm. Đồng bộ không ghi đè danh mục đã gán ở đây.
 */
export function ProductCategoriesTab() {
  const qc = useQueryClient();
  const { confirm, dialog } = useConfirm();
  const [typed, setTyped] = useState('');
  const [uncategorized, setUncategorized] = useState(true);
  const [pancakeOnly, setPancakeOnly] = useState(true);
  const [missingImage, setMissingImage] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryId, setCategoryId] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const q = useDebounced(typed.trim(), 300);

  const list = useInfiniteQuery({
    queryKey: [...LIST_KEY, q, uncategorized, pancakeOnly, missingImage],
    queryFn: ({ pageParam }) => listCategoryProducts({ q, uncategorized, pancakeOnly, missingImage, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const cats = useQuery({ queryKey: ['admin-category-options'], queryFn: listCategoryOptions, staleTime: 30_000 });
  const catName = useMemo(() => new Map((cats.data ?? []).map((c) => [c.id, c.name])), [cats.data]);
  const products: CategoryProduct[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total;
  const picked = products.filter((p) => selected.has(p.id));
  const allShown = products.length > 0 && picked.length === products.length;
  const chosen = cats.data?.find((c) => c.id === categoryId);
  // Cùng một sự cố máy chủ làm hỏng cả hai truy vấn thì chỉ nói một lần.
  const catsErrorText = errText(cats.error, 'Không tải được danh sách danh mục.');
  const listErrorText = errText(list.error, 'Không tải được danh sách sản phẩm.');

  const mut = useMutation({
    mutationFn: (v: { mode: 'ADD' | 'REMOVE' }) => assignCategory(picked.map((p) => p.id), categoryId, v.mode),
    onSuccess: (r, v) => {
      setMsg({
        ok: true,
        text: `${v.mode === 'ADD' ? 'Đã gán' : 'Đã gỡ'} "${r.category.name}": ${r.changed} sản phẩm đổi${r.unchanged ? `, ${r.unchanged} không đổi (đã đúng sẵn)` : ''}.`,
      });
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: LIST_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-category-options'] });
    },
    onError: (e) => setMsg({ ok: false, text: errText(e, 'Không lưu được danh mục.') }),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (mode: 'ADD' | 'REMOVE') => {
    if (!chosen || picked.length === 0 || mut.isPending) return;
    if (picked.length > ASSIGN_MAX) return setMsg({ ok: false, text: `Mỗi lần chỉ gán tối đa ${ASSIGN_MAX} sản phẩm.` });
    setMsg(null);
    const ok = await confirm({
      title: mode === 'ADD' ? 'Gán danh mục' : 'Gỡ danh mục',
      message:
        mode === 'ADD'
          ? `Gán danh mục "${chosen.name}" cho ${picked.length} sản phẩm đã chọn? Danh mục khác của các sản phẩm này giữ nguyên.`
          : `Gỡ danh mục "${chosen.name}" khỏi ${picked.length} sản phẩm đã chọn?`,
      confirmLabel: mode === 'ADD' ? 'Gán' : 'Gỡ',
    });
    if (ok) mut.mutate({ mode });
  };

  return (
    <div className="space-y-4">
      {dialog}
      <div>
        <h2 className="font-display text-lg font-semibold text-stone-900">Danh mục sản phẩm</h2>
        <p className="mt-1 text-sm text-stone-600">
          Hàng đồng bộ từ Pancake chưa có danh mục nên chưa hiện trong trang từng danh mục. Chọn nhiều sản phẩm rồi gán một danh mục.
          Đồng bộ Pancake không ghi đè danh mục đã gán ở đây. Danh mục chưa có sản phẩm đang bán bị Mini App ẩn.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Tìm theo tên sản phẩm hoặc SKU"
          placeholder="Tìm tên sản phẩm hoặc SKU"
          maxLength={64}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className={`${FIELD_XS} w-full sm:w-72`}
        />
        <button type="button" aria-pressed={uncategorized} onClick={() => setUncategorized((v) => !v)} className={chipClass(uncategorized)}>
          Chưa có danh mục
        </button>
        <button type="button" aria-pressed={pancakeOnly} onClick={() => setPancakeOnly((v) => !v)} className={chipClass(pancakeOnly)}>
          Chỉ hàng Pancake
        </button>
        <button type="button" aria-pressed={missingImage} onClick={() => setMissingImage((v) => !v)} className={chipClass(missingImage)}>
          Đang bán, thiếu ảnh
        </button>
        {total !== undefined && <span className="text-xs text-stone-500">{total} sản phẩm khớp bộ lọc</span>}
      </div>

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-card border border-stone-200 bg-stone-0 p-3">
        <span className="text-sm text-stone-700">Đã chọn {picked.length}</span>
        <select
          aria-label="Danh mục"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className={`${FIELD_XS} w-full sm:w-64`}
        >
          <option value="">Chọn danh mục…</option>
          {(cats.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.productCount !== undefined ? ` (${c.productCount})` : ''}
            </option>
          ))}
        </select>
        <button type="button" disabled={!chosen || picked.length === 0 || mut.isPending} onClick={() => void run('ADD')} className={BTN_XS_PRIMARY}>
          Gán danh mục
        </button>
        <button type="button" disabled={!chosen || picked.length === 0 || mut.isPending} onClick={() => void run('REMOVE')} className={BTN_XS_SECONDARY}>
          Gỡ danh mục
        </button>
      </div>
      {cats.isError && !(list.isError && catsErrorText === listErrorText) && <Notice tone="danger" role="alert">{catsErrorText}</Notice>}
      {msg && <Notice tone={msg.ok ? 'success' : 'danger'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</Notice>}

      {list.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-danger-fg">
          {listErrorText}{' '}
          <button
            type="button"
            onClick={() => {
              void list.refetch();
              if (cats.isError) void cats.refetch();
            }}
            className="min-h-[44px] font-medium underline sm:min-h-0"
          >
            Thử lại
          </button>
        </p>
      )}
      {list.isSuccess && products.length === 0 && (
        <p className="rounded-card border border-stone-200 bg-stone-0 p-6 text-center text-sm text-stone-500">
          {q ? `Không có sản phẩm nào khớp "${q}".` : uncategorized ? 'Không còn sản phẩm nào chưa có danh mục.' : 'Chưa có sản phẩm nào.'}
        </p>
      )}
      {products.length > 0 && (
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-700 sm:min-h-0">
          <input
            type="checkbox"
            checked={allShown}
            onChange={() => setSelected(allShown ? new Set() : new Set(products.map((p) => p.id)))}
          />
          Chọn tất cả {products.length} sản phẩm đang hiện
        </label>
      )}
      <ul className="space-y-2">
        {products.map((p) => (
          <li key={p.id} className="flex items-start gap-3 rounded-card border border-stone-200 bg-stone-0 p-3">
            <input
              type="checkbox"
              aria-label={`Chọn ${p.name}`}
              checked={selected.has(p.id)}
              onChange={() => toggle(p.id)}
              className="mt-1"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-words text-sm font-medium text-stone-900">{p.name}</span>
                {!p.isActive && <ToneBadge tone="neutral">Đang tắt</ToneBadge>}
                <button type="button" onClick={() => setEditing(p.id)} aria-label={`Sửa ${p.name}`} className={`${BTN_XS_SECONDARY} ml-auto`}>
                  Sửa
                </button>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-xs text-stone-600">
                {p.categoryIds.length === 0 ? (
                  <span className="text-warning-fg">Chưa có danh mục</span>
                ) : (
                  p.categoryIds.map((id) => (
                    <span key={id} className="rounded-control bg-stone-100 px-2 py-0.5">
                      {catName.get(id) ?? id}
                    </span>
                  ))
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} className={BTN_SECONDARY}>
            {list.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}

      {editing && (
        <ProductEditDrawer
          id={editing}
          categories={cats.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: LIST_KEY });
            void qc.invalidateQueries({ queryKey: ['admin-category-options'] });
          }}
        />
      )}

      <PancakeCategoryHelper catName={catName} />
    </div>
  );
}

/** Nhóm hàng Pancake của shop + danh mục Tubu đang ánh xạ: để điền `pancake.category_map` ở tab Cấu hình. */
function PancakeCategoryHelper({ catName }: { catName: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const rows = useQuery({ queryKey: ['admin-pancake-categories'], queryFn: listPancakeCategories, enabled: open, staleTime: 60_000 });
  return (
    <section aria-label="Nhóm hàng Pancake" className="space-y-2 rounded-card border border-stone-200 bg-stone-0 p-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="text-sm font-medium text-forest-700 underline">
        {open ? 'Ẩn' : 'Xem'} nhóm hàng Pancake và bản đồ tự gán
      </button>
      {open && (
        <>
          <p className="text-xs text-stone-600">
            Tab Cấu hình, khoá <code>pancake.category_map</code>:{' '}
            <code>{'{ "mã hoặc tên nhóm Pancake": "id danh mục Tubu" }'}</code>. Chỉ áp cho sản phẩm chưa có danh mục, ở các lần đồng bộ sau.
          </p>
          {rows.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
          {rows.isError && <Notice tone="danger" role="alert">{errText(rows.error, 'Không đọc được nhóm hàng Pancake.')}</Notice>}
          {rows.data && rows.data.length === 0 && <p className="text-sm text-stone-500">Shop Pancake chưa có nhóm hàng.</p>}
          {rows.data && rows.data.length > 0 && (
            <ul className="space-y-1 text-xs">
              {rows.data.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
                  <code>{r.id}</code>
                  <span className="text-stone-900">{r.path}</span>
                  <span className={r.mappedTo ? 'text-success-fg' : 'text-stone-500'}>
                    {r.mappedTo ? `→ ${catName.get(r.mappedTo) ?? r.mappedTo}` : 'chưa ánh xạ'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
