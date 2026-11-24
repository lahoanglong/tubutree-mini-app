import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Thẻ "Kỳ Refill tới" (Mini App): ngày giao kỳ tới, giá định kỳ so giá lẻ, dời +7 ngày một chạm. Cùng luật với web components/refill/refill-next-delivery.

const mocks = vi.hoisted(() => ({
  goSmart: vi.fn(),
  getSubscriptions: vi.fn(),
  updateSubscription: vi.fn(),
  status: 'authenticated' as string,
}));
vi.mock('../../lib/smart-nav', () => ({ useSmartNavigate: () => mocks.goSmart }));
vi.mock('../../store/auth', () => ({ useAuthStore: (pick: (s: { status: string }) => unknown) => pick({ status: mocks.status }) }));
vi.mock('../../services/subscriptions-api', () => ({
  getSubscriptions: mocks.getSubscriptions,
  updateSubscription: mocks.updateSubscription,
  isStaleSubscriptionError: (e: { stale?: boolean }) => e?.stale === true,
}));
vi.mock('../../services/api', () => ({ getErrorMessage: (e: Error) => e.message }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { RefillNextDelivery } from './refill-next-delivery';

/** 12h00 ngày 20/10/2026 giờ VN. */
const NOW = new Date('2026-10-20T05:00:00.000Z');

const LANDING = {
  enabled: true,
  pairs: [
    {
      bottle: { productId: 'b1', slug: 'chai-a', name: 'Chai a', thumbnail: null, price: 100_000, compareAt: null, sizeLabel: '1L', inStock: true },
      refill: { productId: 'r1', slug: 'refill-a', name: 'Túi Refill a', thumbnail: null, variationId: 'v1', price: 189_000, compareAt: null, sizeLabel: '3L', inStock: true, tubu: true },
      savingPct: 20,
    },
  ],
};

const sub = (over: Record<string, unknown> = {}) => ({
  id: 's1', quantity: 2, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: '2026-11-02T17:00:00.000Z', productName: 'Túi Refill a 3L', variationName: 'Túi 3L',
  thumbnail: null, slug: 'refill-a', unitPrice: 189_000, effectiveDiscountPct: 0.12, cycleSubtotal: 378_000, cycleDiscount: 45_360, cycleGoods: 332_640, ...over,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RefillNextDelivery landing={LANDING} />
    </QueryClientProvider>,
  );
}
const postponeButton = () => screen.getByTestId('refill-next-postpone');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.clearAllMocks();
  mocks.status = 'authenticated';
  mocks.getSubscriptions.mockReset().mockResolvedValue([sub()]);
  mocks.updateSubscription.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RefillNextDelivery (Mini App, tubu-w27-01)', () => {
  it('ngày giao kỳ tới kèm thứ, món và số lượng, giá định kỳ gạch giá lẻ, nút +7 ngày nói rõ ngày mới; "Quản lý" mở tab Định kỳ', async () => {
    mount();
    const card = await screen.findByTestId('refill-next-delivery');
    expect(screen.getByRole('heading', { level: 2, name: 'Kỳ Refill tới' })).toBeTruthy();
    expect(screen.getByTestId('refill-next-date').textContent).toBe('Thứ Ba, 03/11/2026');
    expect(card.textContent).toContain('Túi Refill a 3L · SL 2');
    const price = screen.getByTestId('refill-next-price');
    expect(price.textContent).toContain('332.640đ');
    expect(price.textContent).toContain('378.000đ');
    expect(card.textContent).toContain('Giá định kỳ −12%, rẻ hơn giá lẻ 45.360đ');
    expect(postponeButton().textContent).toContain('Dời lịch kỳ tới (+7 ngày)');
    expect(postponeButton().getAttribute('aria-label')).toBe('Dời lịch kỳ tới 7 ngày, sang Thứ Ba, 10/11/2026');
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý gói định kỳ' }));
    expect(mocks.goSmart).toHaveBeenCalledWith('/orders?tab=subscriptions');
  });

  it('dời một chạm: PATCH ngày mới kèm nextRunAt thẻ đang hiện, chạm đúp chỉ một lệnh, báo ngày mới trong thẻ, tải lại danh sách rồi ngày trên thẻ đổi', async () => {
    let resolve!: (v: unknown) => void;
    mocks.updateSubscription.mockImplementation(() => new Promise((r) => (resolve = r)));
    mount();
    await screen.findByTestId('refill-next-delivery');
    await act(async () => {
      fireEvent.click(postponeButton());
    });
    fireEvent.click(postponeButton());
    expect(mocks.updateSubscription).toHaveBeenCalledTimes(1);
    expect(mocks.updateSubscription).toHaveBeenCalledWith('s1', { nextRunDate: '2026-11-10', expectedNextRunAt: '2026-11-02T17:00:00.000Z' });
    mocks.getSubscriptions.mockResolvedValue([sub({ nextRunAt: '2026-11-09T17:00:00.000Z' })]);
    await act(async () => resolve(sub({ nextRunAt: '2026-11-09T17:00:00.000Z' })));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Đã dời kỳ tới sang Thứ Ba, 10/11/2026'));
    await waitFor(() => expect(screen.getByTestId('refill-next-date').textContent).toBe('Thứ Ba, 10/11/2026'));
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('lịch vừa đổi (409): báo lời máy chủ, tải lại danh sách; lỗi mạng thì không tải lại', async () => {
    mocks.updateSubscription.mockRejectedValueOnce(Object.assign(new Error('Lịch giao vừa thay đổi, bạn xem lại nhé.'), { stale: true }));
    mount();
    await screen.findByTestId('refill-next-delivery');
    await act(async () => {
      fireEvent.click(postponeButton());
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Lịch giao vừa thay đổi, bạn xem lại nhé.'));
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2));

    mocks.updateSubscription.mockRejectedValueOnce(new Error('Mất kết nối mạng'));
    await waitFor(() => expect(postponeButton().getAttribute('aria-disabled')).toBeNull());
    await act(async () => {
      fireEvent.click(postponeButton());
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Mất kết nối mạng'));
    expect(mocks.getSubscriptions).toHaveBeenCalledTimes(2);
  });

  it('+7 ngày vượt 90 ngày tới: nút aria-disabled, nói ngày xa nhất, chạm không gửi gì', async () => {
    mocks.getSubscriptions.mockResolvedValue([sub({ nextRunAt: '2027-01-14T17:00:00.000Z' })]);
    mount();
    await screen.findByTestId('refill-next-delivery');
    expect(postponeButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Chỉ dời được tới Thứ Hai, 18/01/2027')).toBeTruthy();
    fireEvent.click(postponeButton());
    expect(mocks.updateSubscription).not.toHaveBeenCalled();
  });

  it('chưa đăng nhập: không gọi /me/subscriptions, không vẽ; gói tạm dừng hay không phải Refill: không vẽ', async () => {
    mocks.status = 'guest';
    const guest = mount();
    expect(guest.container.innerHTML).toBe('');
    expect(mocks.getSubscriptions).not.toHaveBeenCalled();
    guest.unmount();

    mocks.status = 'authenticated';
    mocks.getSubscriptions.mockResolvedValue([sub({ status: 'PAUSED' }), sub({ id: 's2', slug: 'chai-a' })]);
    const other = mount();
    await waitFor(() => expect(mocks.getSubscriptions).toHaveBeenCalled());
    await act(async () => {});
    expect(other.container.innerHTML).toBe('');
  });
});
