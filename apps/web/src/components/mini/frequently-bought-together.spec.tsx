// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildFrequentlyBoughtBundle, frequentlyBoughtSummary, type FbtLine } from '@tubutree/app-core/commerce/frequently-bought';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import { accessibleName, smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { FrequentlyBoughtTogether } from './frequently-bought-together';

const card = (n: number, over: Partial<ProductCard> = {}): ProductCard => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Món ${n}`, thumbnail: null, basePrice: 50_000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v${n}`, ...over,
});
const bundle = buildFrequentlyBoughtBundle({
  now: Date.parse('2026-11-08T03:00:00Z'),
  current: { productId: 'p0', slug: 'sp-0', name: 'Dầu gội bưởi', thumbnail: null, variationId: 'v0', price: 100_000, compareAt: null, inStock: true },
  candidates: [card(1, { name: 'Mật ong', basePrice: 60_000, salePrice: 45_000 }), card(2, { name: 'Rau muống' })],
})!;
const LINES: readonly FbtLine[] = bundle.lines;
const ALL = new Set(LINES.map((l) => l.key));
const noop = () => undefined;

const props = (picked: ReadonlySet<string> = ALL) => ({ lines: LINES, picked, summary: frequentlyBoughtSummary(LINES, picked), onToggle: noop, onAdd: noop });
const rows = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="fbt-row"]'));
const boxes = (c: ParentNode) => Array.from(c.querySelectorAll<HTMLInputElement>('[data-testid="fbt-row"] input[type="checkbox"]'));
const addBtn = (c: ParentNode) => c.querySelector<HTMLButtonElement>('[data-testid="fbt-add"]')!;
const save = (c: ParentNode) => c.querySelector('[data-testid="fbt-save"]')!;

describe('FrequentlyBoughtTogether (web)', () => {
  it('tiêu đề "Gợi ý mua kèm hợp vị"; món đang xem đứng đầu có nhãn "Món đang xem"; mỗi dòng có tên và giá', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} />);
    expect(container.querySelector('section[data-testid="fbt"]')?.getAttribute('aria-label')).toBe('Gợi ý mua kèm hợp vị');
    expect(container.querySelector('h2')?.textContent).toBe('Gợi ý mua kèm hợp vị');
    expect(rows(container).map((r) => r.dataset.variationId)).toEqual(['v0', 'v1', 'v2']);
    expect(rows(container)[0]!.textContent).toContain('Món đang xem');
    expect(rows(container)[0]!.textContent).toContain('Dầu gội bưởi');
    expect(rows(container)[1]!.textContent).not.toContain('Món đang xem');
    expect(rows(container)[1]!.textContent).toContain('45.000đ');
  });

  it('ô tick mặc định theo `picked`; có tên đọc gồm tên và giá; đổi ô gọi onToggle đúng khoá', () => {
    const onToggle = vi.fn();
    const { container } = mount(<FrequentlyBoughtTogether {...props(new Set(['v0', 'v2']))} onToggle={onToggle} />);
    expect(boxes(container).map((b) => b.checked)).toEqual([true, false, true]);
    expect(boxes(container)[1]!.getAttribute('aria-label')).toBe('Mật ong, 45.000đ');
    click(boxes(container)[1]!);
    expect(onToggle).toHaveBeenCalledWith('v1');
  });

  it('nút ghi số món và tổng tiền của các món đã tick; chọn hết thì tổng bằng cả bộ', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} />);
    expect(addBtn(container).textContent).toBe('Thêm 3 món vào giỏ · 195.000đ');
    mount(<FrequentlyBoughtTogether {...props(new Set(['v0', 'v1']))} />);
    const btns = document.querySelectorAll('[data-testid="fbt-add"]');
    expect(btns[1]!.textContent).toBe('Thêm 2 món vào giỏ · 145.000đ');
  });

  it('"Tiết kiệm" là phần giá sale/Giờ vàng của các món đã tick; không có thì để trống nhưng vẫn giữ chỗ một dòng', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} />);
    expect(save(container).textContent).toBe('Tiết kiệm 15.000đ');
    expect(save(container).getAttribute('aria-live')).toBe('polite');
    const { container: c2 } = mount(<FrequentlyBoughtTogether {...props(new Set(['v0', 'v2']))} />);
    expect(save(c2).textContent).toBe('');
    expect(save(c2).className).toContain('tubu-fbt-save');
  });

  it('bỏ chọn hết: nút đổi thành lời mời "Chọn món muốn thêm" và khoá', () => {
    const onAdd = vi.fn();
    const { container } = mount(<FrequentlyBoughtTogether {...props(new Set())} onAdd={onAdd} />);
    expect(addBtn(container).textContent).toBe('Chọn món muốn thêm');
    expect(addBtn(container).disabled).toBe(true);
    click(addBtn(container));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('bấm nút gọi onAdd; busy khoá nút bằng spinner (aria-busy) và không gọi lần hai', () => {
    const onAdd = vi.fn();
    const { container } = mount(<FrequentlyBoughtTogether {...props()} onAdd={onAdd} />);
    click(addBtn(container));
    expect(onAdd).toHaveBeenCalledTimes(1);
    const { container: c2 } = mount(<FrequentlyBoughtTogether {...props()} onAdd={onAdd} busy />);
    expect(addBtn(c2).getAttribute('aria-busy')).toBe('true');
    click(addBtn(c2));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('giá gạch chỉ do PriceTag vẽ: dòng giảm giá có giá gạch, dòng thường không', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} />);
    expect(rows(container)[1]!.querySelector('[style*="line-through"]')?.textContent).toContain('60.000đ');
    expect(rows(container)[0]!.querySelector('[style*="line-through"]')).toBeNull();
  });

  it('rỗng thì không vẽ gì', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} lines={[]} />);
    expect(container.textContent).toBe('');
  });

  it('a11y: mọi điều khiển có tên; nút đủ 44px; cả dòng là vùng chạm (nhãn bao ô tick); nhóm có tên', () => {
    const { container } = mount(<FrequentlyBoughtTogether {...props()} />);
    expect(unnamedControls(container)).toEqual([]);
    expect(smallTouchTargets(container)).toEqual([]);
    expect(container.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Gợi ý mua kèm hợp vị');
    for (const r of rows(container)) expect(r.tagName).toBe('LABEL');
    expect(accessibleName(boxes(container)[0]!)).toContain('Dầu gội bưởi');
  });

  describe('mini.css', () => {
    const css = readFileSync(resolve(__dirname, 'mini.css'), 'utf8');
    const rule = (sel: string) => new RegExp(`${sel.replace(/[.[\]()']/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

    it('dòng cao tối thiểu 64 và có vùng tick 44; số đều; dòng "Tiết kiệm" giữ chỗ', () => {
      expect(rule('.tubu-fbt-row')).toMatch(/min-height:\s*64px/);
      expect(rule('.tubu-fbt-check')).toMatch(/width:\s*44px/);
      expect(rule('.tubu-fbt')).toMatch(/font-variant-numeric:\s*tabular-nums/);
      expect(rule('.tubu-fbt-save')).toMatch(/min-height:/);
    });
  });
});
