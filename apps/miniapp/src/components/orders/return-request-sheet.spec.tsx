import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
vi.mock('../image-upload', () => ({
  MultiImageUpload: ({
    value,
    onChange,
    onBusyChange,
    disabled,
  }: {
    value: string[];
    onChange: (v: string[]) => void;
    onBusyChange?: (busy: boolean) => void;
    disabled?: boolean;
  }) => (
    <>
      <button type="button" disabled={disabled} onClick={() => onChange([...value, 'https://i/them.jpg'])}>
        Thêm ảnh thử
      </button>
      <button type="button" disabled={disabled} onClick={() => onChange(value.slice(0, -1))}>
        Xoá ảnh thử
      </button>
      <button type="button" onClick={() => onBusyChange?.(true)}>
        Bắt đầu tải ảnh thử
      </button>
      <button
        type="button"
        onClick={() => {
          onChange([...value, 'https://i/minh-chung.jpg']);
          onBusyChange?.(false);
        }}
      >
        Tải xong ảnh thử
      </button>
    </>
  ),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { HttpError } from '../../services/http';
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Bạn mô tả lý do đổi/trả (ít nhất 5 ký tự) nhé.');
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

describe('ReturnRequestSheet: gửi yêu cầu khoá chạm đúp, báo bận, số đều (W69A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requestReturn.mockResolvedValue({ id: 'r1' });
    mocks.fetchRefundBank.mockResolvedValue(null);
    mocks.estimateReturn.mockResolvedValue({ refund: 89_000, goods: 89_000, shipping: 0, isFull: false, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  });

  const fillForm = () => {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm lỗi, hỏng' }));
  };
  const submitButton = () => screen.getByRole('button', { name: 'Gửi yêu cầu' });
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp "Gửi yêu cầu" trong cùng một khung hình chỉ gửi một yêu cầu', async () => {
    const d = deferred();
    mocks.requestReturn.mockReturnValueOnce(d.promise);
    const { onClose } = renderSheet();
    fillForm();
    await act(async () => {
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
    });
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ id: 'r1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('đang gửi: nút báo aria-busy và aria-disabled, chạm thêm không gửi lần nữa', async () => {
    const d = deferred();
    mocks.requestReturn.mockReturnValueOnce(d.promise);
    renderSheet();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-busy', 'true'));
    expect(submitButton()).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(submitButton());
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve({ id: 'r1' }));
  });

  it('gửi lỗi: báo lỗi, không đóng sheet, khoá nhả nên bấm lại gửi được', async () => {
    mocks.requestReturn.mockRejectedValueOnce(new Error('boom'));
    const { onClose } = renderSheet();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy'));
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.requestReturn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('đang gửi: tấm không đóng được (nút Đóng biến mất, Esc không đóng); gửi xong thì đóng như cũ', async () => {
    const d = deferred();
    mocks.requestReturn.mockReturnValueOnce(d.promise);
    const { onClose } = renderSheet();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => d.resolve({ id: 'r1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('đang tải ảnh minh chứng: nút gửi khoá và đổi nhãn, chạm không gửi yêu cầu thiếu ảnh; tải xong gửi kèm ảnh vừa tải (W85A)', async () => {
    renderSheet();
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu tải ảnh thử' }));
    const waiting = screen.getByRole('button', { name: 'Đang tải ảnh…' });
    expect(waiting).toBeDisabled();
    fireEvent.click(waiting);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mocks.requestReturn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Tải xong ảnh thử' }));
    expect(submitButton()).not.toBeDisabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.requestReturn).toHaveBeenCalledTimes(1));
    expect(mocks.requestReturn.mock.calls[0]![1].images).toEqual(['https://i/minh-chung.jpg']);
  });

  it('đang gửi: ô thêm ảnh và nút xoá ảnh khoá, không đổi nhãn nút Gửi sang "Đang tải ảnh…"', async () => {
    const d = deferred();
    mocks.requestReturn.mockReturnValueOnce(d.promise);
    renderSheet();
    fillForm();
    expect(screen.getByRole('button', { name: 'Thêm ảnh thử' })).not.toBeDisabled();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Thêm ảnh thử' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Xoá ảnh thử' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Đang tải ảnh…' })).toBeNull();
    await act(async () => d.resolve({ id: 'r1' }));
  });

  it('nút Gửi yêu cầu cao ít nhất 44px', () => {
    renderSheet();
    expect(submitButton().style.minHeight).toBe('44px');
  });

  it('số tiền dự kiến hoàn dùng số đều (tabular-nums)', async () => {
    renderSheet();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    const line = await screen.findByText('Dự kiến hoàn 89.000đ');
    expect(line.closest('.tubu-nums')).not.toBeNull();
  });
});

describe('ReturnRequestSheet: máy chủ từ chối thì tải lại ngay và đóng khi form hết hiệu lực (W104A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefundBank.mockResolvedValue(null);
    mocks.estimateReturn.mockResolvedValue({ refund: 0, goods: 0, shipping: 0, isFull: false, moneyRefundable: true, pointsUsedBack: 0, lines: [] });
  });

  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const submitButton = () => screen.getByRole('button', { name: 'Gửi yêu cầu' });
  const fillForm = () => {
    fireEvent.click(screen.getByRole('checkbox', { name: 'Trả Nước giặt Chai 1L' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm lỗi, hỏng' }));
  };
  const deferred = () => {
    let resolve!: (v?: unknown) => void;
    const promise = new Promise((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  /** Dựng sheet kèm QueryClient để soi lệnh tải lại; `rerender` đổi đơn/danh sách như khi dữ liệu mới về. */
  function renderLive(invalidate?: (key: readonly unknown[]) => Promise<void> | undefined) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidated: unknown[][] = [];
    vi.spyOn(qc, 'invalidateQueries').mockImplementation(((filters: { queryKey: readonly unknown[] }) => {
      invalidated.push([...filters.queryKey]);
      return invalidate?.(filters.queryKey) ?? Promise.resolve();
    }) as never);
    const onClose = vi.fn();
    const tree = (order: unknown, returns: unknown[], open: boolean) => (
      <QueryClientProvider client={qc}>
        <ReturnRequestSheet open={open} onClose={onClose} order={order as never} returns={returns as never} returnDays={7} />
      </QueryClientProvider>
    );
    const view = render(tree(ORDER, [], true));
    return {
      onClose,
      invalidated,
      rerender: (order: unknown = ORDER, returns: unknown[] = [], open = true) => view.rerender(tree(order, returns, open)),
    };
  }

  it.each([400, 404, 409])('bị từ chối %i: tải lại đơn, danh sách đơn, đổi/trả và hoàn tiền', async (status) => {
    mocks.requestReturn.mockRejectedValueOnce(serverError('Đơn đang có yêu cầu đổi/trả chờ xử lý.', status));
    const { invalidated } = renderLive();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn đang có yêu cầu đổi/trả chờ xử lý.', type: 'error' }));
    await waitFor(() => expect(invalidated).toEqual(expect.arrayContaining([['order', 'TB1'], ['orders'], ['my-returns'], ['my-refunds']])));
  });

  it('bị từ chối: nút Gửi giữ khoá tới khi đơn tải lại xong rồi mới nhả', async () => {
    mocks.requestReturn.mockRejectedValueOnce(serverError('Đơn đang có yêu cầu đổi/trả chờ xử lý.', 400));
    const refresh = deferred();
    renderLive((key) => (key[0] === 'order' ? (refresh.promise as Promise<void>) : undefined));
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    // Đã có lời báo lỗi mà đơn chưa về: nút vẫn bận, bấm thêm không gửi lại trên dữ liệu cũ.
    expect(submitButton()).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(submitButton());
    expect(mocks.requestReturn).toHaveBeenCalledTimes(1);
    await act(async () => refresh.resolve());
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy'));
  });

  it('tải lại treo quá hạn thì nhả khoá, không giữ tấm mãi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mocks.requestReturn.mockRejectedValueOnce(serverError('Yêu cầu đã được xử lý.', 400));
      renderLive(() => new Promise<void>(() => undefined));
      fillForm();
      fireEvent.click(submitButton());
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
      expect(submitButton()).toHaveAttribute('aria-busy', 'true');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_100);
      });
      await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy'));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout', 'ECONNABORTED')],
    ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
    ['hết phiên 401', serverError('Unauthorized', 401)],
    ['lỗi không phải HTTP', new Error('boom')],
  ])('%s: không nói gì về trạng thái thật của đơn nên không tải lại, khoá nhả ngay', async (_label, error) => {
    mocks.requestReturn.mockRejectedValueOnce(error);
    const { invalidated, onClose } = renderLive();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy'));
    expect(invalidated).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('bị từ chối vì máy khác vừa gửi: dữ liệu mới có yêu cầu chờ xử lý thì tấm đóng, trước đó vẫn mở để khách đọc lỗi', async () => {
    mocks.requestReturn.mockRejectedValueOnce(serverError('Đơn đang có yêu cầu đổi/trả chờ xử lý.', 400));
    const { onClose, rerender } = renderLive();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    await waitFor(() => expect(submitButton()).not.toHaveAttribute('aria-busy'));
    expect(onClose).not.toHaveBeenCalled();
    mocks.openSnackbar.mockClear();
    rerender(ORDER, [{ orderId: 'o1', status: 'REQUESTED', items: [{ orderItemId: 'i1', quantity: 1 }] }]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Khách vừa đọc lời từ chối của máy chủ: đóng tấm không báo thêm lời thứ hai.
    expect(mocks.openSnackbar).not.toHaveBeenCalled();
  });

  it('dữ liệu nền mới về làm tấm hết hiệu lực (không có lỗi nào đi kèm): tấm đóng kèm một lời báo, không đóng im lặng', async () => {
    const { onClose, rerender } = renderLive();
    rerender(ORDER, [{ orderId: 'o1', status: 'REQUESTED', items: [{ orderItemId: 'i1', quantity: 1 }] }]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đơn này không còn đổi/trả được nữa hoặc đã có yêu cầu đang chờ xử lý.', type: 'info' });
  });

  it('đơn rời trạng thái Đã giao (đã huỷ, đã trả) thì tấm đóng', async () => {
    const { onClose, rerender } = renderLive();
    expect(onClose).not.toHaveBeenCalled();
    rerender({ ...(ORDER as object), status: 'RETURNED' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('yêu cầu đã duyệt/từ chối của đơn không đóng tấm; yêu cầu chờ xử lý của đơn khác cũng không', () => {
    const { onClose, rerender } = renderLive();
    rerender(ORDER, [
      { orderId: 'o1', status: 'APPROVED', items: [{ orderItemId: 'i2', quantity: 1 }] },
      { orderId: 'o1', status: 'REJECTED', items: [] },
      { orderId: 'o2', status: 'REQUESTED', items: [] },
    ]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tấm đang đóng thì không gọi onClose lần nào nữa dù dữ liệu đã hết hiệu lực', () => {
    const { onClose, rerender } = renderLive();
    rerender(ORDER, [], false);
    rerender({ ...(ORDER as object), status: 'RETURNED' }, [], false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('đang gửi thì không tự đóng dù đơn vừa đổi trạng thái; gửi xong mới đóng theo kết quả', async () => {
    const d = deferred();
    mocks.requestReturn.mockReturnValueOnce(d.promise);
    const { onClose, rerender } = renderLive();
    fillForm();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toHaveAttribute('aria-busy', 'true'));
    rerender({ ...(ORDER as object), status: 'RETURNED' });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => d.resolve({ id: 'r1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
