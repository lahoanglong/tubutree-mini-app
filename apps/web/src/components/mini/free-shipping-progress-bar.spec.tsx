// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  });
});
