import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getSubscriptions: vi.fn(), setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
  updateSubscription: vi.fn(), getAddresses: vi.fn(), getWallet: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/subscriptions-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSubscriptions: mocks.getSubscriptions,
  setSubscriptionStatus: mocks.setSubscriptionStatus,
  skipSubscriptionCycle: mocks.skipSubscriptionCycle,
  updateSubscription: mocks.updateSubscription,
}));
vi.mock('../services/shop-api', () => ({
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
  getAddresses: mocks.getAddresses,
}));
vi.mock('../services/account-api', () => ({ getWallet: mocks.getWallet }));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SubscriptionsPanel } from './subscriptions-panel';

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE' as const, nextRunAt: '2026-10-15T00:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD' as const, lastOrderId: null,
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SubscriptionsPanel /></QueryClientProvider>);
}

const ADDR = (id: string, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street,
  provinceCode: '79', districtCode: '760', wardCode: '1', isDefault: id === 'a1',
});

describe('SubscriptionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi'), ADDR('a2', '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });

  it('liệt kê lịch: tên, chu kỳ + tiền, trạng thái, % giảm đang áp', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    renderPanel();
    expect(await screen.findByText('Nước xả vải Tubu')).toBeInTheDocument();
    expect(screen.getByText('Mỗi 4 tuần · 137.600đ')).toBeInTheDocument();
    expect(screen.getByText('Đang chạy')).toBeInTheDocument();
    expect(screen.getByText('Đang giảm 14% cho đơn định kỳ')).toBeInTheDocument();
  });

  // R2-ENGAGE-9
  it('giá mỗi kỳ là giá SAU giảm; giá gốc gạch ngang kèm nhãn tiết kiệm', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, cycleSubtotal: 160000, cycleDiscount: 22400, cycleGoods: 137600 }]);
    renderPanel();
    expect(await screen.findByText('Mỗi 4 tuần · 137.600đ')).toBeInTheDocument();
    const original = screen.getByText('160.000đ');
    expect(original.tagName).toBe('S');
    expect(screen.getByText('Tiết kiệm 14%')).toBeInTheDocument();
    expect(screen.queryByText('Mỗi 4 tuần · 160.000đ')).toBeNull();
  });

  it('API cũ chưa trả cycle*: thẻ tự tính cùng công thức (phần giảm làm tròn xuống)', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, unitPrice: 99_990, quantity: 3, effectiveDiscountPct: 0.14 }]);
    renderPanel();
    expect(await screen.findByText('Mỗi 4 tuần · 257.975đ')).toBeInTheDocument();
    expect(screen.getByText('299.970đ').tagName).toBe('S');
  });

  it('không giảm giá (0%): chỉ hiện giá mỗi kỳ, không gạch ngang, không nhãn tiết kiệm', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, effectiveDiscountPct: 0 }]);
    renderPanel();
    expect(await screen.findByText('Mỗi 4 tuần · 160.000đ')).toBeInTheDocument();
    expect(screen.queryByText(/Tiết kiệm/)).toBeNull();
  });

  it('thẻ hiện cách trả + địa chỉ giao (phân biệt các gói cùng SP khác địa chỉ)', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB, { ...SUB, id: 's2', addressId: 'a2', paymentMethod: 'WALLET' }]);
    renderPanel();
    expect(await screen.findByText('Giao tới: 1 Lê Lợi, P.1, Q.1')).toBeInTheDocument();
    expect(screen.getByText('Giao tới: 9 Hai Bà Trưng, P.1, Q.1')).toBeInTheDocument();
    expect(screen.getByText('Thanh toán: COD')).toBeInTheDocument();
    expect(screen.getByText('Thanh toán: Ví Tubu')).toBeInTheDocument();
  });

  it('"Sửa" mở sheet; đổi số lượng + địa chỉ + cách trả → PATCH chỉ các trường đã đổi', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.updateSubscription.mockResolvedValue({ ...SUB, quantity: 3, addressId: 'a2', paymentMethod: 'BANK_TRANSFER' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    expect(await screen.findByText('Sửa gói định kỳ')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Lưu thay đổi' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { quantity: 3, addressId: 'a2', paymentMethod: 'BANK_TRANSFER' }),
    );
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã cập nhật gói định kỳ', type: 'success' }));
  });

  it('chỉ đổi số lượng → PATCH chỉ có quantity (không gửi lại địa chỉ, không vướng kiểm trùng)', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.updateSubscription.mockResolvedValue({ ...SUB, quantity: 1 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    await screen.findByRole('radio', { name: /1 Lê Lợi/ });
    fireEvent.click(screen.getByRole('button', { name: 'Giảm số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { quantity: 1 }));
  });

  it('gói tạm dừng cũng sửa được; API từ chối (trùng gói 409) → báo lỗi, sheet vẫn mở', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, status: 'PAUSED' as const }]);
    mocks.updateSubscription.mockRejectedValue(new Error('Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.'));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    fireEvent.click(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByText('Sửa gói định kỳ')).toBeInTheDocument();
  });

  it('"Tạm dừng" gọi đổi trạng thái PAUSED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED'));
  });

  it('hàng nút Sửa/Tạm dừng/Huỷ: nút không bị ép chia đều rồi cắt chữ ("Tạm ...") ở 390px, thiếu chỗ thì xuống dòng (ENGAGE-12)', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    renderPanel();
    const row = (await screen.findByRole('button', { name: 'Tạm dừng' })).parentElement as HTMLElement;
    expect(row.style.flexWrap).toBe('wrap');
    for (const name of ['Sửa', 'Tạm dừng', 'Huỷ']) {
      const btn = screen.getByRole('button', { name });
      expect(btn.style.minWidth).toBe('max-content');
    }
  });

  it('"Huỷ" mở sheet giữ chân; "Bỏ qua kỳ này" gọi skip; "Vẫn huỷ" gọi CANCELLED', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
    expect(await screen.findByText('Giữ lại lịch định kỳ?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua kỳ này' }));
    await waitFor(() => expect(mocks.skipSubscriptionCycle).toHaveBeenCalledWith('s1'), { timeout: 5000 });
    // Chờ sheet đầu ĐÓNG hẳn (đang trượt xuống + nút thẻ còn bị khoá) rồi mới mở sheet thứ hai — nếu không,
    // cú bấm "Hủy" thứ hai có thể rơi vào lúc sheet cũ chưa đóng và bị nuốt (flaky khi máy tải nặng).
    await waitFor(() => expect(screen.queryByText('Giữ lại lịch định kỳ?')).not.toBeInTheDocument(), { timeout: 5000 });
    const cancelBtn = await screen.findByRole('button', { name: 'Huỷ' }, { timeout: 5000 });
    await waitFor(() => expect(cancelBtn).toBeEnabled(), { timeout: 5000 });
    fireEvent.click(cancelBtn);
    expect(await screen.findByText('Giữ lại lịch định kỳ?', {}, { timeout: 5000 })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Vẫn huỷ' }, { timeout: 5000 }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED'), { timeout: 5000 });
  }, 20_000);

  it('lịch đang tạm dừng: hiện "Đang tạm dừng", "Tiếp tục" gọi đổi trạng thái ACTIVE', async () => {
    const paused = { ...SUB, status: 'PAUSED' as const };
    mocks.getSubscriptions.mockResolvedValue([paused]);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...paused, status: 'ACTIVE' });
    renderPanel();
    expect(await screen.findByText('Đang tạm dừng')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục' }));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'ACTIVE'));
  });

  it('lỗi tải → ErrorState, "Thử lại" gọi lại danh sách', async () => {
    mocks.getSubscriptions.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([SUB]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /thử lại/i }));
    expect(await screen.findByText('Nước xả vải Tubu')).toBeInTheDocument();
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('chưa có lịch → EmptyState, CTA sang /browse', async () => {
    mocks.getSubscriptions.mockResolvedValue([]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Khám phá sản phẩm' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('không dùng biến CSS cũ', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    const { container } = renderPanel();
    await screen.findByText('Nước xả vải Tubu');
    expect(container.innerHTML).not.toMatch(/--(neutral|leaf|primary|clay)-/);
  });
});
