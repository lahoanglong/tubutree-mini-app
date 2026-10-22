'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '@/components/geo-picker';
import {
  RECIPIENT_MAX,
  STREET_MAX,
  addressPayload,
  firstInvalidField,
  validateAddress,
  type AddressField,
  type AddressFormValues,
  type AddressPayload,
} from '@/lib/address-form';
import { ui } from '@/lib/guest-ui';

const EMPTY_FORM: AddressFormValues = { recipient: '', phone: '', street: '' };

/**
 * Form thêm/sửa địa chỉ dùng chung cho thanh toán và Sổ địa chỉ. Nút Lưu luôn bấm được: bấm khi còn thiếu thì mỗi ô sai
 * hiện lời nhắc riêng (aria-invalid + aria-describedby) và con trỏ nhảy tới ô sai đầu tiên, thay vì nút xám không rõ lý do.
 * Ô chữ báo lỗi ngay khi rời ô; tỉnh/phường báo khi bấm Lưu.
 */
export function AddressForm({
  initial,
  submitLabel,
  title,
  headingLevel = 3,
  onSubmit,
  onCancel,
}: {
  initial?: { form: AddressFormValues; geo: GeoValue };
  submitLabel: string;
  title: string;
  /** Cấp tiêu đề của form cho khớp trang chứa nó (h2 dưới h1, h3 dưới một mục h2) để không nhảy cấp. */
  headingLevel?: 2 | 3;
  onSubmit: (payload: AddressPayload) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AddressFormValues>(initial?.form ?? EMPTY_FORM);
  const [geo, setGeo] = useState<GeoValue>(initial?.geo ?? EMPTY_GEO);
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const save = useMutation({ mutationFn: (p: AddressPayload) => onSubmit(p) });

  const all = validateAddress(form, geo);
  const shown = (f: AddressField) => (submitted || touched[f] ? all[f] : undefined);
  const touch = (f: AddressField) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));

  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  return (
    <form
      ref={formRef}
      noValidate
      aria-label={title}
      className="space-y-3 rounded-control border border-stone-300 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (firstInvalidField(all)) {
          setFocusTick((n) => n + 1);
          return;
        }
        save.mutate(addressPayload(form, geo));
      }}
    >
      <Heading className="font-semibold text-stone-900">{title}</Heading>
      <TextField
        label="Người nhận"
        value={form.recipient}
        error={shown('recipient')}
        maxLength={RECIPIENT_MAX}
        autoComplete="name"
        onBlur={() => touch('recipient')}
        onChange={(v) => setForm((f) => ({ ...f, recipient: v }))}
      />
      <TextField
        label="Số điện thoại"
        value={form.phone}
        error={shown('phone')}
        maxLength={16}
        autoComplete="tel"
        inputMode="tel"
        onBlur={() => touch('phone')}
        onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
      />
      <div className="space-y-2">
        <GeoPicker value={geo} onChange={setGeo} errorProvince={shown('province')} errorWard={shown('ward')} />
      </div>
      <TextField
        label="Số nhà, đường"
        value={form.street}
        error={shown('street')}
        maxLength={STREET_MAX}
        autoComplete="street-address"
        onBlur={() => touch('street')}
        onChange={(v) => setForm((f) => ({ ...f, street: v }))}
      />
      {save.isError && (
        <p role="alert" className={ui.error}>
          {save.error instanceof Error ? save.error.message : 'Không lưu được địa chỉ. Vui lòng thử lại.'}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={save.isPending} className={ui.btnSecondary}>
          Huỷ
        </button>
        <button type="submit" disabled={save.isPending} className={`${ui.btnPrimary} flex-1`}>
          {save.isPending ? 'Đang lưu…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  onChange,
  onBlur,
  error,
  maxLength,
  autoComplete,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: string;
  maxLength: number;
  autoComplete?: string;
  inputMode?: 'tel';
}) {
  const errorId = useId();
  return (
    <div>
      <label className="block">
        <span className="text-xs font-medium text-stone-700">{label}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          maxLength={maxLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${error ? ui.fieldError : ui.field} mt-1`}
        />
      </label>
      {error && (
        <p id={errorId} className="mt-0.5 flex items-start gap-1 text-xs text-danger-fg">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
