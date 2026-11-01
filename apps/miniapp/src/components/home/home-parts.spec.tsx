import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  haptic: vi.fn(),
  user: null as null | { fullName: string; pointsBalance: number; pointsConvertedBalance?: number },
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchActiveFlashSales: vi.fn().mockResolvedValue([]), getCart: vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: typeof mocks.user }) => unknown) => sel({ status: 'idle', user: mocks.user }),
}));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: mocks.haptic }));

import { HomeHeader } from './home-header';
import { HomeBlockError, HomeBlockErrorSuppressed } from './home-block-error';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = null;
});

describe('HomeHeader', () => {
  it('chuông có nhãn kèm số chưa đọc (trình đọc màn hình nghe được) + huy hiệu số chưa đọc; giỏ hàng', () => {
    wrap(<HomeHeader unreadCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Thông báo, 3 chưa đọc' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/notifications');
    expect(mocks.haptic).toHaveBeenCalledWith('light');
    expect(screen.getByLabelText('3 thông báo chưa đọc')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Giỏ hàng' })).toBeInTheDocument();
  });

  it('không có thông báo chưa đọc → không có huy hiệu; logo có kích thước giữ chỗ', () => {
    wrap(<HomeHeader unreadCount={0} />);
    expect(screen.queryByLabelText(/thông báo chưa đọc/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Thông báo' })).toBeInTheDocument();
    const logo = screen.getByAltText('Tubu Tree');
    expect(logo).toHaveAttribute('width');
    expect(logo).toHaveAttribute('height');
  });
});

describe('HomeHeader — một hàng dính 56px (logo, ô tìm, chuông, giỏ)', () => {
  it('cao đúng HOME_HEADER_HEIGHT, h1 là tên trang, ô tìm mở /browse?focus=search', () => {
    wrap(<HomeHeader unreadCount={0} />);
    expect(screen.getByTestId('home-header')).toHaveStyle({ height: '56px' });
    expect(screen.getByRole('heading', { level: 1 })).toContainElement(screen.getByAltText('Tubu Tree'));
    fireEvent.click(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?focus=search');
  });

  it('ô tìm, chuông, giỏ cùng một hàng và đều có vùng chạm ≥44px', () => {
    wrap(<HomeHeader unreadCount={0} />);
    const row = screen.getByTestId('home-header');
    for (const name of ['Bạn đang tìm gì hôm nay?', 'Thông báo', 'Giỏ hàng']) {
      const btn = screen.getByRole('button', { name });
      expect(row).toContainElement(btn);
    }
    expect(screen.getByRole('button', { name: 'Bạn đang tìm gì hôm nay?' })).toHaveStyle({ minHeight: '44px' });
  });
});

describe('HomeBlockError', () => {
  it('trang đã có dải lỗi cấp trang (HomeBlockErrorSuppressed) → khối lỗi từng kệ ẩn, không xếp chồng', () => {
    const { container } = wrap(
      <HomeBlockErrorSuppressed.Provider value>
        <HomeBlockError title="Bán chạy" error={new Error('x')} onRetry={vi.fn()} />
      </HomeBlockErrorSuppressed.Provider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('tiêu đề + thông báo + nút "Thử lại", không mất khối im lặng (C-084)', () => {
    const refetch = vi.fn();
    wrap(<HomeBlockError title="Bán chạy" error={new Error('x')} onRetry={refetch} />);
    const region = screen.getByRole('region', { name: 'Bán chạy' });
    expect(within(region).getByRole('heading', { name: 'Bán chạy' })).toBeInTheDocument();
    expect(within(region).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Thử lại Bán chạy' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mocks.haptic).toHaveBeenCalledWith('light');
  });

  it('đang thử lại sau lỗi → nút ở trạng thái đang tải và bấm tiếp không gọi thêm', () => {
    const refetch = vi.fn();
    wrap(<HomeBlockError title="Bán chạy" error={new Error('x')} onRetry={refetch} retrying />);
    const btn = screen.getByRole('button', { name: 'Thử lại Bán chạy' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('thông báo lỗi theo loại lỗi (mất mạng / máy chủ) giống getErrorMessage', () => {
    const server = Object.assign(new Error('x'), { isHttpError: true, response: { status: 503, data: {} } });
    wrap(<HomeBlockError title="Bán chạy" error={server} onRetry={vi.fn()} />);
    expect(screen.getByText('Máy chủ đang bận, thử lại nhé.')).toBeInTheDocument();
  });
});
