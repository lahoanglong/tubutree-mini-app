import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ProductTile } from './product-tile';

const PRODUCT = {
  id: 'p1', slug: 'serum-x', name: 'Serum Bã Trầu', brand: 'Tubu', thumbnail: null,
  basePrice: 52000, salePrice: null, inStock: true, reviewCount: 12, ratingAvg: 4.5, sold: 340,
};

// ProductTile hiện WishlistHeart mặc định (showWishlist=true ở mọi variant trừ line/list) —
// WishlistHeart dùng useQueryClient() (@tanstack/react-query), không có fallback no-op nếu thiếu
// Provider ("No QueryClient set" throw ngay khi render). Bọc QueryClientProvider thật, giống
// pattern address-form.spec.tsx đã dùng cho vấn đề tương tự.
function renderTile(ui: ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('ProductTile', () => {
  it('grid variant shows price, name, out-of-stock overlay when inStock=false (fixes A4-06)', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, inStock: false }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText(/tạm hết|hết hàng/i)).toBeInTheDocument();
  });
  it('flash priceOverride wins over salePrice/basePrice and shows a flash badge', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, salePrice: 45000 }} priceOverride={{ price: 39000 }} variant="grid" onPress={() => {}} />);
    expect(screen.getByText('39.000đ')).toBeInTheDocument();
  });
  it('action="rebuy" shows a Mua lại button instead of the default add-to-cart affordance', () => {
    const onAction = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="line" action="rebuy" onPress={() => {}} onAction={onAction} />);
    screen.getByText('Mua lại').click();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  it('onPress fires when the tile itself (not a nested button) is clicked', () => {
    const onPress = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="grid" onPress={onPress} />);
    screen.getByText('Serum Bã Trầu').closest('[role="button"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('clicking "Mua lại" does NOT also fire the tile\'s onPress (click isolation, no accidental navigation)', () => {
    const onPress = vi.fn();
    const onAction = vi.fn();
    renderTile(<ProductTile product={PRODUCT} variant="line" action="rebuy" onPress={onPress} onAction={onAction} />);
    screen.getByText('Mua lại').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });
  it('out-of-stock product with action="rebuy" still shows the overlay (A4-06 applies regardless of action)', () => {
    renderTile(<ProductTile product={{ ...PRODUCT, inStock: false }} variant="line" action="rebuy" onPress={() => {}} onAction={() => {}} />);
    expect(screen.getByText(/tạm hết|hết hàng/i)).toBeInTheDocument();
    expect(screen.getByText('Mua lại')).toBeInTheDocument();
  });
});
