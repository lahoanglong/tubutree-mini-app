'use client';

import { useId, useRef, useState, type ChangeEvent } from 'react';
import type { ShippingAddressSnapshot } from '@tubutree/shared-types';
import { editOrderDelivery } from '@tubutree/app-core/api/order-edit';
import {
  ORDER_EDIT_COPY as COPY,
  orderEditAddressEditable,
  orderEditBody,
  orderEditFormOf,
  orderEditProvinceLine,
  orderEditSplitNote,
  type OrderEditForm,
} from '@tubutree/app-core/order-edit-copy';
import { normalizeVnPhoneInput } from '@tubutree/app-core/phone-input';
import { GeoPicker } from '@/components/geo-picker';
import { Sheet } from '@/components/ui/sheet';
import { ApiError } from '@/lib/client-api';
import { coreHttp } from '@/lib/core-http';
import { actionErrorText } from '@/lib/error-text';
import { ui } from '@/lib/guest-ui';

const NOTE_MAX = 500;

/** Lưu xong (kèm số lượt còn), hoặc máy chủ từ chối vì đơn đã đổi (đã đóng gói, hết lượt, kho đã nhận): trang đóng tấm và tải lại đơn. */
export type OrderEditOutcome = { kind: 'saved'; editsLeft: number } | { kind: 'refused'; message: string };

/**
 * Tấm "Sửa địa chỉ và ghi chú" của chi tiết đơn (cùng Mini App `components/orders/order-edit-sheet`): người nhận, SĐT, phường/xã, số nhà trong
 * tỉnh của đơn và ghi chú. Chỉ gửi phần khách đổi (`orderEditBody`); lỗi nhập (SĐT sai, phường không khớp) ở lại trong tấm.
 */
export default function OrderEditSheet({
  code,
  address,
  note,
  split,
  onClose,
  onSettled,
}: {
  code: string;
  address: ShippingAddressSnapshot;
  note: string | null;
  split: boolean;
  onClose: () => void;
  onSettled: (outcome: OrderEditOutcome) => void;
}) {
  const formId = useId();
  const [form, setForm] = useState<OrderEditForm>(() => orderEditFormOf(address, note));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ref: hai cú chạm cùng khung hình chưa kịp vẽ lại thì state `busy` còn cũ, sẽ gửi hai lần sửa (mỗi lần tính một lượt).
  const pending = useRef(false);
  const editable = orderEditAddressEditable(address);
  const set = (k: keyof OrderEditForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (pending.current) return;
    const body = orderEditBody(address, note, { ...form, phone: normalizeVnPhoneInput(form.phone) });
    if (body === null || body === 'REQUIRED') {
      setError(body === null ? COPY.noChange : COPY.required);
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await editOrderDelivery(coreHttp, code, body);
      onSettled({ kind: 'saved', editsLeft: res.editsLeft });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORDER_EDIT_REFUSED') onSettled({ kind: 'refused', message: actionErrorText(e) });
      else setError(actionErrorText(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      dismissible={!busy}
      title={COPY.title}
      footer={
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={`${ui.btnSecondary} flex-1`}>
            {COPY.close}
          </button>
          <button type="submit" form={formId} disabled={busy} aria-busy={busy || undefined} className={`${ui.btnPrimary} flex-1`}>
            {COPY.save}
          </button>
        </div>
      }
    >
      <form
        id={formId}
        data-testid="order-edit-sheet"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {split && <p className="text-sm text-stone-700">{orderEditSplitNote(code)}</p>}
        {editable ? (
          <>
            <div>
              <p className="text-sm font-medium text-stone-900">{orderEditProvinceLine(address.province)}</p>
              <p className="text-caption text-[color:var(--color-text-secondary)]">{COPY.provinceHint}</p>
            </div>
            <TextInput label={COPY.recipientLabel} value={form.recipient} onChange={set('recipient')} maxLength={120} autoComplete="name" />
            <TextInput label={COPY.phoneLabel} value={form.phone} onChange={set('phone')} maxLength={20} autoComplete="tel" inputMode="tel" />
            <GeoPicker
              provinceLocked
              value={{ province: address.province, provinceCode: address.provinceCode, ward: form.ward, wardCode: form.wardCode }}
              onChange={(g) => setForm((f) => ({ ...f, ward: g.ward, wardCode: g.wardCode }))}
            />
            <TextInput label={COPY.streetLabel} value={form.street} onChange={set('street')} maxLength={255} autoComplete="street-address" />
          </>
        ) : (
          <p className="text-sm text-stone-700">{COPY.noteOnly}</p>
        )}
        <label className="block">
          <span className="text-field-label text-[color:var(--color-text-secondary)]">{COPY.noteLabel}</span>
          <textarea
            value={form.note}
            onChange={set('note')}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder={COPY.notePlaceholder}
            className={`${ui.field} mt-1 resize-none py-2`}
          />
        </label>
        {error && (
          <p role="alert" data-testid="order-edit-error" className={ui.error}>
            {error}
          </p>
        )}
      </form>
    </Sheet>
  );
}

function TextInput({
  label,
  value,
  onChange,
  maxLength,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  maxLength: number;
  autoComplete: string;
  inputMode?: 'tel';
}) {
  return (
    <label className="block">
      <span className="text-field-label text-[color:var(--color-text-secondary)]">{label}</span>
      <input
        value={value}
        onChange={onChange}
        maxLength={maxLength}
        autoComplete={autoComplete}
        inputMode={inputMode}
        aria-required="true"
        className={`${ui.field} mt-1${inputMode === 'tel' ? ' tabular-nums' : ''}`}
      />
    </label>
  );
}
