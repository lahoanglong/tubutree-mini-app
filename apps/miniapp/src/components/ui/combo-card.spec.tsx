import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCardView } from '@tubutree/app-core/commerce/product-card-view';
import { ComboCard, type ComboCardItem } from './combo-card';

const item = (i: number, patch: Partial<ComboCardItem> = {}): ComboCardItem => ({
  id: `p${i}`, slug: `sp-${i}`, name: `Sản phẩm số ${i}`, brandLine: null, price: 100000, compareAt: null, discountPct: 0,
  isFlash: false, isDeal: false, imageBadge: null, label: null, meta: null, stock: 'in', stockText: null, rank: null,
  spoken: { price: 'Giá 100.000đ', stock: null, badges: null },
  thumbnail: null,
  ...patch,
});
const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));
const base = { title: 'Combo giặt sạch', pct: 10, total: 374000, comboTotal: 337300 };

describe('ComboCard', () => {
  it('3 món: nhãn Combo -10%, Tiết kiệm 36.700đ, nút thêm cả combo có tên đọc đủ và gọi onAddAll một lần', () => {
    const onAddAll = vi.fn();
    render(<ComboCard {...base} items={items(3)} onAddAll={onAddAll} />);
    expect(screen.getByText('Combo -10%')).toBeVisible();
    expect(screen.getByText('Tiết kiệm 36.700đ')).toBeVisible();
    expect(screen.getByText('Mua cả bộ')).toBeVisible();
    const btn = screen.getByRole('button', { name: 'Thêm cả combo Combo giặt sạch, 3 món, 337.300đ' });
    expect(btn).toHaveTextContent('Thêm cả combo');
    fireEvent.click(btn);
    expect(onAddAll).toHaveBeenCalledTimes(1);
  });

  it('giá combo và giá gạch của cả bộ cùng hiện', () => {
    render(<ComboCard {...base} items={items(3)} onAddAll={() => {}} />);
    expect(screen.getByText('337.300đ')).toBeVisible();
    expect(screen.getByText('374.000đ')).toBeVisible();
  });

  it('Tiết kiệm màu giá giảm (--color-text-price-deal)', () => {
    render(<ComboCard {...base} items={items(3)} onAddAll={() => {}} />);
    expect(screen.getByText('Tiết kiệm 36.700đ').style.color).toBe('var(--color-text-price-deal)');
  });

  it('5 món: đúng 3 ảnh và ô "+2", danh sách vẫn đủ 5 mục có tên', () => {
    render(<ComboCard {...base} items={items(5)} onAddAll={() => {}} />);
    expect(screen.getAllByTestId('combo-thumb')).toHaveLength(3);
    expect(screen.getByTestId('combo-more')).toHaveTextContent('+2');
    const list = screen.getByRole('list', { name: 'Gồm 5 món' });
    expect(list.querySelectorAll('li')).toHaveLength(5);
    expect(list).toHaveTextContent('Sản phẩm số 5');
  });

  it('3 món trở xuống: không ô "+n"', () => {
    render(<ComboCard {...base} items={items(3)} onAddAll={() => {}} />);
    expect(screen.queryByTestId('combo-more')).toBeNull();
    expect(screen.getAllByTestId('combo-thumb')).toHaveLength(3);
  });

  it('giá combo >= tổng lẻ: không "Tiết kiệm", không "0đ", không số âm; vẫn có nút', () => {
    for (const comboTotal of [374000, 400000]) {
      const { unmount } = render(<ComboCard {...base} comboTotal={comboTotal} items={items(2)} onAddAll={() => {}} />);
      expect(screen.queryByText(/Tiết kiệm/)).toBeNull();
      expect(screen.queryByText(/Combo -/)).toBeNull();
      expect(document.body.textContent).not.toMatch(/-\s?\d[\d.]*đ/);
      expect(document.body.textContent).not.toMatch(/\b0đ/);
      expect(screen.getByRole('button', { name: /Thêm cả combo/ })).toBeInTheDocument();
      unmount();
    }
  });

  it('pct dương nhưng không có khoản tiết kiệm (làm tròn nghìn: 35.000đ giảm 1% vẫn 35.000đ): không nhãn Combo', () => {
    render(<ComboCard {...base} pct={1} total={35000} comboTotal={35000} items={items(2)} onAddAll={() => {}} />);
    expect(screen.queryByText(/Combo -/)).toBeNull();
    expect(screen.queryByText(/Tiết kiệm/)).toBeNull();
  });

  it('có tiết kiệm thì nhãn Combo -n% và dòng Tiết kiệm đi cùng nhau', () => {
    render(<ComboCard {...base} items={items(2)} onAddAll={() => {}} />);
    expect(screen.getByText('Combo -10%')).toBeInTheDocument();
    expect(screen.getByText(/Tiết kiệm/)).toBeInTheDocument();
  });

  it('pct rác (0, NaN, âm): không nhãn Combo', () => {
    for (const pct of [0, Number.NaN, -3]) {
      const { unmount } = render(<ComboCard {...base} pct={pct} items={items(2)} onAddAll={() => {}} />);
      expect(screen.queryByText(/Combo -/)).toBeNull();
      unmount();
    }
  });

  it('items rỗng: render rỗng', () => {
    const { container } = render(<ComboCard {...base} items={[]} onAddAll={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('busy: nút aria-busy/aria-disabled, bấm hai lần không gọi', () => {
    const onAddAll = vi.fn();
    render(<ComboCard {...base} items={items(2)} onAddAll={onAddAll} busy />);
    const btn = screen.getByRole('button', { name: /Thêm cả combo/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onAddAll).not.toHaveBeenCalled();
  });

  it('món hết hàng hiện "Tạm hết hàng" trong danh sách', () => {
    render(<ComboCard {...base} items={[item(1), item(2, { stock: 'out', stockText: 'Tạm hết hàng' })]} onAddAll={() => {}} />);
    expect(screen.getByRole('list', { name: 'Gồm 2 món' })).toHaveTextContent('Tạm hết hàng');
  });

  it('onSeeItems: nút phụ "Xem từng món" chỉ có khi truyền, bấm gọi một lần', () => {
    const onSeeItems = vi.fn();
    const { rerender } = render(<ComboCard {...base} items={items(2)} onAddAll={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Xem từng món' })).toBeNull();
    rerender(<ComboCard {...base} items={items(2)} onAddAll={() => {}} onSeeItems={onSeeItems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem từng món' }));
    expect(onSeeItems).toHaveBeenCalledTimes(1);
  });

  it('ảnh thật dùng thumbnail của món; thiếu ảnh vẫn dựng ô (lá xanh)', () => {
    render(<ComboCard {...base} items={[item(1, { thumbnail: 'https://cdn.example/a.jpg' }), item(2)]} onAddAll={() => {}} />);
    const thumbs = screen.getAllByTestId('combo-thumb');
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.querySelector('img')).not.toBeNull();
    expect(thumbs[1]!.querySelector('img')).toBeNull();
  });

  it('không dùng ProductTile (thẻ sản phẩm do P4 quản)', () => {
    const src = readFileSync(join(__dirname, 'combo-card.tsx'), 'utf8');
    expect(src.split('\n').filter((l) => l.startsWith('import')).join('\n')).not.toMatch(/product-tile|ProductTile/);
  });

  it('kiểu ComboCardItem nhận được ProductCardView thuần (thumbnail tuỳ chọn)', () => {
    const pure: ProductCardView = { ...item(1) };
    const asItem: ComboCardItem = pure;
    expect(asItem.id).toBe('p1');
  });
});
