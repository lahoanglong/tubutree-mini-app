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

  it('hàng cuộn bật nút ‹ › (arrows): hàng được bọc khung relative để nút mũi tên định vị từ md', () => {
    const { container } = mount(<FreeshipAddonRail items={[item('a'), item('b')]} onAdd={vi.fn()} />);
    expect(container.querySelector('.tubu-addon-row')!.parentElement!.className).toBe('relative');
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

    it('thẻ rộng cố định, không co (không tràn ngang), nút "+ Thêm" cao 44; số đều', () => {
      expect(rule('.tubu-addon-card')).toMatch(/flex:\s*0 0 /);
      expect(rule('.tubu-addon-card')).toMatch(/width:\s*272px/);
      expect(rule('.tubu-addon-add.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule('.tubu-addon')).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });
  });
});
