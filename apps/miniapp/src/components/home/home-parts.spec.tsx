import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  haptic: vi.fn(),
  fetchBrands: vi.fn(),
  user: null as null | { fullName: string; pointsBalance: number },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchBrands: mocks.fetchBrands, fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: typeof mocks.user }) => unknown) => sel({ status: 'idle', user: mocks.user }),
}));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));

import type { ProductCard } from '../../services/shop-api';
import { HomeHeader } from './home-header';
import { HomeSection } from './home-section';
import { HomeExtras } from './home-extras';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const P: ProductCard = { id: 'p1', slug: 'p1', brand: 'Tubu', name: 'Xà phòng', thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
});

describe('HomeHeader', () => {
  it('chuông có nhãn + huy hiệu số chưa đọc; giỏ hàng', () => {
    wrap(<HomeHeader unreadCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/notifications');
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(screen.getByLabelText('3 thông báo chưa đọc')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });

  it('không có thông báo chưa đọc → không có huy hiệu; logo có kích thước giữ chỗ', () => {
    wrap(<HomeHeader unreadCount={0} />);
    expect(screen.queryByLabelText(/thông báo chưa đọc/)).toBeNull();
    const logo = screen.getByAltText('Tubu Tree');
    expect(logo).toHaveAttribute('width');
    expect(logo).toHaveAttribute('height');
  });
});

describe('HomeSection', () => {
  const q = (over: object) => ({ isLoading: false, isError: false, error: null, ...over });

  it('đã tải, rỗng → không render (không để lại tiêu đề trống)', () => {
    const { container } = wrap(<HomeSection title="Bán chạy" limit={6} query={q({ data: { data: [] } })} listSource="home" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lỗi → ẩn lặng lẽ: không tiêu đề, không ErrorState, không nút Thử lại', () => {
    const { container } = wrap(<HomeSection title="Bán chạy" limit={6} query={q({ isError: true, error: new Error('x') })} listSource="home" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện SP cũ, không ErrorState', () => {
    wrap(<HomeSection title="Bán chạy" limit={6} query={q({ isError: true, error: new Error('x'), data: { data: [P] } })} listSource="home" />);
    expect(screen.getByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thử lại' })).toBeNull();
  });

  it('đang tải → vùng có tiêu đề + khung chờ; có dữ liệu → lưới SP', () => {
    const { rerender } = wrap(<HomeSection title="Bán chạy" limit={6} query={q({ isLoading: true })} listSource="home" />);
    expect(screen.getByRole('region', { name: 'Bán chạy' })).toContainElement(screen.getByTestId('catalog-grid-skeleton'));
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <HomeSection title="Bán chạy" limit={6} query={q({ data: { data: [P] } })} listSource="home" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('button', { name: 'Xà phòng' })).toBeInTheDocument();
    expect(screen.queryByTestId('catalog-grid-skeleton')).toBeNull();
  });

  it('M2: số ô khung chờ đúng bằng giới hạn SP thật của khối', () => {
    const { rerender } = wrap(<HomeSection title="Bán chạy" limit={6} query={q({ isLoading: true })} listSource="home" />);
    expect(screen.getAllByTestId('catalog-tile-skeleton')).toHaveLength(6);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <HomeSection title="Bán chạy" limit={4} query={q({ isLoading: true })} listSource="home" />
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId('catalog-tile-skeleton')).toHaveLength(4);
  });

  it('"Xem tất cả" có tên truy cập kèm tiêu đề, mở đích đã cho — cả khi đang tải lẫn khi đã có SP', () => {
    const { rerender } = wrap(
      <HomeSection title="Bán chạy" limit={6} seeAllTo="/browse?sort=best_seller" query={q({ isLoading: true })} listSource="home" />,
    );
    expect(screen.getByRole('button', { name: 'Xem tất cả Bán chạy' })).toBeInTheDocument();
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <HomeSection title="Bán chạy" limit={6} seeAllTo="/browse?sort=best_seller" query={q({ data: { data: [P] } })} listSource="home" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xem tất cả Bán chạy' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?sort=best_seller');
    expect(mocks.haptic).toHaveBeenCalledWith('light');
  });

  it('không truyền seeAllTo → không có nút "Xem tất cả"', () => {
    wrap(<HomeSection title="Dành cho bạn" limit={6} query={q({ data: { data: [P] } })} listSource="home" />);
    expect(screen.queryByRole('button', { name: /Xem tất cả/ })).toBeNull();
  });
});

describe('HomeExtras', () => {
  beforeEach(() => {
    mocks.user = { fullName: 'Lan', pointsBalance: 60 };
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Tubu', count: 3 }]);
  });

  it('A2-33: hero dùng "Tìm sản phẩm" (không còn "Khám phá vườn") → mở ô tìm', () => {
    wrap(<HomeExtras />);
    expect(screen.queryByText(/Khám phá vườn/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tìm sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?focus=search');
    expect(screen.getByText(/Chào Lan/)).toHaveTextContent('60 điểm Xanh');
  });

  it('khách chưa đăng nhập → hero không có lời chào', () => {
    mocks.user = null;
    wrap(<HomeExtras />);
    expect(screen.queryByText(/Chào /)).toBeNull();
  });

  it('thẻ nhỏ AI / Mua chung giữ tên truy cập cũ; thương hiệu mở Browse lọc sẵn', async () => {
    wrap(<HomeExtras />);
    fireEvent.click(screen.getByRole('button', { name: 'Hỏi trợ lý AI 24/7' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/ai-advisor');
    fireEvent.click(screen.getByRole('button', { name: 'Mua chung giá tốt' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/group-buy');
    fireEvent.click(await screen.findByRole('button', { name: 'Tubu' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?brand=Tubu');
    fireEvent.click(screen.getByRole('button', { name: /Hành trình nguyên liệu/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/brand-story');
    fireEvent.click(screen.getByRole('button', { name: /Cộng đồng Vườn Tubu/ }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');
  });

  it('tên thương hiệu có ký tự đặc biệt được mã hoá trong URL', async () => {
    mocks.fetchBrands.mockResolvedValue([{ brand: 'Cỏ & Cây', count: 1 }]);
    wrap(<HomeExtras />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cỏ & Cây' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith(`/browse?brand=${encodeURIComponent('Cỏ & Cây')}`);
  });

  it('thẻ Hành trình / Cộng đồng dùng được bằng bàn phím (Enter, Space)', () => {
    wrap(<HomeExtras />);
    const story = screen.getByRole('button', { name: /Hành trình nguyên liệu/ });
    expect(story).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(story, { key: 'Enter' });
    expect(mocks.navigate).toHaveBeenLastCalledWith('/brand-story');
    fireEvent.keyDown(screen.getByRole('button', { name: /Cộng đồng Vườn Tubu/ }), { key: ' ' });
    expect(mocks.navigate).toHaveBeenLastCalledWith('/feed');
  });

  it('dải thương hiệu: khung chờ trong lúc tải, rồi chip thật', async () => {
    let resolve!: (v: unknown) => void;
    mocks.fetchBrands.mockReturnValue(new Promise((r) => { resolve = r; }));
    wrap(<HomeExtras />);
    expect(screen.getByRole('region', { name: 'Thương hiệu Việt' })).toBeInTheDocument();
    expect(screen.getAllByTestId('brand-chip-skeleton')).toHaveLength(5);
    await act(async () => { resolve([{ brand: 'Tubu', count: 3 }]); });
    expect(await screen.findByRole('button', { name: 'Tubu' })).toBeInTheDocument();
    expect(screen.queryAllByTestId('brand-chip-skeleton')).toHaveLength(0);
  });

  it('không có thương hiệu → ẩn cả dải (sau khi tải xong)', async () => {
    mocks.fetchBrands.mockResolvedValue([]);
    wrap(<HomeExtras />);
    await waitFor(() => expect(mocks.fetchBrands).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByTestId('brand-chip-skeleton')).toHaveLength(0));
    expect(screen.queryByRole('region', { name: 'Thương hiệu Việt' })).toBeNull();
  });

  it('tải thương hiệu lỗi → ẩn dải, phần còn lại vẫn dùng được', async () => {
    mocks.fetchBrands.mockRejectedValue(new Error('x'));
    wrap(<HomeExtras />);
    await waitFor(() => expect(mocks.fetchBrands).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryAllByTestId('brand-chip-skeleton')).toHaveLength(0));
    expect(screen.queryByRole('region', { name: 'Thương hiệu Việt' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Tìm sản phẩm' })).toBeInTheDocument();
  });
});
