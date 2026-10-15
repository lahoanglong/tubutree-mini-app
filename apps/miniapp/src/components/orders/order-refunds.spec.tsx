import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(),
  fetchMyRefunds: vi.fn(),
  fetchRefundBank: vi.fn(),
  chooseRefundDestination: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchMyRefunds: mocks.fetchMyRefunds,
  fetchRefundBank: mocks.fetchRefundBank,
  chooseRefundDestination: mocks.chooseRefundDestination,
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { OrderRefunds } from './order-refunds';

const LATE = {
  id: 'r1',
  orderId: 'o1',
  orderCode: 'TB1',
  kind: 'LATE_PAYMENT',
  amount: 197_000,
  method: 'MANUAL_TRANSFER',
  status: 'PENDING',
  bankName: null,
  bankAccountNo: null,
  bankAccountName: null,
  bankRef: null,
  completedAt: null,
  createdAt: '2026-10-14T00:00:00Z',
  canChooseDestination: true,
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderRefunds orderId="o1" />
    </QueryClientProvider>,
  );
}

describe('OrderRefunds (D2: khách thấy và chọn nơi nhận khoản hoàn)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefundBank.mockResolvedValue(null);
  });

  it('không có khoản hoàn → không hiện gì', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([]);
    const { container } = renderPanel();
    await waitFor(() => expect(mocks.fetchMyRefunds).toHaveBeenCalledWith('o1'));
    expect(container.textContent).toBe('');
  });

  it('BUYERMINI-7: tiền về muộn → nhắc chọn nơi nhận; chọn Ví Tubu gọi API và báo đã hoàn', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([LATE]);
    mocks.chooseRefundDestination.mockResolvedValue({ ...LATE, method: 'WALLET', status: 'COMPLETED', canChooseDestination: false });
    renderPanel();
    expect(await screen.findByText(/Tiền về sau khi đơn đã huỷ: chờ bạn chọn nơi nhận/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chọn nơi nhận tiền' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Xác nhận' }));
    await waitFor(() => expect(mocks.chooseRefundDestination).toHaveBeenCalledWith('r1', { refundMethod: 'WALLET' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã hoàn 197.000đ vào Ví Tubu.', type: 'success' });
  });

  it('R2-LIFECYCLE-5: đơn huỷ đã hoàn thẳng vào Ví → "đã hoàn vào Ví Tubu" kèm số tiền, không có nút chọn nơi nhận', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([
      { ...LATE, kind: 'CANCEL', amount: 95_000, method: 'WALLET', status: 'COMPLETED', completedAt: '2026-10-14T03:05:00Z', canChooseDestination: false },
    ]);
    renderPanel();
    expect(await screen.findByText('Hoàn tiền huỷ đơn: đã hoàn vào Ví Tubu · 95.000đ')).toBeInTheDocument();
    expect(screen.getByText(/^Đã cộng vào Ví Tubu lúc/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('R3-MONEY-1: tiền trả dư → nói rõ và cho chọn nơi nhận', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([{ ...LATE, kind: 'OVERPAYMENT', amount: 114_000 }]);
    renderPanel();
    expect(await screen.findByText('Tiền bạn trả dư: chờ bạn chọn nơi nhận · 114.000đ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chọn nơi nhận tiền' })).toBeInTheDocument();
  });

  it('chọn ngân hàng thiếu số tài khoản → báo lỗi, không gọi API', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([LATE]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Chọn nơi nhận tiền' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Tài khoản ngân hàng/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    expect(await screen.findByText('Vui lòng nhập tên ngân hàng.')).toBeInTheDocument();
    expect(mocks.chooseRefundDestination).not.toHaveBeenCalled();
  });

  it('đã chuyển khoản → hiện tài khoản che số và mã giao dịch, không còn nút chọn', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([
      { ...LATE, kind: 'CANCEL', status: 'COMPLETED', bankName: 'VCB', bankAccountNo: '0071000123456', bankRef: 'FT9', canChooseDestination: false },
    ]);
    renderPanel();
    expect(await screen.findByText('Về VCB ••• 3456 · Mã GD FT9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /nơi nhận/ })).toBeNull();
  });
});
