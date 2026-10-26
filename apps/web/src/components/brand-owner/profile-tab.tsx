'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  createOwnedPromotion,
  deleteOwnedPromotion,
  updateOwnedBrand,
  updateOwnedPromotion,
  type OwnedBrand,
} from '@tubutree/app-core/api/brand-owner';
import { coreHttp } from '@/lib/core-http';
import { EMPTY_PROMO, ownerActionError, promoDateRangeInvalid, promoPayload, promoToForm, type PromoForm } from '@/lib/brand-owner-view';
import { ui } from '@/lib/guest-ui';
import { skin } from '@/components/pro-shared/mini-skin';
import { Field } from '@/components/ui/field';
import { Sheet } from '@/components/ui/sheet';
import { useNotice } from '@/components/staff/staff-shell';
import { BrandImageField } from './brand-image-field';

const ICON_BTN = 'inline-flex h-11 w-11 flex-none items-center justify-center rounded-control text-stone-700 hover:bg-stone-50';

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
  const saveMut = useMutation({
    mutationFn: () => updateOwnedBrand(coreHttp, f),
    onSuccess: () => {
      notify({ text: 'Đã lưu thông tin nhãn', tone: 'success' });
      void refresh();
    },
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [promo, setPromo] = useState<PromoForm>(EMPTY_PROMO);
  const resetPromoForm = () => {
    setEditingId(null);
    setPromo(EMPTY_PROMO);
  };
  const invalid = promoDateRangeInvalid(promo);
  const addPromo = useMutation({
    mutationFn: () => createOwnedPromotion(coreHttp, promoPayload(promo)),
    onSuccess: () => {
      resetPromoForm();
      notify({ text: 'Đã thêm khuyến mãi', tone: 'success' });
      void refresh();
    },
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });
  const updPromo = useMutation({
    // Khi sửa, ô mã trống nghĩa là GỠ mã (chuỗi rỗng): `undefined` bị bỏ qua nên mã cũ sẽ ở lại.
    mutationFn: () => updateOwnedPromotion(coreHttp, editingId!, { ...promoPayload(promo), couponCode: promo.couponCode.trim().toUpperCase() }),
    onSuccess: () => {
      resetPromoForm();
      notify({ text: 'Đã cập nhật khuyến mãi', tone: 'success' });
      void refresh();
    },
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });
  const toggleMut = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => updateOwnedPromotion(coreHttp, v.id, { isActive: v.isActive }),
    onSuccess: () => void refresh(),
    onError: (e) => notify({ text: ownerActionError(e), tone: 'error' }),
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const delPromo = useMutation({
    mutationFn: (id: string) => deleteOwnedPromotion(coreHttp, id),
    // So khớp đúng khuyến mãi VỪA XOÁ với khuyến mãi đang sửa dở: xoá B không được làm mất form đang sửa của A.
    onSuccess: (_data, deletedId) => {
      if (editingId === deletedId) resetPromoForm();
      setConfirmDeleteId(null);
      void refresh();
    },
    onError: (e) => {
      setConfirmDeleteId(null);
      notify({ text: ownerActionError(e), tone: 'error' });
    },
  });

  const bigField = `${ui.field} max-md:text-[length:var(--type-body-lg-size)]`;
  const dateClass = `${ui.field} min-w-0 flex-1`;

  return (
    <div className="grid gap-4 pb-6 xl:grid-cols-2 xl:items-start">
      {notice && <div className="xl:col-span-2">{notice}</div>}

      <section aria-label="Thông tin nhãn" className={`flex flex-col gap-3 p-4 ${skin.card}`}>
        <h2 className={skin.cardTitleSans}>Thông tin nhãn</h2>
        <BrandImageField label="Logo" value={f.logoUrl} onChange={(url) => setF({ ...f, logoUrl: url })} />
        <BrandImageField label="Ảnh bìa" value={f.coverUrl} onChange={(url) => setF({ ...f, coverUrl: url })} />
        <Field label="Câu giới thiệu ngắn">
          <input className={bigField} value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
        </Field>
        <Field label="Nguồn gốc">
          <input className={bigField} value={f.origin} onChange={(e) => setF({ ...f, origin: e.target.value })} />
        </Field>
        <Field label="Câu chuyện thương hiệu">
          <textarea className={`${ui.field} min-h-28 py-2`} value={f.story} onChange={(e) => setF({ ...f, story: e.target.value })} />
        </Field>
        <button type="button" disabled={saveMut.isPending} onClick={() => saveMut.mutate()} className={`${ui.btnPrimary} w-full`}>
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
                disabled={toggleMut.isPending}
                onClick={() => toggleMut.mutate({ id: p.id, isActive: !p.isActive })}
                className="inline-flex h-11 w-12 flex-none items-center justify-center disabled:opacity-50"
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
              <button type="button" aria-label={`Xoá khuyến mãi ${p.title}`} className={ICON_BTN} onClick={() => setConfirmDeleteId(p.id)}>
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
          <p className="text-xs text-stone-600">
            Có mã thì khách chạm để sao chép ngay trên trang nhãn. Mã giảm giá phải do Tubu tạo sẵn, công khai và còn hạn — mã không có trong hệ thống
            sẽ bị từ chối khi lưu. Để trống ô này khi sửa để gỡ mã.
          </p>
          <div className="flex gap-2">
            <input type="date" aria-label="Từ ngày" className={dateClass} value={promo.startAt} onChange={(e) => setPromo({ ...promo, startAt: e.target.value })} />
            <input type="date" aria-label="Đến ngày" className={dateClass} value={promo.endAt} onChange={(e) => setPromo({ ...promo, endAt: e.target.value })} />
          </div>
          {invalid && <p className={ui.error}>Ngày kết thúc phải sau ngày bắt đầu.</p>}
          {editingId ? (
            <div className="flex gap-2">
              <button type="button" className={`${skin.btnSecondary} flex-1`} disabled={!promo.title.trim() || invalid || updPromo.isPending} onClick={() => updPromo.mutate()}>
                {updPromo.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
              </button>
              <button type="button" className={ui.btnText} onClick={resetPromoForm}>
                Huỷ
              </button>
            </div>
          ) : (
            <button type="button" className={`${skin.btnSecondary} self-start`} disabled={!promo.title.trim() || invalid || addPromo.isPending} onClick={() => addPromo.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {addPromo.isPending ? 'Đang thêm…' : 'Thêm khuyến mãi'}
            </button>
          )}
        </div>
      </section>

      <Sheet open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} title="Xoá khuyến mãi này?">
        <div className="flex flex-col gap-2.5 px-4 pb-4 pt-2">
          <button type="button" className={`${skin.btnSecondary} w-full`} onClick={() => setConfirmDeleteId(null)}>
            Huỷ
          </button>
          <button
            type="button"
            disabled={delPromo.isPending}
            onClick={() => delPromo.mutate(confirmDeleteId!)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-control bg-danger-fg px-5 text-sm font-semibold text-stone-0 disabled:opacity-60"
          >
            {delPromo.isPending ? 'Đang xoá…' : 'Xoá'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
