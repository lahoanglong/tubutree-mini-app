'use client';

import type { ReactNode } from 'react';
import { SUBSCRIPTION_PAYMENT_METHODS, type SubscriptionPaymentMethod } from '@tubutree/app-core/api/subscriptions';
import type { AddressDTO } from '@tubutree/app-core/api/checkout';
import { formatVnd } from '@/lib/format-vnd';

export const PAY_LABEL: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Thanh toán khi nhận hàng (COD)',
  WALLET: 'Ví Tubu',
  BANK_TRANSFER: 'Chuyển khoản ngân hàng',
};
export const PAY_SHORT: Record<SubscriptionPaymentMethod, string> = { COD: 'COD', WALLET: 'Ví Tubu', BANK_TRANSFER: 'Chuyển khoản' };
const PAY_HINT: Record<SubscriptionPaymentMethod, string> = {
  COD: 'Trả tiền mặt cho shipper mỗi lần giao.',
  WALLET: 'Tự trừ Ví Tubu mỗi kỳ. Ví không đủ tiền thì gói tạm dừng và Tubu báo cho bạn.',
  BANK_TRANSFER: 'Mỗi kỳ Tubu tạo đơn chờ chuyển khoản. Quá hạn chưa chuyển thì đơn tự hủy.',
};

export function addressText(a: Pick<AddressDTO, 'street' | 'ward' | 'district'>): string {
  return [a.street, a.ward, a.district].filter(Boolean).join(', ');
}

/** Hàng chọn một: vùng chạm 44px, cả hàng bấm được, nhóm có role=radiogroup như Mini App. */
function RadioRow({ checked, onSelect, title, hint, name }: { checked: boolean; onSelect: () => void; title: ReactNode; hint?: ReactNode; name: string }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 py-2">
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="h-5 w-5 flex-none accent-forest-600" />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm text-stone-900 ${checked ? 'font-semibold' : ''}`}>{title}</span>
        {hint && <span className="block text-xs text-stone-600">{hint}</span>}
      </span>
    </label>
  );
}

export function PaymentMethodPicker({
  value,
  onChange,
  walletBalance,
}: {
  value: SubscriptionPaymentMethod;
  onChange: (m: SubscriptionPaymentMethod) => void;
  walletBalance?: number;
}) {
  const label = (m: SubscriptionPaymentMethod) => (m === 'WALLET' && walletBalance !== undefined ? `Ví Tubu (${formatVnd(walletBalance)})` : PAY_LABEL[m]);
  return (
    <div role="radiogroup" aria-label="Thanh toán mỗi kỳ">
      {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
        <RadioRow key={m} name="sub-pay" checked={value === m} onSelect={() => onChange(m)} title={label(m)} hint={value === m ? PAY_HINT[m] : undefined} />
      ))}
    </div>
  );
}

export function AddressPicker({ addresses, value, onChange }: { addresses: AddressDTO[]; value: string | undefined; onChange: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Giao tới">
      {addresses.map((a) => (
        <RadioRow key={a.id} name="sub-addr" checked={value === a.id} onSelect={() => onChange(a.id)} title={`${a.recipient} · ${a.phone}`} hint={addressText(a)} />
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mb-1 mt-4 text-sm font-semibold text-stone-900">{children}</div>;
}
