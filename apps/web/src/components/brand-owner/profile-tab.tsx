'use client';

import { useRef, useState } from 'react';
import { useMutationState, useQueryClient } from '@tanstack/react-query';
import { BRAND_OWNER_COUPON_HINT, BRAND_OWNER_INFO, BRAND_OWNER_SAVED } from '@tubutree/app-core/client-copy';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createOwnedPromotion,
  deleteOwnedPromotion,
  updateOwnedBrand,
  updateOwnedPromotion,
  type OwnedBrand,
} from '@tubutree/app-core/api/brand-owner';
import { useLockedMutation } from '@/components/game/use-locked-mutation';
import { coreHttp } from '@/lib/core-http';
import { EMPTY_PROMO, ownerActionError, promoDateRangeError, promoPayload, promoToForm, type PromoForm } from '@/lib/brand-owner-view';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { useNotice } from '@/components/staff/staff-shell';
import { BrandImageField } from './brand-image-field';

const ICON_BTN = 'inline-flex h-11 w-11 flex-none items-center justify-center rounded-control text-stone-700 hover:bg-stone-50';
const TOGGLE_KEY = ['owned-promo-toggle'] as const;
const DELETE_KEY = ['owned-promo-delete'] as const;
const samePromo = (a: PromoForm, b: PromoForm) => a.title === b.title && a.subtitle === b.subtitle && a.couponCode === b.couponCode && a.startAt === b.startAt && a.endAt === b.endAt;

/** Thẻ "Hồ sơ" (logo, ảnh bìa, tagline, nguồn gốc, câu chuyện) và thẻ "Khuyến mãi" của nhãn. */
export function ProfileTab({ brand }: { brand: OwnedBrand }) {
  const qc = useQueryClient();
  const { node: notice, notify } = useNotice();
  const refresh = () => qc.invalidateQueries({ queryKey: ['owned-brand'] });

  const [f, setF] = useState({
    logoUrl: brand.logoUrl ?? '',
    coverUrl: brand.coverUrl ?? '',
    tagline: brand.tagline ?? '',
    origin: brand.origin ?? '',
    story: brand.story ?? '',
  });
  // Hồ sơ gửi đi là biến mutate chụp lúc bấm lần đầu, không đọc `f` mới hơn; khoá giữ tới khi hồ sơ mới về.
  const saveMut = useLockedMutation({
    mutationFn: (sent: typeof f) => updateOwnedBrand(coreHttp, sent),
    onSuccess: () => {
      notify({ text: BRAND_OWNER_SAVED, tone: 'success' });
      return refresh();
    },
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoForm>(EMPTY_PROMO);
  const resetPromoForm = () => {
    setEditingId(null);
    setPromo(EMPTY_PROMO);
  };
  const dateError = promoDateRangeError(promo);
  const invalid = dateError !== null;
  // Callback của mutation chạy sau khi khách có thể đã gõ/chọn khác: đọc form hiện tại qua ref, không phải bản chụp của lần vẽ lúc bấm.
  const latest = useRef({ editingId, promo });
  latest.current = { editingId, promo };
  const addPromo = useLockedMutation({
    mutationFn: (sent: PromoForm) => createOwnedPromotion(coreHttp, promoPayload(sent)),
    onSuccess: (_data, sent) => {
      // Chữ gõ thêm trong lúc đang gửi không bị xoá: chỉ dọn form khi nó vẫn là bản vừa gửi.
      if (latest.current.editingId === null && samePromo(latest.current.promo, sent)) resetPromoForm();
      notify({ text: 'Đã thêm khuyến mãi', tone: 'success' });
      return refresh();
    },
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });
  const updPromo = useLockedMutation(
    {
      // Khi sửa, ô mã trống nghĩa là GỠ mã (chuỗi rỗng): `undefined` bị bỏ qua nên mã cũ sẽ ở lại.
      mutationFn: (v: { id: string; form: PromoForm }) =>
        updateOwnedPromotion(coreHttp, v.id, { ...promoPayload(v.form), couponCode: v.form.couponCode.trim().toUpperCase() }),
      onSuccess: (_data, v) => {
        if (latest.current.editingId === v.id && samePromo(latest.current.promo, v.form)) resetPromoForm();
        notify({ text: 'Đã cập nhật khuyến mãi', tone: 'success' });
        return refresh();
      },
      onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
    },
    (v) => v.id,
  );
  // Bật/tắt tính từ giá trị đang hiện: nhả khoá trước khi danh sách mới về thì lần chạm hai lật từ giá trị cũ. Khoá theo khuyến mãi, bận ở mọi dòng đang bay.
  const toggleMut = useLockedMutation(
    {
      mutationKey: TOGGLE_KEY,
      mutationFn: (v: { id: string; isActive: boolean }) => updateOwnedPromotion(coreHttp, v.id, { isActive: v.isActive }),
      onSuccess: () => refresh(),
      onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
    },
    (v) => v.id,
  );
  const togglingIds = new Set(useMutationState({ filters: { mutationKey: TOGGLE_KEY, status: 'pending' }, select: (m) => (m.state.variables as { id: string }).id }));
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const delPromo = useLockedMutation(
    {
      mutationKey: DELETE_KEY,
      mutationFn: (id: string) => deleteOwnedPromotion(coreHttp, id),
      // So khớp đúng khuyến mãi VỪA XOÁ với khuyến mãi đang sửa dở: xoá B không được làm mất form đang sửa của A.
      onSuccess: (_data, deletedId) => {
        if (latest.current.editingId === deletedId) resetPromoForm();
        setConfirmDeleteId(null);
        return refresh();
      },
      onError: (e) => {
        setConfirmDeleteId(null);
        notify({ text: ownerActionError(e), tone: 'error' });
      },
    },
    (id) => id,
  );
  const deletingIds = new Set(useMutationState({ filters: { mutationKey: DELETE_KEY, status: 'pending' }, select: (m) => m.state.variables as string }));
  const confirmBusy = confirmDeleteId !== null && deletingIds.has(confirmDeleteId);

  const bigField = `${ui.field} max-md:text-[length:var(--type-body-lg-size)]`;
  const dateClass = `${ui.field} w-full min-w-0`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pb-6 xl:grid-cols-2 xl:items-start">
      {notice && <div className="xl:col-span-2">{notice}</div>}

      <section aria-label={BRAND_OWNER_INFO} className={`flex flex-col gap-3 p-4 ${skin.card}`}>
        <h2 className={skin.cardTitleSans}>{BRAND_OWNER_INFO}</h2>
        <BrandImageField label="Logo" value={f.logoUrl} onChange={(url) => setF({ ...f, logoUrl: url })} />
        <BrandImageField label="Ảnh bìa" value={f.coverUrl} onChange={(url) => setF({ ...f, coverUrl: url })} />
        <Field label="Câu giới thiệu ngắn">
          <input className={bigField} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
        </Field>
        <Field label="Nguồn gốc">
          <input className={bigField} value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        </Field>
        <Field label="Câu chuyện thương hiệu">
          <textarea className={`${ui.field} min-h-28 py-2`} maxLength={20000} value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} />
        </Field>
        {/* Đang lưu giữ aria-busy/aria-disabled chứ không `disabled`: nút đang giữ focus mà bị vô hiệu thì Chromium thả focus về body. */}
        <button
          type="button"
          aria-busy={saveMut.isPending || undefined}
          aria-disabled={saveMut.isPending || undefined}
          onClick={() => saveMut.mutate(f)}
          className={`${ui.btnPrimary} w-full`}
        >
          {saveMut.isPending ? 'Đang lưu…' : 'Lưu thông tin'}
        </button>
      </section>

      <section aria-label="Khuyến mãi" className={`flex flex-col gap-2 p-4 ${skin.card}`}>
        <h2 className={`flex items-center gap-1.5 ${skin.cardTitleSans}`}>
          <Gift className="h-4 w-4 text-forest-600" aria-hidden="true" />
          Khuyến mãi
        </h2>
        <ul>
          {brand.promotions.map((p) => (
            <li key={p.id} className="flex items-center gap-1 border-b border-stone-200 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-stone-900 [overflow-wrap:anywhere]">{p.title}</div>
                {p.subtitle && <div className="text-xs text-stone-600 [overflow-wrap:anywhere]">{p.subtitle}</div>}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={p.isActive}
                aria-label={`Bật khuyến mãi ${p.title}`}
                aria-busy={togglingIds.has(p.id) || undefined}
                aria-disabled={togglingIds.has(p.id) || undefined}
                onClick={() => toggleMut.mutate({ id: p.id, isActive: !p.isActive })}
                className="inline-flex h-11 w-12 flex-none items-center justify-center aria-disabled:opacity-50"
              >
                <span className={`flex h-6 w-10 items-center rounded-full p-0.5 transition ${p.isActive ? 'bg-forest-600' : 'bg-stone-450'}`}>
                  <span className={`h-5 w-5 rounded-full bg-stone-0 transition ${p.isActive ? 'translate-x-4' : ''}`} />
                </span>
              </button>
              <button
                type="button"
                aria-label={`Sửa khuyến mãi ${p.title}`}
                className={ICON_BTN}
                onClick={() => {
                  setEditingId(p.id);
                  setPromo(promoToForm(p));
                }}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`Xoá khuyến mãi ${p.title}`}
                aria-busy={deletingIds.has(p.id) || undefined}
                aria-disabled={deletingIds.has(p.id) || undefined}
                className={ICON_BTN}
                onClick={() => {
                  if (!deletingIds.has(p.id)) setConfirmDeleteId(p.id);
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-1 flex flex-col gap-2">
          <input aria-label="Tiêu đề (MUA 2 TẶNG 1)" placeholder="Tiêu đề (MUA 2 TẶNG 1)" className={ui.field} value={promo.title} onChange={(e) => setPromo({ ...promo, title: e.target.value })} />
          <input aria-label="Mô tả" placeholder="Mô tả" className={ui.field} value={promo.subtitle} onChange={(e) => setPromo({ ...promo, subtitle: e.target.value })} />
          {/* Không có mã thì banner chỉ là lời quảng cáo; máy chủ chỉ nhận mã có thật, công khai và còn hạn. */}
          <input
            aria-label="Mã giảm giá (tuỳ chọn) — VD: TUBU20"
            placeholder="Mã giảm giá (tuỳ chọn) — VD: TUBU20"
            className={ui.field}
            value={promo.couponCode}
            onChange={(e) => setPromo({ ...promo, couponCode: e.target.value.toUpperCase() })}
          />
          <p className="text-xs text-stone-600">{BRAND_OWNER_COUPON_HINT}</p>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <Field label="Từ ngày">
              <input type="date" className={dateClass} value={promo.startAt} onChange={(e) => setPromo({ ...promo, startAt: e.target.value })} />
            </Field>
            <Field label="Đến ngày">
              <input type="date" className={dateClass} value={promo.endAt} onChange={(e) => setPromo({ ...promo, endAt: e.target.value })} />
            </Field>
          </div>
          {dateError && <p className={ui.error}>{dateError}</p>}
          {editingId ? (
            <div className="flex gap-2">
              <button
                type="button"
                className={`${skin.btnSecondary} flex-1`}
                disabled={!promo.title.trim() || invalid}
                aria-busy={updPromo.isPending || undefined}
                aria-disabled={updPromo.isPending || undefined}
                onClick={() => updPromo.mutate({ id: editingId, form: promo })}
              >
                {updPromo.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>
              <button type="button" className={ui.btnText} onClick={resetPromoForm}>
                Huỷ
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`${skin.btnSecondary} self-start`}
              disabled={!promo.title.trim() || invalid}
              aria-busy={addPromo.isPending || undefined}
              aria-disabled={addPromo.isPending || undefined}
              onClick={() => addPromo.mutate(promo)}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {addPromo.isPending ? 'Đang thêm…' : 'Thêm khuyến mãi'}
            </button>
          )}
        </div>
      </section>

      <Sheet open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} title="Xoá khuyến mãi này?" dismissible={!confirmBusy}>
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-2">
          <button
            type="button"
            aria-disabled={confirmBusy || undefined}
            className={`${skin.btnSecondary} w-full`}
            onClick={() => {
              if (!confirmBusy) setConfirmDeleteId(null);
            }}
          >
            Huỷ
          </button>
          {/* Xoá không hoàn tác: nút giữ aria-busy/aria-disabled (không `disabled`, để không rơi focus) và hộp không đóng được khi đang gửi. */}
          <button
            type="button"
            aria-busy={confirmBusy || undefined}
            aria-disabled={confirmBusy || undefined}
            onClick={() => delPromo.mutate(confirmDeleteId!)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 aria-disabled:opacity-60"
          >
            {confirmBusy ? 'Đang xoá…' : 'Xoá'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
