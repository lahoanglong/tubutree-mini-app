import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSnackbar: vi.fn(), updateSubscription: vi.fn(), getAddresses: vi.fn(), getWallet: vi.fn(), onClose: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/subscriptions-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  updateSubscription: mocks.updateSubscription,
}));
vi.mock('../services/shop-api', () => ({ getAddresses: mocks.getAddresses }));
vi.mock('../services/account-api', () => ({ getWallet: mocks.getWallet }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { getErrorMessage, getLoadErrorMessage } from '../services/api';
import { HttpError } from '../services/http';
import { SubscriptionEditSheet, subscriptionPatch } from './subscription-edit-sheet';

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE' as const, nextRunAt: '2026-11-07T03:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD' as const, lastOrderId: 'o1', lastOrderAt: '2026-10-10T03:00:00.000Z',
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

function renderSheet(sub = SUB, qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(<QueryClientProvider client={qc}><SubscriptionEditSheet sub={sub} onClose={mocks.onClose} /></QueryClientProvider>);
}

const ADDR = (id: string, street: string) => ({
  id, recipient: 'Lan', phone: '0900000000', province: 'HCM', district: 'Q.1', ward: 'P.1', street, isDefault: id === 'a1',
});
const ADDRS = [ADDR('a1', '1 Lê Lợi'), ADDR('a2', '9 Hai Bà Trưng')];
const serverError = (message: string, status = 409) => new HttpError(message, undefined, { status, data: { message } } as never);

describe('SubscriptionEditSheet: đổi chu kỳ giao (Q22)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T05:00:00.000Z') });
    mocks.getAddresses.mockResolvedValue([]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('có đúng 4 lựa chọn 4/6/8/10 tuần, chu kỳ hiện tại được chọn sẵn', async () => {
    renderSheet();
    const group = await screen.findByRole('group', { name: 'Chu kỳ giao' });
    const options = within(group).getAllByRole('button');
    expect(options.map((o) => o.textContent)).toEqual(['4 tuần', '6 tuần', '8 tuần', '10 tuần']);
    expect(within(group).getByRole('button', { name: '4 tuần' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('chọn 6 tuần → hiện ngày giao kế mới (đơn gần nhất + 6 tuần) trước khi lưu, rồi PATCH chỉ có intervalWeeks', async () => {
    mocks.updateSubscription.mockResolvedValue({ ...SUB, intervalWeeks: 6 });
    renderSheet();
    const save = await screen.findByRole('button', { name: 'Lưu thay đổi' });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '6 tuần' }));
    expect(screen.getByText('Lần giao kế tiếp: 21/11/2026')).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() => expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { intervalWeeks: 6 }));
  });

  it('chọn lại đúng chu kỳ cũ → hết thay đổi, nút lưu tắt, không hiện ngày mới', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: '8 tuần' }));
    fireEvent.click(screen.getByRole('button', { name: '4 tuần' }));
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
    expect(screen.queryByText(/Lần giao kế tiếp/)).toBeNull();
  });

  it('gói tạm dừng: hiện ngày giao kế như gói đang chạy và nói rõ ngày chỉ đổi khi ngày đó đã qua lúc bật lại', async () => {
    renderSheet({ ...SUB, status: 'PAUSED' as never });
    fireEvent.click(await screen.findByRole('button', { name: '10 tuần' }));
    expect(screen.getByText('Lần giao kế tiếp: 19/12/2026')).toBeInTheDocument();
    expect(
      screen.getByText('Gói đang tạm dừng: nếu đến lúc bật lại mà ngày này đã qua, ngày giao kế tiếp sẽ tính từ ngày bật lại.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/được tính lại khi bạn bật lại gói/)).toBeNull();
  });

  it('subscriptionPatch: gửi intervalWeeks chỉ khi đổi, cùng các trường khác', () => {
    const next = { quantity: 2, addressId: 'a1', paymentMethod: 'COD' as const, intervalWeeks: 4 };
    expect(subscriptionPatch(SUB, next)).toEqual({});
    expect(subscriptionPatch(SUB, { ...next, intervalWeeks: 8 })).toEqual({ intervalWeeks: 8 });
    expect(subscriptionPatch(SUB, { ...next, quantity: 3, intervalWeeks: 8 })).toEqual({ quantity: 3, intervalWeeks: 8 });
  });
});

describe('SubscriptionEditSheet: lỗi tải địa chỉ có lối Thử lại (W61A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
  });

  it('tải địa chỉ lỗi: vùng role=alert ghi lời lỗi + nút Thử lại, không vẽ nhóm địa chỉ trống; bấm Thử lại tải lại và hiện danh sách', async () => {
    const err = serverError('Máy chủ đang bận', 500);
    mocks.getAddresses.mockRejectedValueOnce(err).mockResolvedValue(ADDRS);
    renderSheet();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(getLoadErrorMessage(err))).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: 'Giao tới' })).toBeNull();
    expect(screen.queryAllByRole('radio', { name: /Lê Lợi/ })).toHaveLength(0);

    fireEvent.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /1 Lê Lợi/ })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bấm Thử lại: vùng lỗi và nút đứng yên (giữ focus, giữ chữ lỗi cũ), nút báo bận, bấm thêm không gửi lượt tải thứ ba, không có nhóm địa chỉ trống', async () => {
    let release!: (v: unknown) => void;
    const first = serverError('Máy chủ đang bận', 500);
    mocks.getAddresses.mockRejectedValueOnce(first).mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderSheet();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: 'Thử lại' });
    expect(retry).not.toHaveAttribute('aria-busy');
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent(getLoadErrorMessage(first));
    expect(retry).toHaveFocus();
    expect(screen.queryByRole('radiogroup', { name: 'Giao tới' })).toBeNull();
    fireEvent.click(retry);
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);

    release(ADDRS);
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Thử lại mà vẫn lỗi: vùng lỗi không chớp mất (cùng một phần tử), nút hết bận, chữ lỗi mới; Thử lại lần hai hiện danh sách', async () => {
    let fail!: (e: unknown) => void;
    mocks.getAddresses
      .mockRejectedValueOnce(serverError('Máy chủ đang bận', 500))
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject; }))
      .mockResolvedValue(ADDRS);
    renderSheet();
    const alert = await screen.findByRole('alert');
    const retry = within(alert).getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retry);
    await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));

    fail(serverError('Máy chủ vẫn bận', 504));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toBe(alert);
    expect(within(alert).getByRole('button', { name: 'Thử lại' })).toBe(retry);
    expect(screen.queryByRole('radiogroup', { name: 'Giao tới' })).toBeNull();

    fireEvent.click(retry);
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toBeInTheDocument();
    expect(mocks.getAddresses).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tải địa chỉ quá hạn: nói "tải chậm" (lời của màn tải), không nói "chưa rõ đã xong chưa" (lời của nút bấm)', async () => {
    const timeout = new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED');
    mocks.getAddresses.mockRejectedValue(timeout);
    renderSheet();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Tải chậm quá, thử lại nhé.');
    expect(alert).toHaveTextContent(getLoadErrorMessage(timeout));
    expect(alert).not.toHaveTextContent(getErrorMessage(timeout));
  });

  it('đã có danh sách trong bộ nhớ mà lần làm mới nền lỗi: vẫn hiện danh sách, không phủ bằng vùng lỗi', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    qc.setQueryData(['addresses'], ADDRS);
    mocks.getAddresses.mockRejectedValue(serverError('Máy chủ đang bận', 500));
    renderSheet(SUB, qc);
    await waitFor(() => expect(qc.getQueryState(['addresses'])?.status).toBe('error'));
    expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SubscriptionEditSheet: khoá khi đang lưu và báo lỗi lưu (W61A)', () => {
  const group = () => screen.getByRole('group', { name: 'Chu kỳ giao' });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue(ADDRS);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });

  async function startSave() {
    renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  }

  it('đang lưu: nút lưu báo bận; số lượng, chu kỳ, cách trả, địa chỉ đều khoá và bấm không đổi lựa chọn', async () => {
    mocks.updateSubscription.mockReturnValue(new Promise(() => {}));
    await startSave();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute('aria-busy', 'true'));

    const chips = within(group()).getAllByRole('button');
    expect(chips).toHaveLength(4);
    chips.forEach((c) => expect(c).toBeDisabled());
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    radios.forEach((r) => expect(r).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByRole('button', { name: 'Tăng số lượng' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Giảm số lượng' })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(group()).getByRole('button', { name: '6 tuần' }));
    fireEvent.click(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    expect(within(group()).getByRole('button', { name: '4 tuần' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group()).getByRole('button', { name: '6 tuần' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('đang lưu: nút Đóng ẩn đi và phím Escape không đóng sheet giữa lúc PATCH đang bay; lưu xong mới đóng một lần', async () => {
    let finish!: () => void;
    mocks.updateSubscription.mockReturnValue(new Promise((r) => { finish = () => r({ ...SUB, quantity: 3 }); }));
    await startSave();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mocks.onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  });

  it('chưa lưu: nút Đóng và Escape vẫn đóng sheet như cũ', async () => {
    renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mocks.onClose).toHaveBeenCalledTimes(2);
  });

  it('lưu lỗi: footer hiện role=alert với lời máy chủ ngay trên nút lưu, snackbar vẫn báo, điều khiển mở lại, sheet không đóng', async () => {
    const err = serverError('Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.');
    mocks.updateSubscription.mockRejectedValue(err);
    await startSave();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(getErrorMessage(err));
    expect(alert).toHaveTextContent('Bạn đã có gói định kỳ cho sản phẩm này tại địa chỉ đó.');
    expect(alert.nextElementSibling).toBe(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: getErrorMessage(err), type: 'error' });
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toHaveAttribute('aria-busy');
    within(group()).getAllByRole('button').forEach((c) => expect(c).toBeEnabled());
    screen.getAllByRole('radio').forEach((r) => expect(r).not.toHaveAttribute('aria-disabled', 'true'));
    expect(mocks.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    expect(mocks.onClose).toHaveBeenCalledTimes(1);
  });

  it('chưa lưu lần nào: không có role=alert nào ở footer', async () => {
    renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SubscriptionEditSheet: số đều (tabular-nums) cho ngày giao kế tiếp, số dư Ví và số điện thoại (W61A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-20T05:00:00.000Z') });
    mocks.getAddresses.mockResolvedValue(ADDRS);
    mocks.getWallet.mockResolvedValue({ walletBalance: 120000 });
  });
  afterEach(() => vi.useRealTimers());

  it('dòng ngày giao kế tiếp, nhãn Ví Tubu kèm số dư và tiêu đề địa chỉ đều dùng số đều', async () => {
    renderSheet();
    fireEvent.click(await screen.findByRole('button', { name: '6 tuần' }));
    expect(screen.getByText('Lần giao kế tiếp: 21/11/2026').style.fontVariantNumeric).toBe('tabular-nums');
    expect((await screen.findByText('Ví Tubu (120.000đ)')).style.fontVariantNumeric).toBe('tabular-nums');
    const titles = await screen.findAllByText('Lan · 0900000000');
    expect(titles).toHaveLength(2);
    titles.forEach((t) => expect(t.style.fontVariantNumeric).toBe('tabular-nums'));
  });
});

describe('SubscriptionEditSheet: Lưu khoá đồng bộ chạm đúp (W78A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue(ADDRS);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });

  async function openDirty() {
    renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    return screen.getByRole('button', { name: 'Lưu thay đổi' });
  }
  const deferred = () => {
    let resolve!: (v: unknown) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it('chạm đúp "Lưu thay đổi" trong cùng một khung hình chỉ PATCH một lần; xong báo thành công và đóng sheet một lần', async () => {
    const d = deferred();
    mocks.updateSubscription.mockReturnValue(d.promise);
    const save = await openDirty();
    await act(async () => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { quantity: 3 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.resolve({ ...SUB, quantity: 3 }));
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
    expect(mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'success')).toHaveLength(1);
  });

  it('lưu lỗi thì nhả khoá, bấm lại gọi lần hai và đóng sheet khi lần hai xong', async () => {
    const d = deferred();
    mocks.updateSubscription.mockReturnValueOnce(d.promise);
    const save = await openDirty();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.reject(serverError('Máy chủ bận', 500)));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toHaveAttribute('aria-busy'));
    expect(mocks.onClose).not.toHaveBeenCalled();
    mocks.updateSubscription.mockResolvedValueOnce({ ...SUB, quantity: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateSubscription).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.onClose).toHaveBeenCalledTimes(1));
  });
});

describe('SubscriptionEditSheet: lưu bị từ chối vì gói đã đổi thì tải lại danh sách gói (W98A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue(ADDRS);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });

  async function saveWith(err: unknown) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    mocks.updateSubscription.mockRejectedValue(err);
    renderSheet(SUB, qc);
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).not.toHaveAttribute('aria-busy'));
    return invalidate;
  }

  it.each([
    [400, 'Gói định kỳ đã huỷ, không sửa được nữa.'],
    [404, 'Không tìm thấy lịch đặt định kỳ.'],
    [409, 'Bạn đã có gói giao định kỳ "Nước xả vải Tubu" tới địa chỉ này, hãy sửa gói đó hoặc chọn địa chỉ khác.'],
  ])('%i: báo lời máy chủ và làm mới danh sách gói (gói đã huỷ ở máy khác thì biến mất, gói trùng hiện ra)', async (status, message) => {
    const invalidate = await saveWith(serverError(message, status));
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
    expect(mocks.onClose).not.toHaveBeenCalled();
  });

  it.each([
    ['máy chủ lỗi 500', serverError('Internal server error', 500)],
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
  ])('%s: chỉ báo lỗi, không làm mới danh sách gói', async (_name, err) => {
    const invalidate = await saveWith(err);
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['subscriptions'] });
  });
});
