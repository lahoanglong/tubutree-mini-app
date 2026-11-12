import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phân loại không đặt tên (86/154 phân loại trên PROD): dòng sản phẩm của chi tiết đơn không treo " · " sau tên,
// và đoạn tóm tắt "Sao chép thông tin đơn" không ghi "()" sau tên.

const mocks = vi.hoisted(() => ({ fetchOrder: vi.fn(), copyText: vi.fn() }));

vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/orders/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: vi.fn(),
  getPublicConfig: vi.fn().mockResolvedValue({}),
  fetchMyReturns: vi.fn().mockResolvedValue([]),
  cancelOrder: vi.fn(),
  fetchMyRefunds: vi.fn().mockResolvedValue([]),
  fetchRefundBank: vi.fn(),
  chooseRefundDestination: vi.fn(),
  requestReturn: vi.fn(),
  addToCart: vi.fn(),
  repurchaseOrder: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('../services/waste-api', async (orig) => ({ ...(await orig<object>()), getWasteRequestByOrder: vi.fn().mockResolvedValue(null) }));
vi.mock('../services/zmp-bridge', () => ({
  hasOA: false,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: true }),
  setOaPromptState: vi.fn(),
  shouldShowFollowOaPrompt: () => false,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../utils/clipboard', () => ({ copyText: mocks.copyText }));

import OrderDetailPage from './order-detail';

const orderWith = (variationNames: (string | null)[]) => ({
  id: 'o1', code: 'TT001', status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'PAID', createdAt: '2026-10-01T03:00:00.000Z',
  subtotal: 100_000, discount: 0, pointsUsed: 0, pointsEarned: 0, shippingFee: 20_000, total: 120_000, hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: variationNames.map((variationName, i) => ({ id: `oi${i}`, productName: `Xà bông ${i + 1}`, variationName, productSlug: `xb-${i + 1}`, quantity: 2, total: 100_000, backorderedQty: 0 })),
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}
/** Dòng sản phẩm: ô chữ "tên · phân loại ×SL" (span zaui-text-small chứa span ×SL) nằm cạnh ảnh. */
const productLine = (name: string) => {
  const found = Array.from(document.querySelectorAll<HTMLElement>('span.zaui-text-small')).find(
    (el) => (el.textContent ?? '').startsWith(name) && el.querySelector(':scope > span.zaui-text-xSmall')?.textContent === '×2',
  );
  if (!found) throw new Error(`không thấy dòng sản phẩm ${name}`);
  return found;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.copyText.mockResolvedValue(true);
});

describe('OrderDetailPage Mini — phân loại không có tên', () => {
  it('có tên: "tên · phân loại ×SL" như trước', async () => {
    mocks.fetchOrder.mockResolvedValue(orderWith(['Sả']));
    renderPage();
    await screen.findByText(/Xà bông 1/);
    expect(productLine('Xà bông 1').textContent).toBe('Xà bông 1 · Sả ×2');
  });

  it('tên trống, toàn khoảng trắng hay null: chỉ "tên ×SL", không " · " treo sau tên', async () => {
    mocks.fetchOrder.mockResolvedValue(orderWith(['', '   ', null, 'Sả']));
    renderPage();
    await screen.findByText(/Xà bông 1/);
    expect(productLine('Xà bông 1').textContent).toBe('Xà bông 1 ×2');
    expect(productLine('Xà bông 2').textContent).toBe('Xà bông 2 ×2');
    expect(productLine('Xà bông 3').textContent).toBe('Xà bông 3 ×2');
    expect(productLine('Xà bông 4').textContent).toBe('Xà bông 4 · Sả ×2');
  });

  it('đoạn tóm tắt "Sao chép thông tin đơn": tên trống không ghi "()" hay khoảng trắng thừa; có tên giữ "(phân loại)"', async () => {
    mocks.fetchOrder.mockResolvedValue(orderWith(['', '   ', 'Sả']));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sao chép thông tin đơn' }));
    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledTimes(1));
    const text = mocks.copyText.mock.calls[0]![0] as string;
    expect(text).not.toContain('()');
    expect(text).not.toContain('( )');
    expect(text).toContain('Xà bông 3 (Sả)');
    expect(text.split('\n').filter((l) => /Xà bông [12]/.test(l)).every((l) => !/[()]/.test(l))).toBe(true);
  });
});
