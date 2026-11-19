import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ZmpUi from 'zmp-ui';
import type * as RefillApiModule from '@tubutree/app-core/refill/refill-api';

const mocks = vi.hoisted(() => ({
  on: true,
  navigate: vi.fn(),
  openSnackbar: vi.fn(),
  fetchPurchasedItems: vi.fn(),
  addToCart: vi.fn(),
  pairs: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => mocks.navigate,
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../../services/shop-api', () => ({
  fetchPurchasedItems: mocks.fetchPurchasedItems,
  addToCart: mocks.addToCart,
  repurchaseOrder: vi.fn(),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  fetchProducts: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 12, total: 0 } }),
  getCart: mocks.getCart,
}));
vi.mock('../../services/bundle-api', () => ({ getHomeCombos: vi.fn().mockResolvedValue([]) }));
vi.mock('../../services/cart-batch', () => ({ addAllToCart: vi.fn() }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ subscribeDiscountPct: 0.1, refillFirstEnabled: mocks.on }) }));
vi.mock('@tubutree/app-core/refill/refill-api', async (importOriginal) => ({
  ...(await importOriginal<typeof RefillApiModule>()),
  myRefillPairsQuery: (_http: unknown, ids: readonly string[]) => ({
    queryKey: ['refill-pairs', 'mine', ids.join(',')],
    queryFn: () => mocks.pairs(ids),
    retry: false,
  }),
}));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'authenticated' }) }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../../services/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { PurchasedRail } from './purchased-rail';
import { trackEvent } from '../../services/analytics';

const bought = (i: number) => ({
  variationId: `v${i}`, productId: `p${i}`, slug: `sp-${i}`, productName: `Chai ${i}`, variationName: null, brand: 'Fuwa3e', thumbnail: null,
  price: 60_000, salePrice: null, stock: 8, inStock: true, timesBought: 1, retailOnly: false, lastPurchasedAt: '2026-10-10T00:00:00.000Z',
});
const OFFER = { productId: 'p-r', slug: 'refill-10l', name: 'Nước rửa chén Fuwa3e 10L', thumbnail: null, variationId: 'v-r', price: 650_000, compareAt: null, sizeLabel: '10L', inStock: true, tubu: true };

function renderRail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PurchasedRail source="home_rail" />
    </QueryClientProvider>,
  );
}
const cards = (strip: HTMLElement) => within(strip).getAllByTestId('quick-reorder-card');
const ids = (strip: HTMLElement) => cards(strip).map((c) => c.getAttribute('data-variation-id'));

describe('Dải "Mua lại món quen": chai khách đã có thành gói Refill (catalog.refill_first_enabled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.on = true;
    mocks.fetchPurchasedItems.mockResolvedValue({ items: [bought(0), bought(1)], nextCursor: null });
    mocks.pairs.mockResolvedValue({ p0: OFFER });
  });

  it('cờ tắt: không hỏi cặp, dải như cũ', async () => {
    mocks.on = false;
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    expect(ids(strip)).toEqual(['v0', 'v1']);
    expect(mocks.pairs).not.toHaveBeenCalled();
  });

  it('ô chai thành gói Refill; "+ Thêm" thêm đúng gói refill và ghi sự kiện, không chuyển trang', async () => {
    mocks.addToCart.mockResolvedValue({ items: [] });
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    await waitFor(() => expect(ids(strip)).toEqual(['v-r', 'v1']));
    expect(mocks.pairs).toHaveBeenCalledWith(['p0', 'p1']);
    expect(cards(strip)[0]).toHaveTextContent('Nước rửa chén Fuwa3e 10L');
    expect(cards(strip)[0]).toHaveTextContent('650.000đ');
    expect(cards(strip)[0]).toHaveTextContent('Đổi sang túi Refill 10L');
    expect(trackEvent).toHaveBeenCalledWith('refill_swap_shown', 'miniapp', { surface: 'reorder' });
    const add = within(cards(strip)[0]!).getByTestId('quick-reorder-add');
    expect(add).toHaveTextContent('+ Thêm Refill');
    expect(add).toHaveAttribute('aria-label', 'Thêm Refill 10L thay cho Chai 0 vào giỏ, 650.000đ');
    expect(within(cards(strip)[1]!).getByTestId('quick-reorder-add')).toHaveTextContent('+ Thêm');
    expect(within(strip).getByRole('button', { name: /^Thêm lại tất cả 2 món vào giỏ, tổng .*, gồm 1 túi Refill$/ })).toBeInTheDocument();
    fireEvent.click(add);
    await waitFor(() => expect(mocks.addToCart).toHaveBeenCalledWith('v-r', 1, 'repurchase'));
    expect(trackEvent).toHaveBeenCalledWith('refill_swap_applied', 'miniapp', { surface: 'reorder' });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('mở ô Refill: tấm Mua lại của đúng chai cũ (khách vẫn mua lại được món cũ), không sang trang gói refill', async () => {
    renderRail();
    const strip = await screen.findByTestId('quick-reorder');
    await waitFor(() => expect(ids(strip)[0]).toBe('v-r'));
    const open = within(cards(strip)[0]!).getAllByRole('button').find((b) => b.getAttribute('data-testid') !== 'quick-reorder-add')!;
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Chai 0');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
