import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ openSnackbar: vi.fn(), requestReturn: vi.fn(), fetchRefundBank: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({ requestReturn: mocks.requestReturn, fetchRefundBank: mocks.fetchRefundBank }));
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
});
