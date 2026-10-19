import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getPublicConfig: vi.fn(),
  getNewCustomerOffer: vi.fn(),
  status: 'authenticated' as string,
  userId: 'u1',
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig }));
vi.mock('../../services/account-api', () => ({ getNewCustomerOffer: mocks.getNewCustomerOffer }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: { id: string } }) => unknown) => sel({ status: mocks.status, user: { id: mocks.userId } }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { NewCustomerGift } from './new-customer-gift';

// Số cố ý KHÁC mọi mặc định trong mã: nếu khối còn viết cứng 30.000đ/199.000đ/10.000đ/12% thì test đỏ.
const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  affiliateMinWithdrawBank: 50_000,
  cashbackHoldDays: 30,
  newCustomer: {
    welcomeVoucher: { amount: 25_000, minOrder: 150_000 },
    firstOrderFreeShip: { enabled: false, minSubtotal: 0 },
  },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};
const VOUCHER = { code: 'WELCOME-U1', type: 'AMOUNT' as const, value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' };
const OFFER = { isNewCustomer: true, welcomeVoucher: VOUCHER };

function renderGift() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewCustomerGift />
    </QueryClientProvider>,
  );
}
const section = () => screen.findByRole('region', { name: 'Quà khách mới' });

describe('NewCustomerGift — khối "Quà khách mới" ở Trang chủ (D2-07b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.status = 'authenticated';
    mocks.getPublicConfig.mockResolvedValue(CONFIG);
    mocks.getNewCustomerOffer.mockResolvedValue(OFFER);
  });

  it('khách chưa có đơn + có voucher: hiện voucher (mức, đơn tối thiểu, hạn) và 3 lợi ích mua trực tiếp, số đọc từ cấu hình', async () => {
    renderGift();
    const region = await section();
    expect(region).toHaveTextContent('Mã giảm giá chào mừng 25.000đ');
    expect(region).toHaveTextContent('Cho đơn từ 150.000đ');
    expect(region).toHaveTextContent('Dùng đến 17/11/2026');
    expect(region).toHaveTextContent('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(region).toHaveTextContent('Mỗi đơn tích 2% tiền hàng thành Điểm Xanh, 1 điểm = 1.000đ');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
    expect(region.textContent).not.toMatch(/30\.000|199\.000|10\.000đ|12%/);
  });

  it('freeship đơn đầu bật → lợi ích giao hàng nói đơn đầu (kèm ngưỡng nếu có), thay cho ngưỡng freeship thường', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 0 } } });
    const { unmount } = renderGift();
    expect(await section()).toHaveTextContent('Miễn phí giao hàng cho đơn đầu tiên');
    expect(screen.queryByText(/đơn từ 350\.000đ/)).toBeNull();
    unmount();

    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 99_000 } } });
    renderGift();
    expect(await section()).toHaveTextContent('Miễn phí giao hàng cho đơn đầu tiên từ 99.000đ');
  });

  it('voucher không có đơn tối thiểu → không in "Cho đơn từ 0đ"', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: { ...VOUCHER, minOrder: null } });
    renderGift();
    const region = await section();
    expect(region).toHaveTextContent('Mã giảm giá chào mừng 25.000đ');
    expect(region).not.toHaveTextContent('Cho đơn từ');
  });

  it('khách mới nhưng chưa có voucher (cron chưa chạy, khách vãng lai, đã dùng): chỉ còn 3 lợi ích, không có dòng voucher', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null });
    renderGift();
    const region = await section();
    expect(region).not.toHaveTextContent('Mã giảm giá chào mừng');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('khách đã có đơn (theo API) → không hiện gì', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('đang tải ưu đãi: không vẽ gì, kể cả khung chờ (chưa biết có phải khách mới thì chưa chiếm chỗ, để trang không nhảy với khách đã có đơn)', async () => {
    mocks.getNewCustomerOffer.mockReturnValue(new Promise(() => {}));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('new-customer-gift-loading')).toBeNull();
  });

  it('cấu hình công khai đang tải: cũng không vẽ khung chờ', async () => {
    mocks.getPublicConfig.mockReturnValue(new Promise(() => {}));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lỗi tải ưu đãi của khách → ẩn khối (khối quảng bá phụ, không đáng một thẻ lỗi), không bịa số', async () => {
    mocks.getNewCustomerOffer.mockRejectedValue(new Error('boom'));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('cấu hình công khai lỗi → ẩn khối thay vì hiện số mặc định', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('boom'));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('API cũ chưa trả loyalty/newCustomer → lợi ích thiếu số bị bỏ, không bịa', async () => {
    const { loyalty: _l, newCustomer: _n, ...old } = CONFIG;
    mocks.getPublicConfig.mockResolvedValue(old);
    renderGift();
    const region = await section();
    expect(region).not.toHaveTextContent('Điểm Xanh');
    expect(region).toHaveTextContent('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('chưa đăng nhập: không gọi API khách, vẫn hiện 3 lợi ích (không có voucher)', async () => {
    mocks.status = 'idle';
    renderGift();
    const region = await section();
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
    expect(region).not.toHaveTextContent('Mã giảm giá chào mừng');
    expect(mocks.getNewCustomerOffer).not.toHaveBeenCalled();
  });

  it('nút "Chọn sản phẩm" mở trang mua sắm', async () => {
    renderGift();
    await section();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chọn sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });
});
