'use client';

import { useId } from 'react';
import { ui } from '@/lib/guest-ui';
import type { InvoiceInfo } from '@/lib/checkout-rules';

export const EMPTY_INVOICE: InvoiceInfo = { taxCode: '', companyName: '', address: '', email: '' };
const STORAGE_KEY = 'tubu_invoice';

/** Thông tin hoá đơn khách đã dùng lần trước (đỡ nhập lại); không có hoặc hỏng thì để trống. */
export function loadSavedInvoice(): InvoiceInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<InvoiceInfo>;
      return {
        taxCode: typeof p.taxCode === 'string' ? p.taxCode : '',
        companyName: typeof p.companyName === 'string' ? p.companyName : '',
        address: typeof p.address === 'string' ? p.address : '',
        email: typeof p.email === 'string' ? p.email : '',
      };
    }
  } catch {
    /* chế độ riêng tư/dữ liệu hỏng: nhập lại */
  }
  return EMPTY_INVOICE;
}

export function saveInvoice(invoice: InvoiceInfo): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(invoice));
  } catch {
    /* hết dung lượng/chế độ riêng tư: lần sau nhập lại, không được làm hỏng đơn vừa đặt */
  }
}

/** Yêu cầu xuất hoá đơn VAT (doanh nghiệp): bật thì cần đủ MST, tên công ty, địa chỉ và email — API validate IsEmail. */
export function InvoiceSection({
  want,
  onWant,
  invoice,
  onInvoice,
  valid,
  disabled,
}: {
  want: boolean;
  onWant: (v: boolean) => void;
  invoice: InvoiceInfo;
  onInvoice: (v: InvoiceInfo) => void;
  valid: boolean;
  disabled: boolean;
}) {
  const id = useId();
  const set = (patch: Partial<InvoiceInfo>) => onInvoice({ ...invoice, ...patch });
  const fields: { key: keyof InvoiceInfo; label: string; type?: string; autoComplete: string }[] = [
    { key: 'taxCode', label: 'Mã số thuế', autoComplete: 'off' },
    { key: 'companyName', label: 'Tên công ty', autoComplete: 'organization' },
    { key: 'address', label: 'Địa chỉ xuất hoá đơn', autoComplete: 'street-address' },
    { key: 'email', label: 'Email nhận hoá đơn', type: 'email', autoComplete: 'email' },
  ];

  return (
    <section aria-label="Hoá đơn VAT" className={`p-4 ${ui.card}`}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-stone-900">
        <input
          type="checkbox"
          checked={want}
          onChange={(e) => onWant(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 accent-forest-600"
        />
        Yêu cầu xuất hoá đơn VAT
      </label>
      {want && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <label key={f.key} htmlFor={`${id}-${f.key}`} className={f.key === 'address' ? 'block sm:col-span-2' : 'block'}>
              <span className="text-xs font-medium text-stone-700">{f.label}</span>
              <input
                id={`${id}-${f.key}`}
                type={f.type ?? 'text'}
                value={invoice[f.key]}
                onChange={(e) => set({ [f.key]: e.target.value })}
                autoComplete={f.autoComplete}
                disabled={disabled}
                className={`${ui.field} mt-1`}
              />
            </label>
          ))}
          {!valid && (
            <p role="status" className="text-xs text-danger-fg sm:col-span-2">
              Vui lòng điền đủ MST, tên công ty, địa chỉ và email hợp lệ.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
