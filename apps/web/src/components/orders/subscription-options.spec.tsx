// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletNegativeCheckoutReason } from '@tubutree/app-core/wallet-rules';
import { click, render, type Rendered } from '@/test-utils/dom';
import { PaymentMethodPicker } from './subscription-options';

// Cùng ý nghĩa subscription-options.spec.tsx của Mini App: Ví đang âm thì không chọn trả mỗi kỳ bằng Ví được (sửa gói định kỳ).

let mounted: Rendered[] = [];
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});
const mount = (walletBalance: number | undefined, onChange = vi.fn()) => {
  mounted.push(render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={walletBalance} />));
  return onChange;
};
const radioOf = (re: RegExp) => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).find((i) => re.test(i.closest('label')?.textContent ?? ''))!;

describe('PaymentMethodPicker (web, sửa gói định kỳ)', () => {
  it('Ví đang âm: ô Ví Tubu bị khoá, ghi đúng câu của màn thanh toán, bấm không chọn', () => {
    const onChange = mount(-50000);
    const wallet = radioOf(/Ví Tubu/);
    expect(wallet.disabled).toBe(true);
    expect(wallet.closest('label')?.textContent).toContain(walletNegativeCheckoutReason('50.000đ'));
    click(wallet);
    click(wallet.closest('label'));
    expect(onChange).not.toHaveBeenCalled();
    click(radioOf(/Chuyển khoản ngân hàng/));
    expect(onChange).toHaveBeenCalledWith('BANK_TRANSFER');
  });

  it('Ví không âm hoặc chưa tải số dư: chọn Ví được như cũ', () => {
    const onChange = mount(250000);
    expect(radioOf(/Ví Tubu \(250\.000đ\)/).disabled).toBe(false);
    click(radioOf(/Ví Tubu/));
    expect(onChange).toHaveBeenCalledWith('WALLET');
  });
});
