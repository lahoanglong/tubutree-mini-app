import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));

import { BestSellerRail } from './best-seller-rail';

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const card = (n: number) => ({ id: `id${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: false, inStock: true });
const cards = (n: number) => Array.from({ length: n }, (_, i) => card(i + 1));

describe('BestSellerRail — Bán chạy nhất có hạng (Q18)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('vùng "Bán chạy nhất", tiêu đề h2 kèm cơ sở xếp hạng, mỗi thẻ có hạng #1..#n', () => {
    render(<BestSellerRail items={cards(5)} loading={false} />);
    const region = screen.getByRole('region', { name: 'Bán chạy nhất' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Bán chạy nhất' })).toBeInTheDocument();
    expect(within(region).getByText('Theo lượt bán 30 ngày qua')).toBeInTheDocument();
    const ranks = Array.from(region.querySelectorAll('[data-ds-part="rank"]')).map((el) => el.textContent);
    expect(ranks).toEqual(['#1', '#2', '#3', '#4', '#5']);
  });

  it('"Xem tất cả Bán chạy nhất" mở trang đang có theo route khai trong SHELVES', () => {
    render(<BestSellerRail items={cards(4)} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả Bán chạy nhất' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?sort=best_seller');
  });

  it('đang tải: khung chờ trong vùng có tên; không có món và không lỗi: không vẽ gì', () => {
    const loading = render(<BestSellerRail items={[]} loading />);
    expect(screen.getByRole('region', { name: 'Bán chạy nhất' })).toBeInTheDocument();
    loading.unmount();
    const empty = render(<BestSellerRail items={[]} loading={false} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it('lỗi tải và chưa có món: khối lỗi có "Thử lại" gọi onRetry', () => {
    const onRetry = vi.fn();
    render(<BestSellerRail items={[]} loading={false} error={new Error('x')} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại Bán chạy nhất' }));
    expect(onRetry).toHaveBeenCalled();
  });
});
