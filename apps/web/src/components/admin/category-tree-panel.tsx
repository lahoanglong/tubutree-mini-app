'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ApiError } from '@/lib/client-api';
import { buildCategoryTree, canAddChild, canAddRoot, moveInOrder, type CategoryNode } from '@/lib/category-tree';
import {
  createAdminCategory,
  deleteAdminCategory,
  reorderAdminCategories,
  updateAdminCategory,
  type AdminCategory,
  type AdminCategoryList,
} from '@/lib/product-categories';
import { useConfirm } from './confirm-dialog';
import { BTN_XS_DANGER, BTN_XS_PRIMARY, BTN_XS_SECONDARY, FIELD_XS, LoadError, Notice } from './ui';

type Form = { kind: 'add'; parentId: string | null } | { kind: 'rename'; id: string };
/** `at` = chỗ hiện lỗi: lỗi nằm cạnh mục hoặc ô nhập vừa thao tác, không dồn lên đầu danh sách. */
type Msg = { at: string; text: string };

const NAME_MAX = 60;
const ROOT_VALUE = '__root__';
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Không lưu được danh mục.');
const formKeyOf = (f: Form | null) => (!f ? '' : f.kind === 'add' ? `add:${f.parentId ?? 'root'}` : `rename:${f.id}`);

// Nút ↑↓ ở đầu/cuối dùng aria-disabled (không `disabled`) để focus bàn phím không rơi mất sau khi đổi chỗ.
const MOVE_BTN = `${BTN_XS_SECONDARY} min-w-[44px] px-0 sm:min-w-[36px] aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-stone-0`;

export interface CategoryTreePanelProps {
  data: AdminCategoryList | undefined;
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  /** Gọi sau mỗi lần ghi thành công để tải lại cây (và các truy vấn dùng danh mục). */
  onChanged: () => unknown;
}

/**
 * Cây danh mục hai tầng của gian hàng: ≤8 gốc, ≤8 con mỗi gốc (API chặn bằng 400; ở đây khoá nút thêm khi đã đủ).
 * Sắp thứ tự bằng nút ↑↓ (đường bàn phím, tên nút kèm tên mục), thêm/đổi tên/chuyển cha/xoá từng mục. Mọi thay đổi
 * làm mới cache `/categories` công khai ở phía API.
 */
export function CategoryTreePanel({ data, loading, error, onRetry, onChanged }: CategoryTreePanelProps) {
  const { confirm, dialog } = useConfirm();
  const rootRef = useRef<HTMLElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState('');
  const [ok, setOk] = useState('');
  const [failure, setFailure] = useState<Msg | null>(null);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const hintId = useId();

  const tree = useMemo(() => buildCategoryTree(data?.items ?? []), [data]);
  const limits = data?.limits ?? { maxRoots: 8, maxChildren: 8 };
  const formKey = formKeyOf(form);

  const focusKey = (key: string) => {
    const el = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? [])].find((e) => e.dataset.focusKey === key);
    if (!el || (el as HTMLButtonElement).disabled) return false;
    el.focus();
    return true;
  };

  useEffect(() => {
    if (form) rootRef.current?.querySelector<HTMLInputElement>('input[data-draft]')?.focus();
    // Chỉ khi ô nhập mở ra, không giành focus khi dữ liệu nền được tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey]);

  // Sau khi cây sắp lại, nút đã bấm bị React chuyển chỗ trong DOM và trình duyệt bỏ focus: trả focus về đúng nút.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key && focusKey(key)) pendingFocus.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, formKey]);

  const run = async (at: string, task: () => Promise<unknown>, done: { text: string; focus?: string; closeForm?: boolean }): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true;
    pendingFocus.current = null;
    setSaving(true);
    setFailure(null);
    setOk('');
    try {
      await task();
      setOk(done.text);
      if (done.focus) pendingFocus.current = done.focus;
      if (done.closeForm) setForm(null);
      void onChanged();
      return true;
    } catch (e) {
      setFailure({ at, text: errText(e) });
      // 404/409: cây admin đang xem đã cũ so với máy chủ, tải lại để lần thử sau đúng dữ liệu.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) void onChanged();
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  const openForm = (next: Form, initial: string) => {
    setFailure(null);
    setDraft(initial);
    setForm(next);
  };
  const closeForm = (focus: string) => {
    pendingFocus.current = focus;
    setFailure(null);
    setForm(null);
  };

  const move = (siblings: readonly AdminCategory[], parentId: string | null, item: AdminCategory, dir: 'up' | 'down') => {
    const next = moveInOrder(siblings.map((s) => s.id), item.id, dir);
    if (!next) return;
    void run(item.id, () => reorderAdminCategories(parentId, next), {
      text: `Đã đưa "${item.name}" ${dir === 'up' ? 'lên' : 'xuống'} vị trí ${next.indexOf(item.id) + 1}/${next.length}.`,
      focus: `move:${item.id}:${dir}`,
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!form || !name) return;
    if (form.kind === 'add') {
      const at = formKeyOf(form);
      const body = form.parentId ? { name, parentId: form.parentId } : { name };
      void run(at, () => createAdminCategory(body), { text: `Đã thêm "${name}".`, focus: `add:${form.parentId ?? 'root'}`, closeForm: true });
    } else {
      const id = form.id;
      void run(formKeyOf(form), () => updateAdminCategory(id, { name }), { text: `Đã đổi tên thành "${name}".`, focus: `rename:${id}`, closeForm: true });
    }
  };

  const relocate = (item: AdminCategory, currentParent: string | null, value: string) => {
    if (!value) return;
    const target = value === ROOT_VALUE ? null : value;
    if (target === currentParent) return;
    const to = target ? tree.find((r) => r.id === target)?.name : null;
    void run(item.id, () => updateAdminCategory(item.id, { parentId: target }), {
      text: to ? `Đã chuyển "${item.name}" vào "${to}".` : `Đã chuyển "${item.name}" thành danh mục gốc.`,
      focus: `move:${item.id}:up`,
    });
  };

  const remove = async (item: AdminCategory, parentId: string | null) => {
    if (busy.current) return;
    setFailure(null);
    const yes = await confirm({
      title: 'Xoá danh mục',
      message: `Xoá danh mục "${item.name}"? Chỉ xoá được khi không còn sản phẩm và không còn mục con. Mini App sẽ không còn thấy mục này.`,
      confirmLabel: 'Xoá',
      tone: 'danger',
    });
    if (!yes) return;
    await run(item.id, () => deleteAdminCategory(item.id), { text: `Đã xoá "${item.name}".`, focus: `add:${parentId ?? 'root'}` });
  };

  const fail = (at: string) => (failure?.at === at ? <Notice tone="danger" role="alert">{failure.text}</Notice> : null);

  const addForm = (parentId: string | null, parentName: string | null) => {
    if (form?.kind !== 'add' || form.parentId !== parentId) return null;
    const label = parentName ? `Tên mục con mới của "${parentName}"` : 'Tên danh mục gốc mới';
    return (
      <div className="space-y-2">
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <input
            data-draft
            aria-label={label}
            maxLength={NAME_MAX}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && closeForm(`add:${parentId ?? 'root'}`)}
            placeholder={parentName ? 'Tên mục con' : 'Tên danh mục'}
            className={`${FIELD_XS} min-w-0 flex-1 basis-40`}
          />
          <button type="submit" disabled={saving || !draft.trim()} className={BTN_XS_PRIMARY}>
            Thêm
          </button>
          <button type="button" onClick={() => closeForm(`add:${parentId ?? 'root'}`)} className={BTN_XS_SECONDARY}>
            Huỷ
          </button>
        </form>
        {fail(formKey)}
      </div>
    );
  };

  const renameForm = (item: AdminCategory) => (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <input
          data-draft
          aria-label={`Tên mới của "${item.name}"`}
          maxLength={NAME_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e: KeyboardEvent) => e.key === 'Escape' && closeForm(`rename:${item.id}`)}
          className={`${FIELD_XS} min-w-0 flex-1 basis-40`}
        />
        <button type="submit" disabled={saving || !draft.trim()} className={BTN_XS_PRIMARY}>
          Lưu
        </button>
        <button type="button" onClick={() => closeForm(`rename:${item.id}`)} className={BTN_XS_SECONDARY}>
          Huỷ
        </button>
      </form>
      {fail(formKey)}
    </div>
  );

  const parentOptions = (item: AdminCategory, currentParent: string | null) => {
    const opts: { value: string; label: string; disabled?: boolean }[] = [];
    if (currentParent) {
      opts.push({ value: ROOT_VALUE, label: 'Thành danh mục gốc', disabled: !canAddRoot(tree.length, limits) });
    }
    for (const r of tree) {
      if (r.id === item.id || r.id === currentParent) continue;
      const full = !canAddChild(r.children.length, limits);
      opts.push({ value: r.id, label: `Vào "${r.name}"${full ? ` (đủ ${limits.maxChildren})` : ''}`, disabled: full });
    }
    return opts;
  };

  const itemRow = (item: AdminCategory, siblings: readonly AdminCategory[], parentId: string | null, node?: CategoryNode) => {
    const index = siblings.findIndex((s) => s.id === item.id);
    const first = index <= 0;
    const last = index === siblings.length - 1;
    const hasChildren = !!node && node.children.length > 0;
    const renaming = form?.kind === 'rename' && form.id === item.id;
    const moveOpts = hasChildren ? [] : parentOptions(item, parentId);
    const press = (dir: 'up' | 'down') => (dir === 'up' ? first : last) ? undefined : () => move(siblings, parentId, item, dir);
    return (
      <div className="space-y-2 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-40">
            <div data-cat-name className="break-words text-sm font-medium text-stone-900">
              {item.name}
            </div>
            <div className="text-xs tabular-nums text-stone-600">
              {hasChildren ? `${item.totalCount} sản phẩm, cả mục con · ${node!.children.length}/${limits.maxChildren} mục con` : `${item.productCount} sản phẩm`}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['up', 'down'] as const).map((dir) => {
              const atEnd = dir === 'up' ? first : last;
              return (
                <button
                  key={dir}
                  type="button"
                  data-focus-key={`move:${item.id}:${dir}`}
                  aria-label={`Đưa "${item.name}" ${dir === 'up' ? 'lên trên' : 'xuống dưới'}`}
                  aria-disabled={atEnd || saving ? 'true' : undefined}
                  onClick={press(dir)}
                  className={MOVE_BTN}
                >
                  <span aria-hidden="true">{dir === 'up' ? '↑' : '↓'}</span>
                </button>
              );
            })}
            <button
              type="button"
              data-focus-key={`rename:${item.id}`}
              aria-label={`Đổi tên "${item.name}"`}
              onClick={() => openForm({ kind: 'rename', id: item.id }, item.name)}
              className={BTN_XS_SECONDARY}
            >
              Đổi tên
            </button>
            {moveOpts.length > 0 && (
              <select
                aria-label={`Chuyển "${item.name}" sang mục khác`}
                value=""
                onChange={(e) => relocate(item, parentId, e.target.value)}
                className={`${FIELD_XS} max-w-[9.5rem]`}
              >
                <option value="">Chuyển…</option>
                {moveOpts.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
            <button type="button" aria-label={`Xoá "${item.name}"`} onClick={() => void remove(item, parentId)} className={BTN_XS_DANGER}>
              Xoá
            </button>
          </div>
        </div>
        {renaming && renameForm(item)}
        {!renaming && fail(item.id)}
      </div>
    );
  };

  const rootsFull = !canAddRoot(tree.length, limits);

  return (
    <section ref={rootRef} aria-label="Quản lý cây danh mục" aria-busy={saving} className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-3">
      {dialog}
      <div>
        <h3 className="font-display text-base font-semibold text-stone-900">Cây danh mục</h3>
        <p className="mt-0.5 text-xs tabular-nums text-stone-700">
          {data ? `Tầng 1: ${tree.length}/${limits.maxRoots} · tối đa ${limits.maxChildren} mục con mỗi mục` : 'Tối đa hai tầng danh mục.'}
        </p>
        <p className="mt-0.5 text-xs text-stone-600">
          Sản phẩm chỉ gán vào mục không có mục con. Mini App cập nhật cây sau tối đa vài phút.
        </p>
      </div>
      <div role="status">{ok && <Notice tone="success">{ok}</Notice>}</div>
      {loading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {error && !data && <LoadError onRetry={onRetry}>{error}</LoadError>}
      {data && (
        <>
          {tree.length === 0 && <p className="text-sm text-stone-500">Chưa có danh mục nào. Thêm danh mục gốc đầu tiên bên dưới.</p>}
          <ul aria-label="Cây danh mục" className="divide-y divide-stone-100">
            {tree.map((root) => {
              const childFull = !canAddChild(root.children.length, limits);
              const childHint = `${hintId}-${root.id}`;
              return (
                <li key={root.id}>
                  {itemRow(root, tree, null, root)}
                  <div className="ml-3 space-y-1 border-l border-stone-200 pl-3 sm:ml-4 sm:pl-4">
                    {root.children.length > 0 && (
                      <ul className="divide-y divide-stone-100">
                        {root.children.map((child) => (
                          <li key={child.id}>{itemRow(child, root.children, root.id)}</li>
                        ))}
                      </ul>
                    )}
                    {addForm(root.id, root.name)}
                    {form?.kind === 'add' && form.parentId === root.id ? null : (
                      <div className="flex flex-wrap items-center gap-2 pb-2">
                        <button
                          type="button"
                          data-focus-key={`add:${root.id}`}
                          aria-label={`Thêm mục con vào "${root.name}"`}
                          aria-describedby={childFull ? childHint : undefined}
                          disabled={childFull}
                          onClick={() => openForm({ kind: 'add', parentId: root.id }, '')}
                          className={BTN_XS_SECONDARY}
                        >
                          Thêm mục con
                        </button>
                        {childFull && (
                          <span id={childHint} className="text-xs text-stone-600">
                            Đã đủ {limits.maxChildren} mục con.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {addForm(null, null)}
          {form?.kind === 'add' && form.parentId === null ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-focus-key="add:root"
                aria-describedby={rootsFull ? `${hintId}-roots` : undefined}
                disabled={rootsFull}
                onClick={() => openForm({ kind: 'add', parentId: null }, '')}
                className={BTN_XS_PRIMARY}
              >
                Thêm danh mục gốc
              </button>
              {rootsFull && (
                <span id={`${hintId}-roots`} className="text-xs text-stone-600">
                  Đã đủ {limits.maxRoots} danh mục gốc.
                </span>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
