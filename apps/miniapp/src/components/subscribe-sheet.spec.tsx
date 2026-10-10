import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getAddresses: vi.fn(), getWallet: vi.fn(), createSubscription: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  getAddresses: mocks.getAddresses,
  getPublicConfig: vi.fn().mockResolvedValue({ subscribeDiscountPct: 0.12 }),
}));
vi.mock('../services/account-api', () => ({ getWallet: mocks.getWallet }));
vi.mock('../services/subscriptions-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createSubscription: mocks.createSubscription,
}));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { SubscribeSheet } from './subscribe-sheet';

const ADDR = (id: string, isDefault: boolean, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street,
  provinceCode: '79', districtCode: '760', wardCode: '1', isDefault,
});
const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-07T00:00:00.000Z',
  productName: 'Nước xả vải', variationName: 'Sả', thumbnail: null, slug: null, unitPrice: 80000, effectiveDiscountPct: 0.12,
};

function renderSheet(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SubscribeSheet visible onClose={onClose} variationId="v1" quantity={2} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('SubscribeSheet (C-015: ngày bắt đầu + cách trả + địa chỉ)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    mocks.getAddresses.mockResolvedValue([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 300000 });
  });
  afterEach(() => vi.useRealTimers());

  it('mặc định giao ngay, COD, địa chỉ mặc định → không gửi startDate; báo mã đơn đầu', async () => {
    mocks.createSubscription.mockResolvedValue({
      ...SUB, firstOrder: { id: 'o1', code: 'TB-1', status: 'PENDING', paymentMethod: 'COD', total: 160000 },
    });
    const { onClose } = renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('button', { name: 'Giao ngay' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() =>
      expect(mocks.createSubscription).toHaveBeenCalledWith({
        variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a2', paymentMethod: 'COD',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('TB-1'), type: 'success' }));
  });

  it('chọn ngày bắt đầu + Ví Tubu + địa chỉ khác + chu kỳ 6 tuần → gửi đúng startDate/paymentMethod/addressId', async () => {
    mocks.createSubscription.mockResolvedValue({ ...SUB, firstOrder: null });
    renderSheet();
    await screen.findByRole('radio', { name: /1 Lê Lợi/ });
    fireEvent.click(screen.getByRole('button', { name: '6 tuần' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày' }));
    const date = screen.getByLabelText('Ngày bắt đầu giao') as HTMLInputElement;
    expect(date.min).toBe('2026-10-11');
    expect(date.max).toBe('2026-12-09');
    fireEvent.change(date, { target: { value: '2026-10-20' } });
    fireEvent.click(await screen.findByRole('radio', { name: /Ví Tubu \(300\.000đ\)/ }));
    fireEvent.click(screen.getByRole('radio', { name: /1 Lê Lợi/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() =>
      expect(mocks.createSubscription).toHaveBeenCalledWith({
        variationId: 'v1', quantity: 2, intervalWeeks: 6, addressId: 'a1', paymentMethod: 'WALLET', startDate: '2026-10-20',
      }),
    );
    await waitFor(() =>
      expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('20/10/2026') })),
    );
  });

  it('ngày ngoài khoảng (hôm nay) → báo lỗi, khoá nút tạo', async () => {
    renderSheet();
    await screen.findByRole('radio', { name: /1 Lê Lợi/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày' }));
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu giao'), { target: { value: '2026-10-10' } });
    expect(screen.getByText(/Ngày bắt đầu phải từ ngày mai/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' })).toBeDisabled();
    expect(mocks.createSubscription).not.toHaveBeenCalled();
  });

  it('chuyển khoản: đơn đầu chờ thanh toán → mở trang chuyển khoản của đơn', async () => {
    mocks.createSubscription.mockResolvedValue({
      ...SUB, firstOrder: { id: 'o2', code: 'TB-2', status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', total: 160000 },
    });
    renderSheet();
    await screen.findByRole('radio', { name: /1 Lê Lợi/ });
    fireEvent.click(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/bank-payment/TB-2'));
    expect(mocks.createSubscription.mock.calls[0][0].paymentMethod).toBe('BANK_TRANSFER');
  });

  it('API từ chối (Ví thiếu) → hiện lỗi, sheet vẫn mở', async () => {
    mocks.createSubscription.mockRejectedValue(new Error('Số dư Ví Tubu không đủ'));
    const { onClose } = renderSheet();
    await screen.findByRole('radio', { name: /1 Lê Lợi/ });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('chưa có địa chỉ → nút "Thêm địa chỉ" sang /addresses, không có nút tạo', async () => {
    mocks.getAddresses.mockResolvedValue([]);
    const { onClose } = renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Thêm địa chỉ' }));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/addresses');
    expect(screen.queryByRole('button', { name: 'Bắt đầu đặt định kỳ' })).not.toBeInTheDocument();
  });
});
