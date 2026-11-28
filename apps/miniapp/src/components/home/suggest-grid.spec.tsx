import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProductCard as ProductCardData } from '@tubutree/app-core/api/catalog';
import { HOME_INTERLEAVE_AFTER } from '@tubutree/app-core/home-layout';

vi.mock('../ui/product-card', () => ({
  ProductCard: ({ product, variant, listSource, position }: { product: { id: string }; variant: string; listSource: string; position: number }) => (
    <div data-testid="card" data-id={product.id} data-variant={variant} data-source={listSource} data-position={position} />
  ),
}));

import { SuggestGrid } from './suggest-grid';

const products = (n: number, from = 1): ProductCardData[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, slug: `p${from + i}`, brand: 'Tubu', name: `Món ${from + i}`, thumbnail: null, basePrice: 1, salePrice: null, isFeatured: false, inStock: true }));
const INTERLEAVE = <section aria-label="Thẻ chen">chen</section>;
const itemsOf = (list: HTMLElement) => Array.from(list.children).map((li) => (li.querySelector('[data-testid="card"]') ? 'card' : li.getAttribute('data-testid')));

describe('SuggestGrid — lưới Gợi ý có thẻ chen', () => {
  it('lưới hai cột, thẻ biến thể grid mang nguồn danh sách và vị trí đếm từ 1', () => {
    render(<SuggestGrid products={products(4)} listSource="home_suggest" />);
    const list = screen.getByTestId('catalog-grid');
    expect(list.tagName).toBe('UL');
    expect(list.style.gridTemplateColumns).toBe('1fr 1fr');
    const cards = screen.getAllByTestId('card');
    expect(cards.map((c) => c.dataset.position)).toEqual(['1', '2', '3', '4']);
    expect(new Set(cards.map((c) => c.dataset.variant))).toEqual(new Set(['grid']));
    expect(new Set(cards.map((c) => c.dataset.source))).toEqual(new Set(['home_suggest']));
  });

  it('đủ HOME_INTERLEAVE_AFTER (8) thẻ: thẻ chen đứng ngay sau thẻ thứ 8, trải hết bề ngang lưới', () => {
    render(<SuggestGrid products={products(HOME_INTERLEAVE_AFTER)} listSource="home_suggest" interleave={INTERLEAVE} />);
    const list = screen.getByTestId('catalog-grid');
    expect(itemsOf(list)).toEqual([...Array(HOME_INTERLEAVE_AFTER).fill('card'), 'suggest-interleave']);
    const slot = screen.getByTestId('suggest-interleave');
    expect(slot.style.gridColumn).toBe('1 / -1');
    expect(within(slot).getByRole('region', { name: 'Thẻ chen' })).toBeInTheDocument();
  });

  it('ít hơn 8 thẻ: không chen (thẻ chen không đứng cuối một lưới ngắn)', () => {
    render(<SuggestGrid products={products(HOME_INTERLEAVE_AFTER - 1)} listSource="home_suggest" interleave={INTERLEAVE} />);
    expect(screen.queryByTestId('suggest-interleave')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Thẻ chen' })).toBeNull();
  });

  it('nhiều thẻ hơn 8: chen đúng MỘT lần sau thẻ thứ 8; vị trí đếm liên tục qua thẻ chen (thẻ sau đó là 9, không đếm lại từ 1)', () => {
    render(<SuggestGrid products={products(12)} listSource="home_suggest" interleave={INTERLEAVE} />);
    expect(screen.getAllByTestId('suggest-interleave')).toHaveLength(1);
    const list = screen.getByTestId('catalog-grid');
    expect(itemsOf(list).indexOf('suggest-interleave')).toBe(HOME_INTERLEAVE_AFTER);
    expect(screen.getAllByTestId('card').map((c) => c.dataset.position)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
  });

  it('trang sau nối vào cuối: thẻ chen giữ nguyên chỗ và không dựng lại (cùng phần tử DOM)', () => {
    const { rerender } = render(<SuggestGrid products={products(8)} listSource="home_suggest" interleave={INTERLEAVE} />);
    const before = screen.getByTestId('suggest-interleave');
    rerender(<SuggestGrid products={products(16)} listSource="home_suggest" interleave={INTERLEAVE} />);
    expect(screen.getByTestId('suggest-interleave')).toBe(before);
    expect(itemsOf(screen.getByTestId('catalog-grid')).indexOf('suggest-interleave')).toBe(HOME_INTERLEAVE_AFTER);
    expect(screen.getAllByTestId('card')).toHaveLength(16);
  });

  it('không truyền thẻ chen: lưới thuần, không phần tử thừa', () => {
    render(<SuggestGrid products={products(10)} listSource="home_suggest" />);
    expect(screen.queryByTestId('suggest-interleave')).toBeNull();
    expect(screen.getByTestId('catalog-grid').children).toHaveLength(10);
  });
});
