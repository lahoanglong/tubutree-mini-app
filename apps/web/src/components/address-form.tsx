'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pickLastGeo, recallLastGeo, rememberLastGeo } from '@tubutree/app-core/address-geo-memory';
import { usableProfileName } from '@tubutree/app-core/profile-name';
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
import { actionErrorText } from '@/lib/error-text';
import { serverRejectedState } from '@/lib/server-rejected-state';
import { settleWithin } from '@/lib/settle-within';
import { browserStorage } from '@/lib/recently-viewed';
import { getMe, type AddressDTO } from '@/lib/shop-client';

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
  userId,
  onSubmit,
  onCancel,
}: {
  initial?: { form: AddressFormValues; geo: GeoValue };
  submitLabel: string;
  title: string;
  /** Cấp tiêu đề của form cho khớp trang chứa nó (h2 dưới h1, h3 dưới một mục h2) để không nhảy cấp. */
  headingLevel?: 2 | 3;
  /** Khoá bộ nhớ tỉnh/phường theo tài khoản để máy dùng chung không điền nhầm. */
  userId?: string | null;
  onSubmit: (payload: AddressPayload) => Promise<unknown>;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: getMe, enabled: !initial });
  const [form, setForm] = useState<AddressFormValues>(
    initial?.form ?? {
      ...EMPTY_FORM,
      recipient: usableProfileName(meQ.data?.fullName),
      phone: meQ.data?.phone ?? '',
    },
  );
  const [geo, setGeo] = useState<GeoValue>(
    () =>
      initial?.geo ??
      recallLastGeo(browserStorage(), userId) ??
      pickLastGeo(queryClient.getQueryData<AddressDTO[]>(['addresses'])) ??
      EMPTY_GEO,
  );
  const [touched, setTouched] = useState<Partial<Record<AddressField, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  // Khoá đồng bộ: `save.isPending` chỉ đúng sau lần vẽ kế, hai cú gửi form sát nhau (bấm đúp, Enter giữ phím) sẽ tạo hai địa chỉ.
  const savingRef = useRef(false);
  // Lời lỗi nhớ riêng (không đọc `save.error`): `save.error` chỉ có sau khi `onError` xong, mà `onError` có thể giữ tới khi sổ địa chỉ tải lại.
  const [saveError, setSaveError] = useState<{ value: unknown } | null>(null);
  const save = useMutation({
    mutationFn: (p: AddressPayload) => onSubmit(p),
    onMutate: () => setSaveError(null),
    onSuccess: (_r, p) => {
      // Không biết tài khoản thì không ghi: khoá chung sẽ điền nhầm tỉnh/phường cho người dùng sau trên máy dùng chung.
      if (userId) rememberLastGeo(p, browserStorage(), userId);
    },
    // Máy chủ từ chối vì sổ không còn khớp (địa chỉ đang sửa đã bị xoá ở máy khác, đủ số địa chỉ): lời lỗi hiện ngay, sổ địa chỉ và báo giá tải lại rồi mới nhả khoá
    // (tối đa `LOCK_REFRESH_WAIT_MS`), như Mini App; nhả sớm thì bấm Lưu lại trên số cũ nhận đúng lỗi đó. Mất mạng và 5xx không nói gì về sổ thật nên nhả ngay.
    onError: (e) => {
      setSaveError({ value: e });
      return serverRejectedState(e)
        ? settleWithin(Promise.all([queryClient.invalidateQueries({ queryKey: ['addresses'] }), queryClient.invalidateQueries({ queryKey: ['quote'] })]))
        : undefined;
    },
    onSettled: () => {
      savingRef.current = false;
    },
  });

  const prefilled = useRef(false);
  useEffect(() => {
    if (initial || !meQ.data || prefilled.current) return;
    prefilled.current = true;
    const name = usableProfileName(meQ.data.fullName);
    const phone = meQ.data.phone ?? '';
    setForm((f) => ({
      ...f,
      recipient: f.recipient.trim() ? f.recipient : name,
      phone: f.phone.trim() ? f.phone : phone,
    }));
    setGeo((g) => (g.provinceCode ? g : (pickLastGeo(queryClient.getQueryData<AddressDTO[]>(['addresses'])) ?? g)));
  }, [initial, meQ.data, queryClient]);

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
      className="space-y-3 md:rounded-control md:border md:border-stone-300 md:p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (savingRef.current) return;
        setSubmitted(true);
        if (firstInvalidField(all)) {
          setFocusTick((n) => n + 1);
          return;
        }
        savingRef.current = true;
        save.mutate(addressPayload(form, geo));
      }}
    >
      <Heading className="sr-only font-semibold text-stone-900 md:not-sr-only">{title}</Heading>
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
        label="Số nhà, tên đường"
        value={form.street}
        error={shown('street')}
        maxLength={STREET_MAX}
        autoComplete="street-address"
        onBlur={() => touch('street')}
        onChange={(v) => setForm((f) => ({ ...f, street: v }))}
      />
      {saveError && (
        <p role="alert" className={ui.error}>
          {actionErrorText(saveError.value)}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={save.isPending} className={ui.btnSecondary}>
          Huỷ
        </button>
        {/* Không `disabled` thật khi đang lưu: Chromium thả focus về body, khách dùng bàn phím mất chỗ khi lỗi hiện ra. */}
        <button
          type="submit"
          aria-busy={save.isPending || undefined}
          aria-disabled={save.isPending || undefined}
          className={`${ui.btnPrimary} flex-1`}
        >
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
        <span className="text-field-label text-[color:var(--color-text-secondary)]">{label}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          maxLength={maxLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${error ? ui.fieldError : ui.field} mt-1`}
        />
      </label>
      {error && (
        <p id={errorId} className="mt-0.5 flex items-start gap-1 text-caption text-danger-fg">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
