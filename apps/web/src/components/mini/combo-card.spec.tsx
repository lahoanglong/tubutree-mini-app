// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { click } from '@/test-utils/dom';
import { mount } from './harness';
import { ComboCard, type ComboCardItem } from './combo-card';

const item = (i: number, patch: Partial<ComboCardItem> = {}): ComboCardItem => ({
  id: `p${i}`, slug: `sp-${i}`, name: `Sản phẩm số ${i}`, brandLine: null, price: 100000, compareAt: null, discountPct: 0,
  isFlash: false, isDeal: false, imageBadge: null, label: null, meta: null, stock: 'in', stockText: null, rank: null,
  spoken: { price: 'Giá 100.000đ', stock: null, badges: null }, thumbnail: null, ...patch,
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const base = { title: 'Combo giặt sạch', pct: 10, total: 374000, comboTotal: 337300 };
const text = () => document.body.textContent ?? '';
const btn = (name: RegExp | string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => (typeof name === 'string' ? (b.getAttribute('aria-label') ?? b.textContent) === name : name.test(b.getAttribute('aria-label') ?? b.textContent ?? '')));
const q = (id: string) => document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`);

describe('ComboCard (web)', () => {
  it('3 món: nhãn, Tiết kiệm, giá, nút có tên đọc đủ và gọi onAddAll một lần', () => {
    const onAddAll = vi.fn();
    mount(<ComboCard {...base} items={items(3)} onAddAll={onAddAll} />);
    expect(text()).toContain('Combo -10%');
    expect(text()).toContain('Tiết kiệm 36.700đ');
    expect(text()).toContain('337.300đ');
    expect(text()).toContain('374.000đ');
    const b = btn('Thêm cả combo Combo giặt sạch, 3 món, 337.300đ')!;
    expect(b.textContent).toBe('Thêm cả combo');
    click(b);
    expect(onAddAll).toHaveBeenCalledTimes(1);
  });

  it('5 món: 3 ảnh và ô "+2", danh sách đủ 5 mục; 3 món: không ô "+n"', () => {
    const a = mount(<ComboCard {...base} items={items(5)} onAddAll={() => {}} />);
    expect(q('combo-thumb')).toHaveLength(3);
    expect(q('combo-more')[0]!.textContent).toBe('+2');
    const list = document.querySelector('ul[aria-label="Gồm 5 món"]')!;
    expect(list.querySelectorAll('li')).toHaveLength(5);
    a.unmount();
    mount(<ComboCard {...base} items={items(3)} onAddAll={() => {}} />);
    expect(q('combo-more')).toHaveLength(0);
  });

  it('giá combo >= tổng lẻ: không "Tiết kiệm", không "0đ", không số âm; vẫn có nút', () => {
    for (const comboTotal of [374000, 400000]) {
      const m = mount(<ComboCard {...base} comboTotal={comboTotal} items={items(2)} onAddAll={() => {}} />);
      expect(text()).not.toContain('Tiết kiệm');
      expect(text()).not.toContain('Combo -');
      expect(text()).not.toMatch(/-\s?\d[\d.]*đ/);
      expect(text()).not.toMatch(/\b0đ/);
      expect(btn(/Thêm cả combo/)).toBeTruthy();
      m.unmount();
    }
  });

  it('pct dương nhưng không có khoản tiết kiệm (35.000đ giảm 1% làm tròn nghìn vẫn 35.000đ): không nhãn Combo', () => {
    mount(<ComboCard {...base} pct={1} total={35000} comboTotal={35000} items={items(2)} onAddAll={() => {}} />);
    expect(text()).not.toContain('Combo -');
    expect(text()).not.toContain('Tiết kiệm');
  });

  it('có tiết kiệm thì nhãn Combo -n% và dòng Tiết kiệm đi cùng nhau', () => {
    mount(<ComboCard {...base} items={items(2)} onAddAll={() => {}} />);
    expect(text()).toContain('Combo -10%');
    expect(text()).toContain('Tiết kiệm');
  });

  it('pct rác: không nhãn Combo; items rỗng: render rỗng', () => {
    for (const pct of [0, Number.NaN, -3]) {
      const m = mount(<ComboCard {...base} pct={pct} items={items(2)} onAddAll={() => {}} />);
      expect(text()).not.toContain('Combo -');
      m.unmount();
    }
    const e = mount(<ComboCard {...base} items={[]} onAddAll={() => {}} />);
    expect(e.container.innerHTML).toBe('');
  });

  it('busy: nút aria-busy/aria-disabled, bấm hai lần không gọi', () => {
    const onAddAll = vi.fn();
    mount(<ComboCard {...base} items={items(2)} onAddAll={onAddAll} busy />);
    const b = btn(/Thêm cả combo/)!;
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    click(b);
    click(b);
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('có món hết hàng: nút thành "Combo tạm hết", aria-disabled, bấm hai lần không gọi onAddAll, bỏ dòng Tiết kiệm', () => {
    const onAddAll = vi.fn();
    mount(<ComboCard {...base} items={[item(1), item(2, { stock: 'out', stockText: 'Tạm hết hàng' })]} onAddAll={onAddAll} />);
    expect(btn(/Thêm cả combo/)).toBeUndefined();
    const b = btn('Combo tạm hết: Combo giặt sạch')!;
    expect(b.getAttribute('aria-disabled')).toBe('true');
    click(b);
    click(b);
    expect(onAddAll).not.toHaveBeenCalled();
    expect(text()).not.toContain('Tiết kiệm');
  });

  it('giá cả bộ màu giá giảm khi có tiết kiệm, giá thường khi không có', () => {
    const a = mount(<ComboCard {...base} items={items(3)} onAddAll={() => {}} />);
    const priceOf = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('span')).find((e) => e.textContent === t && e.children.length === 0)!;
    expect(priceOf('337.300đ').style.color).toBe('var(--color-text-price-deal)');
    a.unmount();
    mount(<ComboCard {...base} comboTotal={374000} items={items(3)} onAddAll={() => {}} />);
    expect(priceOf('374.000đ').style.color).toBe('var(--color-text-price)');
  });

  it('tạm hết: bỏ nhãn "Combo -n%" và giá gạch, giá không còn màu giảm; hai combo cùng hết hàng có tên nút khác nhau', () => {
    const a = mount(<ComboCard {...base} items={[item(1), item(2, { stock: 'out', stockText: 'Tạm hết hàng' })]} onAddAll={() => {}} />);
    expect(text()).not.toContain('Combo -');
    expect(text()).not.toContain('374.000đ');
    expect(Array.from(document.querySelectorAll<HTMLElement>('span')).find((e) => e.textContent === '337.300đ' && e.children.length === 0)!.style.color).toBe('var(--color-text-price)');
    a.unmount();
    mount(
      <>
        <ComboCard {...base} title="Combo A" items={[item(1, { stock: 'out' })]} onAddAll={() => {}} />
        <ComboCard {...base} title="Combo B" items={[item(2, { stock: 'out' })]} onAddAll={() => {}} />
      </>,
    );
    expect(btn('Combo tạm hết: Combo A')).toBeTruthy();
    expect(btn('Combo tạm hết: Combo B')).toBeTruthy();
  });

  it('hết hàng và đang busy: vẫn đọc "Combo tạm hết" (không spinner), vẫn không gọi; "Xem từng món" dùng được; đủ hàng thì nút thêm không aria-disabled', () => {
    const onAddAll = vi.fn();
    const onSeeItems = vi.fn();
    const a = mount(<ComboCard {...base} items={[item(1, { stock: 'out' })]} onAddAll={onAddAll} onSeeItems={onSeeItems} busy />);
    const b = btn('Combo tạm hết: Combo giặt sạch')!;
    expect(b.getAttribute('aria-busy')).toBeNull();
    click(b);
    expect(onAddAll).not.toHaveBeenCalled();
    click(btn('Xem từng món')!);
    expect(onSeeItems).toHaveBeenCalledTimes(1);
    a.unmount();
    mount(<ComboCard {...base} items={[item(1, { stock: 'in' })]} onAddAll={() => {}} />);
    expect(btn(/Thêm cả combo/)!.getAttribute('aria-disabled')).toBeNull();
  });

  it('món hết hàng hiện "Tạm hết hàng"; onSeeItems chỉ có khi truyền', () => {
    const onSeeItems = vi.fn();
    const a = mount(<ComboCard {...base} items={[item(1), item(2, { stock: 'out', stockText: 'Tạm hết hàng' })]} onAddAll={() => {}} />);
    expect(document.querySelector('ul')!.textContent).toContain('Tạm hết hàng');
    expect(btn('Xem từng món')).toBeUndefined();
    a.unmount();
    mount(<ComboCard {...base} items={items(2)} onAddAll={() => {}} onSeeItems={onSeeItems} />);
    click(btn('Xem từng món')!);
    expect(onSeeItems).toHaveBeenCalledTimes(1);
  });

  it('ảnh thật dùng thumbnail; thiếu ảnh vẫn dựng ô; không dùng ProductTile', () => {
    mount(<ComboCard {...base} items={[item(1, { thumbnail: 'https://cdn.example/a.jpg' }), item(2)]} onAddAll={() => {}} />);
    const thumbs = q('combo-thumb');
    expect(thumbs[0]!.querySelector('img')).not.toBeNull();
    expect(thumbs[1]!.querySelector('img')).toBeNull();
    const src = readFileSync(join(__dirname, 'combo-card.tsx'), 'utf8');
    expect(src.split('\n').filter((l) => l.startsWith('import')).join('\n')).not.toMatch(/product-tile|ProductTile/);
  });
});
