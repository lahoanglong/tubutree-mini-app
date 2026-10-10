import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActive: vi.fn(), navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({
  fetchActiveFlashSales: mocks.fetchActive,
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([]),
  setFlashReminder: vi.fn(),
  cancelFlashReminder: vi.fn(),
}));
vi.mock('../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'guest' }) }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { FlashSale } from './flash-sale';

function renderFlash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FlashSale />
    </QueryClientProvider>,
  );
}

const ITEM = {
  itemId: 'i1', productId: 'p1', productSlug: 'p1', productName: 'Nước rửa chén', thumbnail: null, variationId: 'v1',
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + 3_600_000).toISOString(),
};

describe('FlashSale (C-084)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('không có đợt giờ vàng nào → không vẽ gì', async () => {
    mocks.fetchActive.mockResolvedValue([]);
    const { container } = renderFlash();
    await waitFor(() => expect(mocks.fetchActive).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('tải lỗi → khối có tiêu đề, thông báo và "Thử lại" thay vì biến mất; thử lại thành công hiện đợt giờ vàng', async () => {
    mocks.fetchActive.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([ITEM]);
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Ưu đãi giờ vàng' });
    expect(within(region).getByText('Có chút trục trặc, thử lại nhé')).toBeInTheDocument();
    fireEvent.click(within(region).getByRole('button', { name: 'Thử lại Ưu đãi giờ vàng' }));
    expect(await screen.findByText('Nước rửa chén')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Thử lại/ })).toBeNull();
  });
});
