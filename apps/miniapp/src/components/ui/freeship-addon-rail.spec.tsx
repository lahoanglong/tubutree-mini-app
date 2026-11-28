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
  it('có tiêu đề "Gợi ý mua thêm…", tối đa 2 thẻ gọn trong một danh sách, không có hàng cuộn ngang (tubu-w13-01)', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Gợi ý mua thêm cho đủ Miễn phí giao hàng' })).toBeInTheDocument();
    expect(screen.getAllByTestId('freeship-addon')).toHaveLength(2);
    expect(screen.getByRole('list').children).toHaveLength(2);
    expect(document.querySelector('.scroll-x, .tubu-addon-row')).toBeNull();
  });

  it('thẻ gốc là <section> có tên "Gợi ý mua thêm…"; báo bận (aria-busy) khi có món đang thêm, không báo khi rảnh', () => {
    const { rerender } = render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    const section = screen.getByTestId('freeship-addons');
    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveAttribute('aria-label', 'Gợi ý mua thêm cho đủ Miễn phí giao hàng');
    expect(section).not.toHaveAttribute('aria-busy');
    rerender(<FreeshipAddonRail items={ITEMS} busySlug="a" onAdd={vi.fn()} />);
    expect(screen.getByTestId('freeship-addons')).toHaveAttribute('aria-busy', 'true');
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
    expect(screen.getAllByTestId('freeship-addon').map((c) => c.getAttribute('data-slug'))).toEqual(['a', 'b']);
  });

  it('giá dùng số đều (tabular-nums)', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.getByText('49.000đ').style.fontVariantNumeric).toBe('tabular-nums');
  });

  it('một chạm "+ Thêm" gọi onAdd đúng món (kèm variationId)', () => {
    const onAdd = vi.fn();
    render(<FreeshipAddonRail items={[ITEMS[2]!, ITEMS[0]!]} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: /Thêm Món c vào giỏ/ }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ slug: 'c', variationId: 'v-c', price: 39_000 }));
  });

  it('busySlug: nút của thẻ đó báo bận (aria-busy, aria-disabled, vòng xoay) và không gọi onAdd; thẻ khác không báo bận và vẫn bấm được', () => {
    const onAdd = vi.fn();
    render(<FreeshipAddonRail items={ITEMS} busySlug="a" onAdd={onAdd} />);
    const busyBtn = screen.getByRole('button', { name: /Thêm Món a vào giỏ/ });
    expect(busyBtn).toHaveAttribute('aria-busy', 'true');
    expect(busyBtn).toHaveAttribute('aria-disabled', 'true');
    expect(busyBtn.className).toContain('zaui-btn-loading');
    fireEvent.click(busyBtn);
    expect(onAdd).not.toHaveBeenCalled();
    const other = screen.getByRole('button', { name: /Thêm Món b vào giỏ/ });
    expect(other).toBeEnabled();
    expect(other).not.toHaveAttribute('aria-busy');
    expect(other).not.toHaveAttribute('aria-disabled');
    expect(other.className).not.toContain('zaui-btn-loading');
    fireEvent.click(other);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ slug: 'b' }));
  });

  it('rỗng: không vẽ gì (không để tiêu đề trơ)', () => {
    const { container } = render(<FreeshipAddonRail items={[]} onAdd={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('các phần tử do dải tự vẽ không mang thuộc tính style và không có màu thô (số đo ở css/freeship.css)', () => {
    const { container } = render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    const own = container.querySelectorAll('.tubu-addon-card, .tubu-addon-body, .tubu-addon-name, .tubu-addon-price');
    expect(own.length).toBe(8);
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

  it('thẻ gọn co theo khung (không rộng cố định, không tràn ngang), số đều', () => {
    const card = rule('.tubu-addon-card').style;
    expect(card.getPropertyValue('width')).toBe('');
    expect(card.getPropertyValue('min-width')).toMatch(/^0(px)?$/);
    expect(card.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
  });

  it('nút "+ Thêm" cạnh phải thẻ, vùng chạm 44×44, không co', () => {
    const add = rule('.tubu-addon-add.zaui-btn').style;
    expect(add.getPropertyValue('height')).toBe('44px');
    expect(add.getPropertyValue('min-width')).toBe('44px');
    expect(add.getPropertyValue('flex')).toContain('0 0');
  });
});

describe('FreeshipAddonRail (Mini) `collapsible`: dải gập sau một dòng (w47-01)', () => {
  it('gập sẵn: tiêu đề bọc nút "Gợi ý thêm để được Miễn phí giao hàng", chưa thấy thẻ; chạm mở/gập', () => {
    render(<FreeshipAddonRail items={ITEMS} stage="freeship" collapsible onAdd={vi.fn()} />);
    const heading = screen.getByRole('heading', { name: 'Gợi ý thêm để được Miễn phí giao hàng' });
    const toggle = within(heading).getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('button', { name: /^Thêm / })).toHaveLength(0);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: /^Thêm / }).length).toBeGreaterThan(0);
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('button', { name: /^Thêm / })).toHaveLength(0);
  });

  it('mốc quà: dòng gập là tiêu đề có số còn thiếu', () => {
    render(<FreeshipAddonRail items={ITEMS} stage="gift" title="Thêm 40.000đ nữa để nhận quà dùng thử 0đ" collapsible onAdd={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Thêm 40.000đ nữa để nhận quà dùng thử 0đ' })).toBeInTheDocument();
  });

  it('không truyền collapsible: mở sẵn như cũ, không có nút gập', () => {
    render(<FreeshipAddonRail items={ITEMS} onAdd={vi.fn()} />);
    expect(screen.queryByTestId('freeship-addons-toggle')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Thêm / }).length).toBeGreaterThan(0);
  });
});
