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

  it('basis total (API cũ, xếp theo tổng lượt bán): phụ đề ghi "Theo tổng lượt bán", không còn "30 ngày qua"', () => {
    render(<BestSellerRail items={cards(5)} basis="total" loading={false} />);
    const region = screen.getByRole('region', { name: 'Bán chạy nhất' });
    expect(within(region).getByText('Theo tổng lượt bán')).toBeInTheDocument();
    expect(within(region).queryByText('Theo lượt bán 30 ngày qua')).toBeNull();
  });

  it('kệ đã bỏ món trùng kệ trên (hạng #2, #3, #5): không đánh lại từ #1 và không ghi số hụt, thẻ chỉ ghi "Bán chạy" (P2 #4)', () => {
    render(<BestSellerRail items={[card(2), card(3), card(5)]} ranks={[2, 3, 5]} loading={false} />);
    const region = screen.getByRole('region', { name: 'Bán chạy nhất' });
    const ranks = Array.from(region.querySelectorAll('[data-ds-part="rank"]')).map((el) => el.textContent);
    expect(ranks).toEqual(['Bán chạy', 'Bán chạy', 'Bán chạy']);
  });

  it('hạng hụt vì kệ trên chiếm (#1, #2, #4): thẻ ghi "Bán chạy" không số để khách không tưởng lỗi; hạng liền 1..k giữ số (P2 #4)', () => {
    const gap = render(<BestSellerRail items={[card(1), card(2), card(4)]} ranks={[1, 2, 4]} loading={false} />);
    const badges = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-ds-part="rank"]')).map((n) => n.textContent);
    expect(badges(gap.container)).toEqual(['Bán chạy', 'Bán chạy', 'Bán chạy']);
    gap.unmount();
    const lead = render(<BestSellerRail items={[card(2), card(3)]} ranks={[2, 3]} loading={false} />);
    expect(badges(lead.container)).toEqual(['Bán chạy', 'Bán chạy']);
    lead.unmount();
    const seq = render(<BestSellerRail items={[card(1), card(2), card(3)]} ranks={[1, 2, 3]} loading={false} />);
    expect(badges(seq.container)).toEqual(['#1', '#2', '#3']);
  });

  it('"Xem tất cả Bán chạy nhất" mở trang đang có theo route khai trong SHELVES', () => {
    render(<BestSellerRail items={cards(4)} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả Bán chạy nhất' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/best-sellers');
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
