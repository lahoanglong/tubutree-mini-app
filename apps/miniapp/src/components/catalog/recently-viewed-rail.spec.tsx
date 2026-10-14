import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as ZmpUi from 'zmp-ui';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchProductsBySlugs: vi.fn(), fetchActiveFlashSales: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));
vi.mock('../../services/shop-api', () => ({
  fetchProductsBySlugs: mocks.fetchProductsBySlugs,
  fetchActiveFlashSales: mocks.fetchActiveFlashSales,
}));

import { RECENTLY_VIEWED_MAX, recordRecentlyViewed } from '../../utils/recently-viewed';
import { RecentlyViewedRail } from './recently-viewed-rail';

const liveProduct = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, brand: 'Tubu', name: `SP ${slug}`, thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true, ...over,
});
const FLASH = (slug: string, flashPrice: number) => ({
  itemId: `f-${slug}`, variationId: `v-${slug}`, productSlug: slug, productName: slug, thumbnail: null,
  flashPrice, retailPrice: 120000, salePrice: null, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z',
});

function renderRail(ui: ReactNode = <RecentlyViewedRail />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RecentlyViewedRail (spec 5b.4)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.map((s) => liveProduct(s)));
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('chưa xem gì → không render (ẩn im lặng, spec §9) và không gọi API', () => {
    const { container } = renderRail();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.fetchProductsBySlugs).not.toHaveBeenCalled();
  });

  it('mới xem nhất đứng đầu; chạm → PDP với listSource=recently_viewed', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'Sản phẩm B', thumbnail: null }, 2);
    mocks.fetchProductsBySlugs.mockResolvedValue([liveProduct('a', { basePrice: 45000 }), liveProduct('b', { basePrice: 65000 })]);
    renderRail();
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(Array.from(region.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Sản phẩm B', 'Sản phẩm A']);
    await waitFor(() => expect(region).toHaveTextContent('65.000'));
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm A' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/product/a', { state: { listSource: 'recently_viewed' } });
  });

  it('slug lấy từ localStorage (sửa tay được) được mã hoá URL trước khi điều hướng', () => {
    recordRecentlyViewed({ slug: 'a/b?x=1#y', name: 'Sản phẩm lạ', thumbnail: null });
    renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Sản phẩm lạ' }));
    expect(mocks.navigate).toHaveBeenCalledWith(`/product/${encodeURIComponent('a/b?x=1#y')}`, { state: { listSource: 'recently_viewed' } });
  });

  it('localStorage bị chặn (getItem ném) → dải ẩn, không ném lỗi khi vẽ', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const { container } = renderRail();
      expect(container).toBeEmptyDOMElement();
    } finally {
      spy.mockRestore();
    }
  });

  it('vùng cuộn ngang chừa đệm dưới đủ cho bóng đổ của thẻ (overflow cắt bóng nếu sát mép)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    renderRail();
    const scroller = screen.getByRole('button', { name: 'Sản phẩm A' }).parentElement as HTMLElement;
    expect(scroller).toHaveClass('scroll-x');
    expect(parseFloat(scroller.style.paddingBottom)).toBeGreaterThanOrEqual(12);
  });

  it('cập nhật ngay khi có lượt xem mới (cùng tab)', async () => {
    const { container } = renderRail();
    expect(container).toBeEmptyDOMElement();
    act(() => {
      recordRecentlyViewed({ slug: 'c', name: 'Sản phẩm C', thumbnail: null });
    });
    expect(await screen.findByRole('button', { name: 'Sản phẩm C' })).toBeInTheDocument();
  });

  it('tên truy cập là tên sản phẩm, giá được đọc qua mô tả; ảnh chỉ để trang trí (alt rỗng)', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: 'https://img.test/a.jpg' });
    renderRail();
    const card = screen.getByRole('button', { name: 'Sản phẩm A' });
    await waitFor(() => expect(card).toHaveAccessibleDescription(/45\.000/));
    const img = card.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('sản phẩm không có ảnh vẫn hiện thẻ (khung ảnh trống, không có thẻ img)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    renderRail();
    expect(screen.getByRole('button', { name: 'Sản phẩm A' }).querySelector('img')).toBeNull();
  });

  it('hiện tối đa 20 thẻ (giới hạn của kho lưu)', () => {
    for (let i = 0; i < RECENTLY_VIEWED_MAX + 5; i += 1) {
      recordRecentlyViewed({ slug: `p${i}`, name: `SP ${i}`, thumbnail: null }, i);
    }
    renderRail();
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(region.querySelectorAll('button')).toHaveLength(RECENTLY_VIEWED_MAX);
    expect(screen.getByRole('button', { name: `SP ${RECENTLY_VIEWED_MAX + 4}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SP 0' })).toBeNull();
  });

  it('title tuỳ biến đổi cả tên vùng lẫn tiêu đề', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    renderRail(<RecentlyViewedRail title="Xem lại" />);
    expect(screen.getByRole('region', { name: 'Xem lại' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xem lại' })).toBeInTheDocument();
  });
});

describe('RecentlyViewedRail — giá hiện hành, không giá chụp lúc xem (R4-BUYER-5)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mocks.fetchActiveFlashSales.mockResolvedValue([]);
  });

  it('hỏi giá hiện hành của đúng các slug đã xem (một lần gọi)', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'Sản phẩm B', thumbnail: null }, 2);
    mocks.fetchProductsBySlugs.mockResolvedValue([liveProduct('a'), liveProduct('b')]);
    renderRail();
    await waitFor(() => expect(mocks.fetchProductsBySlugs).toHaveBeenCalledTimes(1));
    expect(mocks.fetchProductsBySlugs).toHaveBeenCalledWith(['b', 'a']);
  });

  it('sản phẩm đang giờ vàng: hiện giá giờ vàng và giá gốc gạch, đúng như thẻ ở lưới (không phải giá lúc xem)', async () => {
    recordRecentlyViewed({ slug: 'nrc', name: 'Nước rửa chén', thumbnail: null });
    mocks.fetchProductsBySlugs.mockResolvedValue([liveProduct('nrc', { basePrice: 120000, salePrice: null })]);
    mocks.fetchActiveFlashSales.mockResolvedValue([FLASH('nrc', 79000)]);
    renderRail();
    const card = screen.getByRole('button', { name: 'Nước rửa chén' });
    await waitFor(() => expect(card).toHaveTextContent('79.000'));
    expect(card).toHaveTextContent('120.000');
    expect(card.querySelector('[style*="line-through"]')).not.toBeNull();
  });

  it('giá thường đổi sau lần xem: hiện giá mới, không hiện giá cũ', async () => {
    localStorage.setItem(
      'tubu_recently_viewed',
      JSON.stringify([{ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 120000, viewedAt: 1 }]),
    );
    mocks.fetchProductsBySlugs.mockResolvedValue([liveProduct('a', { basePrice: 120000, salePrice: 99000 })]);
    renderRail();
    const card = screen.getByRole('button', { name: 'Sản phẩm A' });
    await waitFor(() => expect(card).toHaveTextContent('99.000'));
  });

  it('chưa có giá (đang tải) hoặc API lỗi: thẻ vẫn hiện, không có giá, không hiện giá cũ', async () => {
    localStorage.setItem(
      'tubu_recently_viewed',
      JSON.stringify([{ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 120000, viewedAt: 1 }]),
    );
    mocks.fetchProductsBySlugs.mockRejectedValue(new Error('400'));
    renderRail();
    const card = screen.getByRole('button', { name: 'Sản phẩm A' });
    expect(card).not.toHaveTextContent('120.000');
    await waitFor(() => expect(mocks.fetchProductsBySlugs).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole('button', { name: 'Sản phẩm A' })).not.toHaveTextContent('đ');
  });

  it('sản phẩm đã ẩn/chưa duyệt (API không trả về): thẻ biến mất; không còn thẻ nào thì ẩn cả dải', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null }, 1);
    recordRecentlyViewed({ slug: 'gone', name: 'Đã gỡ', thumbnail: null }, 2);
    mocks.fetchProductsBySlugs.mockResolvedValue([liveProduct('a')]);
    renderRail();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Đã gỡ' })).toBeNull());
    expect(screen.getByRole('button', { name: 'Sản phẩm A' })).toBeInTheDocument();
  });

  it('mọi sản phẩm đã xem đều đã gỡ: dải ẩn hẳn', async () => {
    recordRecentlyViewed({ slug: 'gone', name: 'Đã gỡ', thumbnail: null });
    mocks.fetchProductsBySlugs.mockResolvedValue([]);
    renderRail();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Đã xem gần đây' })).toBeNull());
  });
});
