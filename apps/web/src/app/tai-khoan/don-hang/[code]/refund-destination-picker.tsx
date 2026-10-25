'use client';

import { useEffect, useId, useRef } from 'react';
import { Landmark, Wallet } from 'lucide-react';
import { fetchRefundBank } from '@/lib/shop-client';
import { ui } from '@/lib/guest-ui';
import type { RefundBankInput, RefundMethodChoice } from '@/lib/refund-rules';

interface Props {
  method: RefundMethodChoice;
  onMethod: (m: RefundMethodChoice) => void;
  bank: RefundBankInput;
  onBank: (b: RefundBankInput) => void;
  bankError: string | null;
  amountLabel?: string;
}

const OPTIONS = [
  {
    value: 'WALLET',
    Icon: Wallet,
    title: 'Ví Tubu',
    hint: 'Cộng ngay, dùng mua đơn tiếp theo.',
  },
  {
    value: 'BANK',
    Icon: Landmark,
    title: 'Tài khoản ngân hàng',
    hint: 'Tubu chuyển khoản trong 1-3 ngày làm việc, miễn phí, không giới hạn số tiền.',
  },
] as const;

/** Khách chọn nơi nhận tiền hoàn (D2): Ví Tubu cộng ngay, hoặc tài khoản ngân hàng do Tubu chuyển khoản. */
export function RefundDestinationPicker({
  method,
  onMethod,
  bank,
  onBank,
  bankError,
  amountLabel,
}: Props) {
  const name = useId();

  // Điền sẵn đúng một lần, lúc khách chọn "Tài khoản ngân hàng" đầu tiên và cả ba ô còn trống; sau đó khách sửa hay xoá ô nào
  // cũng không bị ghi đè. Bản trả về muộn cũng chỉ điền khi khách chưa gõ gì.
  const prefillStarted = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ bank, onBank });
  latest.current = { bank, onBank };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (method !== 'BANK' || prefillStarted.current) return;
    prefillStarted.current = true;
    if (bank.bankName || bank.accountNumber || bank.accountName) return;
    fetchRefundBank()
      .then((saved) => {
        const { bank: cur, onBank: apply } = latest.current;
        if (mounted.current && saved && !cur.bankName && !cur.accountNumber && !cur.accountName) apply(saved);
      })
      .catch(() => undefined);
  }, [method, bank]);

  const input = (
    label: string,
    key: keyof RefundBankInput,
    extra: { inputMode?: 'numeric'; placeholder?: string } = {},
  ) => (
    <label className="block">
      <span className="text-xs font-medium text-stone-700">{label}</span>
      <input
        value={bank[key]}
        onChange={(e) => onBank({ ...bank, [key]: e.target.value })}
        maxLength={key === 'accountNumber' ? 40 : 120}
        aria-invalid={bankError ? true : undefined}
        className={`${bankError ? ui.fieldError : ui.field} mt-1`}
        {...extra}
      />
    </label>
  );

  return (
    <div role="radiogroup" aria-label="Nơi nhận tiền hoàn" className="space-y-2">
      <p className="text-sm font-semibold text-stone-900">
        {amountLabel ? `Nhận lại ${amountLabel} về` : 'Nhận tiền hoàn về'}
      </p>
      {OPTIONS.map((opt) => {
        const checked = method === opt.value;
        return (
          <label
            key={opt.value}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-control border px-3 py-2 ${
              checked ? 'border-forest-600 bg-forest-50' : 'border-stone-200 bg-stone-0'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={checked}
              onChange={() => onMethod(opt.value)}
              className="h-4 w-4 flex-none accent-forest-600"
            />
            <opt.Icon className="h-4 w-4 flex-none text-forest-600" aria-hidden="true" />
            <span className="min-w-0">
              <span className={`block text-sm text-stone-900 ${checked ? 'font-semibold' : ''}`}>
                {opt.title}
              </span>
              <span className="block text-xs text-stone-600">{opt.hint}</span>
            </span>
          </label>
        );
      })}
      {method === 'BANK' && (
        <div className="space-y-2 pt-1">
          {input('Tên ngân hàng', 'bankName', { placeholder: 'VD: Techcombank' })}
          {input('Số tài khoản', 'accountNumber', { inputMode: 'numeric' })}
          {input('Chủ tài khoản', 'accountName', { placeholder: 'Tên in trên thẻ' })}
          {bankError && (
            <p role="alert" className={ui.error}>
              {bankError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
