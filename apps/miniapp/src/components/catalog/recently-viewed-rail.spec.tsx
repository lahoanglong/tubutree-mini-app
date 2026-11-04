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

import { shelf } from '@tubutree/app-core/merch/shelves';
import { RECENTLY_VIEWED_MAX, recordRecentlyViewed } from '../../utils/recently-viewed';
import { RecentlyViewedRail } from './recently-viewed-rail';

const liveProduct = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `id-${slug}`, slug, brand: 'Tubu', name: `SP ${slug}`, thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true, ...over,
});
const FLASH = (slug: string, flashPrice: number) => ({
  itemId: `f-${slug}`, variationId: `v-${slug}`, productSlug: slug, productName: slug, thumbnail: null,
  flashPrice, retailPrice: 120000, salePrice: null, soldCount: 1, quota: 10, endAt: '2099-01-01T00:00:00.000Z',
});

/** Vỏ thẻ chứa nút tên: giá, ảnh và nhãn nằm ở đó chứ không nằm trong nút. */
const tileOf = (name: string) => screen.getByRole('button', { name }).closest('[data-ds="product-tile"]') as HTMLElement;

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
    expect(mocks.fetchActiveFlashSales).not.toHaveBeenCalled();
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
    const scroller = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(scroller).toHaveClass('scroll-x');
    expect(scroller.style.padding).toBe('var(--rail-pad-block)');
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
    const img = tileOf('Sản phẩm A').querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('src', 'https://img.test/a.jpg');
  });

  it('ảnh hiện hành thắng URL lưu ở máy (URL cũ đã khỏi danh sách /img); API lỗi thì dùng URL lưu', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: 'https://content.pancake.vn/2-26/cu.jpg' });
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.map((s) => liveProduct(s, { thumbnail: 'https://content.pancake.vn/2-26/moi.jpg' })));
    const { container, unmount } = renderRail();
    await waitFor(() => expect(decodeURIComponent(container.querySelector('img')!.getAttribute('src')!)).toContain('moi.jpg'));
    unmount();
    mocks.fetchProductsBySlugs.mockRejectedValue(new Error('offline'));
    const again = renderRail();
    await waitFor(() => expect(decodeURIComponent(again.container.querySelector('img')!.getAttribute('src')!)).toContain('cu.jpg'));
  });

  it('API trả thiếu món (đã ẩn): kho chỉ còn món còn sống; trả rỗng thì xoá khoá; API lỗi thì không dọn', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'A', thumbnail: null }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'B', thumbnail: null }, 2);
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.filter((s) => s !== 'a').map((s) => liveProduct(s)));
    const first = renderRail();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!).map((i: { slug: string }) => i.slug)).toEqual(['b']));
    first.unmount();
    mocks.fetchProductsBySlugs.mockResolvedValue([]);
    renderRail();
    await waitFor(() => expect(localStorage.getItem('tubu_recently_viewed')).toBeNull());
  });

  it('sau khi dọn: không gọi API thừa theo khoá mới và ảnh không lùi về URL lưu ở máy', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'A', thumbnail: 'https://content.pancake.vn/2-26/stored-a.jpg' }, 1);
    recordRecentlyViewed({ slug: 'b', name: 'B', thumbnail: 'https://content.pancake.vn/2-26/stored-b.jpg' }, 2);
    recordRecentlyViewed({ slug: 'c', name: 'C', thumbnail: 'https://content.pancake.vn/2-26/stored-c.jpg' }, 3);
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.filter((s) => s !== 'b').map((s) => liveProduct(s, { thumbnail: `https://content.pancake.vn/2-26/live-${s}.jpg` })));
    const { container } = renderRail();
    const bad: string[] = [];
    let live = false;
    const look = () => {
      const srcs = Array.from(container.querySelectorAll('img')).map((i) => decodeURIComponent(i.getAttribute('src') ?? ''));
      if (srcs.some((u) => u.includes('live-'))) live = true;
      if (live && srcs.some((u) => u.includes('stored-'))) bad.push(srcs.join('|'));
    };
    new MutationObserver(look).observe(container, { childList: true, subtree: true, attributes: true });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    look();
    expect(live).toBe(true);
    expect(bad).toEqual([]);
    expect(mocks.fetchProductsBySlugs).toHaveBeenCalledTimes(1);
  });

  it('20 slug dài 120 ký tự: chuỗi gửi lên dưới 2000 ký tự (không HTTP 400), món cũ không được hỏi thì không bị dọn', async () => {
    const long = (i: number) => `${'x'.repeat(116)}-${String(i).padStart(3, '0')}`;
    for (let i = 0; i < 20; i++) recordRecentlyViewed({ slug: long(i), name: `SP ${i}`, thumbnail: null }, i + 1);
    // Món mới nhất (i = 19) bị ẩn: bị dọn; bốn món cũ nhất nằm ngoài trần nên không được hỏi và phải còn nguyên.
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.filter((s) => s !== long(19)).map((s) => liveProduct(s)));
    renderRail();
    await waitFor(() => expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(19));
    const sent = mocks.fetchProductsBySlugs.mock.calls.map(([slugs]) => (slugs as string[]).join(','));
    for (const q of sent) expect(q.length).toBeLessThanOrEqual(2000);
    expect(sent[0]?.split(',')).toHaveLength(16);
    const left = JSON.parse(localStorage.getItem('tubu_recently_viewed')!).map((i: { slug: string }) => i.slug);
    for (let i = 0; i < 4; i++) expect(left).toContain(long(i));
    expect(left).not.toContain(long(19));
  });

  it('10 món slug 210 ký tự: sau khi API trả lời chỉ vẽ món đã hỏi và được trả về, không thẻ nào thiếu giá; món ngoài trần vẫn nằm trong kho', async () => {
    const wide = (i: number) => `${'y'.repeat(206)}-${String(i).padStart(3, '0')}`;
    for (let i = 0; i < 10; i++) recordRecentlyViewed({ slug: wide(i), name: `SP ${i}`, thumbnail: null }, i + 1);
    mocks.fetchProductsBySlugs.mockImplementation(async (slugs: string[]) => slugs.map((s) => liveProduct(s)));
    const { container } = renderRail();
    await waitFor(() => expect(mocks.fetchProductsBySlugs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    const cards = container.querySelectorAll('[data-ds="product-tile"]');
    expect(cards).toHaveLength(9);
    for (const card of Array.from(cards)) expect(card.textContent).toContain('45.000');
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(10);
  });

  it('API lỗi: không dọn lịch sử xem', async () => {
    recordRecentlyViewed({ slug: 'a', name: 'A', thumbnail: null }, 1);
    mocks.fetchProductsBySlugs.mockRejectedValue(new Error('offline'));
    renderRail();
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.parse(localStorage.getItem('tubu_recently_viewed')!)).toHaveLength(1);
  });

  it('sản phẩm không có ảnh vẫn hiện thẻ (khung ảnh trống, không có thẻ img)', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    renderRail();
    expect(tileOf('Sản phẩm A').querySelector('img')).toBeNull();
  });

  it('kho lưu giữ tối đa 20 món nhưng dải chỉ hiện 10 thẻ mới xem nhất (ngân sách kệ browse.recent)', () => {
    expect(RECENTLY_VIEWED_MAX).toBeGreaterThan(shelf('browse.recent').maxItems);
    for (let i = 0; i < 12; i += 1) {
      recordRecentlyViewed({ slug: `p${i}`, name: `SP ${i}`, thumbnail: null }, i);
    }
    renderRail();
    const region = screen.getByRole('region', { name: 'Đã xem gần đây' });
    expect(region.querySelectorAll('button')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'SP 11' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SP 2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SP 1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'SP 0' })).toBeNull();
  });

  it('title tuỳ biến đổi cả tên vùng lẫn tiêu đề', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    renderRail(<RecentlyViewedRail title="Xem lại" />);
    expect(screen.getByRole('region', { name: 'Xem lại' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Xem lại' })).toBeInTheDocument();
  });

  it('tiêu đề là h2 của SectionHeader (không có "Xem tất cả"), dải nằm trong Section browse-recent', () => {
    recordRecentlyViewed({ slug: 'a', name: 'Sản phẩm A', thumbnail: null });
    const { container } = renderRail();
    const header = screen.getByTestId('section-header');
    expect(header).toContainElement(screen.getByRole('heading', { level: 2, name: 'Đã xem gần đây' }));
    expect(header.querySelector('button')).toBeNull();
    expect(container.querySelector('section#browse-recent')).not.toBeNull();
    expect(screen.getAllByRole('region')).toHaveLength(1);
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
    const card = tileOf('Nước rửa chén');
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
    const card = tileOf('Sản phẩm A');
    await waitFor(() => expect(card).toHaveTextContent('99.000'));
  });

  it('chưa có giá (đang tải) hoặc API lỗi: thẻ vẫn hiện, không có giá, không hiện giá cũ', async () => {
    localStorage.setItem(
      'tubu_recently_viewed',
      JSON.stringify([{ slug: 'a', name: 'Sản phẩm A', thumbnail: null, price: 120000, viewedAt: 1 }]),
    );
    mocks.fetchProductsBySlugs.mockRejectedValue(new Error('400'));
    renderRail();
    const card = tileOf('Sản phẩm A');
    expect(card).not.toHaveTextContent('120.000');
    await waitFor(() => expect(mocks.fetchProductsBySlugs).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(tileOf('Sản phẩm A')).not.toHaveTextContent('đ');
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
