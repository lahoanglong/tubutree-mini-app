// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactElement } from 'react';
import { renderToStaticMarkup as renderStatic } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { FlashItem } from '@/lib/flash-price';
import { resetFlashSales } from '@/lib/use-flash-sales';

const api = vi.hoisted(() => ({ flash: [] as unknown[], config: null as unknown }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => api.flash }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async (url: string) => (String(url).includes('config') ? api.config : []), post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import { ProductCard, PRIORITY_CARDS } from './product-card';

const staticHtml = (ui: ReactElement) => renderStatic(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const PRODUCT = {
  id: 'p1', slug: 'nuoc-rua-chen', brand: 'Fuwa3e', name: 'Nước rửa chén sinh học 1L', thumbnail: null,
  basePrice: 120000, salePrice: null, isFeatured: false, inStock: true,
};
const FLASH: FlashItem = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', flashPrice: 79000, retailPrice: 120000,
  salePrice: null, soldCount: 3, quota: 20, endAt: '2099-10-14T16:00:00.000Z',
};
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();

let mounted: Rendered[] = [];
beforeEach(() => {
  resetFlashSales();
  api.flash = [];
  api.config = {};
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.useRealTimers();
});

const mount = async (props: Partial<React.ComponentProps<typeof ProductCard>> = {}) => {
  const r = render(<ProductCard product={PRODUCT} variant="grid" {...props} />);
  mounted.push(r);
  await flush();
  return r.container;
};
const link = (c: HTMLElement) => c.querySelector('a.tubu-tile-link') as HTMLAnchorElement;
const badge = (c: HTMLElement) => c.querySelector('[data-ds-part="image-badge"]')?.textContent ?? null;
const nameHead = (c: HTMLElement) => link(c).textContent;

describe('ProductCard: liên kết tới trang chi tiết', () => {
  it('món gian hàng ghim phân loại: mở ?pv= của phân loại đó', async () => {
    expect(link(await mount({ product: { ...PRODUCT, pinnedVariationId: 'v9' } })).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen?pv=v9');
  });

  it('có Giờ vàng thắng thì ?v= của suất đó, vẫn ưu tiên hơn ghim cùng phân loại; suất của phân loại khác không đổi ghim; không gì cả thì đường dẫn trơn', async () => {
    api.flash = [FLASH];
    expect(link(await mount({ product: { ...PRODUCT, pinnedVariationId: 'v1' } })).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen?v=v1');
    expect(link(await mount({ product: { ...PRODUCT, pinnedVariationId: 'v9' } })).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen?pv=v9');
    api.flash = [];
    resetFlashSales();
    expect(link(await mount()).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
  });

  it('suất Giờ vàng do nơi gọi đưa xuống thắng danh sách chung; null tắt Giờ vàng', async () => {
    api.flash = [FLASH];
    expect(link(await mount({ flash: null })).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
    api.flash = [];
    resetFlashSales();
    const c = await mount({ flash: FLASH });
    expect(link(c).getAttribute('href')).toBe('/san-pham/nuoc-rua-chen?v=v1');
    expect(c.textContent).toContain('79.000đ');
  });

  it('một thẻ chỉ có một liên kết tới sản phẩm, tim là anh em của nó (không lồng)', async () => {
    const c = await mount();
    expect(c.querySelectorAll('a[href]').length).toBe(1);
    const heart = c.querySelector('button[aria-label^="Yêu thích"]')!;
    expect(heart.getAttribute('aria-label')).toBe(`Yêu thích ${PRODUCT.name}`);
    expect(link(c).contains(heart)).toBe(false);
  });

  it('chỉ grid, rail-md, rank có tim; showWishlist=false tắt', async () => {
    expect((await mount({ variant: 'rail-sm' })).querySelector('button[aria-label^="Yêu thích"]')).toBeNull();
    expect((await mount({ variant: 'rail-md' })).querySelector('button[aria-label^="Yêu thích"]')).not.toBeNull();
    expect((await mount({ showWishlist: false })).querySelector('button[aria-label^="Yêu thích"]')).toBeNull();
  });
});

describe('ProductCard: giá Giờ vàng khớp giỏ và đơn (R4-BUYER-4)', () => {
  it('HTML dựng sẵn (ISR) chưa biết đợt nào: giá thường, không nhãn', () => {
    const html = staticHtml(<ProductCard product={PRODUCT} variant="grid" />);
    expect(html).toContain('120.000đ');
    expect(html).not.toContain('Giờ vàng');
  });

  it('có đợt Giờ vàng: giá 79.000đ, giá gốc 120.000đ gạch ngang, nhãn "Giờ vàng -34%"', async () => {
    api.flash = [FLASH];
    const c = await mount();
    expect(c.textContent).toContain('79.000đ');
    expect(c.textContent).toContain('120.000đ');
    expect(badge(c)).toContain('Giờ vàng -34%');
    expect(Array.from(c.querySelectorAll<HTMLElement>('span')).find((e) => e.textContent === '120.000đ')!.style.textDecoration).toBe('line-through');
  });

  it('không có đợt: giá thường, không nhãn giảm giá', async () => {
    const c = await mount();
    expect(badge(c)).toBeNull();
    expect(c.textContent).not.toContain('Giờ vàng');
  });

  it('giảm giá thường: nhãn -17% không ghi Giờ vàng', async () => {
    const c = await mount({ product: { ...PRODUCT, salePrice: 100000 } });
    expect(badge(c)).toContain('-17%');
    expect(badge(c)).not.toContain('Giờ vàng');
  });

  it('hết hàng: không dán nhãn giảm giá', async () => {
    api.flash = [FLASH];
    const c = await mount({ product: { ...PRODUCT, inStock: false } });
    expect(badge(c)).toBeNull();
  });

  it('đợt hết giờ khi khách đang xem: thẻ về giá thường đúng mốc endAt, không chờ lần tải lại danh sách', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const endAt = new Date('2030-01-01T00:00:10Z').toISOString();
    const r = render(<ProductCard product={PRODUCT} variant="grid" flash={{ ...FLASH, endAt }} />);
    mounted.push(r);
    expect(badge(r.container)).toContain('Giờ vàng');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_100);
    });
    expect(badge(r.container)).toBeNull();
    expect(r.container.textContent).toContain('120.000đ');
    expect(r.container.textContent).not.toContain('79.000đ');
  });
});

describe('ProductCard: ảnh', () => {
  const WITH_IMG = { ...PRODUCT, thumbnail: 'https://cdn.example/a.jpg' };
  const img = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.querySelector('img')!;
  };

  it('thẻ thường: tải lười, không đòi ưu tiên cao, có width/height (chống nhảy bố cục)', () => {
    const el = img(staticHtml(<ProductCard product={WITH_IMG} variant="grid" />));
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('fetchpriority')).toBeNull();
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('400');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('thẻ priority: tải ngay (eager) và fetchpriority=high, vẫn có width/height', () => {
    const el = img(staticHtml(<ProductCard product={WITH_IMG} variant="grid" priority />));
    expect(el.getAttribute('loading')).toBe('eager');
    expect(el.getAttribute('fetchpriority')).toBe('high');
    expect(el.getAttribute('width')).toBe('400');
  });

  it('PRIORITY_CARDS là 4 thẻ đầu (2 hàng trên mobile, 1 hàng từ md)', () => {
    expect(PRIORITY_CARDS).toBe(4);
  });
});

describe('ProductCard: nhãn "Mới" (dữ kiện về rồi mới hứa)', () => {
  it('tạo 5 ngày trước: nhãn "Mới" đầu tên; 31 ngày trước, thiếu ngày tạo hay hết hàng thì không', async () => {
    expect(nameHead(await mount({ product: { ...PRODUCT, createdAt: daysAgo(5) } }))).toContain('Mới');
    expect(nameHead(await mount({ product: { ...PRODUCT, createdAt: daysAgo(31) } }))).not.toContain('Mới');
    expect(nameHead(await mount())).not.toContain('Mới');
    expect(nameHead(await mount({ product: { ...PRODUCT, createdAt: daysAgo(1), inStock: false } }))).not.toContain('Mới');
  });

  it('config công khai chưa về thì chưa gắn "Mới"; tải lỗi thì giữ luật 30 ngày', async () => {
    const product = { ...PRODUCT, createdAt: daysAgo(5) };
    const pending = render(
      <QueryClientProvider client={new QueryClient()}>
        <ProductCard product={product} variant="grid" />
      </QueryClientProvider>,
    );
    mounted.push(pending);
    expect(nameHead(pending.container)).not.toContain('Mới');
    const failed = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await failed.prefetchQuery({ queryKey: ['public-config'], queryFn: () => Promise.reject(new Error('mạng')) });
    const err = render(
      <QueryClientProvider client={failed}>
        <ProductCard product={product} variant="grid" />
      </QueryClientProvider>,
    );
    mounted.push(err);
    await flush();
    expect(nameHead(err.container)).toContain('Mới');
  });

  it('mốc ngày mở bán: tạo trước mốc không gắn "Mới", từ mốc trở đi theo luật 30 ngày', async () => {
    const today = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    const startVn = new Date(`${today}T00:00:00+07:00`).getTime();
    api.config = { catalogLaunchDate: today };
    expect(nameHead(await mount({ product: { ...PRODUCT, createdAt: new Date(startVn - 1000).toISOString() } }))).not.toContain('Mới');
    expect(nameHead(await mount({ product: { ...PRODUCT, createdAt: new Date(startVn).toISOString() } }))).toContain('Mới');
  });

  it('HTML dựng sẵn (ISR) không mang nhãn: giờ máy khách quyết định nên server và lần hydrate đầu không được lệch', () => {
    expect(staticHtml(<ProductCard product={{ ...PRODUCT, createdAt: daysAgo(5) }} variant="grid" />)).not.toContain('>Mới<');
  });

  it('SP qua mốc 30 ngày giữa lúc dựng HTML và lúc hydrate: hydrate không lỗi, nhãn không hiện; cache config đã có sẵn cũng không lệch', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    const createdAt = new Date('2026-09-28T12:00:00Z').toISOString();
    const client = new QueryClient();
    client.setQueryData(['public-config'], { catalogLaunchDate: null, freeshipThreshold: 1000 });
    const ui = () => (
      <QueryClientProvider client={client}>
        <ProductCard product={{ ...PRODUCT, createdAt, fulfiller: { kind: 'TUBU' } } as never} variant="grid" />
      </QueryClientProvider>
    );
    const html = renderStatic(ui());
    expect(html).not.toContain('>Mới<');
    expect(html).not.toContain('Miễn phí giao hàng');
    vi.setSystemTime(new Date('2026-10-28T13:00:00Z'));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, ui(), { onRecoverableError: (e) => void errors.push(e) });
    });
    consoleError.mockRestore();
    expect(errors).toEqual([]);
    act(() => root.unmount());
    container.remove();
  });
});

describe('ProductCard: nhãn "Miễn phí giao hàng" chỉ khi biết ngưỡng thật', () => {
  const TUBU = { ...PRODUCT, fulfiller: { kind: 'TUBU' as const } };

  it('cấu hình chưa về: không nhãn; về rồi và giá đạt ngưỡng: có nhãn; giá dưới ngưỡng: không', async () => {
    expect(nameHead(await mount({ product: TUBU }))).not.toContain('Miễn phí giao hàng');
    api.config = { freeshipThreshold: 100_000 };
    const reached = render(<ProductCard product={TUBU} variant="grid" />);
    mounted.push(reached);
    await flush();
    expect(nameHead(reached.container)).toContain('Miễn phí giao hàng');
    api.config = { freeshipThreshold: 500_000 };
    expect(nameHead(await mount({ product: { ...TUBU, slug: 'khac' } }))).not.toContain('Miễn phí giao hàng');
  });
});

describe('ProductCard: nút nổi trên ảnh (imageOverlay)', () => {
  const BTN = <button type="button" aria-label="Thêm vào giỏ">+</button>;

  it('đặt nút trong khung phủ vùng ảnh vuông, khung không chặn chạm và nút nằm ngoài liên kết sản phẩm', async () => {
    const c = await mount({ imageOverlay: BTN });
    const btn = c.querySelector('button[aria-label="Thêm vào giỏ"]')!;
    expect(btn.closest('a')).toBeNull();
    const frame = btn.parentElement!.parentElement!;
    expect(frame.style.pointerEvents).toBe('none');
    expect(frame.style.aspectRatio).toBe('1 / 1');
  });

  it('hết hàng không vẽ nút nổi', async () => {
    expect((await mount({ product: { ...PRODUCT, inStock: false }, imageOverlay: BTN })).querySelector('button[aria-label="Thêm vào giỏ"]')).toBeNull();
  });
});
