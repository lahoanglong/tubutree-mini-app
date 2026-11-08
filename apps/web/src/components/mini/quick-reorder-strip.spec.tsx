// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { QUICK_REORDER_CARD_HEIGHT } from '@tubutree/app-core/home-layout';
import type { QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { accessibleName, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { QuickReorderStrip } from './quick-reorder-strip';

const item = (n: number, over: Partial<QuickReorderItem> = {}): QuickReorderItem => ({
  key: `v${n}`, productId: `p${n}`, slug: `sp-${n}`, variationId: `v${n}`, name: `Món ${n}`, thumbnail: null,
  price: 50_000, compareAt: null, savePct: 0, isFlash: false, timesBought: 1, source: 'purchased', ...over,
});
const ITEMS = [item(1, { timesBought: 4 }), item(2, { price: 40_000, compareAt: 60_000, savePct: 33 }), item(3, { price: 30_000, compareAt: 50_000, savePct: 40, isFlash: true })];
const noop = () => undefined;
const cards = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="quick-reorder-card"]'));
const adds = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLButtonElement>('[data-testid="quick-reorder-add"]'));
const addAll = (c: ParentNode) => c.querySelector<HTMLButtonElement>('.tubu-quick-head button')!;

describe('QuickReorderStrip (web)', () => {
  it('tiêu đề "Mua lại món quen"; mỗi món một thẻ có tên, giá, "+ Thêm" với aria-label tên và giá', () => {
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    expect(container.querySelector('section[data-testid="quick-reorder"]')?.getAttribute('aria-label')).toBe('Mua lại món quen');
    expect(container.querySelector('h2')?.textContent).toBe('Mua lại món quen');
    expect(cards(container).map((c) => c.dataset.variationId)).toEqual(['v1', 'v2', 'v3']);
    expect(cards(container)[0]!.textContent).toContain('Món 1');
    expect(cards(container)[0]!.textContent).toContain('50.000đ');
    expect(adds(container)[0]!.textContent).toBe('+ Thêm');
    expect(adds(container)[1]!.getAttribute('aria-label')).toBe('Thêm Món 2 vào giỏ, 40.000đ');
  });

  it('thẻ cao đúng QUICK_REORDER_CARD_HEIGHT (khung chờ của Trang chủ đọc cùng số)', () => {
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    for (const c of cards(container)) expect(c.style.height).toBe(`${QUICK_REORDER_CARD_HEIGHT}px`);
  });

  it('"Thêm lại tất cả": nhãn nhìn thấy nằm trong tên đọc (WCAG 2.5.3), kèm số món và tổng tiền', () => {
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    const btn = addAll(container);
    expect(btn.textContent).toContain('Thêm lại tất cả');
    const name = btn.getAttribute('aria-label')!;
    expect(name.startsWith('Thêm lại tất cả')).toBe(true);
    expect(name).toContain('Thêm lại tất cả 3 món vào giỏ, tổng 120.000đ');
  });

  it('một chạm "+ Thêm" gọi onAdd với đúng món; chạm thân thẻ gọi onOpen; "Thêm lại tất cả" gọi onAddAll', () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    const onAddAll = vi.fn();
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={onAdd} onAddAll={onAddAll} onOpen={onOpen} />);
    click(adds(container)[1]!);
    expect(onAdd).toHaveBeenCalledWith(ITEMS[1]);
    click(container.querySelectorAll('.tubu-quick-open')[2]!);
    expect(onOpen).toHaveBeenCalledWith(ITEMS[2]);
    click(addAll(container));
    expect(onAddAll).toHaveBeenCalledTimes(1);
  });

  it('busyKey: nút của món đó quay (aria-busy) và khoá; mọi nút khác khoá để không bay hai lệnh cùng lúc; "Thêm lại tất cả" không gọi', () => {
    const onAdd = vi.fn();
    const onAddAll = vi.fn();
    const { container } = mount(<QuickReorderStrip items={ITEMS} busyKey="v1" onAdd={onAdd} onAddAll={onAddAll} onOpen={noop} />);
    expect(adds(container)[0]!.getAttribute('aria-busy')).toBe('true');
    expect(adds(container)[1]!.disabled).toBe(true);
    expect(adds(container)[1]!.getAttribute('aria-busy')).toBeNull();
    click(adds(container)[1]!);
    expect(addAll(container).disabled).toBe(true);
    expect(addAll(container).getAttribute('aria-busy')).toBeNull();
    click(addAll(container));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('busyAll: cả dải khoá, section báo bận', () => {
    const onAdd = vi.fn();
    const onAddAll = vi.fn();
    const { container } = mount(<QuickReorderStrip items={ITEMS} busyAll onAdd={onAdd} onAddAll={onAddAll} onOpen={noop} />);
    expect(container.querySelector('[data-testid="quick-reorder"]')?.getAttribute('aria-busy')).toBe('true');
    for (const b of adds(container)) expect(b.disabled).toBe(true);
    expect(addAll(container).disabled).toBe(true);
    expect(addAll(container).getAttribute('aria-busy')).toBe('true');
    click(addAll(container));
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('giá gạch chỉ do PriceTag vẽ (chữ đọc "giá gốc" nằm trong PriceTag); thẻ không giảm thì không gạch', () => {
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    const [a, b, c] = cards(container);
    expect(a!.querySelector('[style*="line-through"]')).toBeNull();
    expect(b!.querySelector('[style*="line-through"]')?.textContent).toContain('60.000đ');
    expect(c!.querySelector('[style*="line-through"]')?.textContent).toContain('50.000đ');
  });

  it('huy hiệu: món giảm giá ghi phần trăm tiết kiệm; món không giảm mà mua từ 2 lần ghi "Đã mua n lần"; mua một lần thì không có huy hiệu', () => {
    const { container } = mount(<QuickReorderStrip items={[...ITEMS, item(4)]} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    const [a, b, c, d] = cards(container);
    expect(b!.textContent).toContain('-33%');
    expect(c!.textContent).toContain('-40%');
    expect(a!.textContent).toContain('Đã mua 4 lần');
    expect(a!.textContent).not.toMatch(/-\d+%/);
    expect(d!.querySelector('.tubu-quick-badge')).toBeNull();
    expect(b!.textContent).not.toContain('Đã mua');
  });

  it('rỗng thì không vẽ gì', () => {
    const { container } = mount(<QuickReorderStrip items={[]} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    expect(container.textContent).toBe('');
  });

  it('a11y: mọi nút có tên; vùng chạm ≥ 44px; hàng cuộn là region có tên', () => {
    const { container } = mount(<QuickReorderStrip items={ITEMS} onAdd={noop} onAddAll={noop} onOpen={noop} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(container.querySelector('[role="region"]')?.getAttribute('aria-label')).toBe('Mua lại món quen');
    expect(accessibleName(adds(container)[0]!)).toContain('Món 1');
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('thẻ rộng --tile-w-sm và không co; nút "+ Thêm" cao 44; số đều', () => {
      expect(rule('.tubu-quick-cell')).toMatch(/flex:\s*0 0 var\(--tile-w-sm\)/);
      expect(rule('.tubu-quick-add.zaui-btn')).toMatch(/height:\s*44px/);
      expect(rule('.tubu-quick-card')).toMatch(/font-variant-numeric:\s*tabular-nums/);
    });

    it('khoảng đệm hàng cuộn = RAIL_PAD (8) trên dưới, 12 hai bên: tổng dải 44 + 8 + 232 + 8 khớp khung chờ', () => {
      expect(rule('.tubu-quick-row')).toMatch(/padding:\s*var\(--p-space-3\) var\(--space-inline-md\)/);
    });
  });
});
