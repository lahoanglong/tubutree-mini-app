// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useState } from 'react';
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
  it('không có gợi ý (null hoặc cả hai rỗng): không vẽ gì', () => {
    expect(mount(<CartVoucherHintStrip hint={null} onApply={vi.fn()} />).container.innerHTML).toBe('');
    expect(mount(<CartVoucherHintStrip hint={{ apply: null, unlock: null }} onApply={vi.fn()} />).container.innerHTML).toBe('');
  });

  it('có mã dùng được: dòng mời áp với chữ của app-core, nút "Áp dụng ngay" có aria-label kèm mã', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={vi.fn()} />);
    expect(q(container, 'cart-voucher-apply')!.dataset.kind).toBe('apply');
    expect(q(container, 'cart-voucher-apply')!.textContent).toContain('🎟️ Bạn có mã giảm giá 45.000đ đủ điều kiện');
    const cta = q(container, 'cart-voucher-apply-cta') as HTMLButtonElement;
    expect(cta.textContent).toBe('Áp dụng ngay');
    expect(cta.getAttribute('aria-label')).toBe('Áp dụng ngay mã GIAM45');
    expect(q(container, 'cart-voucher-unlock')).toBeNull();
  });

  it('một chạm "Áp dụng ngay" gọi onApply đúng một lần với mã thật', () => {
    const onApply = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={onApply} />);
    click(q(container, 'cart-voucher-apply-cta')!);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith('GIAM45');
  });

  it('đang áp: nút giữ nhãn, báo bận (aria-busy) và không gọi onApply lần nữa', () => {
    const onApply = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={onApply} applying />);
    const cta = q(container, 'cart-voucher-apply-cta')!;
    expect(cta.getAttribute('aria-busy')).toBe('true');
    expect(cta.getAttribute('aria-label')).toBe('Áp dụng ngay mã GIAM45');
    click(cta);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('mã sắp mở khoá: dòng nhắc đúng chữ, thanh progressbar đúng mức (min 0, max 100) và tên truy cập; không có nút', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} onApply={vi.fn()} />);
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

  it('cả hai cùng có: dòng mời áp đứng trước dòng nhắc mở khoá', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    expect(Array.from(q(container, 'cart-voucher-hint')!.children).map((el) => el.getAttribute('data-testid'))).toEqual(['cart-voucher-apply', 'cart-voucher-unlock']);
  });

  it('lời báo lỗi áp: role=alert ngay dưới dòng mời áp; không có dòng mời áp thì không hiện lỗi', () => {
    const withBoth = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} error="Mã đã hết lượt dùng." />);
    const err = q(withBoth.container, 'cart-voucher-error')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toBe('Mã đã hết lượt dùng.');
    expect(err.previousElementSibling).toBe(q(withBoth.container, 'cart-voucher-apply'));
    const unlockOnly = mount(<CartVoucherHintStrip hint={{ apply: null, unlock: UNLOCK }} onApply={vi.fn()} error="Mã đã hết lượt dùng." />);
    expect(q(unlockOnly.container, 'cart-voucher-error')).toBeNull();
  });

  it('không có chữ cấm "voucher" và không dấu chấm than trong chữ khách đọc', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
  });

  it('chỉ token trong thuộc tính style: phần đầy chỉ đặt bề rộng %, dòng nhắc không có số đo px, không màu thô', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} />);
    // Nút dùng chung `Button` tự đặt minHeight 44 (vùng chạm); phần của dải chỉ có style ở thanh đầy dần.
    expect(q(container, 'cart-voucher-unlock')!.querySelectorAll('[style*="px"]').length).toBe(0);
    expect(q(container, 'cart-voucher-unlock-bar')!.firstElementChild!.getAttribute('style')).toBe('width: 90%;');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('số đều trong dòng, nút bấm cao 44px, dòng mời áp theo token success', () => {
      expect(rule('.tubu-vhint-row')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-vhint-cta.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule(".tubu-vhint-row[data-kind='apply']")).toContain('var(--color-status-success-bg)');
      expect(rule(".tubu-vhint-row[data-kind='apply'] .tubu-vhint-text")).toContain('var(--color-text-success)');
    });

    it('cùng số đo với Mini (freeship.css): chữ phụ cỡ caption đậm label, đệm hàng inline-md, khoảng chữ-thanh do gap (thanh không có lề trên riêng)', () => {
      expect(rule('.tubu-vhint-text')).toContain('color: var(--color-text-secondary)');
      expect(rule('.tubu-vhint-text')).toContain('font-size: var(--type-caption-size)');
      expect(rule('.tubu-vhint-text')).toContain('font-weight: var(--type-label-weight)');
      expect(rule('.tubu-vhint-row')).toContain('padding: var(--space-inline-md)');
      expect(rule('.tubu-vhint-row--stack')).toContain('gap: var(--space-stack-sm)');
      expect(rule('.tubu-vhint-row--stack .tubu-freeship-track')).toMatch(/margin-top:\s*0/);
      expect(rule('.tubu-vhint-error')).toContain('font-size: var(--type-caption-size)');
      expect(rule('.tubu-vhint-error')).toContain('padding: 0 var(--space-inline-md)');
    });

    it('chữ dài không tràn ngang và lời báo lỗi dùng màu danger', () => {
      expect(rule('.tubu-vhint-text')).toMatch(/overflow-wrap:\s*anywhere/);
      expect(rule('.tubu-vhint-text')).toMatch(/min-width:\s*0/);
      expect(rule('.tubu-vhint-error')).toContain('var(--color-text-danger)');
    });
  });
});

describe('CartVoucherHintStrip (web): báo bận và lời báo lỗi cho trình đọc màn hình', () => {
  const ERROR = 'Mã đã hết lượt dùng.';
  const stripOf = (c: ParentNode) => q(c, 'cart-voucher-hint')!;
  const ariaBusy = (props: { applying?: boolean }) => stripOf(mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} {...props} />).container).getAttribute('aria-busy');
  const applyDescribedBy = (error: string | null) => q(mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} error={error} />).container, 'cart-voucher-apply-cta')!.getAttribute('aria-describedby');

  function Pending({ onShopMore }: { onShopMore: () => void }) {
    const [applying, setApplying] = useState(true);
    return (
      <>
        <button type="button" data-testid="finish" onClick={() => setApplying(false)} />
        <CartVoucherHintStrip hint={both} onApply={vi.fn()} onShopMore={onShopMore} applying={applying} />
      </>
    );
  }

  it('applying: cả dải aria-busy="true"; không bận (false hoặc không truyền) thì không có thuộc tính', () => {
    expect(ariaBusy({ applying: true })).toBe('true');
    expect(ariaBusy({ applying: false })).toBeNull();
    expect(ariaBusy({})).toBeNull();
  });

  it('đang áp: nút "Mua thêm" khoá và không gọi onShopMore; áp xong thì dải hết bận và nút bấm lại được', () => {
    const onShopMore = vi.fn();
    const { container } = mount(<Pending onShopMore={onShopMore} />);
    const cta = () => q(container, 'cart-voucher-unlock-cta') as HTMLButtonElement;
    expect(stripOf(container).getAttribute('aria-busy')).toBe('true');
    expect(cta().disabled).toBe(true);
    click(cta());
    expect(onShopMore).not.toHaveBeenCalled();
    click(q(container, 'finish'));
    expect(stripOf(container).getAttribute('aria-busy')).toBeNull();
    expect(cta().disabled).toBe(false);
    click(cta());
    expect(onShopMore).toHaveBeenCalledTimes(1);
  });

  it('có lỗi: "Áp dụng ngay" trỏ aria-describedby tới đúng phần tử cart-voucher-error; không lỗi thì không có aria-describedby', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} error={ERROR} />);
    const id = q(container, 'cart-voucher-apply-cta')!.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const described = container.querySelector(`[id="${id}"]`)!;
    expect(described).toBe(q(container, 'cart-voucher-error'));
    expect(described.textContent).toBe(ERROR);
    expect(applyDescribedBy(null)).toBeNull();
  });

  it('chưa có lỗi: dải mời áp không mang id nào', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={vi.fn()} />);
    expect(container.querySelector('[id]')).toBeNull();
  });

  it('id lời báo lỗi khác id câu nhắc "Mua thêm": mỗi nút chỉ trỏ tới câu của mình', () => {
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={vi.fn()} onShopMore={vi.fn()} error={ERROR} />);
    const applyId = q(container, 'cart-voucher-apply-cta')!.getAttribute('aria-describedby');
    const unlockId = q(container, 'cart-voucher-unlock-cta')!.getAttribute('aria-describedby');
    expect(applyId).toBeTruthy();
    expect(unlockId).toBeTruthy();
    expect(applyId).not.toBe(unlockId);
    expect(container.querySelector(`[id="${applyId}"]`)!.textContent).toBe(ERROR);
    expect(container.querySelector(`[id="${unlockId}"]`)!.textContent).toBe(UNLOCK.text);
  });
});

describe('CartVoucherHintStrip (web): nút "Mua thêm" ở dòng sắp mở khoá', () => {
  const unlockOnly: CartVoucherHint = { apply: null, unlock: UNLOCK };

  it('có onShopMore: nút "Mua thêm" nằm ngang hàng với chữ nhắc, phía trên thanh tiến trình', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={vi.fn()} onShopMore={vi.fn()} />);
    const cta = q(container, 'cart-voucher-unlock-cta') as HTMLButtonElement;
    expect(cta.textContent).toBe('Mua thêm');
    expect(cta.className).toContain('tubu-vhint-cta');
    const head = cta.parentElement!;
    expect(head.className).toBe('tubu-vhint-head');
    expect(head.querySelector('.tubu-vhint-text')!.textContent).toBe(UNLOCK.text);
    expect(head.nextElementSibling).toBe(q(container, 'cart-voucher-unlock-bar'));
    expect(head.parentElement).toBe(q(container, 'cart-voucher-unlock'));
  });

  it('một chạm "Mua thêm" gọi onShopMore đúng một lần và không gọi onApply', () => {
    const onShopMore = vi.fn();
    const onApply = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={onApply} onShopMore={onShopMore} />);
    click(q(container, 'cart-voucher-unlock-cta')!);
    expect(onShopMore).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('không truyền onShopMore: giao diện cũ nguyên vẹn (không nút, không khung đầu hàng, chữ và thanh là hai con trực tiếp của dòng)', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={vi.fn()} />);
    const row = q(container, 'cart-voucher-unlock')!;
    expect(Array.from(row.children).map((el) => el.className)).toEqual(['tubu-vhint-text', 'tubu-freeship-track']);
    expect(row.querySelector('.tubu-vhint-head')).toBeNull();
    expect(q(container, 'cart-voucher-unlock-cta')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('có onShopMore nhưng không có dòng sắp mở khoá: không có nút "Mua thêm", "Áp dụng ngay" vẫn là nút duy nhất', () => {
    const { container } = mount(<CartVoucherHintStrip hint={{ apply: APPLY, unlock: null }} onApply={vi.fn()} onShopMore={vi.fn()} />);
    expect(q(container, 'cart-voucher-unlock-cta')).toBeNull();
    expect(container.querySelectorAll('button').length).toBe(1);
  });

  it('cả hai dòng: hai nút độc lập, mỗi nút gọi đúng hàm của nó', () => {
    const onApply = vi.fn();
    const onShopMore = vi.fn();
    const { container } = mount(<CartVoucherHintStrip hint={both} onApply={onApply} onShopMore={onShopMore} />);
    expect(container.querySelectorAll('button').length).toBe(2);
    click(q(container, 'cart-voucher-apply-cta')!);
    expect(onApply).toHaveBeenCalledWith('GIAM45');
    expect(onShopMore).not.toHaveBeenCalled();
    click(q(container, 'cart-voucher-unlock-cta')!);
    expect(onShopMore).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('vùng chạm tối thiểu 44px, chữ không có "voucher" và không dấu chấm than, trong đầu hàng chỉ nút mang style nội tuyến', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={vi.fn()} onShopMore={vi.fn()} />);
    const cta = q(container, 'cart-voucher-unlock-cta') as HTMLElement;
    expect(cta.style.minHeight).toBe('44px');
    expect(container.textContent).not.toMatch(/voucher/i);
    expect(container.textContent).not.toContain('!');
    expect(Array.from(container.querySelectorAll('.tubu-vhint-head [style]'))).toEqual([cta]);
  });

  it('nút "Mua thêm" được mô tả bằng đúng câu nhắc của dòng (aria-describedby), không truyền onShopMore thì chữ không mang id', () => {
    const { container } = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={vi.fn()} onShopMore={vi.fn()} />);
    const id = q(container, 'cart-voucher-unlock-cta')!.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    const described = container.querySelector(`[id="${id}"]`)!;
    expect(described.className).toBe('tubu-vhint-text');
    expect(described.textContent).toBe(UNLOCK.text);
    const plain = mount(<CartVoucherHintStrip hint={unlockOnly} onApply={vi.fn()} />);
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
