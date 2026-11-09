import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

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

function renderPanel(returnRequestIds?: ReadonlySet<string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderRefunds orderId="o1" returnRequestIds={returnRequestIds} />
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
    expect(await screen.findByText('Nhập tên ngân hàng nhận tiền hoàn.')).toBeInTheDocument();
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

const SAVED = { bankName: 'Vietcombank', accountNumber: '0123456789', accountName: 'NGUYEN AN' };
const RETURN_REFUND = {
  ...LATE,
  id: 'r2',
  kind: 'RETURN',
  refKey: 'rq1',
  amount: 50_000,
  method: 'WALLET',
  status: 'COMPLETED',
  completedAt: '2026-10-14T03:05:00Z',
  canChooseDestination: false,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Chọn nơi nhận tiền' }));
  return screen.findByRole('button', { name: 'Xác nhận' });
};
const typeField = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const fieldValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

function resetMocks() {
  mocks.openSnackbar.mockReset();
  mocks.fetchMyRefunds.mockReset().mockResolvedValue([LATE]);
  mocks.fetchRefundBank.mockReset().mockResolvedValue(null);
  mocks.chooseRefundDestination.mockReset().mockResolvedValue(LATE);
}

describe('OrderRefunds: khoản hoàn của yêu cầu trả hàng không lặp (returnRequestIds)', () => {
  beforeEach(resetMocks);

  it('khoản hoàn thuộc một yêu cầu trả hàng đã có dòng riêng: không lặp ở khối Hoàn tiền, khoản khác vẫn hiện', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([LATE, RETURN_REFUND]);
    renderPanel(new Set(['rq1']));
    expect(await screen.findByText(/197\.000đ/)).toBeInTheDocument();
    expect(screen.queryByText(/50\.000đ/)).toBeNull();
  });

  it('không truyền returnRequestIds: khoản trả hàng vẫn hiện', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([RETURN_REFUND]);
    renderPanel();
    expect(await screen.findByText(/50\.000đ/)).toBeInTheDocument();
  });

  it('refKey không nằm trong tập yêu cầu: vẫn hiện', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([RETURN_REFUND]);
    renderPanel(new Set(['rq-khac']));
    expect(await screen.findByText(/50\.000đ/)).toBeInTheDocument();
  });

  it('khoản không phải trả hàng dù refKey trùng: vẫn hiện', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([{ ...RETURN_REFUND, kind: 'CANCEL' }]);
    renderPanel(new Set(['rq1']));
    expect(await screen.findByText(/50\.000đ/)).toBeInTheDocument();
  });

  it('khoản trả hàng chưa có refKey (API cũ): vẫn hiện', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([{ ...RETURN_REFUND, refKey: undefined }]);
    renderPanel(new Set(['rq1']));
    expect(await screen.findByText(/50\.000đ/)).toBeInTheDocument();
  });

  it('mọi khoản đều của yêu cầu trả hàng: không vẽ khối Hoàn tiền', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([RETURN_REFUND]);
    const { container } = renderPanel(new Set(['rq1']));
    await waitFor(() => expect(mocks.fetchMyRefunds).toHaveBeenCalledWith('o1'));
    await settle();
    expect(container.textContent).toBe('');
  });
});

describe('ChooseDestinationSheet: khoá lưu đồng bộ, chặn đóng khi đang lưu', () => {
  beforeEach(resetMocks);

  it('hai cú bấm "Xác nhận" sát nhau trước khi vẽ lại: chỉ gọi API một lần', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mocks.chooseRefundDestination).toHaveBeenCalledTimes(1);
    await act(async () => d.resolve(LATE));
  });

  it('đang lưu: nút "Xác nhận" bị khoá; API lỗi thì mở khoá', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    const confirm = await openSheet();
    expect(confirm).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(confirm).toBeDisabled();
    await act(async () => d.reject(new Error('lỗi mạng')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(confirm).toBeEnabled();
  });

  it('API lỗi: khoá nhả, bấm lại gọi lần hai', async () => {
    mocks.chooseRefundDestination.mockRejectedValueOnce(new Error('lỗi mạng')).mockResolvedValue(LATE);
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mocks.chooseRefundDestination).toHaveBeenCalledTimes(2);
  });

  it('thiếu tài khoản: không gọi API và không giữ khoá, sửa xong bấm lại gọi được', async () => {
    renderPanel();
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    const confirm = screen.getByRole('button', { name: 'Xác nhận' });
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mocks.chooseRefundDestination).not.toHaveBeenCalled();
    typeField('Tên ngân hàng', 'Techcombank');
    typeField('Số tài khoản', '0123456789');
    typeField('Chủ tài khoản', 'NGUYEN AN');
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(mocks.chooseRefundDestination).toHaveBeenCalledTimes(1);
  });

  it('đang lưu: nút Đóng ẩn đi, phím Escape bị bỏ qua, sheet vẫn mở', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    const confirm = await openSheet();
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(confirm);
    });
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => d.resolve(LATE));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('đóng ngay trong cùng nhịp với cú bấm lưu (trước khi pending vẽ lại): vẫn bị bỏ qua', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => d.resolve(LATE));
  });

  it('lưu xong thì sheet đóng, báo thành công; không bấm lưu thì Đóng hoạt động', async () => {
    renderPanel();
    await openSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã hoàn 197.000đ vào Ví Tubu.', type: 'success' });
  });

  it('lỗi xong thì Đóng hoạt động lại', async () => {
    mocks.chooseRefundDestination.mockRejectedValue(new Error('lỗi mạng'));
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('ChooseDestinationSheet: điền sẵn tài khoản đã lưu đúng một lần, không ghi đè', () => {
  beforeEach(resetMocks);
  const pickBank = async () => {
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
  };

  it('chọn ngân hàng lần đầu với ba ô trống: điền sẵn cả ba ô', async () => {
    mocks.fetchRefundBank.mockResolvedValue(SAVED);
    renderPanel();
    await pickBank();
    await waitFor(() => expect(fieldValue('Số tài khoản')).toBe('0123456789'));
    expect(fieldValue('Tên ngân hàng')).toBe('Vietcombank');
    expect(fieldValue('Chủ tài khoản')).toBe('NGUYEN AN');
  });

  it.each([
    ['tên ngân hàng', 'Tên ngân hàng', 'MB Bank'],
    ['số tài khoản', 'Số tài khoản', '555666777'],
    ['chủ tài khoản', 'Chủ tài khoản', 'TRAN BINH'],
  ])('khách gõ %s trước khi tài khoản đã lưu trả về: không bị điền đè', async (_n, label, typed) => {
    const d = deferred<typeof SAVED>();
    mocks.fetchRefundBank.mockReturnValue(d.promise);
    renderPanel();
    await pickBank();
    typeField(label, typed);
    await act(async () => d.resolve(SAVED));
    await settle();
    expect(fieldValue(label)).toBe(typed);
    for (const other of ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản'].filter((l) => l !== label)) expect(fieldValue(other)).toBe('');
  });

  it('khách xoá sạch cả ba ô sau khi đã điền sẵn: tài khoản đã lưu trả về lần sau không điền lại', async () => {
    mocks.fetchRefundBank.mockResolvedValueOnce(SAVED).mockResolvedValue({ bankName: 'ACB', accountNumber: '999888777', accountName: 'LE CHI' });
    renderPanel();
    await pickBank();
    await waitFor(() => expect(fieldValue('Số tài khoản')).toBe('0123456789'));
    typeField('Tên ngân hàng', '');
    typeField('Chủ tài khoản', '');
    typeField('Số tài khoản', '');
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(2));
    await settle();
    for (const label of ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) expect(fieldValue(label)).toBe('');
  });

  it('khoản hoàn đã có tài khoản, khách xoá sạch ba ô để nhập tài khoản khác: không bị điền lại bằng tài khoản đã lưu', async () => {
    mocks.fetchRefundBank.mockResolvedValue(SAVED);
    mocks.fetchMyRefunds.mockResolvedValue([{ ...LATE, bankName: 'ACB', bankAccountNo: '999888777', bankAccountName: 'LE CHI' }]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi nơi nhận' }));
    await screen.findByRole('button', { name: 'Xác nhận' });
    typeField('Tên ngân hàng', '');
    typeField('Chủ tài khoản', '');
    typeField('Số tài khoản', '');
    await waitFor(() => expect(mocks.fetchRefundBank).toHaveBeenCalledTimes(1));
    await settle();
    for (const label of ['Tên ngân hàng', 'Số tài khoản', 'Chủ tài khoản']) expect(fieldValue(label)).toBe('');
  });

  it('chưa có tài khoản đã lưu: để trống ba ô', async () => {
    renderPanel();
    await pickBank();
    await settle();
    expect(fieldValue('Số tài khoản')).toBe('');
    expect(fieldValue('Tên ngân hàng')).toBe('');
  });

  it('tài khoản đã lưu thiếu số tài khoản: bỏ qua, không điền nửa vời', async () => {
    mocks.fetchRefundBank.mockResolvedValue({ bankName: 'Vietcombank', accountNumber: '', accountName: 'NGUYEN AN' });
    renderPanel();
    await pickBank();
    await settle();
    expect(fieldValue('Tên ngân hàng')).toBe('');
  });

  it('khoản hoàn đã có tài khoản: mở sẵn ở Ngân hàng, không gọi API điền sẵn', async () => {
    mocks.fetchMyRefunds.mockResolvedValue([{ ...LATE, bankName: 'ACB', bankAccountNo: '999888777', bankAccountName: 'LE CHI' }]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Đổi nơi nhận' }));
    await screen.findByRole('button', { name: 'Xác nhận' });
    await settle();
    expect(fieldValue('Số tài khoản')).toBe('999888777');
    expect(mocks.fetchRefundBank).not.toHaveBeenCalled();
  });
});

describe('ChooseDestinationSheet: chỉ Ví Tubu mới làm mới số dư ví', () => {
  let inv: MockInstance<QueryClient['invalidateQueries']>;
  beforeEach(() => {
    resetMocks();
    inv = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
  });
  afterEach(() => inv.mockRestore());
  const keys = () => inv.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));

  it('chọn Ví Tubu: làm mới khoản hoàn của đơn và ví', async () => {
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(keys()).toEqual(expect.arrayContaining(['["my-refunds","o1"]', '["wallet"]']));
  });

  it('chọn tài khoản ngân hàng: chỉ làm mới khoản hoàn, không động tới ví', async () => {
    renderPanel();
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    typeField('Tên ngân hàng', 'Techcombank');
    typeField('Số tài khoản', '0123456789');
    typeField('Chủ tài khoản', 'NGUYEN AN');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.chooseRefundDestination).toHaveBeenCalledWith('r1', {
      refundMethod: 'BANK',
      bankName: 'Techcombank',
      accountNumber: '0123456789',
      accountName: 'NGUYEN AN',
    });
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.', type: 'success' });
    expect(keys()).toContain('["my-refunds","o1"]');
    expect(keys()).not.toContain('["wallet"]');
  });

  it('đổi radio sang Ngân hàng lúc đang lưu Ví Tubu: vẫn làm mới ví và báo đúng điều đã gửi', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    await act(async () => d.resolve(LATE));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.chooseRefundDestination).toHaveBeenCalledWith('r1', { refundMethod: 'WALLET' });
    expect(keys()).toContain('["wallet"]');
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã hoàn 197.000đ vào Ví Tubu.', type: 'success' });
  });

  it('đổi radio sang Ví Tubu lúc đang lưu tài khoản ngân hàng: không làm mới ví và báo đúng điều đã gửi', async () => {
    const d = deferred<typeof LATE>();
    mocks.chooseRefundDestination.mockReturnValue(d.promise);
    renderPanel();
    await openSheet();
    fireEvent.click(screen.getByRole('radio', { name: /Tài khoản ngân hàng/ }));
    typeField('Tên ngân hàng', 'Techcombank');
    typeField('Số tài khoản', '0123456789');
    typeField('Chủ tài khoản', 'NGUYEN AN');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Xác nhận' }));
    });
    fireEvent.click(screen.getByRole('radio', { name: /Ví Tubu/ }));
    await act(async () => d.resolve(LATE));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalled());
    expect(mocks.chooseRefundDestination).toHaveBeenCalledWith('r1', expect.objectContaining({ refundMethod: 'BANK' }));
    expect(keys()).not.toContain('["wallet"]');
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã lưu tài khoản. Tubu sẽ chuyển khoản trong 1-3 ngày làm việc.', type: 'success' });
  });

  it('API lỗi: không làm mới gì', async () => {
    mocks.chooseRefundDestination.mockRejectedValue(new Error('lỗi mạng'));
    renderPanel();
    const confirm = await openSheet();
    await act(async () => {
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(keys()).not.toContain('["wallet"]');
    expect(keys()).not.toContain('["my-refunds","o1"]');
  });
});
