import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps } from 'react';
import type * as ZmpUi from 'zmp-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchBrands: vi.fn(), fetchProducts: vi.fn(), navigate: vi.fn() }));
vi.mock('zmp-ui', async (importOriginal) => ({ ...(await importOriginal<typeof ZmpUi>()), useNavigate: () => mocks.navigate }));
vi.mock('../../services/shop-api', () => ({ fetchBrands: mocks.fetchBrands, fetchProducts: mocks.fetchProducts, fetchActiveFlashSales: vi.fn().mockResolvedValue([]) }));
vi.mock('../../store/auth', () => ({ useAuthStore: (sel: (s: { status: string }) => unknown) => sel({ status: 'guest' }) }));
vi.mock('../wishlist-heart', () => ({ WishlistHeart: () => null }));
vi.mock('../../utils/haptic', () => ({ haptic: vi.fn() }));

import { BRAND_ORIGINS } from '@tubutree/app-core/brand-origins';
import { SuggestFeed } from './suggest-feed';

type Query = { brand?: string; sort?: string; limit?: number };
const card = (brand: string, n: number, inStock = true) => ({
  id: `${brand}-${n}`, slug: `${brand.toLowerCase().replace(/\W+/g, '-')}-${n}`, brand, name: `${brand} ${n}`, thumbnail: null, basePrice: 100000, salePrice: null, isFeatured: false, inStock,
});
const page = (data: unknown[]) => ({ data, meta: { page: 1, limit: 8, total: data.length } });
const BRANDS = [
  { brand: 'Tubu Tree', count: 9, slug: null },
  { brand: 'Visante', count: 2, slug: null },
  { brand: 'Fuwa3e', count: 44, slug: 'fuwa3e', tagline: null },
  { brand: 'Pơ Lang', count: 14, slug: null, tagline: 'Câu của admin cho Pơ Lang' },
];
let products: Record<string, unknown[]> = {};

const mount = (props: Partial<ComponentProps<typeof SuggestFeed>> = {}, qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => {
  const utils = render(
    <QueryClientProvider client={qc}>
      <div className="zaui-page">
        <SuggestFeed exclude={new Set()} {...props} />
      </div>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
};
const productCalls = () => mocks.fetchProducts.mock.calls.map(([q]) => q as Query);
const sections = () => screen.queryAllByTestId('home-brand-section');
const section = (brand: string) => sections().find((s) => s.getAttribute('aria-label') === brand) ?? null;
/** Tên món theo thứ tự lưới (nút mở PDP của thẻ mang tên món). */
const tileNames = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>('[data-testid="catalog-grid"] > li [data-ds="product-tile"] button[aria-label]')).map((b) => b.getAttribute('aria-label'));
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));

/** IntersectionObserver giả: chỉ báo "gần màn" khi `reveal()` được gọi (gốc là khung cuộn `.zaui-page`). */
let observers: { cb: IntersectionObserverCallback; el: Element | null; root: Element | null }[] = [];
const stubObserver = () =>
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      private o: { cb: IntersectionObserverCallback; el: Element | null; root: Element | null };
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        this.o = { cb, el: null, root: (opts?.root as Element | null) ?? null };
        observers.push(this.o);
      }
      observe(el: Element) {
        this.o.el = el;
      }
      disconnect() {
        this.o.el = null;
      }
    },
  );
const reveal = async (match: (el: Element) => boolean = () => true) => {
  await act(async () => {
    for (const o of [...observers]) if (o.el && match(o.el)) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
  });
  await settle();
};

beforeEach(() => {
  products = {
    Fuwa3e: Array.from({ length: 8 }, (_, i) => card('Fuwa3e', i + 1)),
    'Pơ Lang': [card('Pơ Lang', 1, false), card('Pơ Lang', 2), card('Pơ Lang', 3)],
    Visante: [card('Visante', 1), card('Visante', 2)],
    'Tubu Tree': [card('Tubu Tree', 1)],
  };
  mocks.fetchBrands.mockReset().mockResolvedValue(BRANDS);
  mocks.fetchProducts.mockReset().mockImplementation(async (q: Query) => page(products[q.brand ?? ''] ?? []));
  mocks.navigate.mockReset();
  observers = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SuggestFeed (Mini) — Khám phá theo Thương hiệu (w34-02)', () => {
  it('tiêu đề khối "Khám phá theo Thương hiệu"; mỗi nhãn một mục h3 theo số sản phẩm giảm dần, "Tubu Tree" cuối', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 2, name: 'Khám phá theo Thương hiệu' })).toBeInTheDocument();
    await waitFor(() => expect(sections()).toHaveLength(4));
    expect(sections().map((s) => s.querySelector('h3')?.textContent)).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree']);
  });

  it('mỗi nhãn tải `fetchProducts({ brand, sort: best_seller_30d, limit: 8 })` (không endpoint mới)', async () => {
    mount();
    await waitFor(() => expect(productCalls()).toHaveLength(4));
    expect(productCalls()).toEqual([
      { brand: 'Fuwa3e', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Pơ Lang', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Visante', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Tubu Tree', sort: 'best_seller_30d', limit: 8 },
    ]);
  });

  it('câu giới thiệu một dòng: của admin thắng, thiếu thì câu dự phòng ở brand-origins; "Tất cả (n)" mở danh sách lọc đúng nhãn', async () => {
    mount();
    await waitFor(() => expect(sections()).toHaveLength(4));
    expect(section('Fuwa3e')!.textContent).toContain(BRAND_ORIGINS.find((o) => o.id === 'fuwa3e')!.tagline);
    expect(section('Pơ Lang')!.textContent).toContain('Câu của admin cho Pơ Lang');
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả (44) Fuwa3e' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse?brand=Fuwa3e');
    fireEvent.click(screen.getByRole('button', { name: 'Tất cả (14) Pơ Lang' }));
    expect(mocks.navigate).toHaveBeenLastCalledWith('/browse?brand=P%C6%A1+Lang');
  });

  it('lưới 4 món; món hết hàng sau món còn hàng; món đã ở kệ trên chỉ để bù khi thiếu', async () => {
    mount({ exclude: new Set(['fuwa3e-1', 'fuwa3e-2']) });
    await waitFor(() => expect(tileNames(section('Fuwa3e')!)).toHaveLength(4));
    expect(tileNames(section('Fuwa3e')!)).toEqual(['Fuwa3e 3', 'Fuwa3e 4', 'Fuwa3e 5', 'Fuwa3e 6']);
    expect(tileNames(section('Pơ Lang')!)).toEqual(['Pơ Lang 2', 'Pơ Lang 3', 'Pơ Lang 1']);
  });

  it('neo `home-brand-<slug>` cho chip của thanh nhảy nhanh; neo không tự đặt scroll-margin (scroll-padding-top của `.zaui-page` đã chừa header dính)', async () => {
    mount();
    await waitFor(() => expect(sections()).toHaveLength(4));
    expect(sections().map((s) => s.id)).toEqual(['home-brand-fuwa3e', 'home-brand-polang', 'home-brand-visante', 'home-brand-tubutree']);
    expect(section('Fuwa3e')!.style.scrollMarginTop).toBe('');
  });

  it('khối còn xa màn: không tải món nhãn nào (luật gộp request Trang chủ); khối tới gần thì hai nhãn đầu tải, nhãn sau chờ chính nó tới gần', async () => {
    stubObserver();
    mount();
    await waitFor(() => expect(sections()).toHaveLength(4));
    await settle();
    expect(productCalls()).toEqual([]);
    // Gốc quan sát là khung cuộn của trang Mini, không phải khung nhìn.
    expect(observers.every((o) => o.root?.classList.contains('zaui-page'))).toBe(true);
    // Chưa tải thì nhãn giữ chỗ đúng số món sẽ vẽ, mỗi ô một nút (không khung chờ đầy đủ): chip nhảy nhanh cuộn qua nhãn chưa tải mà đích không bị đẩy xuống.
    expect(section('Fuwa3e')!.querySelector('[data-testid="catalog-grid"], [data-testid="catalog-grid-skeleton"]')).toBeNull();
    expect(section('Fuwa3e')!.querySelectorAll('[data-testid="catalog-grid-reserve"] > *')).toHaveLength(4);
    expect(section('Fuwa3e')!.querySelector('[data-testid="catalog-grid-reserve"] > *')!.children).toHaveLength(0);
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    mocks.fetchProducts.mockImplementation(async (q: Query) => {
      if (q.brand === 'Visante' || q.brand === 'Tubu Tree') await held;
      return page(products[q.brand ?? ''] ?? []);
    });
    await reveal((el) => el.getAttribute('aria-label') === 'Khám phá theo Thương hiệu');
    expect(productCalls().map((q) => q.brand)).toEqual(['Fuwa3e', 'Pơ Lang']);
    expect(section('Visante')!.querySelector('[data-testid="catalog-grid"]')).toBeNull();
    expect(section('Visante')!.querySelectorAll('[data-testid="catalog-grid-reserve"] > *')).toHaveLength(2);
    await reveal();
    expect(productCalls().map((q) => q.brand)).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree']);
    // Đang tải: khung chờ đúng số món sẽ vẽ (Visante chỉ có 2 sản phẩm).
    expect(section('Visante')!.querySelectorAll('[data-testid="catalog-grid-skeleton"] > *')).toHaveLength(2);
    expect(section('Tubu Tree')!.querySelectorAll('[data-testid="catalog-grid-skeleton"] > *')).toHaveLength(4);
    await act(async () => release());
    await waitFor(() => expect(tileNames(section('Visante')!)).toHaveLength(2));
  });

  it('Back về Trang chủ khi món nhãn còn trong cache: vẽ ngay, không chờ khối tới gần (khôi phục cuộn có đủ chiều cao)', async () => {
    const first = mount();
    await waitFor(() => expect(productCalls()).toHaveLength(4));
    first.unmount();
    stubObserver();
    mount({}, first.qc);
    await waitFor(() => expect(tileNames(section('Fuwa3e')!)).toHaveLength(4));
    expect(tileNames(section('Tubu Tree')!)).toHaveLength(1);
  });

  it('nhãn không còn món nào: ẩn hẳn mục đó (chip của nó lùi về trang nhãn)', async () => {
    products.Visante = [];
    mount();
    await waitFor(() => expect(productCalls()).toHaveLength(4));
    await waitFor(() => expect(section('Visante')).toBeNull());
    expect(document.getElementById('home-brand-visante')).toBeNull();
  });

  it('thẻ chen đứng sau nhãn cuối (chiều cao về muộn của nó không đẩy lệch chip nhảy tới nhãn nào)', async () => {
    mount({ interleave: <div data-testid="quiz">Chẩn đoán</div> });
    await waitFor(() => expect(sections()).toHaveLength(4));
    const list = screen.getByTestId('suggest-interleave').parentElement!;
    const order = Array.from(list.children).map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid'));
    expect(order).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree', 'suggest-interleave']);
  });

  it('thẻ chen chỉ dựng khi khối tới gần màn (Cộng đồng tự gọi /feed: mở Trang chủ không thêm request)', async () => {
    stubObserver();
    mount({ interleave: <div data-testid="quiz">Chẩn đoán</div> });
    await waitFor(() => expect(sections()).toHaveLength(4));
    expect(screen.queryByTestId('suggest-interleave')).toBeNull();
    await reveal();
    expect(screen.getByTestId('suggest-interleave')).toBeInTheDocument();
  });

  it('cuối khối một nút "Vào Danh mục" mở trang Danh mục', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Vào Danh mục' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/browse');
  });

  it('chưa có thương hiệu nào: ẩn cả khối, không tải sản phẩm', async () => {
    mocks.fetchBrands.mockResolvedValue([]);
    const { container } = mount();
    await waitFor(() => expect(mocks.fetchBrands).toHaveBeenCalled());
    await settle();
    expect(container.querySelector('.zaui-page')!.innerHTML).toBe('');
    expect(productCalls()).toEqual([]);
  });

  it('lỗi tải thương hiệu: giữ tiêu đề và "Thử lại" tại chỗ; thử lại thành công thì hiện các nhãn', async () => {
    mocks.fetchBrands.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 503 } }));
    mount();
    const retry = await screen.findByRole('button', { name: 'Thử lại Khám phá theo Thương hiệu' });
    mocks.fetchBrands.mockResolvedValue(BRANDS);
    fireEvent.click(retry);
    await waitFor(() => expect(sections()).toHaveLength(4));
  });

  it('đang tải thương hiệu: giữ tiêu đề và khung chờ lưới (trang không nhảy)', async () => {
    mocks.fetchBrands.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByRole('heading', { level: 2, name: 'Khám phá theo Thương hiệu' })).toBeInTheDocument();
    expect(screen.getByTestId('catalog-grid-skeleton')).toBeInTheDocument();
  });
});
