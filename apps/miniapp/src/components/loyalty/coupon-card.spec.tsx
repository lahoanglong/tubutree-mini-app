import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  getCart: vi.fn(),
  applyCoupon: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => (sel ? sel({ status: 'authenticated' }) : { status: 'authenticated' }),
}));
vi.mock('../../services/shop-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCart: mocks.getCart,
  applyCoupon: mocks.applyCoupon,
}));
vi.mock('../../utils/clipboard', () => ({ copyText: mocks.copyText }));

import { CouponCard } from './coupon-card';

const COUPON = { code: 'TUBU10', type: 'AMOUNT', value: 10000, minOrder: 99000, maxDiscount: null, endAt: '2026-12-31T05:00:00Z' } as never;

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CouponCard coupon={COUPON} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCart.mockResolvedValue({ itemCount: 0 });
  mocks.applyCoupon.mockResolvedValue({ couponCode: 'TUBU10', discount: 10000, freeship: false });
  mocks.copyText.mockResolvedValue(true);
});

describe('CouponCard — Sao chép và Dùng ngay (B-55)', () => {
  it('"Sao chép" chép đúng mã và báo "Đã sao chép mã"', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã TUBU10' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã sao chép mã', type: 'success' }));
    expect(mocks.copyText).toHaveBeenCalledWith('TUBU10');
  });

  it('không chép được thì báo lỗi, không báo "Đã sao chép mã"', async () => {
    mocks.copyText.mockResolvedValue(false);
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Sao chép mã TUBU10' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(mocks.openSnackbar).not.toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã sao chép mã' }));
  });

  it('"Dùng ngay" khi giỏ có hàng: chọn sẵn mã ở giỏ rồi tới giỏ', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 3 });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    expect(mocks.applyCoupon).toHaveBeenCalledWith('TUBU10');
  });

  it('"Dùng ngay" bấm khi giỏ còn đang tải: chờ giỏ về rồi mới quyết (giỏ có hàng → giỏ, không bị coi là trống)', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.getCart.mockImplementation(() => new Promise((r) => { release = r; }));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' }));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.navigate).not.toHaveBeenCalled();
    release({ itemCount: 2, couponCode: null });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
  });

  it('chạm đúp "Dùng ngay": chỉ áp mã và chuyển trang một lần', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 2, couponCode: null });
    renderCard();
    const btn = screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.applyCoupon).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it('giỏ đang giữ mã khác: sau khi áp báo "Đã đổi sang mã TUBU10"', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 2, couponCode: 'FREESHIP1' });
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã đổi sang mã TUBU10', type: 'info' });
  });

  it('"Dùng ngay" khi giỏ trống: tới danh sách sản phẩm, không áp mã', async () => {
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/browse'));
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('mã chưa chọn sẵn được (máy chủ từ chối): vẫn tới giỏ và nói lý do', async () => {
    mocks.getCart.mockResolvedValue({ itemCount: 1 });
    mocks.applyCoupon.mockRejectedValue(new Error('rejected'));
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Dùng mã TUBU10 ngay' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/cart'));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: expect.stringContaining('Chưa chọn sẵn được mã: '), type: 'warning' });
  });
});
