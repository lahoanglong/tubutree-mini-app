// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CartVoucherHint } from '@tubutree/app-core/commerce/cart-voucher-hint';
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
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
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('CartVoucherHintStrip (web)', () => {
  it('không có gợi ý (null, cả hai rỗng, hoặc chỉ có mã dùng được mà không có mã sắp mở khoá): không vẽ gì', () => {
    expect(mount(<CartVoucherHintStrip hint={null} />).container.innerHTML).toBe('');
    expect(mount(<CartVoucherHintStrip hint={{ apply: null, unlock: null }} />).container.innerHTML).toBe('');
    // W166: dòng mời áp mã chuyển xuống hàng "Mã giảm giá" (CouponBox), dải chỉ còn vẽ dòng sắp mở khoá.
    expect(mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />).container.innerHTML).toBe('');
  });

  it('có mã dùng được và mã sắp mở khoá: dải không còn nút "Áp dụng ngay" (mỗi hành động một nút), chỉ có dòng sắp mở khoá', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} />);
    expect(q(container, 'cart-voucher-apply')).toBeNull();
    expect(q(container, 'cart-voucher-apply-cta')).toBeNull();
    expect(container.textContent).not.toContain('Bạn có mã giảm giá');
    expect(q(container, 'cart-voucher-unlock')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('có onShopMore: nút duy nhất của dải là "Mua thêm", không có nút áp mã dù hint có mã dùng được', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBe(q(container, 'cart-voucher-unlock-cta'));
    expect(Array.from(buttons).some((b) => /Áp dụng/.test(b.textContent ?? '') || /Áp dụng/.test(b.getAttribute('aria-label') ?? ''))).toBe(false);
  });

  it('lệnh áp mã không còn là việc của dải: không aria-busy, không lời báo lỗi (role=alert) ở dải', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    expect(q(container, 'cart-voucher-hint')!.getAttribute('aria-busy')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(q(container, 'cart-voucher-error')).toBeNull();
  });

  it('mã sắp mở khoá: dòng nhắc đúng chữ, thanh progressbar đúng mức (min 0, max 100) và tên truy cập; không có nút', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} />);
    expect(q(container, 'cart-voucher-unlock')!.dataset.kind).toBe('unlock');
    expect(q(container, 'cart-voucher-unlock')!.textContent).toContain('🔥 Mua thêm 30.000đ để mở khoá mã giảm giá 80.000đ');
    const bar = q(container, 'cart-voucher-unlock-bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('90');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Đã đạt 90% đơn tối thiểu của mã giảm giá');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('90%');
    expect(q(container, 'cart-voucher-apply')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('cả hai cùng có: dải chỉ còn MỘT dòng con, là dòng sắp mở khoá (dòng mời áp đã chuyển xuống hàng mã)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} />);
    expect(Array.from(q(container, 'cart-voucher-hint')!.children).map((el) => el.getAttribute('data-testid'))).toEqual(['cart-voucher-unlock']);
  });

  it('có mã dùng được mà không có dòng sắp mở khoá: không dựng khung dải (không để lại khoảng trống)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} />);
    expect(container.innerHTML).toBe('');
    expect(q(container, 'cart-voucher-hint')).toBeNull();
  });

  it('không có chữ cấm "voucher" và không dấu chấm than trong chữ khách đọc', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} />);
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
  });

  it('chỉ token trong thuộc tính style: phần đầy chỉ đặt bề rộng %, dòng nhắc không có số đo px, không màu thô', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} />);
    // Nút dùng chung `Button` tự đặt minHeight 44 (vùng chạm); phần của dải chỉ có style ở thanh đầy dần.
    expect(q(container, 'cart-voucher-unlock')!.querySelectorAll('[style*="px"]').length).toBe(0);
    expect(q(container, 'cart-voucher-unlock-bar')!.firstElementChild!.getAttribute('style')).toBe('width: 90%;');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('số đều trong dòng, nút bấm cao 44px (dùng chung cho "Mua thêm" và "Áp dụng" ở hàng mã); không còn luật riêng của dòng mời áp', () => {
      expect(rule('.tubu-vhint-row')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-vhint-cta.zaui-btn')).toMatch(/height:\s*44px/);
      expect(css).not.toContain(".tubu-vhint-row[data-kind='apply']");
    });

    it('cùng số đo với Mini (freeship.css): chữ phụ cỡ caption đậm label, đệm hàng inline-md, khoảng chữ-thanh do gap (thanh không có lề trên riêng)', () => {
      expect(rule('.tubu-vhint-text')).toContain('color: var(--color-text-secondary)');
      expect(rule('.tubu-vhint-text')).toContain('font-size: var(--type-caption-size)');
      expect(rule('.tubu-vhint-text')).toContain('font-weight: var(--type-label-weight)');
      expect(rule('.tubu-vhint-row')).toContain('padding: var(--space-inline-md)');
      expect(rule('.tubu-vhint-row--stack')).toContain('gap: var(--space-stack-sm)');
      expect(rule('.tubu-vhint-row--stack .tubu-freeship-track')).toMatch(/margin-top:\s*0/);
    });

    it('chữ dài không tràn ngang; lời báo lỗi áp mã và lời "Đã áp dụng" không còn ở dải (luật .tubu-vhint-error, .tubu-vhint-done đã gỡ)', () => {
      expect(rule('.tubu-vhint-text')).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule('.tubu-vhint-text')).toMatch(/min-width:\s*0/);
      expect(css).not.toContain('.tubu-vhint-error');
      expect(css).not.toContain('.tubu-vhint-done');
    });
  });
});

describe('CartVoucherHintStrip (web): "Mua thêm" không phụ thuộc lệnh áp mã ở hàng mã', () => {
  it('nút "Mua thêm" luôn bấm được: dải không có trạng thái bận (lệnh áp mã chạy ở hàng "Mã giảm giá", không khoá lối về chọn món)', () => {
    const onShopMore = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={both} onShopMore={onShopMore} />);
    const cta = q(container, 'cart-voucher-unlock-cta') as HTMLButtonElement;
    expect(cta.disabled).toBe(false);
    expect(cta.getAttribute('aria-busy')).toBeNull();
    click(cta);
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('dải không bao giờ mang aria-busy, cả khi dựng với hint có mã dùng được', () => {
    expect(q(mount(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />).container, 'cart-voucher-hint')!.getAttribute('aria-busy')).toBeNull();
    expect(q(mount(<CartVoucherHintStrip hint={both} />).container, 'cart-voucher-hint')!.getAttribute('aria-busy')).toBeNull();
  });

  it('"Mua thêm" trỏ aria-describedby tới đúng câu nhắc của mình, không có lời báo lỗi áp mã nào chen vào', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onShopMore={vi.fn()} />);
    const unlockId = q(container, 'cart-voucher-unlock-cta')!.getAttribute('aria-describedby');
    expect(unlockId).toBeTruthy();
    expect(container.querySelector(`[id="${unlockId}"]`)!.textContent).toBe(UNLOCK.text);
    expect(container.querySelectorAll('[id]')).toHaveLength(1);
  });

  it('không truyền onShopMore: dải có mã dùng được vẫn không mang id nào (không còn id lời báo lỗi)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} />);
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('có mã dùng được mà dải rỗng: không có vùng nào đọc "Áp dụng ngay" ở thân giỏ', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});

describe('CartVoucherHintStrip (web): nút "Mua thêm" ở dòng sắp mở khoá', () => {
  const unlockOnly: CartVoucherHint = { apply: null, unlock: UNLOCK };

  it('có onShopMore: nút "Mua thêm" nằm ngang hàng với chữ nhắc, phía trên thanh tiến trình', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    const cta = q(container, 'cart-voucher-unlock-cta') as HTMLButtonElement;
    expect(cta.textContent).toBe('Mua thêm');
    expect(cta.className).toContain('tubu-vhint-cta');
    const head = cta.parentElement!;
    expect(head.className).toBe('tubu-vhint-head');
    expect(head.querySelector('.tubu-vhint-text')!.textContent).toBe(UNLOCK.text);
    expect(head.nextElementSibling).toBe(q(container, 'cart-voucher-unlock-bar'));
    expect(head.parentElement).toBe(q(container, 'cart-voucher-unlock'));
  });

  it('một chạm "Mua thêm" gọi onShopMore đúng một lần', () => {
    const onShopMore = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onShopMore={onShopMore} />);
    click(q(container, 'cart-voucher-unlock-cta')!);
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('không truyền onShopMore: giao diện cũ nguyên vẹn (không nút, không khung đầu hàng, chữ và thanh là hai con trực tiếp của dòng)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} />);
    const row = q(container, 'cart-voucher-unlock')!;
    expect(Array.from(row.children).map((el) => el.className)).toEqual(['tubu-vhint-text', 'tubu-freeship-track']);
    expect(row.querySelector('.tubu-vhint-head')).toBeNull();
    expect(q(container, 'cart-voucher-unlock-cta')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('có onShopMore nhưng không có dòng sắp mở khoá: không có nút nào (mã dùng được không sinh nút ở dải)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onShopMore={vi.fn()} />);
    expect(q(container, 'cart-voucher-unlock-cta')).toBeNull();
    expect(container.querySelectorAll('button').length).toBe(0);
  });

  it('có cả mã dùng được và mã sắp mở khoá: chỉ một nút "Mua thêm", bấm gọi đúng onShopMore', () => {
    const onShopMore = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={both} onShopMore={onShopMore} />);
    expect(container.querySelectorAll('button').length).toBe(1);
    expect(q(container, 'cart-voucher-apply-cta')).toBeNull();
    click(q(container, 'cart-voucher-unlock-cta')!);
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('vùng chạm tối thiểu 44px, chữ không có "voucher" và không dấu chấm than, trong đầu hàng chỉ nút mang style nội tuyến', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    const cta = q(container, 'cart-voucher-unlock-cta') as HTMLElement;
    expect(cta.style.minHeight).toBe('44px');
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
    expect(Array.from(container.querySelectorAll('.tubu-vhint-head [style]'))).toEqual([cta]);
  });

  it('nút "Mua thêm" được mô tả bằng đúng câu nhắc của dòng (aria-describedby), không truyền onShopMore thì chữ không mang id', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onShopMore={vi.fn()} />);
    const id = q(container, 'cart-voucher-unlock-cta')!.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const described = container.querySelector(`[id="${id}"]`)!;
    expect(described.className).toBe('tubu-vhint-text');
    expect(described.textContent).toBe(UNLOCK.text);
    const plain = mount(<CartVoucherHintStrip hint={unlockOnly} />);
    expect(plain.container.querySelector('[id]')).toBeNull();
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('đầu hàng: chữ và nút cùng một hàng, căn giữa theo chiều dọc, khoảng cách inline-md; nút cao 44px', () => {
      expect(rule('.tubu-vhint-head')).toMatch(/display:\s*flex/);
      expect(rule('.tubu-vhint-head')).toMatch(/align-items:\s*center/);
      expect(rule('.tubu-vhint-head')).toContain('gap: var(--space-inline-md)');
      expect(rule('.tubu-vhint-cta.zaui-btn')).toMatch(/height:\s*44px/);
    });
  });
});
