import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSuggestions: vi.fn(),
  getPublicConfig: vi.fn(),
  trackEvent: vi.fn(),
  subscribeSheet: vi.fn(),
}));
vi.mock('zmp-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof ZmpUi>()),
  useNavigate: () => vi.fn(),
  useSnackbar: () => ({ openSnackbar: vi.fn(), closeSnackbar: vi.fn() }),
}));
vi.mock('@tubutree/app-core/api/subscriptions', () => ({ getSubscriptionSuggestions: mocks.getSuggestions }));
vi.mock('../../services/shop-api', () => ({
  getPublicConfig: mocks.getPublicConfig,
  getCart: vi.fn().mockResolvedValue({ items: [] }),
  repurchaseOrder: vi.fn(),
  addToCart: vi.fn(),
}));
vi.mock('../../services/analytics', () => ({ trackEvent: mocks.trackEvent }));
vi.mock('../../services/buy-flow-events', () => ({ trackReorderClicked: vi.fn(), trackReorderCompleted: vi.fn() }));
vi.mock('../subscribe-sheet', () => ({
  SubscribeSheet: (p: { variationId: string; quantity: number; initialWeeks?: number; onClose: () => void }) => {
    mocks.subscribeSheet(p);
    return (
      <div data-testid="subscribe-sheet-stub">
        {p.variationId} · {p.initialWeeks} tuần
        <button type="button" onClick={p.onClose}>
          Đóng sheet định kỳ
        </button>
      </div>
    );
  },
}));

import { useAuthStore } from '../../store/auth';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget } from './reorder-types';
import type { PurchasedItem } from '../../services/shop-api';

const SUGGESTION = (variationId: string, intervalWeeks = 6) => ({
  variationId,
  productName: 'Nước giặt Tubu',
  variationName: 'Can 3,8L',
  slug: 'nuoc-giat',
  thumbnail: null,
  unitPrice: 189000,
  intervalWeeks,
  lastDeliveredAt: '2026-11-01T00:00:00.000Z',
});

const purchased = (variationId: string): PurchasedItem =>
  ({
    productId: `p-${variationId}`,
    variationId,
    slug: 'nuoc-giat',
    productName: 'Nước giặt Tubu',
    variationName: 'Can 3,8L',
    brand: null,
    thumbnail: null,
    price: 189000,
    salePrice: null,
    stock: 20,
    inStock: true,
    timesBought: 2,
    lastQuantity: 1,
    lastOrderedAt: '2026-11-01T00:00:00.000Z',
    retailOnly: false,
  }) as unknown as PurchasedItem;

function renderUi(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) };
}

describe('Gợi ý giao định kỳ trong sheet Mua lại (Mini, cùng web)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'authenticated' });
    mocks.getPublicConfig.mockResolvedValue({ freeshipThreshold: 199000, subscribeDiscountPct: 0.12 });
    mocks.getSuggestions.mockResolvedValue({ enabled: true, items: [SUGGESTION('v-giat')] });
  });
  afterEach(() => useAuthStore.setState({ status: 'idle' }));

  it('món đang mua lại có nhịp mua: dòng gợi ý đúng chữ và số % của cấu hình, báo shown một lần', async () => {
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={() => {}} />);
    const row = await screen.findByTestId('subscription-suggestion');
    expect(row).toHaveTextContent('Bạn thường mua Nước giặt Tubu khoảng 6 tuần một lần. Đặt giao định kỳ, giảm 12%');
    expect(row.tagName).toBe('BUTTON');
    expect(mocks.trackEvent.mock.calls.filter((c) => c[0] === 'subscription_suggestion_shown')).toEqual([['subscription_suggestion_shown', 'miniapp', {}]]);
  });

  it('chạm gợi ý: báo accepted kèm chu kỳ, đóng sheet Mua lại, mở sheet Đặt định kỳ chọn sẵn chu kỳ; đóng sheet đó thì gỡ', async () => {
    const onClose = vi.fn();
    const { qc, rerender } = renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={onClose} />);
    fireEvent.click(await screen.findByTestId('subscription-suggestion'));
    expect(mocks.trackEvent).toHaveBeenCalledWith('subscription_suggestion_accepted', 'miniapp', { intervalWeeks: 6 });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Cha đóng sheet Mua lại (target → null); sheet Đặt định kỳ vẫn sống vì nằm ngoài BottomSheet.
    rerender(
      <QueryClientProvider client={qc}>
        <ReorderSheet target={null} source="home_rail" onClose={onClose} />
      </QueryClientProvider>,
    );
    const stub = await screen.findByTestId('subscribe-sheet-stub');
    expect(stub).toHaveTextContent('v-giat · 6 tuần');
    expect(mocks.subscribeSheet).toHaveBeenLastCalledWith(expect.objectContaining({ variationId: 'v-giat', quantity: 1, initialWeeks: 6 }));
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng sheet định kỳ' }));
    await waitFor(() => expect(screen.queryByTestId('subscribe-sheet-stub')).toBeNull());
  });

  it('gợi ý cho món khác: sheet không có dòng gợi ý', async () => {
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-khac'))} source="home_rail" onClose={() => {}} />);
    await waitFor(() => expect(mocks.getSuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
  });

  it('máy chủ tắt gợi ý (cờ smart interval): không có dòng', async () => {
    mocks.getSuggestions.mockResolvedValue({ enabled: false, items: [SUGGESTION('v-giat')] });
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={() => {}} />);
    await waitFor(() => expect(mocks.getSuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
  });

  it('cấu hình công khai lỗi: không có dòng (số % mặc định không được hiện)', async () => {
    mocks.getPublicConfig.mockRejectedValue(new Error('boom'));
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={() => {}} />);
    await waitFor(() => expect(mocks.getSuggestions).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
  });

  it('cấu hình công khai thiếu subscribeDiscountPct: không có dòng (không ghi "giảm 0%"), như web', async () => {
    mocks.getPublicConfig.mockResolvedValue({ freeshipThreshold: 199000 });
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={() => {}} />);
    await waitFor(() => expect(mocks.getSuggestions).toHaveBeenCalled());
    await waitFor(() => expect(mocks.getPublicConfig).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
  });

  it('chưa đăng nhập: không gọi /me/subscriptions/suggestions', async () => {
    useAuthStore.setState({ status: 'idle' });
    renderUi(<ReorderSheet target={itemReorderTarget(purchased('v-giat'))} source="home_rail" onClose={() => {}} />);
    await act(async () => {});
    expect(mocks.getSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByTestId('subscription-suggestion')).toBeNull();
  });

  it('sheet đóng (target null): không gọi máy chủ', async () => {
    renderUi(<ReorderSheet target={null} source="home_rail" onClose={() => {}} />);
    await act(async () => {});
    expect(mocks.getSuggestions).not.toHaveBeenCalled();
  });
});
