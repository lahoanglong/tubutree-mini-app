// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { FreeShippingProgressBar } from './free-shipping-progress-bar';

const root = (c: ParentNode) => c.querySelector<HTMLElement>('[data-testid="freeship-progress"]')!;
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe('FreeShippingProgressBar (web)', () => {
  it('chưa đạt: dòng mời mua thêm đúng số còn thiếu, thanh progressbar đúng phần trăm, aria-label đọc được', () => {
    const { container } = mount(<FreeShippingProgressBar base={289000} threshold={500000} />);
    expect(root(container).dataset.reached).toBe('false');
    expect(root(container).textContent).toContain('Mua thêm 211.000đ để được Miễn phí giao hàng 🚚');
    const bar = q(container, 'freeship-bar')!;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('57');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Đã đạt 57% để được Miễn phí giao hàng');
    expect(q(container, 'freeship-fill')!.style.width).toBe('57%');
  });

  it('thiếu vài đồng thì thanh chưa đầy 100% (tối đa 99)', () => {
    const { container } = mount(<FreeShippingProgressBar base={499999} threshold={500000} />);
    expect(q(container, 'freeship-fill')!.style.width).toBe('99%');
    expect(root(container).dataset.reached).toBe('false');
  });

  it('có hàng gian hàng tự giao (tubuOnly): chữ nói rõ chỉ tính phần hàng Tubu Tree giao', () => {
    const { container } = mount(<FreeShippingProgressBar base={100000} threshold={500000} tubuOnly />);
    expect(root(container).textContent).toContain('Mua thêm 400.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao 🚚');
  });

  it('đạt ngưỡng: dòng chúc mừng, không còn thanh, data-reached=true', () => {
    const { container } = mount(<FreeShippingProgressBar base={500000} threshold={500000} />);
    expect(root(container).dataset.reached).toBe('true');
    expect(root(container).textContent).toBe('🎉 Đơn hàng đã được Miễn phí giao hàng');
    expect(q(container, 'freeship-bar')).toBeNull();
  });

  it('đạt ngưỡng với hàng gian hàng tự giao: lời chúc nói đúng phần Tubu giao', () => {
    const { container } = mount(<FreeShippingProgressBar base={600000} threshold={500000} tubuOnly />);
    expect(root(container).textContent).toBe('🎉 Phần hàng Tubu Tree giao đã được Miễn phí giao hàng');
  });

  it('cờ serverReached tin được thì đạt dù tiền hàng chưa tới ngưỡng', () => {
    const { container } = mount(<FreeShippingProgressBar base={100000} threshold={500000} serverReached />);
    expect(root(container).dataset.reached).toBe('true');
  });

  it('khối là vùng aria-live lịch sự để lời chúc được đọc ra khi đạt ngưỡng; số đã được định dạng bằng dấu chấm', () => {
    const { container } = mount(<FreeShippingProgressBar base={0} threshold={1234000} />);
    expect(root(container).getAttribute('aria-live')).toBe('polite');
    expect(root(container).textContent).toContain('1.234.000đ');
  });

  describe('nút "Mua thêm" (W51B)', () => {
    const cta = (c: ParentNode) => q(c, 'freeship-shop-more-cta') as HTMLButtonElement | null;

    it('chưa đạt + có onShopMore: nút nằm trong khối, chữ "Mua thêm", tên truy cập nêu số còn thiếu, bấm gọi onShopMore đúng một lần', () => {
      const onShopMore = vi.fn();
      const { container } = mount(<FreeShippingProgressBar base={289000} threshold={500000} onShopMore={onShopMore} />);
      const btn = cta(container)!;
      expect(root(container).contains(btn)).toBe(true);
      expect(btn.textContent).toBe('Mua thêm');
      expect(btn.getAttribute('aria-label')).toBe('Mua thêm: còn thiếu 211.000đ để được Miễn phí giao hàng');
      expect(btn.getAttribute('aria-label')!.startsWith(btn.textContent!)).toBe(true);
      click(btn);
      expect(onShopMore).toHaveBeenCalledTimes(1);
    });

    it('nút nằm cùng hàng với dòng chữ (khối .tubu-freeship-head), thanh vẫn ở dưới và đủ thuộc tính progressbar', () => {
      const { container } = mount(<FreeShippingProgressBar base={289000} threshold={500000} onShopMore={() => {}} />);
      const head = container.querySelector('.tubu-freeship-head')!;
      expect(head.querySelector('.tubu-freeship-text')).not.toBeNull();
      expect(head.contains(cta(container))).toBe(true);
      expect(head.contains(q(container, 'freeship-bar'))).toBe(false);
      expect(q(container, 'freeship-bar')!.getAttribute('aria-valuenow')).toBe('57');
      expect(root(container).dataset.cta).toBe('true');
    });

    it('không truyền onShopMore: không có nút, không có hàng .tubu-freeship-head, không có data-cta (khối y như trước)', () => {
      const { container } = mount(<FreeShippingProgressBar base={289000} threshold={500000} />);
      expect(cta(container)).toBeNull();
      expect(container.querySelector('.tubu-freeship-head')).toBeNull();
      expect(root(container).hasAttribute('data-cta')).toBe(false);
    });

    it('đạt ngưỡng: không còn nút dù có onShopMore, vẫn còn dòng chúc mừng, không còn thanh', () => {
      const { container } = mount(<FreeShippingProgressBar base={500000} threshold={500000} onShopMore={() => {}} />);
      expect(cta(container)).toBeNull();
      expect(root(container).textContent).toBe('🎉 Đơn hàng đã được Miễn phí giao hàng');
      expect(q(container, 'freeship-bar')).toBeNull();
    });

    it('đạt nhờ cờ serverReached hoặc ngưỡng 0: cũng không có nút', () => {
      const a = mount(<FreeShippingProgressBar base={100000} threshold={500000} serverReached onShopMore={() => {}} />);
      expect(cta(a.container)).toBeNull();
      const b = mount(<FreeShippingProgressBar base={0} threshold={0} onShopMore={() => {}} />);
      expect(cta(b.container)).toBeNull();
    });

    it('thiếu vài đồng vẫn chưa đạt: nút còn, tên truy cập nêu đúng số lẻ', () => {
      const { container } = mount(<FreeShippingProgressBar base={499999} threshold={500000} onShopMore={() => {}} />);
      expect(cta(container)!.getAttribute('aria-label')).toBe('Mua thêm: còn thiếu 1đ để được Miễn phí giao hàng');
    });

    it('tubuOnly: chữ nút vẫn "Mua thêm" nhưng tên truy cập nói rõ miễn phí giao chỉ cho phần hàng Tubu Tree giao, khớp dòng chữ hiện', () => {
      const { container } = mount(<FreeShippingProgressBar base={100000} threshold={500000} tubuOnly onShopMore={() => {}} />);
      const btn = cta(container)!;
      expect(btn.textContent).toBe('Mua thêm');
      expect(btn.getAttribute('aria-label')).toBe('Mua thêm: còn thiếu 400.000đ để được Miễn phí giao hàng cho phần hàng Tubu Tree giao');
      expect(btn.getAttribute('aria-label')!.startsWith(btn.textContent!)).toBe(true);
    });

    it('chữ nút và tên truy cập không có chữ cấm "Freeship" và không có dấu chấm than', () => {
      const { container } = mount(<FreeShippingProgressBar base={0} threshold={500000} tubuOnly onShopMore={() => {}} />);
      const label = `${cta(container)!.textContent} ${cta(container)!.getAttribute('aria-label')}`;
      expect(label).not.toMatch(/freeship/i);
      expect(label).not.toContain('!');
    });
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');

    it('giảm chuyển động tắt cả chuyển động đầy dần lẫn ánh chạy (shimmer)', () => {
      expect(reduced).toMatch(/\.tubu-freeship-fill\s*\{\s*transition:\s*none/);
      expect(reduced).toMatch(/\.tubu-freeship-fill::after\s*\{\s*animation:\s*none/);
      expect(rule('.tubu-freeship-fill::after')).toMatch(/animation:\s*tubu-freeship-shimmer/);
    });

    it('thanh dùng token ngữ nghĩa (rãnh --color-track, chuyển sắc --color-progress-fill-from), số đều, khối không nhảy khi đổi trạng thái (min-height)', () => {
      expect(rule('.tubu-freeship-track')).toContain('var(--color-track)');
      expect(rule('.tubu-freeship-fill')).toContain('var(--color-progress-fill-from)');
      expect(rule('.tubu-freeship-fill')).toContain('var(--color-action-primary-bg)');
      expect(rule('.tubu-freeship')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-freeship')).toMatch(/min-height:/);
    });

    it('W51B: có nút thì khối cao tối thiểu theo hàng nút 44px (không nhảy khi hết nút), nút cao 44px, số đều thừa kế, chữ không tràn hàng', () => {
      expect(rule(".tubu-freeship[data-cta='true']")).toMatch(/min-height:\s*calc\(44px\b/);
      expect(rule('.tubu-freeship-cta.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule('.tubu-freeship-cta.zaui-btn')).toMatch(/font-variant-numeric:\s*inherit/);
      expect(rule('.tubu-freeship-head')).toMatch(/display:\s*flex/);
      expect(rule('.tubu-freeship-head .tubu-freeship-text')).toMatch(/min-width:\s*0/);
    });
  });
});
