import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { useState, type ComponentType } from 'react';
import type { BottomSheetProps } from './ui/bottom-sheet';
import { getLoadErrorMessage } from '../services/api';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getAddresses: vi.fn(), getWallet: vi.fn(), createSubscription: vi.fn(),
}));
// Bọc BottomSheet để đọc props mới nhất (open/dismissible/onClose): guard `onClose` không có đường bấm nào chạm tới khi
// `dismissible=false` đã ẩn nút X và chặn Esc, nên chỉ gọi thẳng onClose mới chứng minh được nó.
const sheetSpy = vi.hoisted(() => ({
  calls: [] as Array<{ open: boolean; dismissible?: boolean; title?: string; onClose: () => void }>,
}));
vi.mock('./ui/bottom-sheet', async (importOriginal) => {
  const orig = await importOriginal<{ BottomSheet: ComponentType<BottomSheetProps> }>();
  return {
    ...orig,
    BottomSheet: (p: BottomSheetProps) => {
      sheetSpy.calls.push(p);
      return <orig.BottomSheet {...p} />;
    },
  };
});
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
  const { unmount } = render(
    <QueryClientProvider client={qc}>
      <SubscribeSheet visible onClose={onClose} variationId="v1" quantity={2} />
    </QueryClientProvider>,
  );
  return { onClose, unmount };
}

describe('SubscribeSheet (C-015: ngày bắt đầu + cách trả + địa chỉ)', () => {
  // Trong một worker jsdom, lần getByRole đầu (~0,4 s đo trên DOM tối giản khi máy bận) và lần dựng/bấm đầu của Sheet tốn hàng trăm ms, và chúng
  // chạy ngay trong lần gọi đầu của waitFor nên ăn mất ngân sách 1 giây của lệnh chờ đó: ca đầu file rớt ngẫu nhiên khi máy bận. Chạy trước một
  // vòng ở đây để chi phí rơi vào hook; hạn 8 giây chỉ để vòng khởi động này không tự rớt, không nới lệnh chờ của ca nào.
  beforeAll(async () => {
    mocks.getAddresses.mockResolvedValue([ADDR('a2', true, '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 0 });
    mocks.createSubscription.mockResolvedValue({ ...SUB, firstOrder: null });
    const { onClose, unmount } = renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'), { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 8000 });
    unmount();
   }, 20_000);

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

  it('giao ngay nhưng API trả gói y hệt đã có (bấm đúp/thử lại, không kèm đơn đầu) → báo đã có gói, không in ngày rỗng', async () => {
    mocks.createSubscription.mockResolvedValue({ ...SUB, firstOrder: null });
    const { onClose } = renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const text = mocks.openSnackbar.mock.calls[0]![0].text as string;
    expect(text).toContain('đã có');
    expect(text).not.toMatch(/undefined|đơn đầu giao từ/);
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

  it('Ví đang âm → hàng Ví Tubu bị khoá kèm lý do, bấm không chọn được, gói tạo bằng COD', async () => {
    mocks.getWallet.mockResolvedValue({ walletBalance: -50000 });
    mocks.createSubscription.mockResolvedValue({ ...SUB, firstOrder: null });
    renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'));
    const wallet = await screen.findByRole('radio', { name: /Số dư Ví Tubu đang âm 50\.000đ/ });
    expect(wallet).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(wallet);
    expect(wallet).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' }));
    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'COD' })));
  });

  it('đã chọn Ví rồi số dư tải về âm → khoá nút tạo, không gửi gói trả bằng Ví', async () => {
    let resolveWallet!: (w: { walletBalance: number }) => void;
    mocks.getWallet.mockReturnValue(new Promise((r) => (resolveWallet = r)));
    renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(screen.getByRole('radio', { name: /^Ví Tubu/ }));
    expect(screen.getByRole('radio', { name: /^Ví Tubu/ })).toHaveAttribute('aria-checked', 'true');
    resolveWallet({ walletBalance: -50000 });
    await screen.findByRole('radio', { name: /Số dư Ví Tubu đang âm 50\.000đ/ });
    expect(screen.getByRole('button', { name: 'Bắt đầu đặt định kỳ' })).toBeDisabled();
    expect(mocks.createSubscription).not.toHaveBeenCalled();
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
    expect(mocks.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'BANK_TRANSFER' }));
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const createBtn = () => screen.queryByRole('button', { name: 'Bắt đầu đặt định kỳ' });
const skeletons = () => document.querySelectorAll('.tubu-skeleton').length;
const lastSheet = () => sheetSpy.calls.at(-1)!;
/** Gọi thẳng onClose đang treo ở sheet (nút X/Esc đã bị `dismissible` chặn trước khi tới đây). */
const tryClose = () => act(() => lastSheet().onClose());
const radios = (group: string) => within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio');
const INTERVALS = ['4 tuần', '6 tuần', '8 tuần', '10 tuần'];

describe('SubscribeSheet: tải địa chỉ (skeleton, lỗi + Thử lại)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    mocks.getWallet.mockResolvedValue({ walletBalance: 300000 });
  });
  afterEach(() => vi.useRealTimers());

  it('địa chỉ đang tải: hiện skeleton, chưa dựng danh sách địa chỉ; tải xong thì thay bằng danh sách', async () => {
    const addr = deferred<ReturnType<typeof ADDR>[]>();
    mocks.getAddresses.mockReturnValue(addr.promise);
    renderSheet();
    await waitFor(() => expect(skeletons()).toBeGreaterThan(0));
    expect(screen.queryByRole('radiogroup', { name: 'Giao tới' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => addr.resolve([ADDR('a2', true, '9 Hai Bà Trưng')]));
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true');
    expect(skeletons()).toBe(0);
  });

  it('tải địa chỉ lỗi: role="alert" có lời lỗi + "Thử lại"; không có nút tạo, không có danh sách địa chỉ', async () => {
    const err = new Error('boom');
    mocks.getAddresses.mockRejectedValue(err);
    renderSheet();
    const alert = await screen.findByRole('alert');
    expect(getLoadErrorMessage(err)).not.toBe('');
    expect(alert).toHaveTextContent(getLoadErrorMessage(err));
    const retryBtn = within(alert).getByRole('button', { name: 'Thử lại' });
    expect(retryBtn).toBeEnabled();
    expect(retryBtn.className).toContain('zaui-btn-secondary');
    expect(within(alert).getByText(getLoadErrorMessage(err)).style.color).toBe('var(--color-text-danger)');
    expect(createBtn()).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Giao tới' })).toBeNull();
    expect(skeletons()).toBe(0);
  });

  it('"Thử lại": gọi lại địa chỉ; đang tải nút xoay, vùng lỗi + focus đứng yên, chưa có nút tạo; xong thì hiện danh sách + nút tạo', async () => {
    const err = new Error('boom');
    const retry = deferred<ReturnType<typeof ADDR>[]>();
    mocks.getAddresses.mockRejectedValueOnce(err).mockReturnValueOnce(retry.promise);
    renderSheet();
    const alert = await screen.findByRole('alert');
    const retryBtn = within(alert).getByRole('button', { name: 'Thử lại' });
    retryBtn.focus();
    fireEvent.click(retryBtn);
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retryBtn).toHaveAttribute('aria-busy', 'true'));

    // react-query xoá lỗi lúc tải lại: vùng lỗi vẫn là CÙNG phần tử, còn lời cũ, focus không rơi về body
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent(getLoadErrorMessage(err));
    expect(document.activeElement).toBe(retryBtn);
    expect(skeletons()).toBe(0);
    expect(createBtn()).toBeNull();
    fireEvent.click(retryBtn);
    expect(mocks.getAddresses).toHaveBeenCalledTimes(2);

    await act(async () => retry.resolve([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]));
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(createBtn()).toBeEnabled();
  });

  it('đã có danh sách địa chỉ mà lần tải lại sau đó lỗi: danh sách ở lại, không hiện vùng lỗi, vẫn có nút tạo', async () => {
    mocks.getAddresses.mockReset().mockResolvedValue([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((v) => !v)}>đổi</button>
          <SubscribeSheet visible={open} onClose={() => setOpen(false)} variationId="v1" quantity={2} />
        </>
      );
    }
    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true');
    mocks.getAddresses.mockReset().mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByText('đổi'));
    fireEvent.click(screen.getByText('đổi'));
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('radio', { name: /Hai Bà Trưng|Lê Lợi/ })).toHaveLength(2);
    expect(createBtn()).toBeEnabled();
    unmount();
  });

  it('"Thử lại" lỗi tiếp: vùng lỗi vẫn đó, nút hết xoay, thử lại được lần nữa', async () => {
    const err = new Error('boom');
    mocks.getAddresses.mockRejectedValueOnce(err).mockRejectedValueOnce(err).mockResolvedValueOnce([ADDR('a2', true, '9 Hai Bà Trưng')]);
    renderSheet();
    const retryBtn = within(await screen.findByRole('alert')).getByRole('button', { name: 'Thử lại' });
    fireEvent.click(retryBtn);
    await waitFor(() => expect(mocks.getAddresses).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại' })).not.toHaveAttribute('aria-busy'));
    expect(screen.getByRole('alert')).toHaveTextContent(getLoadErrorMessage(err));
    expect(createBtn()).toBeNull();

    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.getAddresses).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SubscribeSheet: khoá form + chặn đóng khi đang tạo lịch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    mocks.getAddresses.mockResolvedValue([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 300000 });
  });
  afterEach(() => vi.useRealTimers());

  /** Chọn "Chọn ngày" + một ngày hợp lệ (để ô ngày hiện ra), bấm tạo, đợi nút báo bận. */
  async function startPending() {
    const create = deferred<Record<string, unknown>>();
    mocks.createSubscription.mockReturnValue(create.promise);
    const r = renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày' }));
    fireEvent.change(screen.getByLabelText('Ngày bắt đầu giao'), { target: { value: '2026-10-20' } });
    fireEvent.click(createBtn()!);
    await waitFor(() => expect(createBtn()).toHaveAttribute('aria-busy', 'true'));
    return { ...r, create };
  }

  it('đang tạo: khoá chu kỳ, "Giao ngay"/"Chọn ngày", ô ngày, 3 cách trả, các địa chỉ; nút tạo xoay nhưng giữ focus (không disabled DOM)', async () => {
    await startPending();
    for (const name of INTERVALS) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Giao ngay' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Chọn ngày' })).toBeDisabled();
    expect(screen.getByLabelText('Ngày bắt đầu giao')).toBeDisabled();
    const pay = radios('Thanh toán mỗi kỳ');
    expect(pay).toHaveLength(3);
    for (const r of pay) expect(r).toHaveAttribute('aria-disabled', 'true');
    const addr = radios('Giao tới');
    expect(addr).toHaveLength(2);
    for (const r of addr) expect(r).toHaveAttribute('aria-disabled', 'true');
    expect(createBtn()).toBeEnabled();
  });

  it('đang tạo: bấm các điều khiển bị khoá không đổi lựa chọn; bấm nút tạo lần nữa không bắn lời gọi thứ hai', async () => {
    await startPending();
    fireEvent.click(screen.getByRole('button', { name: '6 tuần' }));
    expect(screen.getByRole('button', { name: '4 tuần' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Giao ngay' }));
    expect(screen.getByRole('button', { name: 'Chọn ngày' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('radio', { name: /1 Lê Lợi/ }));
    expect(screen.getByRole('radio', { name: /1 Lê Lợi/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ }));
    expect(screen.getByRole('radio', { name: /Chuyển khoản ngân hàng/ })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(createBtn()!);
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('đang tạo: sheet không đóng được (không nút X, Esc, onClose đều bị chặn); tạo xong mở khoá lại', async () => {
    const { onClose, create } = await startPending();
    expect(lastSheet().dismissible).toBe(false);
    expect(screen.queryByRole('button', { name: 'Đóng' })).toBeNull();
    tryClose();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => create.resolve({ ...SUB, firstOrder: null }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(lastSheet().dismissible).toBe(true));
    for (const name of INTERVALS) expect(screen.getByRole('button', { name })).toBeEnabled();
    expect(screen.getByLabelText('Ngày bắt đầu giao')).toBeEnabled();
  });

  it('tạo lỗi: báo lỗi, mở khoá lại form, đóng sheet được', async () => {
    const { onClose, create } = await startPending();
    await act(async () => create.reject(new Error('Số dư Ví Tubu không đủ')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(lastSheet().dismissible).toBe(true));
    expect(createBtn()).not.toHaveAttribute('aria-busy');
    for (const name of INTERVALS) expect(screen.getByRole('button', { name })).toBeEnabled();
    for (const r of radios('Giao tới')) expect(r).not.toHaveAttribute('aria-disabled');
    tryClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SubscribeSheet: số đều (tabular-nums)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    mocks.getAddresses.mockResolvedValue([ADDR('a2', true, '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 300000 });
  });
  afterEach(() => vi.useRealTimers());

  it('tiêu đề có % tiết kiệm, số tuần, gợi ý số ngày tối đa, số dư Ví Tubu đều có tabular-nums', async () => {
    renderSheet();
    await screen.findByRole('radio', { name: /9 Hai Bà Trưng/ });
    fireEvent.click(screen.getByRole('button', { name: 'Chọn ngày' }));
    const wallet = await screen.findByRole('radio', { name: /Ví Tubu \(300\.000đ\)/ });
    const spots: HTMLElement[] = [
      screen.getByRole('heading', { name: /Đặt định kỳ — tiết kiệm 12%/ }),
      ...INTERVALS.map((name) => screen.getByRole('button', { name })),
      screen.getByText(/Chọn một ngày trong vòng \d+ ngày tới/),
      within(wallet).getByText(/Ví Tubu \(300\.000đ\)/),
    ];
    for (const el of spots) expect(el.style.fontVariantNumeric, el.textContent ?? '').toBe('tabular-nums');
  });
});

describe('SubscribeSheet: nút tạo khoá đồng bộ chạm đúp (W78A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
    mocks.getAddresses.mockResolvedValue([ADDR('a1', false, '1 Lê Lợi'), ADDR('a2', true, '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 300000 });
  });
  afterEach(() => vi.useRealTimers());

  async function ready() {
    const r = renderSheet();
    await waitFor(() => expect(screen.getByRole('radio', { name: /9 Hai Bà Trưng/ })).toHaveAttribute('aria-checked', 'true'));
    await waitFor(() => expect(createBtn()).toBeEnabled());
    return r;
  }
  const successToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'success');

  it('chạm đúp "Bắt đầu đặt định kỳ" trong cùng một khung hình chỉ tạo một lịch; xong đóng sheet và báo thành công một lần', async () => {
    const create = deferred<Record<string, unknown>>();
    mocks.createSubscription.mockReturnValue(create.promise);
    const { onClose } = await ready();
    const btn = createBtn()!;
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.createSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.createSubscription).toHaveBeenCalledWith({
      variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a2', paymentMethod: 'COD',
    });
    await waitFor(() => expect(createBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => create.resolve({ ...SUB, firstOrder: null }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(successToasts()).toHaveLength(1);
  });

  it('tạo lỗi thì nhả khoá, bấm lại gọi lần hai', async () => {
    const create = deferred<Record<string, unknown>>();
    mocks.createSubscription.mockReturnValueOnce(create.promise);
    const { onClose } = await ready();
    fireEvent.click(createBtn()!);
    await waitFor(() => expect(createBtn()).toHaveAttribute('aria-busy', 'true'));
    await act(async () => create.reject(new Error('Số dư Ví Tubu không đủ')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(createBtn()).not.toHaveAttribute('aria-busy'));
    expect(onClose).not.toHaveBeenCalled();
    mocks.createSubscription.mockResolvedValueOnce({ ...SUB, firstOrder: null });
    fireEvent.click(createBtn()!);
    await waitFor(() => expect(mocks.createSubscription).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
