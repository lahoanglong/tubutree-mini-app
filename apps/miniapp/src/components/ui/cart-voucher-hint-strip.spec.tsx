import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartVoucherHintStrip } from './cart-voucher-hint-strip';

const APPLY = {
  code: 'GIAM45',
  label: 'GIAM45',
  saving: 45_000,
  text: '🎟️ Bạn có mã giảm giá 45.000đ đủ điều kiện',
  ariaLabel: 'Áp dụng ngay mã GIAM45',
};
const UNLOCK = {
  code: 'GIAM80',
  missing: 30_000,
  pct: 90,
  text: '🔥 Mua thêm 30.000đ để mở khoá mã giảm giá 80.000đ',
  barAria: 'Đã đạt 90% đơn tối thiểu của mã giảm giá',
};
const both: CartVoucherHint = { apply: APPLY, unlock: UNLOCK };

describe('CartVoucherHintStrip (Mini)', () => {
  it('không có gợi ý (null hoặc cả hai rỗng): không vẽ gì', () => {
    const a = render(<CartVoucherHintStrip hint={null} onApply={vi.fn()} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<CartVoucherHintStrip hint={{ apply: null, unlock: null }} onApply={vi.fn()} />);
    expect(b.container.firstChild).toBeNull();
  });

  it('có mã dùng được: một dòng mời áp với chữ của app-core và nút "Áp dụng ngay" có tên truy cập kèm mã', () => {
    render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={vi.fn()} />);
    const row = screen.getByTestId('cart-voucher-apply');
    expect(row).toHaveAttribute('data-kind', 'apply');
    expect(within(row).getByText('🎟️ Bạn có mã giảm giá 45.000đ đủ điều kiện')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: 'Áp dụng ngay mã GIAM45' });
    expect(cta).toBe(screen.getByTestId('cart-voucher-apply-cta'));
    expect(cta).toHaveTextContent('Áp dụng ngay');
    expect(screen.queryByTestId('cart-voucher-unlock')).toBeNull();
  });

  it('một chạm "Áp dụng ngay" gọi onApply đúng một lần với mã thật', () => {
    const onApply = vi.fn();
    render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={onApply} />);
    fireEvent.click(screen.getByTestId('cart-voucher-apply-cta'));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('GIAM45');
  });

  it('đang áp: nút giữ nhãn, báo bận (aria-busy) và không gọi onApply lần nữa', () => {
    const onApply = vi.fn();
    render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={onApply} applying />);
    const cta = screen.getByTestId('cart-voucher-apply-cta');
    expect(cta).toHaveAttribute('aria-busy', 'true');
    expect(cta).toHaveAccessibleName('Áp dụng ngay mã GIAM45');
    fireEvent.click(cta);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('chưa đủ điều kiện nhưng gần đủ: dòng nhắc "Mua thêm … để mở khoá …" và thanh progressbar đúng mức, có tên truy cập', () => {
    render(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} onApply={vi.fn()} />);
    const row = screen.getByTestId('cart-voucher-unlock');
    expect(row).toHaveAttribute('data-kind', 'unlock');
    expect(within(row).getByText('🔥 Mua thêm 30.000đ để mở khoá mã giảm giá 80.000đ')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar');
    expect(bar).toBe(screen.getByTestId('cart-voucher-unlock-bar'));
    expect(bar).toHaveAttribute('aria-valuenow', '90');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAccessibleName('Đã đạt 90% đơn tối thiểu của mã giảm giá');
    expect(bar.firstElementChild).toHaveStyle({ width: '90%' });
    expect(screen.queryByTestId('cart-voucher-apply')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('cả hai cùng có: dòng mời áp đứng trước dòng nhắc mở khoá', () => {
    render(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    const strip = screen.getByTestId('cart-voucher-hint');
    expect(Array.from(strip.children).map((el) => el.getAttribute('data-testid'))).toEqual(['cart-voucher-apply', 'cart-voucher-unlock']);
  });

  it('lời báo lỗi áp: role=alert ngay dưới dòng mời áp; không có dòng mời áp thì không hiện lỗi', () => {
    const { rerender } = render(<CartVoucherHintStrip hint={both} onApply={vi.fn()} error="Mã đã hết lượt dùng." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Mã đã hết lượt dùng.');
    expect(screen.getByTestId('cart-voucher-error').previousElementSibling).toBe(screen.getByTestId('cart-voucher-apply'));
    rerender(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} onApply={vi.fn()} error="Mã đã hết lượt dùng." />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('không có chữ cấm "voucher" và không dấu chấm than trong chữ khách đọc', () => {
    const { container } = render(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
  });

  it('chỉ token trong thuộc tính style: phần đầy chỉ đặt bề rộng %, dòng nhắc không có số đo px, không màu thô', () => {
    const { container } = render(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    // Nút dùng chung `Button` tự đặt minHeight 44 (vùng chạm); phần của dải chỉ có style ở thanh đầy dần.
    expect(screen.getByTestId('cart-voucher-unlock').querySelectorAll('[style*="px"]').length).toBe(0);
    expect(screen.getByTestId('cart-voucher-unlock-bar').firstElementChild?.getAttribute('style')).toBe('width: 90%;');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe('css/freeship.css: dải gợi ý mã giảm giá', () => {
  const css = readFileSync(resolve(__dirname, '../../css/freeship.css'), 'utf8');
  function loadSheet() {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return style.sheet!;
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => (Array.from(loadSheet().cssRules).find((r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === sel) as CSSStyleRule).style;

  it('số đều trong dòng, nút bấm cao 44px, dòng mời áp theo token success', () => {
    expect(rule('.tubu-vhint-row').getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
    expect(rule('.tubu-vhint-cta.zaui-btn').getPropertyValue('height')).toBe('44px');
    expect(rule(".tubu-vhint-row[data-kind='apply']").getPropertyValue('background')).toBe('var(--color-status-success-bg)');
    expect(rule(".tubu-vhint-row[data-kind='apply'] .tubu-vhint-text").getPropertyValue('color')).toBe('var(--color-text-success)');
  });

  it('chữ dài không tràn ngang (overflow-wrap) và lời báo lỗi dùng màu danger', () => {
    expect(rule('.tubu-vhint-text').getPropertyValue('overflow-wrap')).toBe('anywhere');
    expect(parseFloat(rule('.tubu-vhint-text').getPropertyValue('min-width'))).toBe(0);
    expect(rule('.tubu-vhint-error').getPropertyValue('color')).toBe('var(--color-text-danger)');
  });
});
