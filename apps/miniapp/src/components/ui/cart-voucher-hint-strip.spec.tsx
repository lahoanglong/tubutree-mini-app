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
  it('không có gợi ý (null, cả hai rỗng, hoặc chỉ có mã dùng được mà không có mã sắp mở khoá): không vẽ gì', () => {
    const a = render(<CartVoucherHintStrip hint={null} />);
    expect(a.container.firstChild).toBeNull();
    const b = render(<CartVoucherHintStrip hint={{ apply: null, unlock: null }} />);
    expect(b.container.firstChild).toBeNull();
    // W166: dòng mời áp mã chuyển xuống hàng "Mã giảm giá" ở chân dính, dải chỉ còn vẽ dòng sắp mở khoá.
    const c = render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />);
    expect(c.container.firstChild).toBeNull();
  });

  it('có mã dùng được và mã sắp mở khoá: dải không còn nút "Áp dụng ngay" (mỗi hành động một nút), chỉ có dòng sắp mở khoá', () => {
    render(<CartVoucherHintStrip hint={both} />);
    expect(screen.queryByTestId('cart-voucher-apply')).toBeNull();
    expect(screen.queryByTestId('cart-voucher-apply-cta')).toBeNull();
    expect(screen.queryByText(/Bạn có mã giảm giá/)).toBeNull();
    expect(screen.getByTestId('cart-voucher-unlock')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('có onShopMore: nút duy nhất của dải là "Mua thêm", không có nút áp mã dù hint có mã dùng được', () => {
    render(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toBe(screen.getByTestId('cart-voucher-unlock-cta'));
    expect(screen.queryByRole('button', { name: /Áp dụng/ })).toBeNull();
  });

  it('lệnh áp mã không còn là việc của dải: không aria-busy, không lời báo lỗi (role=alert) ở dải', () => {
    render(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    expect(screen.getByTestId('cart-voucher-hint')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('cart-voucher-error')).toBeNull();
  });

  it('chưa đủ điều kiện nhưng gần đủ: dòng nhắc "Mua thêm … để mở khoá …" và thanh progressbar đúng mức, có tên truy cập', () => {
    render(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} />);
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

  it('cả hai cùng có: dải chỉ còn MỘT dòng con, là dòng sắp mở khoá (dòng mời áp đã chuyển xuống hàng mã)', () => {
    render(<CartVoucherHintStrip hint={both} />);
    const strip = screen.getByTestId('cart-voucher-hint');
    expect(Array.from(strip.children).map((el) => el.getAttribute('data-testid'))).toEqual(['cart-voucher-unlock']);
  });

  it('có mã dùng được mà không có dòng sắp mở khoá: không dựng khung dải (không để lại khoảng trống)', () => {
    const { container } = render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} />);
    expect(container.innerHTML).toBe('');
    expect(screen.queryByTestId('cart-voucher-hint')).toBeNull();
  });

  it('không có chữ cấm "voucher" và không dấu chấm than trong chữ khách đọc', () => {
    const { container } = render(<CartVoucherHintStrip hint={both} />);
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
  });

  it('chỉ token trong thuộc tính style: phần đầy chỉ đặt bề rộng %, dòng nhắc không có số đo px, không màu thô', () => {
    const { container } = render(<CartVoucherHintStrip hint={both} />);
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

  const hasRule = (sel: string) => Array.from(loadSheet().cssRules).some((r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === sel);

  it('số đều trong dòng, nút bấm cao 44px (dùng chung cho "Mua thêm" và "Áp dụng" ở hàng mã); không còn luật riêng của dòng mời áp', () => {
    expect(rule('.tubu-vhint-row').getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
    expect(rule('.tubu-vhint-cta.zaui-btn').getPropertyValue('height')).toBe('44px');
    expect(hasRule(".tubu-vhint-row[data-kind='apply']")).toBe(false);
    expect(hasRule(".tubu-vhint-row[data-kind='apply'] .tubu-vhint-text")).toBe(false);
  });

  it('chữ dài không tràn ngang (overflow-wrap); lời báo lỗi áp mã không còn ở dải (luật .tubu-vhint-error đã gỡ)', () => {
    expect(rule('.tubu-vhint-text').getPropertyValue('overflow-wrap')).toBe('anywhere');
    expect(parseFloat(rule('.tubu-vhint-text').getPropertyValue('min-width'))).toBe(0);
    expect(hasRule('.tubu-vhint-error')).toBe(false);
  });
});

describe('CartVoucherHintStrip (Mini): nút "Mua thêm" ở dòng sắp mở khoá', () => {
  const unlockOnly: CartVoucherHint = { apply: null, unlock: UNLOCK };

  it('có onShopMore: nút "Mua thêm" nằm ngang hàng với chữ nhắc, phía trên thanh tiến trình', () => {
    render(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    const cta = screen.getByTestId('cart-voucher-unlock-cta');
    expect(cta).toHaveTextContent('Mua thêm');
    expect(cta.className).toContain('tubu-vhint-cta');
    const head = cta.closest('.tubu-vhint-head') as HTMLElement;
    expect(head).not.toBeNull();
    expect(within(head).getByText(UNLOCK.text)).toBeInTheDocument();
    expect(head.nextElementSibling).toBe(screen.getByTestId('cart-voucher-unlock-bar'));
    expect(head.parentElement).toBe(screen.getByTestId('cart-voucher-unlock'));
  });

  it('một chạm "Mua thêm" gọi onShopMore đúng một lần', () => {
    const onShopMore = vi.fn();
    render(<CartVoucherHintStrip hint={unlockOnly} onShopMore={onShopMore} />);
    fireEvent.click(screen.getByTestId('cart-voucher-unlock-cta'));
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('không truyền onShopMore: giao diện cũ nguyên vẹn (không nút, không khung đầu hàng, chữ và thanh là hai con trực tiếp của dòng)', () => {
    render(<CartVoucherHintStrip hint={unlockOnly} />);
    const row = screen.getByTestId('cart-voucher-unlock');
    expect(Array.from(row.children).map((el) => el.className)).toEqual(['tubu-vhint-text', 'tubu-freeship-track']);
    expect(row.querySelector('.tubu-vhint-head')).toBeNull();
    expect(screen.queryByTestId('cart-voucher-unlock-cta')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('có onShopMore nhưng không có dòng sắp mở khoá: không có nút nào (mã dùng được không sinh nút ở dải)', () => {
    render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />);
    expect(screen.queryByTestId('cart-voucher-unlock-cta')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('có cả mã dùng được và mã sắp mở khoá: chỉ một nút "Mua thêm", bấm gọi đúng onShopMore', () => {
    const onShopMore = vi.fn();
    render(<CartVoucherHintStrip hint={both} onShopMore={onShopMore} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByTestId('cart-voucher-apply-cta')).toBeNull();
    fireEvent.click(screen.getByTestId('cart-voucher-unlock-cta'));
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('vùng chạm tối thiểu 44px, chữ không có "voucher" và không dấu chấm than', () => {
    const { container } = render(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    expect(screen.getByTestId('cart-voucher-unlock-cta').style.minHeight).toBe('44px');
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
  });

  it('nút "Mua thêm" được mô tả bằng đúng câu nhắc của dòng (aria-describedby), không truyền onShopMore thì chữ không mang id', () => {
    const { container, unmount } = render(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    const id = screen.getByTestId('cart-voucher-unlock-cta').getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const described = container.querySelector(`[id="${id}"]`)!;
    expect(described.className).toBe('tubu-vhint-text');
    expect(described.textContent).toBe(UNLOCK.text);
    unmount();
    const plain = render(<CartVoucherHintStrip hint={unlockOnly} />);
    expect(plain.container.querySelector('[id]')).toBeNull();
  });
});

describe('CartVoucherHintStrip (Mini): "Mua thêm" không phụ thuộc lệnh áp mã ở hàng mã', () => {
  it('nút "Mua thêm" luôn bấm được: dải không có trạng thái bận (lệnh áp mã chạy ở hàng "Mã giảm giá", không khoá lối về chọn món)', () => {
    const onShopMore = vi.fn();
    render(<CartVoucherHintStrip hint={both} onShopMore={onShopMore} />);
    const cta = screen.getByTestId('cart-voucher-unlock-cta');
    expect(cta).toBeEnabled();
    expect(cta).not.toHaveAttribute('aria-busy');
    fireEvent.click(cta);
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('dải không bao giờ mang aria-busy, cả khi dựng lại với cùng một hint', () => {
    const { rerender } = render(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    expect(screen.getByTestId('cart-voucher-hint')).not.toHaveAttribute('aria-busy');
    rerender(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: UNLOCK }} />);
    expect(screen.getByTestId('cart-voucher-hint')).not.toHaveAttribute('aria-busy');
  });

  it('"Mua thêm" được mô tả bằng đúng câu nhắc của mình (không có lời báo lỗi áp mã nào chen vào mô tả)', () => {
    render(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    expect(screen.getByTestId('cart-voucher-unlock-cta')).toHaveAccessibleDescription(UNLOCK.text);
  });

  it('dải có mã dùng được vẫn không mang id nào khi không truyền onShopMore (không còn id lời báo lỗi)', () => {
    const { container } = render(<CartVoucherHintStrip hint={both} />);
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('có mã dùng được mà dải rỗng: không vẽ dải, nên không có vùng aria nào đọc "Áp dụng ngay" ở thân giỏ', () => {
    const { container } = render(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('css/freeship.css: đầu hàng của dòng sắp mở khoá', () => {
  const css = readFileSync(resolve(__dirname, '../../css/freeship.css'), 'utf8');
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    return (Array.from(style.sheet!.cssRules).find((r) => 'selectorText' in r && (r as CSSStyleRule).selectorText === sel) as CSSStyleRule | undefined)?.style;
  };

  it('chữ và nút cùng một hàng, căn giữa theo chiều dọc, khoảng cách inline-md; nút cao 44px', () => {
    expect(rule('.tubu-vhint-head')?.getPropertyValue('display')).toBe('flex');
    expect(rule('.tubu-vhint-head')?.getPropertyValue('align-items')).toBe('center');
    expect(rule('.tubu-vhint-head')?.getPropertyValue('gap')).toBe('var(--space-inline-md)');
    expect(rule('.tubu-vhint-cta.zaui-btn')?.getPropertyValue('height')).toBe('44px');
  });
});
