import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ZmpUi from 'zmp-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchActive: vi.fn(), navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchActiveFlashSales: mocks.fetchActive }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

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
