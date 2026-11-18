import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActive: vi.fn(), navigate: vi.fn(), add: vi.fn(), config: {} as { flashGreenHourEnabled?: boolean } }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActive }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../hooks/use-public-config', () => ({ usePublicConfig: () => ({ ...mocks.config, isLoaded: true, isPending: false }) }));
vi.mock('../home/home-quick-add', async () => {
  const { ProductCardQuickAddContext } = await import('../ui/product-card-quick-add');
  return {
    HomeQuickAddProvider: ({ children }: { children: ReactNode }) => (
      <ProductCardQuickAddContext.Provider value={{ add: mocks.add, busyId: null }}>{children}</ProductCardQuickAddContext.Provider>
    ),
  };
});

import { FLASH_HINT_KEY, FLASH_SKELETON_HEIGHT } from '@tubutree/app-core/home-layout';
import { OffersFlash } from './offers-flash';

const HOUR = 3_600_000;
const item = (n: number, over: Record<string, unknown> = {}) => ({
  itemId: `i${n}`, variationId: 'v1', productSlug: `p${n}`, productName: `Sản phẩm ${n}`, thumbnail: null,
  retailPrice: 100000, flashPrice: 80000, quota: 10, soldCount: 2, endAt: new Date(Date.now() + HOUR).toISOString(), ...over,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => item(i));

function renderFlash() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OffersFlash />
    </QueryClientProvider>,
  );
}

describe('OffersFlash — Giờ vàng hôm nay ở trang Ưu đãi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.config = {};
  });

  it('cờ Giờ Xanh bật: tiêu đề "Giờ Xanh Ưu Đãi", ＋ trên từng thẻ còn suất, chạm ＋ thêm đúng phân loại của suất', async () => {
    mocks.config = { flashGreenHourEnabled: true };
    mocks.fetchActive.mockResolvedValue([item(0), item(1, { soldCount: 10 }), item(2, { variationId: 'v9' })]);
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Giờ Xanh Ưu Đãi' });
    const adds = within(region).getAllByRole('button', { name: /^Thêm .* vào giỏ$/ });
    expect(adds.map((b) => b.getAttribute('aria-label'))).toEqual(['Thêm Sản phẩm 0 vào giỏ', 'Thêm Sản phẩm 2 vào giỏ']);
    fireEvent.click(adds[1]!);
    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add.mock.calls[0]![0]).toMatchObject({ id: 'i2', slug: 'p2', pinnedVariationId: 'v9' });
    expect(within(region).getAllByTestId('flash-sold-bar')[0]!.querySelector('span')!.style.color).toBe('var(--color-action-secondary-fg)');
    expect(within(region).getByRole('timer').querySelector('span')!.style.color).toBe('var(--color-text-brand)');
  });

  it('không có suất nào đang chạy: không vẽ gì', async () => {
    mocks.fetchActive.mockResolvedValue([]);
    const { container } = renderFlash();
    await waitFor(() => expect(mocks.fetchActive).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('tiêu đề "Giờ vàng hôm nay"; đồng hồ là chữ "Kết thúc sau …" ở hàng riêng dưới tiêu đề, không có ô số HH:MM:SS (Q3)', async () => {
    mocks.fetchActive.mockResolvedValue(many(3));
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
    expect(within(region).getByRole('heading', { level: 2 })).toHaveTextContent('Giờ vàng hôm nay');
    const timer = within(region).getByRole('timer');
    expect(timer.textContent).toMatch(/^Kết thúc sau /);
    expect(within(region).queryAllByTestId('countdown-cell')).toHaveLength(0);
    expect(within(region).getByTestId('section-header')).not.toContainElement(timer);
  });

  it('6 suất: đúng 4 thẻ (maxItems của kệ offers.flash), một đồng hồ, "Xem tất cả Giờ vàng hôm nay" tới /flash-sale', async () => {
    mocks.fetchActive.mockResolvedValue(many(6));
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
    expect(within(region).getAllByTestId('flash-sold-bar')).toHaveLength(4);
    expect(within(region).getAllByRole('timer')).toHaveLength(1);
    fireEvent.click(within(region).getByRole('button', { name: /Xem tất cả/ }));
    expect(mocks.navigate).toHaveBeenCalledWith('/flash-sale');
  });

  it('một sản phẩm hai phân loại cùng Giờ vàng chỉ một thẻ; suất đã hết giờ không hiện', async () => {
    mocks.fetchActive.mockResolvedValue([item(1), item(1, { itemId: 'i1b', variationId: 'v2' }), item(2, { endAt: new Date(Date.now() - 1000).toISOString() })]);
    renderFlash();
    const region = await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
    expect(within(region).getAllByTestId('flash-sold-bar')).toHaveLength(1);
  });

  it('suất hết giờ khi khách đang xem: cả khối (kể cả hàng chữ đồng hồ) biến mất, không để lại hàng trống', async () => {
    mocks.fetchActive.mockResolvedValue([item(1, { endAt: new Date(Date.now() + 1_200).toISOString() }), item(2, { endAt: new Date(Date.now() + 1_200).toISOString() })]);
    const { container } = renderFlash();
    await screen.findByRole('region', { name: 'Giờ vàng hôm nay' });
    await waitFor(() => expect(container).toBeEmptyDOMElement(), { timeout: 5_000 });
  });

  it('lỗi tải: ẩn khối, không báo lỗi (Giờ vàng ở Ưu đãi là phần thêm, Trang chủ đã có khối lỗi)', async () => {
    mocks.fetchActive.mockRejectedValue(new Error('boom'));
    const { container } = renderFlash();
    await waitFor(() => expect(mocks.fetchActive).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lần mở trước có Giờ vàng: lúc tải giữ chỗ đúng chiều cao khung chờ; chưa nhớ thì im lặng', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.fetchActive.mockReturnValue(new Promise((r) => (release = r)));
    localStorage.setItem(FLASH_HINT_KEY, '1');
    const first = renderFlash();
    const frame = screen.getByTestId('flash-sale-loading');
    expect(frame.firstElementChild).toHaveStyle({ height: `${FLASH_SKELETON_HEIGHT}px` });
    release([]);
    await waitFor(() => expect(first.container).toBeEmptyDOMElement());
    first.unmount();
    localStorage.clear();
    mocks.fetchActive.mockReturnValue(new Promise(() => undefined));
    const second = renderFlash();
    expect(second.container).toBeEmptyDOMElement();
  });
});
