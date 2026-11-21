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

  it('câu đầu là vùng aria-live lịch sự để lời chúc được đọc ra khi đạt ngưỡng (chữ mốc dưới thanh không đọc lại); số đã được định dạng bằng dấu chấm', () => {
    const { container } = mount(<FreeShippingProgressBar base={0} threshold={1234000} giftThreshold={2000000} />);
    expect(root(container).getAttribute('aria-live')).toBeNull();
    const live = root(container).querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe('Mua thêm 1.234.000đ để được Miễn phí giao hàng 🚚');
    expect(live.getAttribute('role')).toBe('status');
    expect(root(container).querySelectorAll('[aria-live]')).toHaveLength(1);
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

    it('thanh dùng token ngữ nghĩa (rãnh --color-track, chuyển sắc --color-progress-fill-from), số đều, trạng thái chưa đạt có min-height', () => {
      expect(rule('.tubu-freeship-track')).toContain('var(--color-track)');
      expect(rule('.tubu-freeship-fill')).toContain('var(--color-progress-fill-from)');
      expect(rule('.tubu-freeship-fill')).toContain('var(--color-action-primary-bg)');
      expect(rule('.tubu-freeship')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-freeship')).toMatch(/min-height:/);
    });

    it('W51B: có nút (chưa đạt) thì khối cao tối thiểu theo hàng nút 44px, nút cao 44px, số đều thừa kế, chữ không tràn hàng', () => {
      expect(rule(".tubu-freeship[data-cta='true']")).toMatch(/min-height:\s*calc\(44px\b/);
      expect(rule('.tubu-freeship-cta.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule('.tubu-freeship-cta.zaui-btn')).toMatch(/font-variant-numeric:\s*inherit/);
      expect(rule('.tubu-freeship-head')).toMatch(/display:\s*flex/);
      expect(rule('.tubu-freeship-head .tubu-freeship-text')).toMatch(/min-width:\s*0/);
    });

    // W166, như Mini (freeship.css): dòng chúc mừng trước đây giữ min-height của lúc chưa đạt nên là hộp gần trống.
    it('W166: đạt ngưỡng co thành dòng gọn (min-height 0, đệm dọc token), đặt SAU luật data-cta để thắng cùng độ ưu tiên', () => {
      const shrink = /\.tubu-freeship\[data-reached='true'\]\s*\{\s*min-height:\s*0;\s*padding-block:\s*var\(--space-inline-sm\);\s*\}/.exec(css);
      expect(shrink, 'có luật min-height 0 cho trạng thái đạt').not.toBeNull();
      expect(shrink!.index).toBeGreaterThan(css.indexOf(".tubu-freeship[data-cta='true']"));
    });

    it('W166: dòng chúc mừng cao không quá 40px một dòng: 2 x đệm dọc + một dòng chữ caption tính từ token thật', () => {
      const tokens = readFileSync(resolve(__dirname, '../../../../../packages/design-tokens/src/tokens.css'), 'utf8');
      const px = (name: string) => parseFloat(new RegExp(`${name}:\\s*([\\d.]+)px`).exec(tokens)![1]!);
      const captionLh = parseFloat(/--type-caption-lh:\s*([\d.]+)/.exec(tokens)![1]!);
      expect(/--space-inline-sm:\s*var\(--p-space-3\)/.test(tokens)).toBe(true);
      const height = 2 * px('--p-space-3') + px('--type-caption-size') * captionLh;
      expect(height).toBeLessThanOrEqual(40);
      expect(height).toBeGreaterThan(30);
    });
  });
});

describe('FreeShippingProgressBar (web): thanh hai mốc Miễn phí giao hàng → Quà dùng thử (tubu-w13-01), cùng số với Mini App', () => {
  const two = (base: number, extra: { giftThreshold?: number | null; onShopMore?: () => void } = { onShopMore: () => {} }) =>
    mount(<FreeShippingProgressBar base={base} threshold={199000} giftThreshold={299000} {...extra} />);
  const marks = (c: ParentNode) =>
    Array.from(c.querySelectorAll<HTMLElement>('[data-testid="freeship-milestone"]')).map((m) => [m.textContent, m.dataset.reached]);

  it('chưa Miễn phí giao hàng: thanh đo tới mốc quà, vạch mốc giao hàng ở 66,5%, hai nhãn mốc, một nút "Mua thêm"', () => {
    const { container } = two(100000);
    expect(root(container).dataset.gift).toBe('locked');
    expect(root(container).textContent).toContain('Mua thêm 99.000đ để được Miễn phí giao hàng');
    const bar = q(container, 'freeship-bar')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(bar.getAttribute('aria-label')).toBe('Đã đạt 33% chặng tới Quà dùng thử, mốc Miễn phí giao hàng ở 199.000đ');
    expect(q(container, 'freeship-fill')!.getAttribute('style')).toBe('width: 33%;');
    expect(q(container, 'freeship-mark')!.getAttribute('style')).toBe('left: 66.5%;');
    expect(q(container, 'freeship-mark')!.getAttribute('aria-hidden')).toBe('true');
    expect(marks(container)).toEqual([
      ['199.000đ Miễn phí giao hàng', 'false'],
      ['299.000đ Quà dùng thử', 'false'],
    ]);
    expect(container.querySelectorAll('button')).toHaveLength(1);
  });

  it('đã Miễn phí giao hàng, chưa đủ quà: câu chúc mừng (không nói lại số còn thiếu tới quà), thanh và nhãn còn, mốc đầu đã đạt, không nút', () => {
    const { container } = two(250000);
    expect(root(container).dataset.reached).toBe('true');
    expect(root(container).dataset.gift).toBe('locked');
    expect(root(container).textContent).toContain('🎉 Đơn hàng đã được Miễn phí giao hàng');
    expect(root(container).textContent).not.toContain('49.000đ');
    expect(q(container, 'freeship-bar')!.getAttribute('aria-valuenow')).toBe('83');
    expect(marks(container)).toEqual([
      ['199.000đ Miễn phí giao hàng', 'true'],
      ['299.000đ Quà dùng thử', 'false'],
    ]);
    expect(container.querySelector('button')).toBeNull();
  });

  it('đủ mốc quà: co về dòng chúc mừng, không thanh, không nhãn mốc', () => {
    const { container } = two(299000);
    expect(root(container).dataset.gift).toBe('reached');
    expect(q(container, 'freeship-bar')).toBeNull();
    expect(q(container, 'freeship-milestones')).toBeNull();
  });

  it('không mốc quà hay mốc quà không cao hơn mốc giao hàng: một mốc, khối y như trước', () => {
    for (const giftThreshold of [null, 150000]) {
      const { container, unmount } = two(100000, { giftThreshold });
      expect(root(container).hasAttribute('data-gift')).toBe(false);
      expect(q(container, 'freeship-mark')).toBeNull();
      expect(q(container, 'freeship-milestones')).toBeNull();
      expect(q(container, 'freeship-bar')!.getAttribute('aria-label')).toBe('Đã đạt 50% để được Miễn phí giao hàng');
      unmount();
    }
  });

  it('mini.css: nhãn mốc số đều, mốc đã đạt màu thành công, trạng thái giữa hai mốc giữ nền thẻ, thanh trong khối mốc không thêm lề trên', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    expect(css).toMatch(/\.tubu-freeship-legend \{[^}]*font-variant-numeric: tabular-nums;/);
    expect(css).toMatch(/\.tubu-freeship-milestone\[data-reached='true'\] \{[^}]*color: var\(--color-text-success\);/);
    expect(css).toMatch(/\.tubu-freeship\[data-reached='true'\]\[data-gift='locked'\] \{[^}]*background: var\(--color-bg-surface\);/);
    expect(css).toMatch(/\.tubu-freeship-meter \.tubu-freeship-track \{ margin-top: 0; \}/);
  });
});
