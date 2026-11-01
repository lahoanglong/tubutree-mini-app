'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { vnd } from '@tubutree/app-core/commerce/money';
import { createAdminBundle, updateAdminBundle, type AdminBundle, type AdminBundleKind } from '@/lib/admin-bundles-client';
import {
  ADDON_MAX_ITEMS,
  BUNDLE_MAX_QTY,
  BUNDLE_PCT_MAX_PRODUCTS,
  buildBundleInput,
  draftFromBundle,
  emptyBundleDraft,
  type BundleDraft,
  type BundleDraftItem,
} from '@/lib/admin-bundle-form';
import { AddonVariationPicker, type PickedAddonVariation } from './bundle-addon-picker';
import { ProductPicker } from './product-picker';
import { BTN_LINK_DANGER, BTN_PRIMARY, BTN_SECONDARY, Field, FIELD_CLASS, INPUT_CLASS, TOUCH_H } from './ui';
import { VnDateTimeInput } from './vn-date-input';

export const KIND_LABELS: Record<AdminBundleKind, string> = { BUNDLE_PCT: 'Combo giảm %', ADDON: 'Mua kèm (giá riêng)' };
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** "Giảm 11.000đ (22%)" khi đã biết cả giá bán lẫn giá kèm hợp lệ; chưa biết giá bán (món vừa chọn) thì không đoán. */
function addonSaving(item: BundleDraftItem): string | null {
  if (item.price === null || !/^\d+$/.test(item.addonPrice.trim())) return null;
  const price = Number(item.addonPrice);
  if (price >= item.price) return null;
  return `Giảm ${vnd(item.price - price)} (${Math.round(((item.price - price) / item.price) * 100)}%)`;
}

/**
 * Form tạo/sửa một bộ "Combo và mua kèm". Mốc giờ nhập theo giờ Việt Nam. Loại bộ chọn lúc tạo, không đổi khi sửa (đổi loại là đổi luật của món:
 * tạo bộ mới). Món mua kèm luôn ghim một phân loại (giá kèm là con số cố định); muốn đổi phân loại thì bỏ món rồi thêm lại. Sửa gửi lại cả danh sách món, kể cả phân loại đã ghim. Luật hình thức kiểm ở `buildBundleInput`;
 * trần % theo cấu hình, giá kèm so với giá hiện tại của món mới chọn và hạn mức nhân viên do máy chủ quyết, lời báo lỗi hiện nguyên văn.
 */
export function BundleForm({ initial, onDone, onCancel }: { initial?: AdminBundle; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<BundleDraft>(() => (initial ? draftFromBundle(initial) : emptyBundleDraft('BUNDLE_PCT')));
  const [startPending, setStartPending] = useState(false);
  const [endPending, setEndPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (patch: Partial<BundleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setItem = (productId: string, patch: Partial<BundleDraftItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((i) => (i.productId === productId ? { ...i, ...patch } : i)) }));
  const maxItems = draft.kind === 'ADDON' ? ADDON_MAX_ITEMS : BUNDLE_PCT_MAX_PRODUCTS;
  const field = `${FIELD_CLASS} ${TOUCH_H}`;
  const canSave = draft.title.trim() !== '' && draft.startAt !== '' && draft.endAt !== '' && !startPending && !endPending && !busy;

  const addItem = (p: { id: string; label: string } | null) => {
    if (!p) return;
    setDraft((d) =>
      d.items.some((i) => i.productId === p.id) || d.items.length >= maxItems
        ? d
        : { ...d, items: [...d.items, { productId: p.id, name: p.label, variationId: null, variationName: null, price: null, addonPrice: '', maxQty: '1' }] },
    );
  };
  const addAddonItem = (v: PickedAddonVariation) =>
    setDraft((d) =>
      d.items.some((i) => i.productId === v.productId) || d.items.length >= ADDON_MAX_ITEMS
        ? d
        : {
            ...d,
            items: [...d.items, { productId: v.productId, name: v.productName, variationId: v.variationId, variationName: v.variationName, price: v.price, addonPrice: '', maxQty: '1' }],
          },
    );
  const changeKind = (kind: AdminBundleKind) =>
    setDraft((d) => ({ ...emptyBundleDraft(kind), title: d.title, startAt: d.startAt, endAt: d.endAt, sortOrder: d.sortOrder, isActive: d.isActive }));

  const save = async () => {
    setError(null);
    const built = buildBundleInput(draft);
    if (!built.ok) return setError(built.error);
    setBusy(true);
    try {
      if (initial) {
        const { kind: _kind, ...patch } = built.input;
        await updateAdminBundle(initial.id, patch);
      } else {
        await createAdminBundle(built.input);
      }
    } catch (e) {
      setBusy(false);
      return setError(errText(e, 'Không lưu được bộ.'));
    }
    void qc.invalidateQueries({ queryKey: ['admin-bundles'] });
    void qc.invalidateQueries({ queryKey: ['admin-bundle'] });
    setBusy(false);
    onDone();
  };

  const heading = initial ? 'Sửa bộ combo và mua kèm' : 'Tạo bộ combo và mua kèm';
  return (
    <form
      aria-label={heading}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
      className="space-y-3 rounded-card border border-stone-200 bg-stone-0 p-4"
    >
      <h2 className="font-display text-sm font-semibold text-stone-900">{heading}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Loại bộ" hint={initial ? 'Không đổi được khi sửa; muốn đổi loại thì tạo bộ mới.' : undefined}>
          <select aria-label="Loại bộ" value={draft.kind} disabled={!!initial} onChange={(e) => changeKind(e.target.value as AdminBundleKind)} className={`${field} w-full`}>
            {(Object.keys(KIND_LABELS) as AdminBundleKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABELS[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="Tên bộ">
          <input aria-label="Tên bộ" maxLength={120} value={draft.title} onChange={(e) => set({ title: e.target.value })} className={INPUT_CLASS} />
        </Field>
        {draft.kind === 'BUNDLE_PCT' ? (
          <Field label="% giảm mỗi món" hint="Không vượt trần % đang cấu hình (mặc định 50%). Giỏ lấy mức giảm lớn hơn giữa combo gian hàng và bộ này, không cộng dồn.">
            <input aria-label="% giảm mỗi món" type="number" min={1} max={100} step={1} inputMode="numeric" value={draft.pct} onChange={(e) => set({ pct: e.target.value })} className={`${field} w-28`} />
          </Field>
        ) : (
          <Field label="Sản phẩm chính" hint="Giá mua kèm chỉ áp khi sản phẩm này có trong giỏ.">
            {draft.anchor && (
              <p data-testid="bundle-anchor" className="mb-1 text-sm text-stone-800">
                {draft.anchor.name || draft.anchor.id}
              </p>
            )}
            <ProductPicker mode="product" label="Chọn sản phẩm chính" value={null} onChange={(p) => p && set({ anchor: { id: p.id, name: p.label } })} />
          </Field>
        )}
        <Field label="Bắt đầu lúc (giờ Việt Nam)">
          <VnDateTimeInput ariaLabel="Bắt đầu" value={draft.startAt} onChange={(v) => set({ startAt: v })} onPendingChange={setStartPending} className={field} />
        </Field>
        <Field label="Kết thúc lúc (giờ Việt Nam)">
          <VnDateTimeInput ariaLabel="Kết thúc" value={draft.endAt} onChange={(v) => set({ endAt: v })} onPendingChange={setEndPending} className={field} />
        </Field>
        <Field label="Thứ tự hiển thị" hint="Số nhỏ đứng trước.">
          <input aria-label="Thứ tự hiển thị" type="number" min={0} max={9999} step={1} inputMode="numeric" value={draft.sortOrder} onChange={(e) => set({ sortOrder: e.target.value })} className={`${field} w-28`} />
        </Field>
        <label className="flex min-h-[44px] items-center gap-2 text-sm text-stone-800 sm:min-h-0 sm:self-end sm:pb-2">
          <input type="checkbox" aria-label="Đang bật" checked={draft.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="h-4 w-4" />
          Đang bật
        </label>
      </div>

      <section aria-label="Sản phẩm trong bộ" className="space-y-2">
        <h3 className="text-xs font-medium text-stone-700">
          {draft.kind === 'ADDON' ? 'Món mua kèm' : 'Sản phẩm trong combo'} ({draft.items.length}/{maxItems})
        </h3>
        {draft.items.length === 0 ? (
          <p className="text-xs text-stone-500">{draft.kind === 'ADDON' ? 'Chưa có món mua kèm.' : 'Chưa có sản phẩm. Combo cần ít nhất 2 sản phẩm khác nhau.'}</p>
        ) : (
          <ul className="space-y-2">
            {draft.items.map((i) => (
              <li key={i.productId} data-testid="bundle-item" className="space-y-2 rounded-control bg-stone-50 px-2.5 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 break-words">
                    {i.name}
                    {i.variationName ? <span className="text-stone-500">{` · ${i.variationName}`}</span> : null}
                    {i.price !== null ? <span className="text-stone-500">{` · giá bán ${vnd(i.price)}`}</span> : null}
                  </span>
                  <button type="button" aria-label={`Bỏ ${i.name} khỏi bộ`} onClick={() => set({ items: draft.items.filter((x) => x.productId !== i.productId) })} className={BTN_LINK_DANGER}>
                    Bỏ
                  </button>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  {draft.kind === 'ADDON' && (
                    <label className="text-xs text-stone-700">
                      Giá mua kèm (đồng)
                      <input
                        aria-label={`Giá mua kèm ${i.name}`}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        value={i.addonPrice}
                        onChange={(e) => setItem(i.productId, { addonPrice: e.target.value })}
                        className={`${field} mt-1 block w-36`}
                      />
                    </label>
                  )}
                  <label className="text-xs text-stone-700">
                    Số lượng ưu đãi mỗi đơn
                    <input
                      aria-label={`Số lượng ưu đãi ${i.name}`}
                      type="number"
                      min={1}
                      max={BUNDLE_MAX_QTY}
                      step={1}
                      inputMode="numeric"
                      value={i.maxQty}
                      onChange={(e) => setItem(i.productId, { maxQty: e.target.value })}
                      className={`${field} mt-1 block w-24`}
                    />
                  </label>
                  {draft.kind === 'ADDON' && addonSaving(i) && <span className="pb-2 text-xs text-success-fg">{addonSaving(i)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {draft.items.length < maxItems &&
          (draft.kind === 'ADDON' ? (
            <AddonVariationPicker onPick={addAddonItem} />
          ) : (
            <ProductPicker mode="product" label="Thêm sản phẩm" value={null} onChange={addItem} />
          ))}
      </section>

      {error && (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!canSave} className={BTN_PRIMARY}>
          {busy ? 'Đang lưu…' : 'Lưu bộ'}
        </button>
        <button type="button" onClick={onCancel} className={BTN_SECONDARY}>
          Đóng
        </button>
      </div>
    </form>
  );
}
