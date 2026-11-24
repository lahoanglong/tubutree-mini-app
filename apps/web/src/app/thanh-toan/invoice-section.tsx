'use client';

import type { InvoiceField, InvoiceFieldErrors } from '@tubutree/app-core/commerce/checkout-form';
import { ui } from '@/lib/guest-ui';
import { CheckMark, mini, miniCheckbox, miniCheckboxGutter, miniCheckboxWrap } from '@/components/order-mobile/mobile-ui';
import { InvoiceFieldsLazy } from '@/components/checkout/checkout-panels-lazy';
import type { InvoiceInfo } from '@/lib/checkout-rules';

/**
 * Yêu cầu xuất hoá đơn VAT (doanh nghiệp): bật thì cần đủ MST, tên công ty, địa chỉ và email — API validate IsEmail.
 * `errors` là các lỗi đã được phép hiện (ô đã rời, hoặc khách đã bấm Đặt hàng): mỗi ô báo riêng ngay dưới ô.
 * Bốn ô chỉ có khi khách tích ô nên nằm ở chunk tải lười, không trong JS tải lần đầu của trang thanh toán.
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
  return (
    <section aria-label="Hoá đơn VAT" className={`p-4 ${ui.card} ${mini.band}`}>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-[color:var(--color-text-primary)] max-md:flex-row-reverse max-md:justify-between">
        <span className={`${miniCheckboxWrap} ${miniCheckboxGutter}`}>
          <input type="checkbox" checked={want} onChange={(e) => onWant(e.target.checked)} disabled={disabled} className={miniCheckbox} />
          <CheckMark />
        </span>
        Yêu cầu xuất hoá đơn VAT
      </label>
      {want && <InvoiceFieldsLazy invoice={invoice} onInvoice={onInvoice} errors={errors} onTouch={onTouch} disabled={disabled} className="mt-2" />}
    </section>
  );
}
