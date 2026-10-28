// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byText, click, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';
import { ApiError } from '@/lib/client-api';

// Chép ý nghĩa home-parts.spec của Mini App (HomeSection, khối lỗi, dải lỗi cấp trang).
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { HomeBlockError, HomeBlockErrorSuppressed } from './home-block-error';
import { HomePageError } from './home-page-error';
import { HomeSection, type SectionQuery } from './home-section';

const card = (n: number) => ({
  id: `p${n}`, slug: `sp-${n}`, brand: 'Tubu', name: `Sản phẩm ${n}`, thumbnail: null, basePrice: 100000 + n, salePrice: null, isFeatured: false, inStock: true,
});
const query = (over: Partial<SectionQuery> = {}): SectionQuery => ({ isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over });

let mounted: Rendered | null = null;
const mount = (ui: React.ReactElement) => (mounted = render(ui));
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('HomeSection', () => {
  it('đã tải, rỗng → không render (không để lại tiêu đề trống)', () => {
    const { container } = mount(<HomeSection title="Bán chạy" query={query({ data: { data: [] } })} limit={6} />);
    expect(container.textContent).toBe('');
  });

  it('lỗi (chưa có dữ liệu) → tiêu đề + thông báo + nút "Thử lại", không mất khối im lặng (C-084)', () => {
    const refetch = vi.fn();
    const { container } = mount(<HomeSection title="Bán chạy" query={query({ isError: true, error: new ApiError('Máy chủ đang bận', 503), refetch })} limit={6} />);
    expect(container.querySelector('section[aria-label="Bán chạy"]')).not.toBeNull();
    expect(container.textContent).toContain('Máy chủ đang bận');
    click(container.querySelector('button[aria-label="Thử lại Bán chạy"]'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('đang thử lại sau lỗi → nút báo đang tải và khoá bấm tiếp', () => {
    const refetch = vi.fn();
    const { container } = mount(<HomeSection title="Bán chạy" query={query({ isError: true, error: new Error('x'), isFetching: true, refetch })} limit={6} />);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Thử lại Bán chạy"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    click(btn);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('lỗi không có thông báo cụ thể → câu chung giống ErrorBoundary', () => {
    const { container } = mount(<HomeSection title="Bán chạy" query={query({ isError: true, error: undefined })} limit={6} />);
    expect(container.textContent).toContain('Đã có lỗi xảy ra');
  });

  it('trang đã có dải lỗi cấp trang (HomeBlockErrorSuppressed) → khối lỗi từng kệ ẩn, không xếp chồng', () => {
    const { container } = mount(
      <HomeBlockErrorSuppressed.Provider value>
        <HomeSection title="Bán chạy" query={query({ isError: true, error: new Error('x') })} limit={6} />
        <HomeBlockError title="Mua lại" onRetry={() => undefined} />
      </HomeBlockErrorSuppressed.Provider>,
    );
    expect(container.textContent).toBe('');
  });

  it('làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện SP cũ, không khối lỗi', () => {
    const { container } = mount(<HomeSection title="Bán chạy" query={query({ isError: true, error: new Error('x'), data: { data: [card(1)] } })} limit={6} />);
    expect(container.textContent).toContain('Sản phẩm 1');
    expect(container.querySelector('[data-testid="home-block-error"]')).toBeNull();
  });

  it('đang tải → tiêu đề + khung chờ đúng bằng giới hạn (M2: trang không nhảy); có dữ liệu → lưới SP', () => {
    const loading = mount(<HomeSection title="Bán chạy" query={query({ isLoading: true })} limit={6} />);
    expect(loading.container.querySelector('h2')?.textContent).toBe('Bán chạy');
    expect(loading.container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    expect(loading.container.querySelectorAll('li').length).toBe(6);
    loading.unmount();
    const ready = mount(<HomeSection title="Bán chạy" query={query({ data: { data: [card(1), card(2)] } })} limit={6} />);
    expect(ready.container.querySelectorAll('a[href^="/san-pham/"]')).toHaveLength(2);
  });

  it('"Xem tất cả" có tên truy cập kèm tiêu đề, dẫn tới đích đã cho — cả khi đang tải lẫn khi đã có SP; không truyền seeAllTo thì không có', () => {
    const a = mount(<HomeSection title="Bán chạy" query={query({ isLoading: true })} limit={6} seeAllTo="/san-pham?sort=best_seller" />);
    expect(a.container.querySelector('a[aria-label="Xem tất cả Bán chạy"]')?.getAttribute('href')).toBe('/san-pham?sort=best_seller');
    a.unmount();
    const b = mount(<HomeSection title="Bán chạy" query={query({ data: { data: [card(1)] } })} limit={6} seeAllTo="/san-pham?sort=best_seller" />);
    expect(b.container.querySelector('a[aria-label="Xem tất cả Bán chạy"]')).not.toBeNull();
    b.unmount();
    const c = mount(<HomeSection title="Dành cho bạn" query={query({ data: { data: [card(1)] } })} limit={6} />);
    expect(c.container.querySelector('a[aria-label^="Xem tất cả"]')).toBeNull();
    expect(unnamedControls(c.container)).toEqual([]);
    expect(smallTouchTargets(c.container)).toEqual([]);
  });
});

describe('HomePageError', () => {
  it('một thẻ có tiêu đề, thông báo lỗi thật và nút "Thử lại" (D7 mục 5)', () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError error={new ApiError('Máy chủ đang bận', 503)} onRetry={onRetry} />);
    expect(container.querySelector('section[aria-label="Chưa tải được Trang chủ"]')).not.toBeNull();
    expect(container.textContent).toContain('Máy chủ đang bận');
    click(byText(container, 'button', 'Thử lại'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('đang tải lại thì khoá nút', () => {
    const onRetry = vi.fn();
    const { container } = mount(<HomePageError onRetry={onRetry} retrying />);
    expect(container.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  });
});
