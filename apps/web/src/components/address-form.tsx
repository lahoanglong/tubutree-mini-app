'use client';

import { useEffect, useId, useRef, useState, type ClipboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pickLastGeo, recallLastGeo, rememberLastGeo } from '@tubutree/app-core/address-geo-memory';
import {
  applyAddressPaste,
  takesAddressPaste,
  type AddressPasteHost,
  type PasteSlot,
  type PasteTextField,
} from '@tubutree/app-core/address-paste';
import { parseVnPhoneInput } from '@tubutree/app-core/phone-input';
import { usableProfileName } from '@tubutree/app-core/profile-name';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { GeoPicker, EMPTY_GEO, type GeoValue } from '@/components/geo-picker';
import { getCommunes, getProvinces, type GeoOption } from '@/lib/geo-client';
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
  // Ô khách đã tự gõ/chọn: khối địa chỉ dán vào không đè. Ô app điền sẵn (tên, SĐT hồ sơ, tỉnh/phường lần trước) thì đè được.
  const edited = useRef(new Set<PasteSlot>(initial ? ['recipient', 'phone', 'street', 'geo'] : []));
  const latest = useRef({ form, geo });
  latest.current = { form, geo };
  // `n` đổi mỗi lần dán: dòng báo vẽ lại thành nút mới nên trình đọc màn hình đọc lại cả khi chữ giống lần trước.
  const [pasteNote, setPasteNote] = useState({ shown: false, n: 0 });
  const hidePasteNote = () => setPasteNote((s) => (s.shown ? { ...s, shown: false } : s));

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

  const editField = (k: PasteTextField, v: string) => {
    edited.current.add(k);
    hidePasteNote();
    setForm((f) => ({ ...f, [k]: v }));
  };

  const pasteHost: AddressPasteHost<GeoValue> = {
    read: () => latest.current,
    edited: edited.current,
    provinces: () => queryClient.fetchQuery({ queryKey: ['geo-provinces'], queryFn: getProvinces, staleTime: Infinity }),
    communes: (code) => queryClient.fetchQuery({ queryKey: ['geo-communes', code], queryFn: () => getCommunes(code), staleTime: Infinity }),
    setForm,
    setGeo,
    announce: () => setPasteNote((s) => ({ shown: true, n: s.n + 1 })),
  };

  // Chữ dán có dáng một khối địa chỉ (tên + SĐT + đường/tỉnh/phường) thì tách ra các ô; không thì để ô dán như thường. Không tự lưu.
  const pasteAddress = (target: PasteTextField) => (e: ClipboardEvent<HTMLInputElement>): boolean => {
    const text = e.clipboardData.getData('text');
    if (!takesAddressPaste(text, queryClient.getQueryData<GeoOption[]>(['geo-provinces']), e.currentTarget, target, edited.current)) return false;
    e.preventDefault();
    void applyAddressPaste(text, target, pasteHost);
    return true;
  };

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
        onChange={(v) => editField('recipient', v)}
        onPasteAddress={pasteAddress('recipient')}
      />
      <TextField
        label="Số điện thoại"
        value={form.phone}
        error={shown('phone')}
        maxLength={20}
        autoComplete="tel"
        inputMode="tel"
        tabular
        // Chuẩn hoá khi rời ô và khi dán cả số, không phải từng phím: sửa chữ đang gõ giữa chừng sẽ làm con trỏ nhảy.
        onBlur={() => {
          touch('phone');
          setForm((f) => {
            const phone = parseVnPhoneInput(f.phone) ?? f.phone;
            return phone === f.phone ? f : { ...f, phone };
          });
        }}
        onChange={(v) => editField('phone', v)}
        onPasteAddress={pasteAddress('phone')}
        onPasteText={parseVnPhoneInput}
      />
      <div className="space-y-2">
        <GeoPicker
          value={geo}
          onChange={(g) => {
            edited.current.add('geo');
            hidePasteNote();
            setGeo(g);
          }}
          errorProvince={shown('province')}
          errorWard={shown('ward')}
        />
        {/* Vùng đọc luôn có mặt để trình đọc màn hình bắt được lần đổi chữ đầu tiên; rỗng thì ẩn. */}
        <p aria-live="polite" className={pasteNote.shown ? 'text-caption text-[color:var(--color-text-secondary)]' : 'sr-only'}>
          {pasteNote.shown && <span key={pasteNote.n}>{fillCopy('checkout.addressPasteFilled')}</span>}
        </p>
      </div>
      <TextField
        label="Số nhà, tên đường"
        value={form.street}
        error={shown('street')}
        maxLength={STREET_MAX}
        autoComplete="street-address"
        onBlur={() => touch('street')}
        onChange={(v) => editField('street', v)}
        onPasteAddress={pasteAddress('street')}
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
  tabular,
  onPasteText,
  onPasteAddress,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  error?: string;
  maxLength: number;
  autoComplete?: string;
  inputMode?: 'tel';
  /** Số hiển thị thẳng hàng (SĐT). */
  tabular?: boolean;
  /** Chữ dán đổi được thành giá trị chuẩn thì thay cả ô bằng giá trị đó; trả null, hoặc khách đang bôi chọn một phần ô, thì để trình duyệt dán như thường. */
  onPasteText?: (text: string) => string | null;
  /** Khối địa chỉ dán vào: trả true khi đã tự tách và điền (đã chặn dán mặc định). */
  onPasteAddress?: (e: ClipboardEvent<HTMLInputElement>) => boolean;
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
          onPaste={(e) => {
            if (onPasteAddress?.(e)) return;
            // Chỉ khi khách bôi chọn MỘT PHẦN ô thì để trình duyệt chèn vào đúng đoạn chọn (không xoá phần còn lại); ô trống, bôi hết, hay con trỏ không bôi gì thì chữ dán là cả số mới nên thay cả ô.
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd && !(el.selectionStart === 0 && el.selectionEnd === el.value.length)) return;
            const next = onPasteText?.(e.clipboardData.getData('text'));
            if (next == null) return;
            e.preventDefault();
            onChange(next);
          }}
          maxLength={maxLength}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-required="true"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={`${error ? ui.fieldError : ui.field} mt-1${tabular ? ' tabular-nums' : ''}`}
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
