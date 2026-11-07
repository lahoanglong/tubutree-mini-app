import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FreeshipAddonRail, type FreeshipAddonItem } from './freeship-addon-rail';

const addon = (slug: string, price: number, over: Partial<FreeshipAddonItem> = {}): FreeshipAddonItem => ({
  slug,
  name: `Món ${slug}`,
  thumbnail: null,
  price,
  variationId: `v-${slug}`,
  ...over,
});
const ITEMS = [addon('a', 49_000), addon('b', 59_000, { compareAt: 79_000 }), addon('c', 39_000)];

describe('FreeshipAddonRail (Mini)', () => {
  it('có tiêu đề "Gợi ý mua thêm…" và một thẻ cho mỗi món, vùng cuộn có tên', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(screen.getAllByTestId('freeship-addon')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' }).className).toContain('scroll-x');
  });

  it('mỗi thẻ: tên, giá qua PriceTag (giá gạch có chữ đọc "giá gốc"), nút "+ Thêm" có tên truy cập {tên}, {giá}', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    const [a, b] = screen.getAllByTestId('freeship-addon');
    expect(within(a!).getByText('Món a')).toBeInTheDocument();
    expect(within(a!).getByText('49.000đ')).toBeInTheDocument();
    expect(within(b!).getByText('59.000đ')).toBeInTheDocument();
    expect(within(b!).getByText('79.000đ').style.textDecoration).toBe('line-through');
    expect(within(a!).getByRole('button', { name: 'Thêm Món a vào giỏ, 49.000đ' })).toHaveTextContent('+ Thêm');
  });

  it('mỗi thẻ mang data-slug của món', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.getAllByTestId('freeship-addon').map((c) => c.getAttribute('data-slug'))).toEqual(['a', 'b', 'c']);
  });

  it('giá dùng số đều (tabular-nums)', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.getByText('49.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('một chạm "+ Thêm" gọi onAdd đúng món (kèm variationId)', () => {
    const onAdd = vi.fn();
    render(<FreeshipAddonRail items={ITEMS} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Thêm Món c vào giỏ/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ slug: 'c', variationId: 'v-c', price: 39_000 }));
  });

  it('busySlug: nút của thẻ đó disabled + aria-busy và không gọi onAdd; thẻ khác vẫn bấm được', () => {
    const onAdd = vi.fn();
    render(<FreeshipAddonRail items={ITEMS} busySlug="a" onAdd={onAdd} />);
    const busyBtn = screen.getByRole('button', { name: /Thêm Món a vào giỏ/ });
    expect(busyBtn).toBeDisabled();
    expect(busyBtn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busyBtn);
    expect(onAdd).not.toHaveBeenCalled();
    const other = screen.getByRole('button', { name: /Thêm Món b vào giỏ/ });
    expect(other).toBeEnabled();
    expect(other).toHaveAttribute('aria-busy', 'false');
    fireEvent.click(other);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ slug: 'b' }));
  });

  it('rỗng: không vẽ gì (không để tiêu đề trơ)', () => {
    const { container } = render(<FreeshipAddonRail items={[]} onAdd={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('các phần tử do dải tự vẽ không mang thuộc tính style và không có màu thô (số đo ở css/freeship.css)', () => {
    const { container } = render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    const own = container.querySelectorAll('.tubu-addon-card, .tubu-addon-name, .tubu-addon-price');
    expect(own.length).toBe(9);
    own.forEach((el) => expect(el.hasAttribute('style')).toBe(false));
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('chữ khách đọc không có "Freeship" và không dấu chấm than', () => {
    const { container } = render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(container.textContent).not.toMatch(/freeship/i);
    expect(container.textContent).not.toContain('!');
  });
});

describe('css/freeship.css: thẻ gợi ý bù đơn', () => {
  function loadRules() {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '../../css/freeship.css'), 'utf8');
    document.head.appendChild(style);
    return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => loadRules().find((r) => r.selectorText === sel)!;

  it('thẻ rộng cố định theo token --tile-w-sm, không co (không tràn ngang), số đều', () => {
    const card = rule('.tubu-addon-card').style;
    expect(card.getPropertyValue('width')).toBe('var(--tile-w-sm)');
    expect(card.getPropertyValue('flex')).toContain('0 0');
    expect(card.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
  });

  it('nút đáy thẻ: ép xuống đáy (margin-top:auto) và rộng đủ thẻ', () => {
    expect(rule('.tubu-addon-add').style.getPropertyValue('margin-top')).toBe('auto');
    expect(rule('.tubu-addon-add').style.getPropertyValue('width')).toBe('100%');
  });
});
