// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { walletNegativeCheckoutReason } from '@tubutree/app-core/wallet-rules';
import { click, render, type Rendered } from '@/test-utils/dom';
import { AddressPicker, PaymentMethodPicker } from './subscription-options';

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

const ADDRS = [
  { id: 'a1', recipient: 'Lan', phone: '0900000000', street: '1 Lê Lợi', ward: 'P.1', district: 'Q.1' },
  { id: 'a2', recipient: 'Minh', phone: '0911111111', street: '9 Hai Bà Trưng', ward: 'P.2', district: 'Q.3' },
] as never;
const allRadios = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'));

describe('khoá bộ chọn khi đang bận (W61A)', () => {
  it('PaymentMethodPicker: disabled khoá cả ba ô (kể cả Ví không âm), bấm hàng không chọn', () => {
    const onChange = vi.fn();
    mounted.push(render(<PaymentMethodPicker value="COD" onChange={onChange} walletBalance={250000} disabled />));
    expect(allRadios()).toHaveLength(3);
    allRadios().forEach((r) => {
      expect(r.disabled).toBe(true);
      click(r);
      click(r.closest('label'));
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('PaymentMethodPicker: không truyền disabled thì chỉ Ví âm bị khoá', () => {
    mount(-1000);
    expect(radioOf(/Thanh toán khi nhận hàng/).disabled).toBe(false);
    expect(radioOf(/Chuyển khoản/).disabled).toBe(false);
    expect(radioOf(/Ví Tubu/).disabled).toBe(true);
  });

  it('AddressPicker: mặc định chọn được; disabled khoá mọi ô và bấm không gọi onChange', () => {
    const onChange = vi.fn();
    const first = render(<AddressPicker addresses={ADDRS} value="a1" onChange={onChange} />);
    expect(allRadios()).toHaveLength(2);
    allRadios().forEach((r) => expect(r.disabled).toBe(false));
    click(allRadios()[1]!);
    expect(onChange).toHaveBeenCalledWith('a2');
    first.unmount();
    onChange.mockClear();
    mounted.push(render(<AddressPicker addresses={ADDRS} value="a1" onChange={onChange} disabled />));
    allRadios().forEach((r) => {
      expect(r.disabled).toBe(true);
      click(r);
      click(r.closest('label'));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(allRadios()[0]!.checked).toBe(true);
  });
});

describe('số đều (tabular-nums) ở hàng chọn thanh toán và địa chỉ (W61A)', () => {
  const textBox = (radioEl: HTMLInputElement) => radioEl.closest('label')!.querySelector('span')!;

  it('hàng Ví Tubu kèm số dư, hàng Ví âm kèm số tiền và hàng địa chỉ kèm số điện thoại đều có tabular-nums', () => {
    mount(120000);
    expect(textBox(radioOf(/Ví Tubu \(120\.000đ\)/)).className).toContain('tabular-nums');
    mounted.pop()!.unmount();
    mount(-50000);
    expect(textBox(radioOf(/Ví Tubu/)).className).toContain('tabular-nums');
    expect(textBox(radioOf(/Ví Tubu/)).textContent).toContain(walletNegativeCheckoutReason('50.000đ'));
    mounted.pop()!.unmount();
    mounted.push(render(<AddressPicker addresses={ADDRS} value="a1" onChange={vi.fn()} />));
    expect(textBox(allRadios()[0]!).className).toContain('tabular-nums');
    expect(textBox(allRadios()[0]!).textContent).toContain('Lan · 0900000000');
  });
});
