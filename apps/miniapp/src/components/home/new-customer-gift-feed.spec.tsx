import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Nối thật NewCustomerGift → fetchHasAnyOrder → khối /home/me (chỉ giả lớp HTTP): tài khoản khách đã có đơn thì dải ẩn mà không tốn lời /orders.
vi.mock('../../services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => vi.fn() }));
vi.mock('../../store/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ status: 'authenticated', user: { id: 'u1', phone: null, zaloId: 'guest_1' }, ensurePhoneOrThrow: vi.fn() }),
}));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { api } from '../../services/api';
import { armHomeFeed, disarmHomeFeed } from '../../services/home-feed';
import { NewCustomerGift } from './new-customer-gift';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const CONFIG = {
  freeshipThreshold: 350_000,
  subscribeDiscountPct: 0.17,
  affiliateWalletMultiplier: 1,
  cashbackHoldDays: 30,
  newCustomer: { welcomeVoucher: { amount: 25_000, minOrder: 150_000 }, firstOrderFreeShip: { enabled: false, minSubtotal: 0 } },
  loyalty: { earnPct: 2, vndPerPoint: 50, vndPerPointRedeem: 1_000 },
};

function renderWithFeed(me: Record<string, unknown>, ordersTotal = 0) {
  get.mockImplementation(async (path: string) => {
    if (path === '/home') return { data: { publicConfig: CONFIG } };
    if (path === '/home/me') return { data: me };
    if (path === '/config/public') return { data: CONFIG };
    return { data: { data: [], meta: { page: 1, limit: 1, total: ordersTotal } } };
  });
  armHomeFeed(() => 'u1:g');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NewCustomerGift />
    </QueryClientProvider>,
  );
}
const paths = () => get.mock.calls.map((c) => c[0]);

describe('NewCustomerGift với khối /home/me thật (tài khoản khách)', () => {
  afterEach(() => {
    disarmHomeFeed();
    get.mockReset();
  });

  it('/home/me báo hasOrders=true: dải ẩn, không gọi /orders', async () => {
    const { container } = renderWithFeed({ hasOrders: true });
    await waitFor(() => expect(paths()).toContain('/home/me'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(paths()).not.toContain('/orders');
  });

  it('/home/me báo hasOrders=false: dải hiện, không gọi /orders', async () => {
    renderWithFeed({ hasOrders: false });
    expect(await screen.findByRole('region', { name: 'Quà khách mới' })).toBeInTheDocument();
    expect(paths()).not.toContain('/orders');
  });

  it('API cũ chưa có hasOrders: lùi về /orders, có đơn thì vẫn ẩn', async () => {
    const { container } = renderWithFeed({ forYou: [] }, 1);
    await waitFor(() => expect(paths()).toContain('/orders'));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
