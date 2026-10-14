import type { ReactNode } from 'react';
import { Input } from 'zmp-ui';
import { Landmark, Wallet } from 'lucide-react';
import { Field, Radio } from '../ui/form';
import { Icon } from '../ui/icon';
import { Text } from '../ui/text';
import { rowKeyboardProps } from '../ui/row-keyboard';
import { haptic } from '../../utils/haptic';
import { bankFieldErrors, type RefundBankInput, type RefundMethodChoice } from '../../utils/refund-rules';

interface Props {
  method: RefundMethodChoice;
  onMethod: (m: RefundMethodChoice) => void;
  bank: RefundBankInput;
  onBank: (b: RefundBankInput) => void;
  /** Khách đã bấm gửi: hiện lỗi tài khoản dưới từng ô sai. */
  showBankErrors?: boolean;
  /** Số tiền dự kiến hoàn, để câu chọn nói rõ "nhận 114.000đ". */
  amountLabel?: string;
}

/** Khách chọn nơi nhận tiền hoàn (D2): Ví Tubu cộng ngay, hoặc tài khoản ngân hàng (admin chuyển 1-3 ngày, miễn phí). */
export function RefundDestinationPicker({ method, onMethod, bank, onBank, showBankErrors, amountLabel }: Props) {
  const errors = showBankErrors ? bankFieldErrors(bank) : {};
  return (
    <div role="radiogroup" aria-label="Nơi nhận tiền hoàn" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Text variant="body-sm" as="div" style={{ fontWeight: 600 }}>
        {amountLabel ? `Nhận lại ${amountLabel} về` : 'Nhận tiền hoàn về'}
      </Text>
      <OptionRow
        checked={method === 'WALLET'}
        onSelect={() => onMethod('WALLET')}
        icon={<Icon icon={Wallet} size="sm" tone="brand" />}
        title="Ví Tubu"
        hint="Cộng ngay, dùng mua đơn tiếp theo hoặc rút về ngân hàng."
      />
      <OptionRow
        checked={method === 'BANK'}
        onSelect={() => onMethod('BANK')}
        icon={<Icon icon={Landmark} size="sm" tone="brand" />}
        title="Tài khoản ngân hàng"
        hint="Tubu chuyển khoản trong 1-3 ngày làm việc, miễn phí, không giới hạn số tiền."
      />
      {method === 'BANK' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
          <Field label="Tên ngân hàng" error={errors.bankName}>
            <Input placeholder="VD: Techcombank" maxLength={120} value={bank.bankName} onChange={(e) => onBank({ ...bank, bankName: e.target.value })} />
          </Field>
          <Field label="Số tài khoản" error={errors.accountNumber}>
            <Input inputMode="numeric" maxLength={40} value={bank.accountNumber} onChange={(e) => onBank({ ...bank, accountNumber: e.target.value })} />
          </Field>
          <Field label="Chủ tài khoản" error={errors.accountName}>
            <Input placeholder="Tên in trên thẻ" maxLength={120} value={bank.accountName} onChange={(e) => onBank({ ...bank, accountName: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  );
}

function OptionRow({ checked, onSelect, icon, title, hint }: { checked: boolean; onSelect: () => void; icon: ReactNode; title: string; hint: string }) {
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
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        minHeight: 44,
        boxSizing: 'border-box',
        cursor: 'pointer',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${checked ? 'var(--color-border-selected)' : 'var(--color-border-subtle)'}`,
        background: checked ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
      }}
    >
      <Radio checked={checked} onChange={() => {}} />
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-sm" as="div" style={{ fontWeight: checked ? 600 : 400 }}>
          {title}
        </Text>
        <Text variant="caption" tone="tertiary" as="div">
          {hint}
        </Text>
      </div>
    </div>
  );
}
