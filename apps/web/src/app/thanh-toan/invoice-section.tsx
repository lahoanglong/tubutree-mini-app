'use client';

import { useId } from 'react';
import type { InvoiceField, InvoiceFieldErrors } from '@tubutree/app-core/commerce/checkout-form';
import { ui } from '@/lib/guest-ui';
import { CheckMark, mini, miniCheckbox, miniCheckboxGutter, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';
import type { InvoiceInfo } from '@/lib/checkout-rules';

/**
 * Yêu cầu xuất hoá đơn VAT (doanh nghiệp): bật thì cần đủ MST, tên công ty, địa chỉ và email — API validate IsEmail.
 * `errors` là các lỗi đã được phép hiện (ô đã rời, hoặc khách đã bấm Đặt hàng): mỗi ô báo riêng ngay dưới ô.
 */
export function InvoiceSection({
  want,
  onWant,
  invoice,
  onInvoice,
  errors,
  onTouch,
  disabled,
}: {
  want: boolean;
  onWant: (v: boolean) => void;
  invoice: InvoiceInfo;
  onInvoice: (v: InvoiceInfo) => void;
  errors: InvoiceFieldErrors;
  onTouch: (field: InvoiceField) => void;
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
    <section aria-label="Hoá đơn VAT" className={`p-4 ${ui.card} ${mini.band}`}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[color:var(--color-text-primary)] max-md:flex-row-reverse max-md:justify-between">
        <span className={`${miniCheckboxWrap} ${miniCheckboxGutter}`}>
          <input type="checkbox" checked={want} onChange={(e) => onWant(e.target.checked)} disabled={disabled} className={miniCheckbox} />
          <CheckMark />
        </span>
        Yêu cầu xuất hoá đơn VAT
      </label>
      {want && (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <label key={f.key} htmlFor={`${id}-${f.key}`} className={f.key === 'address' ? 'block sm:col-span-2' : 'block'}>
              <span className="text-caption font-medium text-[color:var(--color-text-secondary)]">{f.label}</span>
              <input
                id={`${id}-${f.key}`}
                type={f.type ?? 'text'}
                value={invoice[f.key]}
                onChange={(e) => set({ [f.key]: e.target.value })}
                onBlur={() => onTouch(f.key)}
                autoComplete={f.autoComplete}
                disabled={disabled}
                aria-invalid={errors[f.key] ? true : undefined}
                aria-describedby={errors[f.key] ? `${id}-${f.key}-err` : undefined}
                className={`${ui.field} mt-1`}
              />
              {errors[f.key] && (
                <span id={`${id}-${f.key}-err`} className="mt-1 block text-caption text-danger-fg">
                  <span aria-hidden="true">⚠ </span>
                  {errors[f.key]}
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
