import type { ReactNode } from 'react';
import type { AddressDTO } from '../services/shop-api';
import {
  MAX_START_DAYS_AHEAD,
  SUBSCRIPTION_PAYMENT_METHODS,
  type SubscriptionPaymentMethod,
} from '../services/subscriptions-api';
import { formatVnd } from '../utils/format';
import { haptic } from '../utils/haptic';
import { vi } from '../i18n/vi';
import { Radio } from './ui/form';
import { rowKeyboardProps } from './ui/row-keyboard';
import { Text } from './ui/text';

const VN_OFFSET_MS = 7 * 3600 * 1000;

/** Ngày lịch giờ Việt Nam (YYYY-MM-DD) — API so ngày bắt đầu theo giờ VN, máy khách có thể khác múi giờ. */
export function vnDateOf(at: Date): string {
  return new Date(at.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Khoảng được hẹn: từ ngày mai (hôm nay = "Giao ngay") tới hết `MAX_START_DAYS_AHEAD` ngày, như API. */
export function startDateRange(now: Date = new Date()): { min: string; max: string } {
  return {
    min: vnDateOf(new Date(now.getTime() + 864e5)),
    max: vnDateOf(new Date(now.getTime() + MAX_START_DAYS_AHEAD * 864e5)),
  };
}

export function isStartDateAllowed(date: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { min, max } = startDateRange(now);
  return date >= min && date <= max;
}

/** "2026-10-20" → "20/10/2026" (không qua Date để khỏi lệch ngày theo múi giờ máy). */
export function formatVnDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function addressText(a: Pick<AddressDTO, 'street' | 'ward' | 'district'>): string {
  return [a.street, a.ward, a.district].filter(Boolean).join(', ');
}

function RadioRow({
  checked,
  onSelect,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  title: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      {...rowKeyboardProps()}
      className="tubu-press"
      onClick={() => {
        if (checked) return;
        haptic('light');
        onSelect();
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', minHeight: 44, boxSizing: 'border-box', cursor: 'pointer' }}
    >
      {/* Chấm tròn chỉ để nhìn: chọn nằm ở onClick của hàng (role=radio), như hàng thanh toán ở checkout. */}
      <Radio checked={checked} onChange={() => {}} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-sm" as="div" style={{ fontWeight: checked ? 600 : 400 }}>
          {title}
        </Text>
        {hint && (
          <Text variant="caption" tone="tertiary" as="div">
            {hint}
          </Text>
        )}
      </div>
    </div>
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
  const t = vi.subscriptions;
  const label = (m: SubscriptionPaymentMethod) =>
    m === 'WALLET' && walletBalance !== undefined ? t.payWalletBalance(formatVnd(walletBalance)) : t.payLabel[m];
  return (
    <div role="radiogroup" aria-label={t.paymentLabel}>
      {SUBSCRIPTION_PAYMENT_METHODS.map((m) => (
        <RadioRow
          key={m}
          checked={value === m}
          onSelect={() => onChange(m)}
          title={label(m)}
          hint={value === m ? t.payHint[m] : undefined}
        />
      ))}
    </div>
  );
}

export function AddressPicker({
  addresses,
  value,
  onChange,
}: {
  addresses: AddressDTO[];
  value: string | undefined;
  onChange: (id: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label={vi.subscriptions.addressLabel}>
      {addresses.map((a) => (
        <RadioRow
          key={a.id}
          checked={value === a.id}
          onSelect={() => onChange(a.id)}
          title={`${a.recipient} · ${a.phone}`}
          hint={addressText(a)}
        />
      ))}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text variant="body-sm" as="div" style={{ fontWeight: 600, marginTop: 16, marginBottom: 4 }}>
      {children}
    </Text>
  );
}
