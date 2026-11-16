import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  getPublicConfig: vi.fn(),
  getNewCustomerOffer: vi.fn(),
  fetchHasAnyOrder: vi.fn(),
  status: 'authenticated' as string,
  userId: 'u1',
  guest: false,
  ensurePhone: vi.fn(),
}));
const flags = vi.hoisted(() => ({ subscriptions: true }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/features', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  get SUBSCRIPTIONS_IN_MINIAPP() {
    return flags.subscriptions;
  },
}));
vi.mock('../../services/shop-api', () => ({ getPublicConfig: mocks.getPublicConfig, fetchHasAnyOrder: mocks.fetchHasAnyOrder }));
vi.mock('../../services/account-api', () => ({ getNewCustomerOffer: mocks.getNewCustomerOffer }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({
      status: mocks.status,
      user: { id: mocks.userId, phone: mocks.guest ? null : '0901234567', zaloId: mocks.guest ? 'guest_1' : 'z1' },
      ensurePhoneOrThrow: mocks.ensurePhone,
    }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { HOME_GIFT_HEIGHT } from '@tubutree/app-core/home-layout';
import { NewCustomerGift } from './new-customer-gift';
import { HttpError } from '../../services/http';

// Số cố ý KHÁC mọi mặc định trong mã: nếu khối còn viết cứng 30.000đ/199.000đ/10.000đ/12% thì test đỏ.
const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  cashbackHoldDays: 30,
  newCustomer: {
    welcomeVoucher: { amount: 25_000, minOrder: 150_000 },
    firstOrderFreeShip: { enabled: false, minSubtotal: 0 },
  },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};
const VOUCHER = { code: 'WELCOME-U1', type: 'AMOUNT' as const, value: 25_000, minOrder: 150_000, endAt: '2026-11-17T10:00:00.000Z' };
const OFFER = { isNewCustomer: true, welcomeVoucher: VOUCHER };

function renderGift(fallback?: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewCustomerGift fallback={fallback} />
    </QueryClientProvider>,
  );
}
const section = () => screen.findByRole('region', { name: 'Quà khách mới' });
/** Dải gọn chỉ hiện tóm tắt; chi tiết (mã, hạn, lợi ích) mở bằng "Xem quyền lợi". */
const expanded = async () => {
  const region = await section();
  await userEvent.click(within(region).getByRole('button', { name: /Xem quyền lợi/ }));
  return region;
};

describe('NewCustomerGift — khối "Quà khách mới" ở Trang chủ (D2-07b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.subscriptions = true;
    mocks.status = 'authenticated';
    mocks.guest = false;
    mocks.fetchHasAnyOrder.mockResolvedValue(false);
    mocks.getPublicConfig.mockResolvedValue(CONFIG);
    mocks.getNewCustomerOffer.mockResolvedValue(OFFER);
  });

  it('dải gọn: tóm tắt mã chào mừng trên một dòng, chưa mở chi tiết', async () => {
    renderGift();
    const region = await section();
    expect(region).toHaveTextContent('Mã 25.000đ · cho đơn từ 150.000đ');
    expect(region).not.toHaveTextContent('Dùng đến');
    expect(region).not.toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('thu gọn là MỘT hàng cao đúng HOME_GIFT_HEIGHT (64): biểu tượng, tiêu đề, câu lợi ích cắt "…" một dòng và nút cùng hàng; không dòng thứ ba', async () => {
    renderGift();
    const region = await section();
    const headline = Array.from(region.querySelectorAll<HTMLElement>('div')).find((d) => d.textContent === 'Mã 25.000đ · cho đơn từ 150.000đ')!;
    const cta = Array.from(region.querySelectorAll('button')).find((b) => b.textContent?.includes('Chọn sản phẩm'))!;
    expect(HOME_GIFT_HEIGHT).toBe(64);
    expect(headline).toHaveStyle({ whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' });
    expect(headline.style.getPropertyValue('-webkit-line-clamp')).toBe('');
    // Nút nằm cùng hàng với chữ: cha chung là hàng cao cố định 64, không phải khối chữ.
    const row = cta.parentElement as HTMLElement;
    expect(row.contains(headline)).toBe(true);
    expect(row.style.height).toBe(`${HOME_GIFT_HEIGHT}px`);
    expect(row.style.boxSizing).toBe('border-box');
    expect(region.querySelector('[style*="min-height: 64"]')).toBeNull();
  });

  it('nút bật mở chi tiết vẫn có vùng chạm cao 44 và thu gọn không đổi chiều cao hàng', async () => {
    renderGift();
    const region = await section();
    const toggle = within(region).getByRole('button', { name: /Xem quyền lợi/ });
    expect(toggle.style.minHeight).toBe('44px');
    const row = toggle.parentElement as HTMLElement;
    await userEvent.click(toggle);
    expect(row.style.height).toBe(`${HOME_GIFT_HEIGHT}px`);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('khách chưa có đơn + có voucher: hiện voucher (mức, đơn tối thiểu, hạn) và các lợi ích mua trực tiếp, kể cả Đặt định kỳ vì Mini App đã bật định kỳ; số đọc từ cấu hình', async () => {
    renderGift();
    const region = await expanded();
    expect(region).toHaveTextContent('Mã giảm giá chào mừng 25.000đ');
    expect(region).toHaveTextContent('Cho đơn từ 150.000đ');
    expect(region).toHaveTextContent('Dùng đến 17/11/2026');
    expect(region).toHaveTextContent('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(region).toHaveTextContent('Mỗi đơn tích 2% tiền hàng thành Điểm Xanh, 1 điểm = 1.000đ');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
    expect(region.textContent).not.toMatch(/30\.000|199\.000|10\.000đ|12%/);
  });

  it('cờ giao định kỳ ở Mini App tắt: lợi ích không có dòng Đặt định kỳ (công tắc ẩn lối vào)', async () => {
    flags.subscriptions = false;
    renderGift();
    const region = await expanded();
    expect(region).toHaveTextContent('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(region).not.toHaveTextContent('Đặt định kỳ');
  });

  it('freeship đơn đầu bật → lợi ích giao hàng nói đơn đầu (kèm ngưỡng nếu có), thay cho ngưỡng freeship thường', async () => {
    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 0 } } });
    const { unmount } = renderGift();
    expect(await expanded()).toHaveTextContent('Miễn phí giao hàng cho đơn đầu tiên');
    expect(screen.queryByText(/đơn từ 350\.000đ/)).toBeNull();
    unmount();

    mocks.getPublicConfig.mockResolvedValue({ ...CONFIG, newCustomer: { ...CONFIG.newCustomer, firstOrderFreeShip: { enabled: true, minSubtotal: 99_000 } } });
    renderGift();
    expect(await expanded()).toHaveTextContent('Miễn phí giao hàng cho đơn đầu tiên từ 99.000đ');
  });

  it('voucher phần trăm và miễn phí giao: tên mã không lặp chữ "giảm"', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ ...OFFER, welcomeVoucher: { ...VOUCHER, type: 'PERCENT', value: 12 } });
    const { unmount } = renderGift();
    expect(await expanded()).toHaveTextContent('Mã giảm giá chào mừng 12%');
    expect(await section()).not.toHaveTextContent(/giảm giá chào mừng giảm/);
    unmount();
    mocks.getNewCustomerOffer.mockResolvedValue({ ...OFFER, welcomeVoucher: { ...VOUCHER, type: 'FREESHIP', value: 0 } });
    renderGift();
    expect(await expanded()).toHaveTextContent('Mã miễn phí giao hàng chào mừng');
  });

  it('voucher không có đơn tối thiểu → không in "Cho đơn từ 0đ"', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: { ...VOUCHER, minOrder: null } });
    renderGift();
    const region = await expanded();
    expect(region).toHaveTextContent('Mã giảm giá chào mừng 25.000đ');
    expect(region).not.toHaveTextContent('Cho đơn từ');
  });

  it('khách mới nhưng chưa có voucher (cron chưa chạy, khách vãng lai, đã dùng): chỉ còn các lợi ích, không có dòng voucher', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null });
    renderGift();
    const region = await expanded();
    expect(region).not.toHaveTextContent('Mã giảm giá chào mừng');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('khách đã có đơn (theo API) → không hiện gì', async () => {
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('đang tải ưu đãi: giữ chỗ bằng khung chờ cao bằng dải thật, không hiện số suy đoán', async () => {
    mocks.getNewCustomerOffer.mockReturnValue(new Promise(() => {}));
    renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    expect(screen.getByTestId('new-customer-gift-loading')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
  });

  it('cấu hình công khai đang tải: cũng giữ chỗ bằng khung chờ', async () => {
    mocks.getPublicConfig.mockReturnValue(new Promise(() => {}));
    renderGift();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    expect(screen.getByTestId('new-customer-gift-loading')).toBeInTheDocument();
  });

  it('lỗi tải ưu đãi của khách → ẩn khối (khối quảng bá phụ, không đáng một thẻ lỗi), không bịa số', async () => {
    mocks.getNewCustomerOffer.mockRejectedValue(new Error('boom'));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getNewCustomerOffer).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('cấu hình công khai lỗi → ẩn khối thay vì hiện số mặc định', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('boom'));
    const { container } = renderGift();
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('API cũ chưa trả loyalty/newCustomer → lợi ích thiếu số bị bỏ, không bịa', async () => {
    const { loyalty: _l, newCustomer: _n, ...old } = CONFIG;
    mocks.getPublicConfig.mockResolvedValue(old);
    renderGift();
    const region = await expanded();
    expect(region).not.toHaveTextContent('Điểm Xanh');
    expect(region).toHaveTextContent('Miễn phí giao hàng cho đơn từ 350.000đ');
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
  });

  it('chưa đăng nhập: không gọi API khách, vẫn hiện lợi ích (không có voucher)', async () => {
    mocks.status = 'idle';
    renderGift();
    const region = await expanded();
    expect(region).toHaveTextContent('Đặt định kỳ giảm 17% mỗi đơn');
    expect(region).not.toHaveTextContent('Mã giảm giá chào mừng');
    expect(mocks.getNewCustomerOffer).not.toHaveBeenCalled();
  });

  it('tài khoản khách Mini App (chưa liên kết Zalo): hứa mã theo cấu hình, không gọi API khách, nút liên kết Zalo gọi ensurePhoneOrThrow', async () => {
    mocks.guest = true;
    mocks.ensurePhone.mockResolvedValue('0901234567');
    renderGift();
    const region = await expanded();
    expect(region).toHaveTextContent('Mã giảm giá chào mừng 25.000đ');
    expect(region).toHaveTextContent('Liên kết Zalo để nhận mã và giữ điểm');
    expect(mocks.getNewCustomerOffer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Nhận quà bằng Zalo' }));
    expect(mocks.ensurePhone).toHaveBeenCalled();
  });

  it('liên kết Zalo bị máy chủ từ chối (409): hiện lời máy chủ; khách từ chối sheet (null) thì hiện câu chung', async () => {
    mocks.guest = true;
    mocks.ensurePhone.mockRejectedValueOnce(new HttpError('conflict', undefined, { status: 409, data: { message: 'Số điện thoại này đã gắn với tài khoản Zalo khác.' } }));
    renderGift();
    await section();
    await userEvent.click(screen.getByRole('button', { name: 'Nhận quà bằng Zalo' }));
    expect(await screen.findByText('Số điện thoại này đã gắn với tài khoản Zalo khác.')).toBeInTheDocument();
    mocks.ensurePhone.mockResolvedValueOnce(null);
    await userEvent.click(screen.getByRole('button', { name: 'Nhận quà bằng Zalo' }));
    expect(await screen.findByText('Chưa liên kết được Zalo. Bạn thử lại sau nhé.')).toBeInTheDocument();
  });

  it('tài khoản khách đã có đơn: không hứa quà chào mừng (khối ẩn hẳn)', async () => {
    mocks.guest = true;
    mocks.fetchHasAnyOrder.mockResolvedValue(true);
    const { container } = renderGift();
    await waitFor(() => expect(mocks.fetchHasAnyOrder).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
  });

  it('tài khoản khách: chưa biết có đơn hay không thì chưa hứa gì (chỉ khung chờ)', async () => {
    mocks.guest = true;
    mocks.fetchHasAnyOrder.mockReturnValue(new Promise(() => {}));
    renderGift();
    await waitFor(() => expect(mocks.fetchHasAnyOrder).toHaveBeenCalled());
    expect(screen.getByTestId('new-customer-gift-loading')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
  });

  it('khách không còn ưu đãi (đã có đơn, lỗi tải ưu đãi, lỗi cấu hình): vẽ fallback thay vì để dải trống; đang tải thì vẫn là khung chờ, chưa vẽ fallback', async () => {
    const fb = <section aria-label="Thẻ thành viên" />;
    mocks.getNewCustomerOffer.mockResolvedValue({ isNewCustomer: false, welcomeVoucher: null });
    const a = renderGift(fb);
    expect(screen.getByTestId('new-customer-gift-loading')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Thẻ thành viên' })).toBeNull();
    expect(await screen.findByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Quà khách mới' })).toBeNull();
    a.unmount();

    mocks.getNewCustomerOffer.mockRejectedValue(new Error('boom'));
    const b = renderGift(fb);
    expect(await screen.findByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
    b.unmount();

    mocks.getNewCustomerOffer.mockResolvedValue(OFFER);
    mocks.getPublicConfig.mockRejectedValue(new Error('boom'));
    renderGift(fb);
    expect(await screen.findByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
  });

  it('tài khoản khách đã có đơn: cũng vẽ fallback', async () => {
    mocks.guest = true;
    mocks.fetchHasAnyOrder.mockResolvedValue(true);
    renderGift(<section aria-label="Thẻ thành viên" />);
    expect(await screen.findByRole('region', { name: 'Thẻ thành viên' })).toBeInTheDocument();
  });

  it('nút "Chọn sản phẩm" mở trang mua sắm', async () => {
    renderGift();
    await section();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Chọn sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });
});
