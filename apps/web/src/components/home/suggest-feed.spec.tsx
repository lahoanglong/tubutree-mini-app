// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

const mocks = vi.hoisted(() => ({ get: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: vi.fn(), delete: vi.fn() } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest', useAuthRestoring: () => false }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { BRAND_ORIGINS } from '@tubutree/app-core/brand-origins';
import { GRID_BRAND } from '@/lib/product-grid';
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

let mounted: Rendered | null = null;
const mount = async (props: Partial<React.ComponentProps<typeof SuggestFeed>> = {}) => {
  mounted = render(
    <QueryClientProvider client={newTestClient()}>
      <SuggestFeed exclude={new Set()} {...props} />
    </QueryClientProvider>,
  );
  await flush(8);
  return mounted.container;
};
const productCalls = () => mocks.get.mock.calls.filter(([path]) => path === '/products').map(([, opts]) => (opts as { query: Query }).query);
const sections = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('[data-testid="home-brand-section"]'));
const section = (c: HTMLElement, brand: string) => sections(c).find((s) => s.getAttribute('aria-label') === brand) ?? null;
const tileNames = (el: HTMLElement) => Array.from(el.querySelectorAll('a.tubu-tile-link')).map((a) => a.getAttribute('href'));

/** IntersectionObserver giả: nhãn sau hai nhãn đầu chỉ tải khi `reveal()` báo gần khung nhìn. */
let observers: { cb: IntersectionObserverCallback; el: Element | null }[] = [];
const reveal = async () => {
  for (const o of observers) if (o.el) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
  await flush(8);
};

beforeEach(() => {
  products = {
    Fuwa3e: Array.from({ length: 8 }, (_, i) => card('Fuwa3e', i + 1)),
    'Pơ Lang': [card('Pơ Lang', 1, false), card('Pơ Lang', 2), card('Pơ Lang', 3)],
    Visante: [card('Visante', 1), card('Visante', 2)],
    'Tubu Tree': [card('Tubu Tree', 1)],
  };
  mocks.get.mockReset().mockImplementation(async (path: string, opts?: { query?: Query }) => {
    if (path === '/brands') return BRANDS;
    if (path === '/products') return page(products[opts?.query?.brand ?? ''] ?? []);
    return [];
  });
  mocks.push.mockReset();
  observers = [];
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

describe('SuggestFeed (web) — Khám phá theo Thương hiệu (w34-02)', () => {
  it('tiêu đề khối h2 "Khám phá theo Thương hiệu"; mỗi nhãn một mục h3 theo số sản phẩm giảm dần, "Tubu Tree" cuối', async () => {
    const c = await mount();
    expect(c.querySelector('section')?.getAttribute('aria-label')).toBe('Khám phá theo Thương hiệu');
    expect(c.querySelector('h2')?.textContent).toBe('Khám phá theo Thương hiệu');
    expect(sections(c).map((s) => s.querySelector('h3')?.textContent)).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree']);
  });

  it('mỗi nhãn tải `GET /products?brand=&sort=best_seller_30d&limit=8` (không endpoint mới)', async () => {
    await mount();
    expect(productCalls()).toEqual([
      { brand: 'Fuwa3e', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Pơ Lang', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Visante', sort: 'best_seller_30d', limit: 8 },
      { brand: 'Tubu Tree', sort: 'best_seller_30d', limit: 8 },
    ]);
  });

  it('câu giới thiệu một dòng: của admin thắng, thiếu thì câu dự phòng ở brand-origins; "Tất cả (n)" tới danh sách lọc đúng nhãn', async () => {
    const c = await mount();
    const fuwa = section(c, 'Fuwa3e')!;
    expect(fuwa.textContent).toContain(BRAND_ORIGINS.find((o) => o.id === 'fuwa3e')!.tagline);
    expect(section(c, 'Pơ Lang')!.textContent).toContain('Câu của admin cho Pơ Lang');
    const all = fuwa.querySelector<HTMLAnchorElement>('a[aria-label="Tất cả (44) Fuwa3e"]')!;
    expect(all.textContent).toContain('Tất cả (44)');
    expect(all.getAttribute('href')).toBe('/san-pham?brand=Fuwa3e');
    expect(section(c, 'Pơ Lang')!.querySelector('a[aria-label^="Tất cả (14)"]')?.getAttribute('href')).toBe('/san-pham?brand=P%C6%A1+Lang');
  });

  it('lưới 4 món (2 cột điện thoại, 4 cột từ md); món hết hàng sau món còn hàng; món đã ở kệ trên chỉ để bù khi thiếu', async () => {
    const c = await mount({ exclude: new Set(['fuwa3e-1', 'fuwa3e-2']) });
    const fuwa = section(c, 'Fuwa3e')!;
    expect(fuwa.querySelector('ul[data-testid="catalog-grid"]')?.className).toBe(GRID_BRAND);
    expect(tileNames(fuwa)).toEqual(['/san-pham/fuwa3e-3', '/san-pham/fuwa3e-4', '/san-pham/fuwa3e-5', '/san-pham/fuwa3e-6']);
    expect(tileNames(section(c, 'Pơ Lang')!)).toEqual(['/san-pham/p-lang-2', '/san-pham/p-lang-3', '/san-pham/p-lang-1']);
  });

  it('neo `home-brand-<slug>` cho chip của thanh nhảy nhanh; neo không tự đặt scroll-margin (scroll-padding-top của html đã chừa thanh đầu dính)', async () => {
    const c = await mount();
    expect(sections(c).map((s) => s.id)).toEqual(['home-brand-fuwa3e', 'home-brand-polang', 'home-brand-visante', 'home-brand-tubutree']);
    expect(section(c, 'Fuwa3e')!.className).not.toMatch(/scroll-m/);
  });

  it('hai nhãn đầu tải món ngay, nhãn sau chờ gần khung nhìn; nhãn nào cũng chỉ vẽ ô thật khi gần khung nhìn, lúc đang tải thì khung chờ bằng số món sẽ vẽ', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        private o: { cb: IntersectionObserverCallback; el: Element | null };
        constructor(cb: IntersectionObserverCallback) {
          this.o = { cb, el: null };
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
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    mocks.get.mockImplementation(async (path: string, opts?: { query?: Query }) => {
      if (path === '/brands') return BRANDS;
      const brand = opts?.query?.brand ?? '';
      if (brand === 'Visante' || brand === 'Tubu Tree') await held;
      return page(products[brand] ?? []);
    });
    const c = await mount();
    expect(productCalls().map((q) => q.brand)).toEqual(['Fuwa3e', 'Pơ Lang']);
    // Món của nhãn đầu đã về nhưng nhãn chưa gần khung nhìn: vẫn chỗ giữ một nút mỗi ô (Trang chủ mới mở không thêm vài chục nút DOM của thẻ thật).
    expect(tileNames(section(c, 'Fuwa3e')!)).toHaveLength(0);
    expect(section(c, 'Fuwa3e')!.querySelectorAll('[data-testid="catalog-grid-reserve"] > *')).toHaveLength(4);
    const visante = section(c, 'Visante')!;
    expect(visante.querySelector('h3')?.textContent).toBe('Visante');
    // Chưa tải thì giữ chỗ đúng số món sẽ vẽ, mỗi ô một nút (không khung chờ đầy đủ): chip nhảy nhanh cuộn qua nhãn chưa tải mà đích không bị đẩy xuống.
    expect(visante.querySelector('[data-testid="catalog-grid"], [data-testid="catalog-grid-skeleton"]')).toBeNull();
    expect(visante.querySelectorAll('[data-testid="catalog-grid-reserve"] > *')).toHaveLength(2);
    expect(visante.querySelector('[data-testid="catalog-grid-reserve"]')!.className).toBe(GRID_BRAND);
    await reveal();
    expect(productCalls().map((q) => q.brand)).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree']);
    expect(tileNames(section(c, 'Fuwa3e')!)).toHaveLength(4);
    expect(section(c, 'Visante')!.querySelectorAll('[data-testid="catalog-grid-skeleton"] > *')).toHaveLength(2);
    expect(section(c, 'Tubu Tree')!.querySelectorAll('[data-testid="catalog-grid-skeleton"] > *')).toHaveLength(4);
    release();
    await flush(8);
    expect(tileNames(section(c, 'Visante')!)).toHaveLength(2);
  });

  it('Back về Trang chủ khi món nhãn còn trong cache: nhãn lười vẽ ngay, không chờ gần khung nhìn', async () => {
    const client = newTestClient();
    const first = render(
      <QueryClientProvider client={client}>
        <SuggestFeed exclude={new Set()} />
      </QueryClientProvider>,
    );
    await flush(8);
    first.unmount();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    mounted = render(
      <QueryClientProvider client={client}>
        <SuggestFeed exclude={new Set()} />
      </QueryClientProvider>,
    );
    await flush(8);
    expect(tileNames(section(mounted.container, 'Visante')!)).toHaveLength(2);
    expect(tileNames(section(mounted.container, 'Tubu Tree')!)).toHaveLength(1);
  });

  it('nhãn không còn món nào: ẩn hẳn mục đó (chip của nó lùi về trang nhãn)', async () => {
    products.Visante = [];
    const c = await mount();
    expect(section(c, 'Visante')).toBeNull();
    expect(c.querySelector('#home-brand-visante')).toBeNull();
  });

  it('thẻ chen đứng sau nhãn cuối (chiều cao về muộn của nó không đẩy lệch chip nhảy tới nhãn nào)', async () => {
    const c = await mount({ interleave: <div data-testid="quiz">Chẩn đoán</div> });
    const list = c.querySelector('[data-testid="suggest-interleave"]')!.parentElement!;
    const order = Array.from(list.children).map((el) => el.getAttribute('aria-label') ?? el.getAttribute('data-testid'));
    expect(order).toEqual(['Fuwa3e', 'Pơ Lang', 'Visante', 'Tubu Tree', 'suggest-interleave']);
  });

  it('cuối khối một nút "Vào Danh mục" tới trang sản phẩm', async () => {
    const c = await mount();
    click(Array.from(c.querySelectorAll('button')).find((b) => b.textContent === 'Vào Danh mục') ?? null);
    expect(mocks.push).toHaveBeenCalledWith('/san-pham');
  });

  it('chưa có thương hiệu nào: ẩn cả khối, không tải sản phẩm', async () => {
    mocks.get.mockImplementation(async () => []);
    const c = await mount();
    expect(c.innerHTML).toBe('');
    expect(productCalls()).toEqual([]);
  });

  it('lỗi tải thương hiệu: giữ tiêu đề và "Thử lại" tại chỗ; thử lại thành công thì hiện các nhãn', async () => {
    mocks.get.mockImplementation(async (path: string, opts?: { query?: Query }) => {
      if (path === '/brands') throw Object.assign(new Error('x'), { status: 503 });
      return page(products[opts?.query?.brand ?? ''] ?? []);
    });
    const c = await mount();
    const retry = c.querySelector<HTMLButtonElement>('button[aria-label="Thử lại Khám phá theo Thương hiệu"]');
    expect(retry).not.toBeNull();
    mocks.get.mockImplementation(async (path: string, opts?: { query?: Query }) => (path === '/brands' ? BRANDS : page(products[opts?.query?.brand ?? ''] ?? [])));
    click(retry);
    await flush(8);
    expect(sections(c)).toHaveLength(4);
  });

  it('đang tải thương hiệu: giữ tiêu đề và khung chờ lưới (trang không nhảy)', async () => {
    mocks.get.mockImplementation(() => new Promise(() => {}));
    const c = await mount();
    expect(c.querySelector('h2')?.textContent).toBe('Khám phá theo Thương hiệu');
    expect(c.querySelector('[data-testid="catalog-grid-skeleton"]')).not.toBeNull();
  });
});
