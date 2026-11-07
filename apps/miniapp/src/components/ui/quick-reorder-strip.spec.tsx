import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';
import { QUICK_REORDER_CARD_HEIGHT } from '@tubutree/app-core/home-layout';
import type { QuickReorderItem } from '@tubutree/app-core/commerce/quick-reorder';
import { QuickReorderStrip } from './quick-reorder-strip';

vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

const item = (n: number, over: Partial<QuickReorderItem> = {}): QuickReorderItem => ({
  key: `v${n}`,
  productId: `p${n}`,
  slug: `sp-${n}`,
  variationId: `v${n}`,
  name: `Món ${n}`,
  thumbnail: null,
  price: 50_000,
  compareAt: null,
  savePct: 0,
  isFlash: false,
  timesBought: 1,
  source: 'purchased',
  ...over,
});
const ITEMS = [item(1, { timesBought: 4 }), item(2, { price: 60_000, compareAt: 100_000, savePct: 40, isFlash: true }), item(3)];

describe('QuickReorderStrip (Mini)', () => {
  it('có tiêu đề "Mua lại món quen", vùng cuộn có tên và một thẻ cho mỗi món', () => {
    render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Mua lại món quen' })).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: 'Mua lại món quen' }).some((r) => r.className.includes('scroll-x'))).toBe(true);
    expect(screen.getAllByTestId('quick-reorder-card').map((c) => c.getAttribute('data-variation-id'))).toEqual(['v1', 'v2', 'v3']);
  });

  it('mỗi thẻ cao đúng QUICK_REORDER_CARD_HEIGHT (khung chờ Trang chủ đọc cùng số)', () => {
    render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    for (const card of screen.getAllByTestId('quick-reorder-card')) expect(card).toHaveStyle({ height: `${QUICK_REORDER_CARD_HEIGHT}px` });
  });

  it('giá qua PriceTag: giá gạch có chữ đọc, số đều; nhãn -x% khi giảm, "Đã mua n lần" khi không giảm mà mua nhiều lần', () => {
    render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    const [a, b, c] = screen.getAllByTestId('quick-reorder-card');
    expect(within(a!).getByText('Đã mua 4 lần')).toBeInTheDocument();
    expect(within(b!).getByText('-40%')).toBeInTheDocument();
    expect(within(b!).queryByText(/Đã mua/)).toBeNull();
    expect(within(b!).getByText('60.000đ').style.fontVariantNumeric).toBe('tabular-nums');
    expect(within(b!).getByText('100.000đ').style.textDecoration).toBe('line-through');
    expect(within(c!).queryByText(/Đã mua|%/)).toBeNull();
  });

  it('nút "+ Thêm" có tên truy cập {tên}, {giá}; một chạm gọi onAdd đúng món (kèm variationId)', () => {
    const onAdd = vi.fn();
    render(<QuickReorderStrip items={ITEMS} onAdd={onAdd} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Thêm Món 2 vào giỏ, 60.000đ' });
    expect(btn).toHaveTextContent('+ Thêm');
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ variationId: 'v2', price: 60_000 }));
  });

  it('"Thêm lại tất cả" ở tiêu đề: tên truy cập có số món và tổng tiền; bấm gọi onAddAll', () => {
    const onAddAll = vi.fn();
    render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={onAddAll} onOpen={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Thêm lại tất cả 3 món vào giỏ, tổng 160.000đ' });
    expect(btn).toHaveTextContent('Thêm lại tất cả');
    fireEvent.click(btn);
    expect(onAddAll).toHaveBeenCalledTimes(1);
  });

  it('chạm thân thẻ gọi onOpen đúng món', () => {
    const onOpen = vi.fn();
    render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={onOpen} />);
    const [a] = screen.getAllByTestId('quick-reorder-card');
    fireEvent.click(within(a!).getByText('Món 1'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ variationId: 'v1' }));
  });

  it('busyKey: nút của thẻ đó báo bận; mọi nút khác (kể cả "Thêm lại tất cả") khoá và không gọi gì', () => {
    const onAdd = vi.fn();
    const onAddAll = vi.fn();
    render(<QuickReorderStrip items={ITEMS} busyKey="v1" onAdd={onAdd} onAddAll={onAddAll} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Thêm Món 1 vào giỏ/ })).toHaveAttribute('aria-busy', 'true');
    const other = screen.getByRole('button', { name: /Thêm Món 2 vào giỏ/ });
    expect(other).toBeDisabled();
    fireEvent.click(other);
    fireEvent.click(screen.getByRole('button', { name: /Thêm lại tất cả 3 món/ }));
    expect(onAdd).not.toHaveBeenCalled();
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('busyAll: vùng báo bận, mọi nút "+ Thêm" khoá và "Thêm lại tất cả" không gọi thêm lần nữa', () => {
    const onAdd = vi.fn();
    const onAddAll = vi.fn();
    render(<QuickReorderStrip items={ITEMS} busyAll onAdd={onAdd} onAddAll={onAddAll} onOpen={vi.fn()} />);
    expect(screen.getByTestId('quick-reorder')).toHaveAttribute('aria-busy', 'true');
    for (const b of screen.getAllByTestId('quick-reorder-add')) expect(b).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Thêm lại tất cả 3 món/ }));
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('rỗng: không vẽ gì (không để tiêu đề trơ)', () => {
    const { container } = render(<QuickReorderStrip items={[]} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('chữ khách đọc không có dấu chấm than và không dính thuật ngữ cấm; không màu thô', () => {
    const { container } = render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    expect(container.textContent).not.toContain('!');
    expect(container.textContent).not.toMatch(/freeship|voucher|flash sale/i);
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('các phần tử do dải tự vẽ chỉ mang style chiều cao thẻ (số đo còn lại ở css/quick-reorder.css)', () => {
    const { container } = render(<QuickReorderStrip items={ITEMS} onAdd={vi.fn()} onAddAll={vi.fn()} onOpen={vi.fn()} />);
    const own = container.querySelectorAll('.tubu-quick-track, .tubu-quick-cell, .tubu-quick-open, .tubu-quick-name, .tubu-quick-price, .tubu-quick-thumb');
    expect(own.length).toBeGreaterThan(0);
    own.forEach((el) => expect(el.hasAttribute('style'), el.className).toBe(false));
  });
});

describe('css/quick-reorder.css: thẻ Mua lại món quen', () => {
  function loadRules() {
    const style = document.createElement('style');
    style.textContent = readFileSync(resolve(__dirname, '../../css/quick-reorder.css'), 'utf8');
    document.head.appendChild(style);
    return Array.from(style.sheet!.cssRules).filter((r): r is CSSStyleRule => 'selectorText' in r);
  }
  afterEach(() => document.head.querySelectorAll('style').forEach((s) => s.remove()));
  const rule = (sel: string) => loadRules().find((r) => r.selectorText === sel)!;

  it('ô rộng cố định theo token --tile-w-sm và không co; thẻ dùng số đều', () => {
    const cell = rule('.tubu-quick-cell').style;
    expect(cell.getPropertyValue('width')).toBe('var(--tile-w-sm)');
    expect(cell.getPropertyValue('flex')).toContain('0 0');
    expect(rule('.tubu-quick-card').style.getPropertyValue('font-variant-numeric')).toBe('tabular-nums');
  });

  it('số đo cộng đúng chiều cao thẻ: đệm 8 + ảnh 108 + cách 4 + tên 20 + giá 36 + cách 4 + nút 44 + đệm 8', () => {
    const px = (sel: string, prop: string) => parseFloat(rule(sel).style.getPropertyValue(prop));
    const sum =
      px('.tubu-quick-card', 'padding') * 2 +
      px('.tubu-quick-thumb', 'height') +
      px('.tubu-quick-name', 'margin-top') +
      px('.tubu-quick-name', 'height') +
      px('.tubu-quick-price', 'height') +
      px('.tubu-quick-card', 'gap') +
      px('.tubu-quick-add', 'min-height');
    expect(sum).toBe(QUICK_REORDER_CARD_HEIGHT);
  });

  it('không màu thô, không primitive --stone/--forest', () => {
    const css = readFileSync(resolve(__dirname, '../../css/quick-reorder.css'), 'utf8');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/var\(--(stone|forest|p-)/);
  });
});
