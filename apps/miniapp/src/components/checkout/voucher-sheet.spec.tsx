import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ getCoupons: vi.fn(), applyCoupon: vi.fn(), removeCoupon: vi.fn(), openSnackbar: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/account-api', () => ({ getCoupons: mocks.getCoupons }));
vi.mock('../../services/shop-api', () => ({ applyCoupon: mocks.applyCoupon, removeCoupon: mocks.removeCoupon }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { VoucherSheet } from './voucher-sheet';

const COUPONS = [
  { code: 'GIAM10', type: 'PERCENT', value: 10, minOrder: null, maxDiscount: 50_000, endAt: '2027-01-01T00:00:00.000Z' },
  { code: 'FREESHIP', type: 'FREESHIP', value: 20_000, minOrder: 500_000, maxDiscount: null, endAt: '2027-01-01T00:00:00.000Z' },
];

function renderSheet(currentCode?: string, extra: { onClose?: () => void; onCouponApplied?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VoucherSheet visible onClose={extra.onClose ?? (() => {})} onCouponApplied={extra.onCouponApplied} currentCode={currentCode} subtotal={100_000} />
    </QueryClientProvider>,
  );
}

const px = (v: string) => Number.parseFloat(v);
// Nút đóng của BottomSheet (IconButton) khai báo vùng chạm bằng min-width/min-height.
const declared = (el: HTMLElement, axis: 'w' | 'h') => Math.max(px(axis === 'w' ? el.style.width : el.style.height) || 0, px(axis === 'w' ? el.style.minWidth : el.style.minHeight) || 0);

describe('VoucherSheet — vùng chạm >= 44px (C-021)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nút đóng (x) vuông tối thiểu 44x44', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet();
    const close = await screen.findByRole('button', { name: 'Đóng' });
    expect(declared(close, 'w')).toBeGreaterThanOrEqual(44);
    expect(declared(close, 'h')).toBeGreaterThanOrEqual(44);
  });

  it('nút "Dùng mã" / "Chưa đủ" / "Bỏ dùng" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS);
    renderSheet('GIAM10');
    const used = await screen.findByRole('button', { name: 'Bỏ dùng' });
    const notEnough = await screen.findByRole('button', { name: 'Chưa đủ' });
    expect(px(used.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(px(notEnough.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('"Dùng mã" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockResolvedValue(COUPONS.slice(0, 1));
    renderSheet();
    const use = await screen.findByRole('button', { name: 'Dùng mã' });
    expect(px(use.style.minHeight)).toBeGreaterThanOrEqual(44);
  });

  it('tải mã lỗi → "Thử lại" cao tối thiểu 44px', async () => {
    mocks.getCoupons.mockRejectedValue(new Error('Mạng lỗi'));
    renderSheet();
    const retry = await screen.findByRole('button', { name: 'Thử lại' });
    expect(px(retry.style.minHeight)).toBeGreaterThanOrEqual(44);
  });
});

describe('VoucherSheet — hành vi (C-076 di cư DS v2: giữ nguyên hành vi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCoupons.mockResolvedValue(COUPONS);
    mocks.applyCoupon.mockResolvedValue({ couponCode: 'GIAM10' });
    mocks.removeCoupon.mockResolvedValue({ couponCode: null });
  });

  it('tiêu đề h2, ghi chú 1 mã/đơn, ô nhập có tên truy cập, mô tả từng loại mã và điều kiện đơn tối thiểu', async () => {
    renderSheet();
    expect(await screen.findByRole('heading', { level: 2, name: 'Chọn mã giảm giá' })).toBeInTheDocument();
    expect(screen.getByText('Mỗi đơn hàng chỉ áp dụng 1 mã giảm giá')).toBeInTheDocument();
    expect(screen.getByLabelText('Nhập mã giảm giá khác')).toBeInTheDocument();
    expect(await screen.findByText('Giảm 10% (tối đa 50.000đ)')).toBeInTheDocument();
    expect(screen.getByText('Miễn phí ship (tối đa 20.000đ)')).toBeInTheDocument();
    expect(screen.getByText('Cần đơn tối thiểu 500.000đ')).toBeInTheDocument();
    expect(screen.getAllByText('HSD: 1/1/2027')).toHaveLength(2);
  });

  it('chạm "Dùng mã" → áp dụng đúng mã, báo thành công, báo cho trang và đóng sheet', async () => {
    const onClose = vi.fn();
    const onCouponApplied = vi.fn();
    renderSheet(undefined, { onClose, onCouponApplied });
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã' }));
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('GIAM10'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCouponApplied).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã áp dụng mã GIAM10', type: 'success' }));
  });

  it('mã chưa đủ điều kiện: nút "Chưa đủ" bị khoá, bấm không gọi API', async () => {
    renderSheet();
    const notEnough = await screen.findByRole('button', { name: 'Chưa đủ' });
    expect(notEnough).toBeDisabled();
    fireEvent.click(notEnough);
    expect(mocks.applyCoupon).not.toHaveBeenCalled();
  });

  it('nhập mã tay: bỏ khoảng trắng + IN HOA; ô trống thì nút "Áp dụng" khoá; Enter cũng áp dụng', async () => {
    renderSheet();
    await screen.findByRole('button', { name: 'Dùng mã' });
    const apply = screen.getByRole('button', { name: 'Áp dụng' });
    expect(apply).toBeDisabled();
    const input = screen.getByLabelText('Nhập mã giảm giá khác');
    fireEvent.change(input, { target: { value: '  welcome ' } });
    expect(apply).toBeEnabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mocks.applyCoupon).toHaveBeenCalledWith('WELCOME'));
  });

  it('mã đang dùng: nhãn "Đang dùng" và "Bỏ dùng" gỡ mã, báo trang nhưng KHÔNG đóng sheet', async () => {
    const onClose = vi.fn();
    const onCouponApplied = vi.fn();
    renderSheet('giam10', { onClose, onCouponApplied });
    expect(await screen.findByText('Đang dùng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ dùng' }));
    await waitFor(() => expect(mocks.removeCoupon).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onCouponApplied).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: 'Đã bỏ mã giảm giá' }));
  });

  it('áp dụng đang chạy: nút của chính mã đó hiện trạng thái đang tải, nút khác bị khoá', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0], { ...COUPONS[0], code: 'KHAC' }]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    const buttons = await screen.findAllByRole('button', { name: 'Dùng mã' });
    fireEvent.click(buttons[0]!);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Dùng mã' })[0]).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getAllByRole('button', { name: 'Dùng mã' })[1]).toBeDisabled();
  });

  it('áp dụng mã trong danh sách: nút "Áp dụng" của ô nhập tay bị khoá, không quay spinner', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0]]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    fireEvent.change(await screen.findByLabelText('Nhập mã giảm giá khác'), { target: { value: 'abc' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Dùng mã' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dùng mã' })).toHaveAttribute('aria-busy', 'true'));
    const manual = screen.getByRole('button', { name: 'Áp dụng' });
    expect(manual).toBeDisabled();
    expect(manual).not.toHaveAttribute('aria-busy');
  });

  it('áp dụng mã nhập tay: nút "Áp dụng" quay spinner, nút "Dùng mã" trong danh sách bị khoá', async () => {
    mocks.getCoupons.mockResolvedValue([COUPONS[0]]);
    mocks.applyCoupon.mockReturnValue(new Promise(() => {}));
    renderSheet();
    await screen.findByRole('button', { name: 'Dùng mã' });
    fireEvent.change(screen.getByLabelText('Nhập mã giảm giá khác'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Áp dụng' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Dùng mã' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dùng mã' })).not.toHaveAttribute('aria-busy');
  });

  it('không có mã nào → trạng thái trống hướng dẫn nhập tay', async () => {
    mocks.getCoupons.mockResolvedValue([]);
    renderSheet();
    expect(await screen.findByText('Bạn chưa có mã giảm giá trong ví')).toBeInTheDocument();
    expect(screen.getByText('Nhập mã giảm giá thủ công ở phía trên để áp dụng.')).toBeInTheDocument();
  });

  it('tải lỗi → hiện lý do và "Thử lại" tải lại được', async () => {
    mocks.getCoupons.mockRejectedValueOnce(new Error('Mạng lỗi')).mockResolvedValue(COUPONS);
    renderSheet();
    expect(await screen.findByText(/Không thể tải danh sách mã giảm giá/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText('GIAM10')).toBeInTheDocument();
  });

  it('nút đóng gọi onClose', async () => {
    const onClose = vi.fn();
    renderSheet(undefined, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Đóng' }));
    expect(onClose).toHaveBeenCalled();
  });
});
