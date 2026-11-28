// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { FreeshipAddonRail, type FreeshipAddonItem } from './freeship-addon-rail';

const item = (slug: string, over: Partial<FreeshipAddonItem> = {}): FreeshipAddonItem => ({
  slug, name: `Món ${slug}`, thumbnail: null, price: 50000, variationId: `v-${slug}`, ...over,
});
const cards = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="freeship-addon"]'));
const adds = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLButtonElement>('[data-testid="freeship-add"]'));

describe('FreeshipAddonRail (web)', () => {
  it('mỗi món một thẻ: tên, giá, nút "+ Thêm" có aria-label tên và giá', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b', { price: 289000 })]} onAdd={vi.fn()} />);
    expect(cards(container).map((c) => c.dataset.slug)).toEqual(['a', 'b']);
    expect(cards(container)[0]!.textContent).toContain('Món a');
    expect(cards(container)[0]!.textContent).toContain('50.000đ');
    expect(adds(container)[0]!.textContent).toBe('+ Thêm');
    expect(adds(container)[1]!.getAttribute('aria-label')).toBe('Thêm Món b vào giỏ, 289.000đ');
    expect(container.textContent).toContain('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
  });

  it('một chạm "+ Thêm" gọi onAdd với đúng món (có variationId)', () => {
    const onAdd = vi.fn();
    const a = item('a');
    const { container } = mount(<FreeshipAddonRail items={[a, item('b')]} onAdd={onAdd} />);
    click(adds(container)[0]!);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(a);
  });

  it('busySlug báo bận đúng nút của món đó (aria-busy, aria-disabled, vòng xoay) và để nút khác không báo bận, bấm được', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug="a" onAdd={vi.fn()} />);
    expect(adds(container)[0]!.getAttribute('aria-busy')).toBe('true');
    expect(adds(container)[0]!.getAttribute('aria-disabled')).toBe('true');
    expect(adds(container)[0]!.querySelector('.zaui-btn-loading-icon')).not.toBeNull();
    expect(adds(container)[1]!.disabled).toBe(false);
    expect(adds(container)[1]!.getAttribute('aria-busy')).toBeNull();
    expect(adds(container)[1]!.getAttribute('aria-disabled')).toBeNull();
    expect(adds(container)[1]!.querySelector('.zaui-btn-loading-icon')).toBeNull();
  });

  it('busySlug nhận danh sách: mọi món trong danh sách báo bận, món ngoài danh sách không, thẻ gốc aria-busy', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug={['a', 'c']} onAdd={vi.fn()} />);
    expect(adds(container).map((b) => b.getAttribute('aria-busy'))).toEqual(['true', null]);
    expect(adds(container).map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', null]);
    const both = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug={['a', 'b']} onAdd={vi.fn()} />);
    expect(adds(both.container).map((b) => b.getAttribute('aria-busy'))).toEqual(['true', 'true']);
    expect(container.querySelector('[data-testid="freeship-addons"]')!.getAttribute('aria-busy')).toBe('true');
  });

  it('busySlug dạng chuỗi so khớp NGUYÊN mã: "ab" không làm món "a" báo bận', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('ab')]} busySlug="ab" onAdd={vi.fn()} />);
    expect(adds(container).map((b) => b.getAttribute('aria-busy'))).toEqual([null, 'true']);
  });

  it('busySlug là danh sách rỗng: không món nào báo bận, thẻ gốc không aria-busy', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug={[]} onAdd={vi.fn()} />);
    expect(adds(container).map((b) => b.getAttribute('aria-busy'))).toEqual([null, null]);
    expect(container.querySelector('[data-testid="freeship-addons"]')!.getAttribute('aria-busy')).toBeNull();
  });

  it('thẻ gốc là <section> có tên "Gợi ý mua thêm…"; aria-busy khi có món đang thêm, không có khi rảnh', () => {
    const idle = mount(<FreeshipAddonRail items={[item('a'), item('b')]} onAdd={vi.fn()} />);
    const root = idle.container.querySelector('[data-testid="freeship-addons"]')!;
    expect(root.tagName).toBe('SECTION');
    expect(root.getAttribute('aria-label')).toBe('Gợi ý mua thêm cho đủ Miễn phí giao hàng');
    expect(root.hasAttribute('aria-busy')).toBe(false);
    idle.unmount();
    const busy = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug="a" onAdd={vi.fn()} />);
    expect(busy.container.querySelector('[data-testid="freeship-addons"]')!.getAttribute('aria-busy')).toBe('true');
  });

  it('tối đa 2 thẻ gọn trong một danh sách, không có hàng cuộn ngang (tubu-w13-01)', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b'), item('c')]} onAdd={vi.fn()} />);
    expect(cards(container).map((c) => c.dataset.slug)).toEqual(['a', 'b']);
    expect(container.querySelector('ul.tubu-addon-list')!.children).toHaveLength(2);
    expect(container.querySelector('.scroll-x, .tubu-addon-row')).toBeNull();
  });

  it('a11y: mọi nút có tên và vùng chạm >= 44px, cả khi một món đang bận (vòng xoay không làm mất tên nút)', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug="a" onAdd={vi.fn()} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('bấm nút đang bận không gọi onAdd (bấm liên tiếp không tạo lệnh thứ hai)', () => {
    const onAdd = vi.fn();
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} busySlug="a" onAdd={onAdd} />);
    click(adds(container)[0]!);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('giá gạch chỉ do PriceTag vẽ: món đang giảm hiện giá gạch có chữ đọc "giá gốc", món thường không gạch', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a', { price: 40000, compareAt: 60000 }), item('b')]} onAdd={vi.fn()} />);
    const [a, b] = cards(container);
    expect(a!.textContent).toContain('60.000đ');
    expect(a!.textContent).toContain('40.000đ');
    expect(a!.querySelector('[style*="line-through"]')?.textContent).toContain('60.000đ');
    expect(b!.querySelector('[style*="line-through"]')).toBeNull();
    expect(b!.textContent).not.toContain('60.000đ');
  });

  it('rỗng thì không vẽ gì', () => {
    const { container } = mount(<FreeshipAddonRail items={[]} onAdd={vi.fn()} />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('[data-testid="freeship-addons"]')).toBeNull();
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('thẻ gọn co theo khung (không rộng cố định, không tràn ngang), nút "+ Thêm" 44×44; số đều; từ md hai cột', () => {
      expect(rule('.tubu-addon-card')).toMatch(/min-width:\s*0/);
      expect(rule('.tubu-addon-card')).not.toMatch(/width:\s*272px/);
      expect(rule('.tubu-addon-add.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule('.tubu-addon-add.zaui-btn')).toMatch(/min-width:\s*44px/);
      expect(rule('.tubu-addon')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(css).toMatch(/@media \(min-width: 768px\) \{\s*\.tubu-addon-list \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
    });
  });
});

describe('FreeshipAddonRail (web) `collapsible`: dải gập sau một dòng (w47-01, như Mini App)', () => {
  it('gập sẵn: tiêu đề h3 bọc nút "Gợi ý thêm để được Miễn phí giao hàng", thẻ ẩn; chạm mở/gập; vùng chạm 44px', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} stage="freeship" collapsible onAdd={vi.fn()} />);
    const toggle = container.querySelector<HTMLButtonElement>('[data-testid="freeship-addons-toggle"]')!;
    expect(toggle.parentElement!.tagName).toBe('H3');
    expect(toggle.textContent).toBe('Gợi ý thêm để được Miễn phí giao hàng');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const list = container.querySelector<HTMLElement>(`#${CSS.escape(toggle.getAttribute('aria-controls')!)}`)!;
    expect(list.hidden).toBe(true);
    click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    click(toggle);
    expect(list.hidden).toBe(true);
    expect(smallTouchTargets(container)).toEqual([]);
  });

  it('mốc quà: dòng gập là tiêu đề có số còn thiếu', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} stage="gift" title="Thêm 40.000đ nữa để nhận quà dùng thử 0đ" collapsible onAdd={vi.fn()} />);
    expect(container.querySelector('[data-testid="freeship-addons-toggle"]')!.textContent).toBe('Thêm 40.000đ nữa để nhận quà dùng thử 0đ');
  });
});
