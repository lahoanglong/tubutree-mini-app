import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// D2-06: lời mời theo dõi OA chỉ hứa điều backend làm thật (cập nhật đơn, tư vấn), không hứa "ưu đãi mới".
const mocks = vi.hoisted(() => ({
  fetchOrder: vi.fn(),
  fetchOrders: vi.fn(),
  openSnackbar: vi.fn(),
  followOA: vi.fn(),
  requestNotifyPermission: vi.fn(),
  setOaPromptState: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Page: ({ children }: { children: ReactNode }) => <div data-testid="page">{children}</div>,
  useParams: () => ({ code: 'TT001' }),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/orders/TT001', search: '', state: null }),
  useSnackbar: () => ({ openSnackbar: mocks.openSnackbar, closeSnackbar: vi.fn() }),
}));
vi.mock('../services/shop-api', () => ({
  fetchOrder: mocks.fetchOrder,
  fetchOrders: mocks.fetchOrders,
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
vi.mock('../services/zmp-bridge', () => ({
  hasOA: true,
  openOAChat: vi.fn(),
  openExternal: vi.fn(),
  followOA: mocks.followOA,
  requestNotifyPermission: mocks.requestNotifyPermission,
  getOaPromptState: vi.fn().mockResolvedValue({ promptSeen: false, followed: false }),
  setOaPromptState: mocks.setOaPromptState,
  shouldShowFollowOaPrompt: () => true,
}));
vi.mock('../store/auth', () => {
  const state = { status: 'authenticated', user: { id: 'u1' } };
  return { useAuthStore: (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state) };
});
vi.mock('../components/image-upload', () => ({ MultiImageUpload: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import OrderDetailPage from './order-detail';

const ORDER = {
  id: 'o1', code: 'TT001', status: 'PENDING', paymentMethod: 'COD', paymentStatus: 'UNPAID', createdAt: '2026-10-01T03:00:00.000Z',
  subtotal: 100_000, discount: 0, pointsUsed: 0, pointsEarned: 0, shippingFee: 20_000, total: 120_000, hasRecyclingPickup: false,
  shippingAddress: { recipient: 'Ánh', phone: '0911111111', street: '1 Lê Lợi', ward: 'Phường Bến Nghé', province: 'TP. Hồ Chí Minh' },
  items: [{ id: 'oi1', productName: 'Xà bông thảo mộc', variationName: 'Sả', productSlug: 'xa-bong', quantity: 2, total: 100_000, backorderedQty: 0 }],
};

describe('OrderDetailPage — lời mời theo dõi OA sau đơn đầu (D2-06)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchOrders.mockResolvedValue({ data: [ORDER], meta: { page: 1, limit: 1, total: 1 } });
  });

  it('chỉ hứa cập nhật đơn và tư vấn, không hứa ưu đãi', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OrderDetailPage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Theo dõi Tubu Tree trên Zalo')).toBeInTheDocument();
    expect(screen.getByText('Nhận cập nhật đơn và tư vấn từ Tubu Tree qua Zalo — không bỏ lỡ tin quan trọng.')).toBeInTheDocument();
    expect(screen.queryByText(/ưu đãi/i)).toBeNull();
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrderDetailPage />
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// Nút gọi `void handleFollowOaPrompt()` nên lỗi thật trôi ra ngoài (production có bộ bắt toàn cục ở app.tsx), còn vitest coi
// unhandledRejection là lỗi cả lượt chạy: thay tạm bộ nghe của vitest bằng bộ gom để kiểm đúng lỗi nào đã trôi ra.
async function collectUnhandledRejections(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const saved = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason) => {
    seen.push(reason);
  });
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const listener of saved) process.on('unhandledRejection', listener as NodeJS.UnhandledRejectionListener);
  }
  return seen;
}

describe('OrderDetailPage — "Theo dõi ngay" chống chạm đúp cùng nhịp (W78A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchOrder.mockResolvedValue(ORDER);
    mocks.fetchOrders.mockResolvedValue({ data: [ORDER], meta: { page: 1, limit: 1, total: 1 } });
    mocks.requestNotifyPermission.mockResolvedValue(true);
    mocks.setOaPromptState.mockResolvedValue(undefined);
  });

  it('hai cú chạm cùng nhịp: chỉ mở hộp theo dõi OA một lần và báo một thông báo', async () => {
    const d = deferred<boolean>();
    mocks.followOA.mockReturnValue(d.promise);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Theo dõi ngay' });
    await act(async () => {
      fireEvent.click(btn);
      fireEvent.click(btn);
    });
    expect(mocks.followOA).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      d.resolve(true);
    });
    expect(mocks.followOA).toHaveBeenCalledTimes(1);
    expect(mocks.setOaPromptState).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledTimes(1);
    expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã theo dõi Tubu Tree trên Zalo!', type: 'success' });
    expect(btn).not.toHaveAttribute('aria-busy');
  });

  it('lưu cờ đã mời lỗi thì nhả khoá: nút hết bận và chạm lại gọi followOA lần nữa', async () => {
    const boom = new Error('lưu cờ lỗi');
    mocks.followOA.mockResolvedValue(true);
    mocks.setOaPromptState.mockRejectedValueOnce(boom).mockResolvedValue(undefined);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Theo dõi ngay' });

    const surfaced = await collectUnhandledRejections(async () => {
      fireEvent.click(btn);
      await waitFor(() => expect(mocks.setOaPromptState).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(btn).not.toHaveAttribute('aria-busy'));
    });
    expect(surfaced).toEqual([boom]);
    expect(mocks.openSnackbar).not.toHaveBeenCalled();

    fireEvent.click(btn);
    await waitFor(() => expect(mocks.followOA).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.openSnackbar).toHaveBeenCalledWith({ text: 'Đã theo dõi Tubu Tree trên Zalo!', type: 'success' }));
  });
});
