import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

import { SubscriptionEditSheet, subscriptionPatch } from './subscription-edit-sheet';

const SUB = {
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE' as const, nextRunAt: '2026-11-07T03:00:00.000Z',
  addressId: 'a1', paymentMethod: 'COD' as const, lastOrderId: 'o1', lastOrderAt: '2026-10-10T03:00:00.000Z',
  productName: 'Nước xả vải Tubu', variationName: 'Hương sả', thumbnail: null, slug: 'nxv', unitPrice: 80000, effectiveDiscountPct: 0.14,
};

function renderSheet(sub = SUB) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SubscriptionEditSheet sub={sub} onClose={mocks.onClose} /></QueryClientProvider>);
}

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
