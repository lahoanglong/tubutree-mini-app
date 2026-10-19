import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  user: { fullName: 'Lan', pointsBalance: 60 } as { fullName: string; pointsBalance: number } | null,
  authed: true,
}));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useNavigate: () => mocks.navigate }));
vi.mock('../services/shop-api', () => ({
  getPublicConfig: vi.fn().mockResolvedValue({ aiAdvisorEnabled: true }),
  fetchBrands: vi.fn().mockResolvedValue([{ brand: 'Tubu', count: 3 }, { brand: 'Cỏ Mềm', count: 2 }]),
  fetchActiveFlashSales: vi.fn().mockResolvedValue([]),
  fetchProductsBySlugs: vi.fn().mockResolvedValue([{ id: 'id-p1', slug: 'p1', brand: 'Tubu', name: 'Xà phòng', thumbnail: null, basePrice: 45000, salePrice: null, isFeatured: false, inStock: true }]),
  fetchUpcomingFlashSales: vi.fn().mockResolvedValue([
    { itemId: 'u1', productSlug: 'nrc', productName: 'Nước rửa chén', thumbnail: null, retailPrice: 100000, flashPrice: 80000, startAt: new Date(Date.now() + 3_600_000).toISOString(), reminded: false },
  ]),
  setFlashReminder: vi.fn(),
  cancelFlashReminder: vi.fn(),
  getCart: vi.fn().mockResolvedValue({ itemCount: 2 }),
  fetchCatalog: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, limit: 1, total: 12 } }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (sel: (s: { status: string; user: typeof mocks.user }) => unknown) =>
    sel({ status: mocks.authed ? 'authenticated' : 'idle', user: mocks.user }),
}));
vi.mock('../components/wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../utils/haptic', () => ({ haptic: vi.fn() }));

import { UpcomingFlashSales } from '../components/flash-sale';
import { CatalogGrid } from '../components/catalog/catalog-grid';
import { CategoryGrid } from '../components/catalog/category-grid';
import { FilterSheet } from '../components/catalog/filter-sheet';
import { RecentlyViewedRail } from '../components/catalog/recently-viewed-rail';
import { ResultHeader } from '../components/catalog/result-header';
import { SortChips } from '../components/catalog/sort-chips';
import { SuggestList } from '../components/catalog/suggest-list';
import { HomeBlockError } from '../components/home/home-block-error';
import { HomeExtras } from '../components/home/home-extras';
import { HomeHeader } from '../components/home/home-header';
import { HomeSection } from '../components/home/home-section';
import { SEGMENT_ENTRIES } from '../hooks/use-categories';
import { RECENTLY_VIEWED_KEY } from '../utils/recently-viewed';
import { parseSearchState } from '../utils/search-state';

/**
 * Vùng chạm >= 44px cho mọi nút của Trang chủ / Danh mục / Tìm kiếm (Task 26 phần mã, C-021, WCAG 2.5.5).
 * jsdom không có layout nên đọc kích thước KHAI BÁO trên chính phần tử: cao = height/min-height >= 44 hoặc lớp
 * `tubu-hit-44*` (pseudo-element 44px). Nút chỉ có icon phải khai báo cả rộng >= 44 (nút có chữ thì bề rộng do chữ quyết định).
 * Vùng chạm đo thật ở 320/375/390px do e2e Task 26 (chờ T3).
 */
const px = (v: string): number => (v.endsWith('px') ? parseFloat(v) : 0);
const declared = (el: HTMLElement, axis: 'w' | 'h'): number =>
  axis === 'h' ? Math.max(px(el.style.height), px(el.style.minHeight)) : Math.max(px(el.style.width), px(el.style.minWidth));

const INTERACTIVE = 'button, [role="button"], a[href]';

function undersized(container: HTMLElement): string[] {
  const bad: string[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(INTERACTIVE))) {
    if (/\btubu-hit-44(-square)?\b/.test(el.className)) continue;
    // Thẻ cả khối: `.tubu-tile-link` của ProductTile phủ cả thẻ bằng ::after (ảnh dựng bằng aspect-ratio); thẻ
    // "Đã xem gần đây" có khung ảnh cao 120px bên trong nút.
    if (/\btubu-tile-link\b/.test(el.className) || Array.from(el.querySelectorAll<HTMLElement>('div')).some((d) => declared(d, 'h') >= 44)) continue;
    const label = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName;
    if (declared(el, 'h') < 44) bad.push(`"${label}" cao < 44px`);
    else if (!(el.textContent ?? '').trim() && declared(el, 'w') < 44) bad.push(`"${label}" (chỉ icon) rộng < 44px`);
  }
  return bad;
}

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const P = { id: 'p1', slug: 'p1', brand: 'Tubu', name: 'Xà phòng', thumbnail: null, basePrice: 45000, salePrice: 30000, isFeatured: false, inStock: true };

describe('vùng chạm >= 44px — Trang chủ / Danh mục / Tìm kiếm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.authed = true;
    mocks.user = { fullName: 'Lan', pointsBalance: 60 };
  });

  it('đầu Trang chủ (chuông + giỏ)', () => {
    const { container } = wrap(<HomeHeader unreadCount={2} />);
    expect(container.querySelectorAll(INTERACTIVE).length).toBe(2);
    expect(undersized(container)).toEqual([]);
  });

  it('khối SP: "Xem tất cả", thẻ SP, khối lỗi + "Thử lại"', () => {
    const { container } = wrap(
      <>
        <HomeSection title="Bán chạy" limit={6} seeAllTo="/browse" listSource="home" query={{ isLoading: false, isError: false, error: null, refetch: vi.fn(), data: { data: [P] } }} />
        <HomeBlockError title="Mua lại" onRetry={vi.fn()} />
        <CatalogGrid products={[P]} listSource="browse" />
      </>,
    );
    expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThanOrEqual(3);
    expect(undersized(container)).toEqual([]);
  });

  it('lưới danh mục, dải sắp xếp, đầu kết quả (nút Bộ lọc + chip gỡ lọc)', () => {
    const { container } = wrap(
      <>
        <CategoryGrid entries={SEGMENT_ENTRIES} isLoading={false} onSelect={vi.fn()} />
        <SortChips value="newest" onChange={vi.fn()} />
        <ResultHeader
          total={30}
          isLoading={false}
          chips={[{ key: 'brand:Tubu', label: 'Tubu', patch: {} }]}
          filterCount={1}
          filtersIgnored={false}
          onOpenFilters={vi.fn()}
          onPatch={vi.fn()}
        />
      </>,
    );
    expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThanOrEqual(10);
    expect(undersized(container)).toEqual([]);
  });

  it('gợi ý tìm kiếm: từ khoá gần đây, danh mục, sản phẩm, xoá lịch sử', () => {
    const { container, rerender } = wrap(
      <SuggestList
        draft=""
        recent={['xà phòng', 'nước rửa chén']}
        categories={SEGMENT_ENTRIES}
        products={[]}
        loading={false}
        onPickKeyword={vi.fn()}
        onPickCategory={vi.fn()}
        onPickProduct={vi.fn()}
        onClearRecent={vi.fn()}
      />,
    );
    expect(undersized(container)).toEqual([]);
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <SuggestList
          draft="me"
          recent={['mẹ và bé']}
          categories={SEGMENT_ENTRIES}
          products={[{ slug: 'p1', name: 'Dầu gội mẹ', thumbnail: null, basePrice: 45000 }]}
          loading={false}
          onPickKeyword={vi.fn()}
          onPickCategory={vi.fn()}
          onPickProduct={vi.fn()}
          onClearRecent={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThanOrEqual(3);
    expect(undersized(container)).toEqual([]);
  });

  it('"Đã xem gần đây" và khối phụ cuối Trang chủ (thẻ nhỏ, hero, chip thương hiệu, hàng liên kết)', async () => {
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify([{ slug: 'p1', name: 'Xà phòng', thumbnail: null, viewedAt: 1 }]));
    const { container } = wrap(
      <>
        <RecentlyViewedRail />
        <HomeExtras />
      </>,
    );
    await screen.findByRole('button', { name: 'Tubu' });
    await screen.findByRole('button', { name: 'Hỏi trợ lý AI 24/7' });
    expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThanOrEqual(8);
    expect(undersized(container)).toEqual([]);
  });

  it('"Nhắc tôi" của đợt giờ vàng sắp diễn ra', async () => {
    const { container } = wrap(<UpcomingFlashSales />);
    await waitFor(() => expect(container.querySelector('[role="button"]')).not.toBeNull());
    expect(undersized(container)).toEqual([]);
  });

  it('bộ lọc: chip khoảng giá / còn hàng / đánh giá / thương hiệu, nút Xoá bộ lọc + áp dụng', () => {
    wrap(
      <FilterSheet
        open
        onClose={vi.fn()}
        state={parseSearchState(new URLSearchParams())}
        brands={[{ brand: 'Tubu', count: 3 }]}
        onApply={vi.fn()}
      />,
    );
    const sheet = document.body;
    expect(sheet.querySelectorAll('button[aria-pressed]').length).toBeGreaterThanOrEqual(4);
    expect(undersized(sheet).filter((m) => !m.includes('Đóng'))).toEqual([]);
  });
});
