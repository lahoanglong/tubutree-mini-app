import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import type { BottomSheetProps } from './ui/bottom-sheet';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), openSnackbar: vi.fn(), getSubscriptions: vi.fn(), setSubscriptionStatus: vi.fn(), skipSubscriptionCycle: vi.fn(),
  updateSubscription: vi.fn(), getAddresses: vi.fn(), getWallet: vi.fn(),
}));
// Bọc BottomSheet để đọc props mới nhất (open/dismissible/onClose): guard `onClose` của sheet giữ chân không có đường bấm nào chạm tới
// khi `dismissible=false` đã ẩn nút X, nên chỉ gọi thẳng onClose mới chứng minh được nó.
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

import { haptic } from '../utils/haptic';
import { HttpError } from '../services/http';
import { LOCK_REFRESH_WAIT_MS } from '../utils/settle-within';
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

  it('TZ-01: nextRunAt = 00:00 VN (17:00Z hôm trước) hiện đúng ngày VN, không lùi một ngày', async () => {
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, nextRunAt: '2026-11-10T17:00:00.000Z' }]);
    renderPanel();
    expect(await screen.findByText(/11\/11\/2026/)).toBeInTheDocument();
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

  it('W140: gói tạm dừng nói rõ lý do và cách chạy lại; không biết lý do (dừng từ trước, mã lạ) chỉ có dòng chung; gói đang chạy không có dòng lý do', async () => {
    mocks.getSubscriptions.mockResolvedValue([
      { ...SUB, id: 's1', status: 'PAUSED' as const, pausedReason: 'invalid_address' },
      { ...SUB, id: 's2', status: 'PAUSED' as const, pausedReason: null },
      { ...SUB, id: 's3', status: 'PAUSED' as const, pausedReason: 'mã_lạ_của_api_mới' },
      { ...SUB, id: 's4', status: 'ACTIVE' as const, pausedReason: 'customer' },
      { ...SUB, id: 's5', status: 'PAUSED' as const, pausedReason: 'customer' },
    ]);
    renderPanel();
    expect(await screen.findByText('Địa chỉ giao hàng không còn dùng được')).toBeInTheDocument();
    expect(screen.getByText('Bấm Sửa để chọn lại địa chỉ, rồi bấm Tiếp tục.')).toBeInTheDocument();
    expect(screen.getAllByText('Đang tạm dừng')).toHaveLength(2);
    expect(screen.getAllByText(/^Lần kế:/)).toHaveLength(1);
    expect(screen.getByText('Bạn đã tạm dừng gói này')).toBeInTheDocument();
    expect(screen.getByText('Bấm Tiếp tục khi muốn Tubu giao lại.')).toBeInTheDocument();
    expect(screen.queryByText(/mã_lạ/)).toBeNull();
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RETENTION_TITLE = 'Giữ lại lịch định kỳ?';
const sheetEl = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const inSheet = (name: string) => within(sheetEl()!).getByRole('button', { name });
const cardBtns = (name: string) => screen.getAllByRole('button', { name }).filter((b) => !sheetEl()?.contains(b));
const retentionSheet = () => sheetSpy.calls.filter((c) => c.title === RETENTION_TITLE).at(-1)!;
async function openRetention() {
  fireEvent.click(await screen.findByRole('button', { name: 'Huỷ' }));
  await screen.findByText(RETENTION_TITLE);
}
/** Gọi thẳng onClose đang treo ở sheet giữ chân (nút X/Esc/vuốt đã bị `dismissible` chặn trước khi tới đây). */
function tryClose() {
  act(() => retentionSheet().onClose());
}

describe('SubscriptionsPanel: khoá chéo statusMut ↔ skipMut, chặn đóng sheet, nút thẻ đang bận', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValue([SUB]);
  });

  it('skipMut đang chạy: "Tạm dừng" + "Vẫn huỷ" + 3 nút thẻ nền khoá; "Bỏ qua kỳ này" giữ focus (aria-busy, không disabled DOM)', async () => {
    const skip = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValue(skip.promise);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(inSheet('Bỏ qua kỳ này')).toHaveAttribute('aria-busy', 'true'));
    expect(inSheet('Bỏ qua kỳ này')).toBeEnabled();
    expect(inSheet('Tạm dừng')).toBeDisabled();
    expect(inSheet('Vẫn huỷ')).toBeDisabled();
    for (const name of ['Sửa', 'Tạm dừng', 'Huỷ']) expect(cardBtns(name)[0]).toBeDisabled();

    // bấm lại / bấm nút kia: không phát sinh lời gọi API thứ hai
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    fireEvent.click(inSheet('Tạm dừng'));
    fireEvent.click(inSheet('Vẫn huỷ'));
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).not.toHaveBeenCalled();

    await act(async () => skip.resolve(SUB));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await waitFor(() => expect(screen.queryByText(RETENTION_TITLE)).not.toBeInTheDocument(), { timeout: 5000 });
  });

  it('skipMut đang chạy: sheet không đóng được (không nút X, Esc, onClose đều bị chặn) cho tới khi xong', async () => {
    const skip = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValue(skip.promise);
    renderPanel();
    await openRetention();
    expect(retentionSheet().dismissible).toBe(true);
    expect(within(sheetEl()!).getByRole('button', { name: 'Đóng' })).toBeInTheDocument();

    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(retentionSheet().dismissible).toBe(false));
    expect(within(sheetEl()!).queryByRole('button', { name: 'Đóng' })).toBeNull();
    tryClose();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(retentionSheet().open).toBe(true);
    expect(screen.getByText(RETENTION_TITLE)).toBeInTheDocument();

    await act(async () => skip.resolve(SUB));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('skipMut lỗi: mở khoá lại cả sheet, bấm đóng được, báo lỗi', async () => {
    const skip = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValue(skip.promise);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(inSheet('Tạm dừng')).toBeDisabled());
    await act(async () => skip.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(inSheet('Tạm dừng')).toBeEnabled());
    expect(inSheet('Vẫn huỷ')).toBeEnabled();
    expect(inSheet('Bỏ qua kỳ này')).not.toHaveAttribute('aria-busy');
    expect(retentionSheet().dismissible).toBe(true);
    tryClose();
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('statusMut đang chạy từ "Tạm dừng" trong sheet: nút đó giữ focus (aria-busy); "Bỏ qua kỳ này", "Vẫn huỷ", thẻ nền khoá; không đóng được', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Tạm dừng'));
    await waitFor(() => expect(inSheet('Tạm dừng')).toHaveAttribute('aria-busy', 'true'));
    expect(inSheet('Tạm dừng')).toBeEnabled();
    expect(inSheet('Bỏ qua kỳ này')).toBeDisabled();
    expect(inSheet('Vẫn huỷ')).toBeDisabled();
    for (const name of ['Sửa', 'Tạm dừng', 'Huỷ']) expect(cardBtns(name)[0]).toBeDisabled();
    // sheet đang mở nên thẻ nền không giả vờ là nơi đang xoay
    expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy');

    expect(retentionSheet().dismissible).toBe(false);
    tryClose();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(retentionSheet().open).toBe(true);

    fireEvent.click(inSheet('Tạm dừng'));
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    fireEvent.click(inSheet('Vẫn huỷ'));
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED');
    expect(mocks.skipSubscriptionCycle).not.toHaveBeenCalled();

    await act(async () => status.resolve({ ...SUB, status: 'PAUSED' }));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('statusMut đang chạy từ "Vẫn huỷ": nút đó giữ focus; "Tạm dừng" + "Bỏ qua kỳ này" khoá; bấm đóng không đóng được', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Vẫn huỷ'));
    await waitFor(() => expect(inSheet('Vẫn huỷ')).toHaveAttribute('aria-busy', 'true'));
    expect(inSheet('Vẫn huỷ')).toBeEnabled();
    expect(inSheet('Tạm dừng')).toBeDisabled();
    expect(inSheet('Bỏ qua kỳ này')).toBeDisabled();
    tryClose();
    expect(retentionSheet().open).toBe(true);
    fireEvent.click(inSheet('Tạm dừng'));
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED');

    await act(async () => status.resolve({ ...SUB, status: 'CANCELLED' }));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('bấm "Tạm dừng" ngay trên thẻ: chỉ nút đó xoay (aria-busy, còn bấm được DOM); Sửa/Huỷ và thẻ khác khoá', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    mocks.getSubscriptions.mockResolvedValue([SUB, { ...SUB, id: 's2' }]);
    renderPanel();
    await screen.findAllByRole('button', { name: 'Tạm dừng' });
    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).toHaveAttribute('aria-busy', 'true'));
    expect(cardBtns('Tạm dừng')[0]).toBeEnabled();
    expect(cardBtns('Tạm dừng')[1]).toBeDisabled();
    expect(cardBtns('Tạm dừng')[1]).not.toHaveAttribute('aria-busy');
    for (const i of [0, 1]) {
      expect(cardBtns('Sửa')[i]).toBeDisabled();
      expect(cardBtns('Huỷ')[i]).toBeDisabled();
    }
    expect(sheetEl()).toBeNull();

    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    fireEvent.click(cardBtns('Tạm dừng')[1]!);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED');

    await act(async () => status.resolve({ ...SUB, status: 'PAUSED' }));
    await waitFor(() => expect(cardBtns('Sửa')[0]).toBeEnabled());
    expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy');
    expect(cardBtns('Tạm dừng')[1]).toBeEnabled();
  });

  it('"Tiếp tục" ở gói đang dừng cũng xoay như "Tạm dừng"; lỗi thì nhả khoá và báo lỗi', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, status: 'PAUSED' as const }]);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếp tục' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();

    await act(async () => status.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sửa' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeEnabled();
  });

  it('số tiền / % / số lượng / ngày dùng số đều (tabular-nums)', async () => {
    renderPanel();
    await screen.findByText('Nước xả vải Tubu');
    const lines = [
      screen.getByText(/tiết kiệm 14% mỗi đơn/),
      screen.getByText('Đang giảm 14% cho đơn định kỳ'),
      screen.getByText('Hương sả · SL 2'),
      screen.getByText('Mỗi 4 tuần · 137.600đ'),
      screen.getByText('160.000đ'),
      screen.getByText('Tiết kiệm 14%'),
      screen.getByText('Lần kế: 15/10/2026'),
    ];
    for (const el of lines) expect(el.style.fontVariantNumeric, el.textContent ?? '').toBe('tabular-nums');
  });
});

describe('SubscriptionsPanel: khoá đồng bộ chạm đúp, một việc mỗi lúc trên mọi gói (W78A)', () => {
  const successToasts = () => mocks.openSnackbar.mock.calls.filter(([o]) => (o as { type: string }).type === 'success');

  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValue([SUB]);
  });

  it('chạm đúp "Tạm dừng" ngay trên thẻ trong cùng một khung hình chỉ gửi một lần; xong thì làm mới danh sách một lần', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    renderPanel();
    const pause = await screen.findByRole('button', { name: 'Tạm dừng' });
    await act(async () => {
      fireEvent.click(pause);
      fireEvent.click(pause);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED');
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).toHaveAttribute('aria-busy', 'true'));
    await act(async () => status.resolve({ ...SUB, status: 'PAUSED' }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp "Tiếp tục" ở gói đang dừng trong cùng một khung hình chỉ gửi một lần (ACTIVE)', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    mocks.getSubscriptions.mockResolvedValue([{ ...SUB, status: 'PAUSED' as const }]);
    renderPanel();
    const resume = await screen.findByRole('button', { name: 'Tiếp tục' });
    await act(async () => {
      fireEvent.click(resume);
      fireEvent.click(resume);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'ACTIVE');
    await act(async () => status.resolve({ ...SUB, status: 'ACTIVE' }));
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1));
  });

  it('lỗi thì nhả khoá, bấm lại gọi lần hai (nút thẻ)', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValueOnce(status.promise);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).toHaveAttribute('aria-busy', 'true'));
    await act(async () => status.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy'));
    mocks.setSubscriptionStatus.mockResolvedValueOnce({ ...SUB, status: 'PAUSED' });
    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(2));
  });

  it('thành công cũng nhả khoá: bấm lần sau gửi lần hai', async () => {
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy'));
    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(2));
  });

  it('hai thẻ khác nhau, "Tạm dừng" cả hai trong cùng một khung hình: chỉ gói đầu được gửi (một việc mỗi lúc như giao diện đã khoá nút thẻ nền)', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    mocks.getSubscriptions.mockResolvedValue([SUB, { ...SUB, id: 's2' }]);
    renderPanel();
    await screen.findAllByRole('button', { name: 'Tạm dừng' });
    const [first, second] = cardBtns('Tạm dừng');
    await act(async () => {
      fireEvent.click(first!);
      fireEvent.click(second!);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'PAUSED');
    await act(async () => status.resolve({ ...SUB, status: 'PAUSED' }));
    await waitFor(() => expect(cardBtns('Tạm dừng')[1]).toBeEnabled());
  });

  it('chạm đúp "Vẫn huỷ" trong sheet cùng một khung hình chỉ gửi CANCELLED một lần, xong sheet đóng một lần', async () => {
    const status = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(status.promise);
    renderPanel();
    await openRetention();
    const confirm = inSheet('Vẫn huỷ');
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED');
    await waitFor(() => expect(inSheet('Vẫn huỷ')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => status.resolve({ ...SUB, status: 'CANCELLED' }));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('chạm đúp "Bỏ qua kỳ này" trong cùng một khung hình chỉ gửi skip một lần; báo thành công một lần', async () => {
    const skip = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValue(skip.promise);
    renderPanel();
    await openRetention();
    const btn = inSheet('Bỏ qua kỳ này');
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(1);
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(inSheet('Bỏ qua kỳ này')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => skip.resolve(SUB));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    expect(successToasts()).toHaveLength(1);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['"Tạm dừng" rồi "Vẫn huỷ"', 'Tạm dừng', 'Vẫn huỷ', 'PAUSED'],
    ['"Vẫn huỷ" rồi "Tạm dừng"', 'Vẫn huỷ', 'Tạm dừng', 'CANCELLED'],
  ] as const)('hai nút khác nhau trong sheet, %s cùng một khung hình: chỉ lệnh đầu gọi API, sheet vẫn đóng khi lệnh đầu xong', async (_label, first, second, status) => {
    const d = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(d.promise);
    renderPanel();
    await openRetention();
    const a = inSheet(first);
    const b = inSheet(second);
    await act(async () => {
      fireEvent.click(a);
      fireEvent.click(b);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', status);
    expect(mocks.skipSubscriptionCycle).not.toHaveBeenCalled();
    await act(async () => d.resolve({ ...SUB, status }));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it.each([
    ['"Bỏ qua kỳ này" rồi "Vẫn huỷ"', 'Bỏ qua kỳ này', 'Vẫn huỷ'],
    ['"Bỏ qua kỳ này" rồi "Tạm dừng"', 'Bỏ qua kỳ này', 'Tạm dừng'],
  ] as const)('khoá chéo skipMut → statusMut, %s cùng một khung hình: chỉ skip gọi API', async (_label, first, second) => {
    const d = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValue(d.promise);
    renderPanel();
    await openRetention();
    const a = inSheet(first);
    const b = inSheet(second);
    await act(async () => {
      fireEvent.click(a);
      fireEvent.click(b);
    });
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(1);
    expect(mocks.setSubscriptionStatus).not.toHaveBeenCalled();
    await act(async () => d.resolve(SUB));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('khoá chéo statusMut → skipMut: "Vẫn huỷ" rồi "Bỏ qua kỳ này" cùng một khung hình, chỉ CANCELLED gọi API', async () => {
    const d = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValue(d.promise);
    renderPanel();
    await openRetention();
    const cancel = inSheet('Vẫn huỷ');
    const skip = inSheet('Bỏ qua kỳ này');
    await act(async () => {
      fireEvent.click(cancel);
      fireEvent.click(skip);
    });
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.skipSubscriptionCycle).not.toHaveBeenCalled();
    await act(async () => d.resolve({ ...SUB, status: 'CANCELLED' }));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('skip lỗi nhả khoá chung: sau đó "Vẫn huỷ" gọi được, sheet đóng', async () => {
    const skip = deferred<Record<string, unknown>>();
    mocks.skipSubscriptionCycle.mockReturnValueOnce(skip.promise);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(inSheet('Bỏ qua kỳ này')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => skip.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(inSheet('Vẫn huỷ')).toBeEnabled());
    fireEvent.click(inSheet('Vẫn huỷ'));
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledWith('s1', 'CANCELLED'));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('đổi trạng thái lỗi nhả khoá chung: sau đó "Bỏ qua kỳ này" gọi được', async () => {
    const d = deferred<Record<string, unknown>>();
    mocks.setSubscriptionStatus.mockReturnValueOnce(d.promise);
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Tạm dừng'));
    await waitFor(() => expect(inSheet('Tạm dừng')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => d.reject(new Error('boom')));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(inSheet('Bỏ qua kỳ này')).toBeEnabled());
    expect(retentionSheet().open).toBe(true);
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(mocks.skipSubscriptionCycle).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });
});

describe('SubscriptionsPanel: khoá giữ tới khi danh sách làm mới về (W87A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValue([SUB]);
  });

  it('"Tạm dừng" xong mà danh sách chưa về: nút vẫn bận và bấm thêm không gửi lệnh thứ hai; danh sách về thì nút thành "Tiếp tục" và hết bận', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    const stale = cardBtns('Tạm dừng')[0]!;
    expect(stale).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(stale);
    fireEvent.click(stale);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([{ ...SUB, status: 'PAUSED' }]));
    const resume = await screen.findByRole('button', { name: 'Tiếp tục' });
    expect(resume).not.toHaveAttribute('aria-busy');
    expect(resume).toBeEnabled();
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it('"Vẫn huỷ" xong mà danh sách chưa về: sheet đóng ngay sau lệnh, nút thẻ vẫn khoá (không nút nào xoay nhầm); danh sách về thì mở lại, một lệnh duy nhất', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise);
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Vẫn huỷ'));
    await waitFor(() => expect(haptic).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    expect(cardBtns('Tạm dừng')[0]).toBeDisabled();
    expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy');
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([{ ...SUB, status: 'CANCELLED' }]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ' })).toBeEnabled());
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it('"Bỏ qua kỳ này" xong mà danh sách chưa về: các nút thẻ vẫn khoá (kỳ giao kế tiếp còn là số cũ); danh sách về thì mở lại', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise);
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' })));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    expect(screen.getByRole('button', { name: 'Sửa' })).toBeDisabled();
    expect(cardBtns('Tạm dừng')[0]).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    await act(async () => refreshed.resolve([SUB]));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sửa' })).toBeEnabled());
    expect(cardBtns('Tạm dừng')[0]).toBeEnabled();
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionsPanel: "Thử lại" danh sách khoá chạm đúp (W87A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValue([SUB]);
  });

  // Truy vấn chưa có dữ liệu thì react-query gộp hai lần refetch làm một, nên chỉ ca còn dữ liệu cũ mà lần làm mới lỗi mới chứng minh được khoá của nút
  // (refetch thứ hai sẽ huỷ rồi chạy lại).
  async function renderWithRefreshError() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={qc}><SubscriptionsPanel /></QueryClientProvider>);
    await screen.findByText('Nước xả vải Tubu');
    mocks.getSubscriptions.mockRejectedValueOnce(new Error('mất mạng'));
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
    });
    return screen.findByRole('button', { name: 'Thử lại' });
  }

  it('chạm đúp trong cùng một khung hình chỉ tải lại một lần', async () => {
    const retry = await renderWithRefreshError();
    const next = deferred<unknown[]>();
    mocks.getSubscriptions.mockReturnValueOnce(next.promise);
    const before = mocks.getSubscriptions.mock.calls.length;
    await act(async () => {
      fireEvent.click(retry);
      fireEvent.click(retry);
    });
    expect(mocks.getSubscriptions.mock.calls.length - before).toBe(1);
    await act(async () => next.resolve([SUB]));
    await screen.findByText('Nước xả vải Tubu');
  });

  it('hai cú chạm ở hai lần act liên tiếp (lượt tải chưa về) vẫn chỉ một lần', async () => {
    const retry = await renderWithRefreshError();
    const next = deferred<unknown[]>();
    mocks.getSubscriptions.mockReturnValueOnce(next.promise);
    const before = mocks.getSubscriptions.mock.calls.length;
    await act(async () => {
      fireEvent.click(retry);
    });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(mocks.getSubscriptions.mock.calls.length - before).toBe(1);
    await act(async () => next.resolve([SUB]));
    await screen.findByText('Nước xả vải Tubu');
  });
});

describe('SubscriptionsPanel: "Sửa" chờ danh sách làm mới, khoá giữ danh sách có hạn (W87A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValue([SUB]);
  });
  const qtyShown = () => screen.getByRole('button', { name: 'Giảm số lượng' }).nextElementSibling?.textContent;

  it('lưu ở sheet "Sửa" xong mà danh sách chưa về: "Sửa" không mở lại sheet trên số liệu cũ; danh sách về thì mở với số lượng MỚI', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise);
    mocks.updateSubscription.mockResolvedValue({ ...SUB, quantity: 3 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    await screen.findByText('Sửa gói định kỳ');
    expect(qtyShown()).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Tăng số lượng' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
    await waitFor(() => expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { quantity: 3 }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Sửa gói định kỳ')).toBeNull());
    const edit = screen.getByRole('button', { name: 'Sửa' });
    await waitFor(() => expect(edit).toBeDisabled());
    fireEvent.click(edit);
    expect(screen.queryByText('Sửa gói định kỳ')).toBeNull();
    await act(async () => refreshed.resolve([{ ...SUB, quantity: 3 }]));
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    await screen.findByText('Sửa gói định kỳ');
    expect(qtyShown()).toBe('3');
    expect(screen.getByRole('button', { name: 'Lưu thay đổi' })).toBeDisabled();
  });
});

describe('SubscriptionsPanel: khoá giữ danh sách có hạn 4 giây khi làm mới không về (W87A)', () => {
  const never = () => new Promise<unknown[]>(() => undefined);
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    // shouldAdvanceTime để bộ đếm giờ của react-query và waitFor vẫn chạy; chỉ cần giả setTimeout để tua tới hạn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(never());
  });
  afterEach(() => vi.useRealTimers());

  it('"Tạm dừng" trên thẻ: còn khoá ở 3 giây, nhả sau 4 giây dù danh sách chưa về', async () => {
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'PAUSED' });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await advance(3_000);
    expect(cardBtns('Tạm dừng')[0]).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    await advance(1_500);
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy'));
    fireEvent.click(cardBtns('Tạm dừng')[0]!);
    await waitFor(() => expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(2));
  });

  it('"Vẫn huỷ" trong sheet: nút thẻ còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    mocks.setSubscriptionStatus.mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Vẫn huỷ'));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await advance(3_000);
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    await advance(1_500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ' })).toBeEnabled());
  });

  it('"Bỏ qua kỳ này": nút thẻ còn khoá ở 3 giây, nhả sau 4 giây', async () => {
    mocks.skipSubscriptionCycle.mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await advance(3_000);
    expect(screen.getByRole('button', { name: 'Huỷ' })).toBeDisabled();
    await advance(1_500);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Huỷ' })).toBeEnabled());
  });
});

describe('SubscriptionsPanel: lệnh bị từ chối vì lịch đã đổi thì tải lại danh sách (W98A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    // Hàng đợi `...Once` của test trước không được rò sang test sau (clearAllMocks không xoá chúng).
    for (const m of [mocks.getSubscriptions, mocks.setSubscriptionStatus, mocks.skipSubscriptionCycle]) m.mockReset();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });

  it.each([
    [400, 'Chỉ bỏ qua kỳ khi lịch đang chạy.'],
    [404, 'Không tìm thấy lịch đặt định kỳ.'],
    [409, 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.'],
  ])('"Tạm dừng" bị từ chối %i: báo lời máy chủ rồi tải lại danh sách, thẻ hiện đúng trạng thái thật (cron đã tạm dừng gói)', async (status, message) => {
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockResolvedValueOnce([{ ...SUB, status: 'PAUSED' as const }]);
    mocks.setSubscriptionStatus.mockRejectedValue(serverError(message, status));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: message, type: 'error' }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    const resume = await screen.findByRole('button', { name: 'Tiếp tục' });
    expect(resume).not.toHaveAttribute('aria-busy');
    expect(resume).toBeEnabled();
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
  });

  it('"Bỏ qua kỳ này" bị từ chối 400 vì gói đã tạm dừng: tải lại danh sách, sheet hết nút "Bỏ qua kỳ này" (không bấm lặp lại cùng lỗi)', async () => {
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockResolvedValueOnce([{ ...SUB, status: 'PAUSED' as const }]);
    mocks.skipSubscriptionCycle.mockRejectedValue(serverError('Chỉ bỏ qua kỳ khi lịch đang chạy.', 400));
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Chỉ bỏ qua kỳ khi lịch đang chạy.', type: 'error' }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(sheetEl()!).queryByRole('button', { name: 'Bỏ qua kỳ này' })).toBeNull());
    expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(1);
  });

  it('khoá giữ tới khi danh sách tải lại về: nút thẻ vẫn bận lúc chờ, bấm thêm không gửi lệnh thứ hai', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise);
    mocks.setSubscriptionStatus.mockRejectedValue(serverError('Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.', 409));
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    const stale = cardBtns('Tạm dừng')[0]!;
    expect(stale).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(stale);
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([{ ...SUB, status: 'PAUSED' as const }]));
    expect(await screen.findByRole('button', { name: 'Tiếp tục' })).not.toHaveAttribute('aria-busy');
  });

  it.each([
    ['máy chủ lỗi 500', serverError('Internal server error', 500)],
    ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
    ['quá thời gian', new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED')],
  ])('%s: chỉ báo lỗi, KHÔNG tải lại danh sách (lỗi tạm không nói gì về trạng thái thật của gói)', async (_name, err) => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockRejectedValue(err);
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Tạm dừng' }));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(cardBtns('Tạm dừng')[0]).not.toHaveAttribute('aria-busy'));
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Không tải được|Thử lại/)).toBeNull();
  });
});

// W113A: sheet giữ chân (chỉ ba lựa chọn, không ô nhập) đóng khi máy chủ từ chối hẳn lệnh (400/404/409/422); riêng 400/404/409 còn tải lại danh sách và giữ khoá tới khi dữ liệu về (tối đa LOCK_REFRESH_WAIT_MS). Mất mạng, quá hạn, 401, 5xx: sheet còn mở, nhả khoá ngay, không tải lại.
describe('SubscriptionsPanel: sheet giữ chân đóng khi lệnh bị từ chối hẳn (W113A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = (text: string) => mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error' && o.text === text).length;
  const cardCancel = () => screen.getByRole('button', { name: 'Huỷ' });
  type Case = { name: string; write: ReturnType<typeof vi.fn>; label: string; succeed: unknown };
  const CASES: Case[] = [
    { name: 'Bỏ qua kỳ này (skipMut)', write: mocks.skipSubscriptionCycle, label: 'Bỏ qua kỳ này', succeed: SUB },
    { name: '"Tạm dừng" trong sheet (statusMut)', write: mocks.setSubscriptionStatus, label: 'Tạm dừng', succeed: { ...SUB, status: 'PAUSED' } },
    { name: '"Vẫn huỷ" (statusMut)', write: mocks.setSubscriptionStatus, label: 'Vẫn huỷ', succeed: { ...SUB, status: 'CANCELLED' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of [mocks.getSubscriptions, mocks.setSubscriptionStatus, mocks.skipSubscriptionCycle]) m.mockReset();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each(CASES)('$name', (c) => {
    it.each([
      [400, 'Gói đã thay đổi'],
      [404, 'Không tìm thấy lịch đặt định kỳ.'],
      [409, 'Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.'],
    ])('bị từ chối %i: báo lỗi một lần, tải lại danh sách, sheet còn mở và khoá giữ tới khi dữ liệu về, rồi sheet đóng và khoá nhả', async (status, message) => {
      const refreshed = deferred<unknown[]>();
      mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise).mockResolvedValue([SUB]);
      c.write.mockRejectedValueOnce(serverError(message, status)).mockResolvedValue(c.succeed);
      renderPanel();
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(errorToasts(message)).toBe(1));
      await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
      await settle();
      // Danh sách chưa về: sheet còn mở, nút thẻ còn khoá, chạm lên nút thẻ không gửi thêm lệnh nào.
      expect(retentionSheet().open).toBe(true);
      expect(cardCancel()).toBeDisabled();
      fireEvent.click(cardBtns('Tạm dừng')[0]!);
      expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(c.write === mocks.setSubscriptionStatus ? 1 : 0);
      expect(mocks.skipSubscriptionCycle).toHaveBeenCalledTimes(c.write === mocks.skipSubscriptionCycle ? 1 : 0);
      await act(async () => refreshed.resolve([SUB]));
      await waitFor(() => expect(retentionSheet().open).toBe(false));
      await settle();
      await waitFor(() => expect(cardCancel()).toBeEnabled());
      expect(errorToasts(message)).toBe(1);
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('bị từ chối 422: đóng sheet và báo lỗi nhưng không tải lại danh sách, nhả khoá ngay', async () => {
      mocks.getSubscriptions.mockResolvedValue([SUB]);
      c.write.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue(c.succeed);
      renderPanel();
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(errorToasts('Dữ liệu không hợp lệ')).toBe(1));
      await waitFor(() => expect(retentionSheet().open).toBe(false));
      await waitFor(() => expect(cardCancel()).toBeEnabled());
      await settle();
      expect(mocks.getSubscriptions).toHaveBeenCalledTimes(1);
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it.each([
      ['mất mạng', new HttpError('Network Error', 'ERR_NETWORK')],
      ['hết thời gian', new HttpError('timeout of 15000ms exceeded', 'ECONNABORTED')],
      ['máy chủ lỗi 503', serverError('Service Unavailable', 503)],
      ['hết phiên 401', serverError('Unauthorized', 401)],
    ])('%s: sheet còn mở, nhả khoá ngay, không tải lại danh sách', async (_label, error) => {
      mocks.getSubscriptions.mockResolvedValue([SUB]);
      c.write.mockRejectedValueOnce(error).mockResolvedValue(c.succeed);
      renderPanel();
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
      await waitFor(() => expect(inSheet(c.label)).not.toHaveAttribute('aria-busy'));
      expect(retentionSheet().open).toBe(true);
      expect(inSheet('Vẫn huỷ')).toBeEnabled();
      await settle();
      expect(mocks.getSubscriptions).toHaveBeenCalledTimes(1);
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });

    it('tải lại treo mãi: sheet và nút thẻ còn khoá ở 3 giây, sheet đóng và khoá nhả sau 4 giây', async () => {
      mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue([SUB]);
      c.write.mockRejectedValueOnce(serverError('Lịch giao vừa thay đổi, hãy tải lại rồi thử lại.', 409)).mockResolvedValue(c.succeed);
      renderPanel();
      await openRetention();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
      });
      expect(retentionSheet().open).toBe(true);
      expect(cardCancel()).toBeDisabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await waitFor(() => expect(retentionSheet().open).toBe(false));
      await waitFor(() => expect(cardCancel()).toBeEnabled());
      vi.useRealTimers();
      await openRetention();
      fireEvent.click(inSheet(c.label));
      await waitFor(() => expect(c.write).toHaveBeenCalledTimes(2));
    });
  });
});

describe('SubscriptionsPanel: sheet giữ chân đóng SAU khi danh sách mới về (W115A)', () => {
  const serverError = (message: string, status: number) => new HttpError(message, undefined, { status, data: { message } } as never);
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  const errorToasts = (text: string) => mocks.openSnackbar.mock.calls.filter(([o]) => o.type === 'error' && o.text === text).length;
  const cardCancel = () => screen.getByRole('button', { name: 'Huỷ' });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const m of [mocks.getSubscriptions, mocks.setSubscriptionStatus, mocks.skipSubscriptionCycle]) m.mockReset();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('thứ tự: lỗi hiện trước, sheet còn mở và nút "Vẫn huỷ" bận lúc danh sách chưa về, danh sách về thì sheet đóng đúng một lần rồi khoá nhả', async () => {
    const refreshed = deferred<unknown[]>();
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(refreshed.promise).mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockRejectedValueOnce(serverError('Lịch giao vừa thay đổi', 409)).mockResolvedValue({ ...SUB, status: 'CANCELLED' });
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Vẫn huỷ'));
    await waitFor(() => expect(errorToasts('Lịch giao vừa thay đổi')).toBe(1));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await settle();
    expect(retentionSheet().open).toBe(true);
    expect(inSheet('Vẫn huỷ')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(inSheet('Vẫn huỷ'));
    expect(mocks.setSubscriptionStatus).toHaveBeenCalledTimes(1);
    await act(async () => refreshed.resolve([SUB]));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    await settle();
    await waitFor(() => expect(cardCancel()).toBeEnabled());
    expect(errorToasts('Lịch giao vừa thay đổi')).toBe(1);
  });

  it('422: không có gì để chờ nên sheet đóng ngay, không tải lại danh sách, nhả khoá ngay', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.skipSubscriptionCycle.mockRejectedValueOnce(serverError('Dữ liệu không hợp lệ', 422)).mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(errorToasts('Dữ liệu không hợp lệ')).toBe(1));
    await waitFor(() => expect(retentionSheet().open).toBe(false));
    await waitFor(() => expect(cardCancel()).toBeEnabled());
    await settle();
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('tải lại treo mãi: sheet còn mở ở LOCK_REFRESH_WAIT_MS - 500, đã đóng ở LOCK_REFRESH_WAIT_MS + 100', async () => {
    mocks.getSubscriptions.mockResolvedValueOnce([SUB]).mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue([SUB]);
    mocks.skipSubscriptionCycle.mockRejectedValueOnce(serverError('Chỉ bỏ qua kỳ khi lịch đang chạy.', 400)).mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    fireEvent.click(inSheet('Bỏ qua kỳ này'));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LOCK_REFRESH_WAIT_MS - 500);
    });
    expect(retentionSheet().open).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    await waitFor(() => expect(retentionSheet().open).toBe(false));
  });

  it('máy chủ lỗi 503: sheet giữ mở, không tải lại, nhả khoá ngay (không đổi so với trước)', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    mocks.setSubscriptionStatus.mockRejectedValueOnce(serverError('Service Unavailable', 503)).mockResolvedValue(SUB);
    renderPanel();
    await openRetention();
    fireEvent.click(inSheet('Tạm dừng'));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    await waitFor(() => expect(inSheet('Tạm dừng')).not.toHaveAttribute('aria-busy'));
    await settle();
    expect(retentionSheet().open).toBe(true);
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionsPanel Mini: phân loại không có tên', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sheetSpy.calls.length = 0;
    mocks.getAddresses.mockResolvedValue([ADDR('a1', '1 Lê Lợi'), ADDR('a2', '9 Hai Bà Trưng')]);
    mocks.getWallet.mockResolvedValue({ walletBalance: 50000 });
  });
  const editDescription = () => (sheetSpy.calls.filter((c) => c.title === 'Sửa gói định kỳ').at(-1) as unknown as { description?: string }).description;

  it('có tên: "phân loại · SL n" và mô tả sheet sửa "tên · phân loại" như trước', async () => {
    mocks.getSubscriptions.mockResolvedValue([SUB]);
    renderPanel();
    expect(await screen.findByText('Hương sả · SL 2')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
    await screen.findByText('Sửa gói định kỳ');
    expect(editDescription()).toBe('Nước xả vải Tubu · Hương sả');
  });

  it('tên trống hoặc toàn khoảng trắng: chỉ "SL n" (không " · " mở đầu), mô tả sheet sửa chỉ tên sản phẩm', async () => {
    for (const variationName of ['', '   ']) {
      mocks.getSubscriptions.mockResolvedValue([{ ...SUB, variationName }]);
      const { unmount } = renderPanel();
      expect(await screen.findByText('SL 2')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }));
      await screen.findByText('Sửa gói định kỳ');
      expect(editDescription()).toBe('Nước xả vải Tubu');
      unmount();
      sheetSpy.calls.length = 0;
    }
  });
});
