import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
