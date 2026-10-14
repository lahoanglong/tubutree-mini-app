import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), requestReturn: vi.fn(), fetchRefundBank: vi.fn(), estimateReturn: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  requestReturn: mocks.requestReturn,
  fetchRefundBank: mocks.fetchRefundBank,
  estimateReturn: mocks.estimateReturn,
}));
vi.mock('../image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { ReturnRequestSheet } from './return-request-sheet';

const ORDER = {
  id: 'o1',
  code: 'TB1',
  status: 'DELIVERED',
  paymentMethod: 'COD',
  paymentStatus: 'UNPAID',
  total: 282_000,
  items: [
    { id: 'i1', productName: 'Nước giặt', variationName: 'Chai 1L', quantity: 3, total: 267_000 },
    { id: 'i2', productName: 'Xịt khoáng', variationName: 'Chai 100ml', quantity: 1, total: 0 },
  ],
} as never;

function renderSheet(returns: unknown[] = [], onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ReturnRequestSheet open onClose={onClose} order={ORDER} returns={returns as never} returnDays={7} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('ReturnRequestSheet (D3: trả theo dòng và số lượng)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestReturn.mockResolvedValue({ id: 'r1' });
    mocks.fetchRefundBank.mockResolvedValue({ bankName: 'Techcombank', accountNumber: '190312345678', accountName: 'NGUYEN VAN A' });
    mocks.estimateReturn.mockResolvedValue({ refund: 0, goods: 0, shipping: 0, isFull: false, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  });

  it('BUYERMINI-11: chọn 1/3 chai + lý do chọn sẵn → gửi đúng dòng, số lượng, mã lý do, nhận về Ví', async () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm lỗi, hỏng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    await waitFor(() =>
      expect(mocks.requestReturn).toHaveBeenCalledWith('TB1', {
        reasonCode: 'DEFECTIVE',
        reason: undefined,
        images: [],
        items: [{ orderItemId: 'i1', quantity: 1 }],
        refundMethod: 'WALLET',
      }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('tăng số lượng tới số còn trả được; dòng đã trả hết không hiện', async () => {
    renderSheet([{ orderId: 'o1', status: 'APPROVED', items: [{ orderItemId: 'i2', quantity: 1 }] }]);
    expect(screen.queryByText('Xịt khoáng')).toBeNull();
    // Một dòng còn lại → chọn sẵn, có bộ chọn số lượng.
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Giao sai sản phẩm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    await waitFor(() => expect(mocks.requestReturn).toHaveBeenCalled());
    expect(mocks.requestReturn.mock.calls[0]![1].items).toEqual([{ orderItemId: 'i1', quantity: 3 }]);
  });

  it('chưa chọn sản phẩm / "Lý do khác" thiếu mô tả → báo lỗi, không gửi', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chọn ít nhất một sản phẩm muốn trả.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Xịt khoáng Chai 100ml' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lý do khác' }));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Mô tả lý do (tối thiểu 5 ký tự).');
    expect(mocks.requestReturn).not.toHaveBeenCalled();
  });

  it('MONEY-9: chọn hoàn về tài khoản ngân hàng → điền sẵn tài khoản gần nhất và gửi kèm', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bể vỡ, móp méo khi vận chuyển' }));
    const group = screen.getByRole('radiogroup', { name: 'Nơi nhận tiền hoàn' });
    fireEvent.click(within(group).getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    await waitFor(() => expect(screen.getByLabelText('Số tài khoản')).toHaveValue('190312345678'));
    fireEvent.click(screen.getByRole('button', { name: 'Gửi yêu cầu' }));
    await waitFor(() => expect(mocks.requestReturn).toHaveBeenCalled());
    expect(mocks.requestReturn.mock.calls[0]![1]).toMatchObject({
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '190312345678',
      accountName: 'NGUYEN VAN A',
    });
  });

  it('R2-LIFECYCLE-7: chạm vào tên sản phẩm cũng chọn/bỏ chọn dòng đó', () => {
    renderSheet();
    const box = screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' });
    expect(box).not.toBeChecked();
    fireEvent.click(screen.getByText('Nước giặt'));
    expect(box).toBeChecked();
    fireEvent.click(screen.getByText('Nước giặt'));
    expect(box).not.toBeChecked();
  });

  it('R2-BUYERMINI-7: hiện số tiền dự kiến hoàn cho dòng/số lượng/lý do đang chọn, cập nhật khi đổi số lượng', async () => {
    mocks.estimateReturn.mockImplementation(async (_code: string, body: { items: { quantity: number }[]; reasonCode?: string }) => {
      const q = body.items[0]!.quantity;
      const ship = body.reasonCode === 'DEFECTIVE' ? 15_000 : 0;
      return { refund: 89_000 * q + ship, goods: 89_000 * q, shipping: ship, isFull: false, moneyRefundable: true, pointsUsedBack: 0, lines: [] };
    });
    renderSheet();
    expect(screen.queryByText(/Dự kiến hoàn/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    expect(await screen.findByText('Dự kiến hoàn 89.000đ')).toBeInTheDocument();
    expect(mocks.estimateReturn).toHaveBeenLastCalledWith('TB1', { items: [{ orderItemId: 'i1', quantity: 1 }], reasonCode: undefined });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(await screen.findByText('Dự kiến hoàn 178.000đ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm lỗi, hỏng' }));
    expect(await screen.findByText('Dự kiến hoàn 193.000đ')).toBeInTheDocument();
    expect(screen.getByText(/gồm 15.000đ phí vận chuyển/)).toBeInTheDocument();
  });
});
