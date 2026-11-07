// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BestSellersPage } from '@tubutree/app-core/api/browse';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { newTestClient } from '@/test-utils/render-hook';

// Lớp mạng (apiFetch) là bản giả; core-http, query và quick-add là bản THẬT để Reel đi đúng đường thêm giỏ nhanh của web.
const net = vi.hoisted(() => ({ apiFetch: vi.fn(), push: vi.fn(), phase: 'authenticated' as 'authenticated' | 'guest' }));
vi.mock('@/lib/client-api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/client-api')>()), apiFetch: net.apiFetch }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => net.phase, useAuthRestoring: () => false }));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/use-flash-sales', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/use-flash-sales')>()), useActiveFlashSales: () => [] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: net.push }) }));
// Bảng chọn thật nạp qua next/dynamic; thay bằng bản rút gọn để test không phụ thuộc bảng đáy.
vi.mock('@/components/variation-sheet', () => ({
  VariationSheet: (p: { open: boolean; productName: string; variations: { id: string }[] }) =>
    p.open ? <div data-testid="variation-sheet">{p.productName}:{p.variations.length}</div> : null,
}));

import { HomeStoryReel } from './home-story-reel';

const card = (id: string, over: Record<string, unknown> = {}) => ({
  id, slug: id, brand: 'Tubu', name: `Món ${id}`, thumbnail: null, basePrice: 50000, salePrice: null, isFeatured: false, inStock: true, repVariationId: `v-${id}`, ...over,
});
const PAGE = (cards: unknown[]): BestSellersPage => ({ data: cards, meta: { page: 1, limit: 10, total: cards.length }, basis: 'days30' }) as unknown as BestSellersPage;
const CARDS = [card('a'), card('b'), card('c'), card('d')];
const detail = (slug: string, over: Record<string, unknown> = {}) => ({
  id: slug, slug, brand: 'Tubu', name: `Món ${slug}`, shortDesc: null, description: 'Mô tả', images: [], thumbnail: null, basePrice: 50000, salePrice: null,
  certifications: [], ingredients: null, storyConfig: null,
  variations: [{ id: `v-${slug}`, sku: slug, name: 'Mặc định', attributes: {}, retailPrice: 50000, salePrice: null, stock: 5 }], ...over,
});
const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 0 };

let details: Record<string, unknown> = {};
let mounted: Rendered | null = null;
const q = (id: string) => mounted!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rings = () => Array.from(mounted!.container.querySelectorAll<HTMLElement>('[data-testid="story-reel-item"]'));
const calls = () => net.apiFetch.mock.calls.map(([p, o]) => `${(o as { method?: string } | undefined)?.method ?? 'GET'} ${String(p).split('?')[0]}`);

function mount(ui: React.ReactElement) {
  mounted = render(ui, newTestClient());
  return mounted;
}

beforeEach(() => {
  sessionStorage.clear();
  net.phase = 'authenticated';
  net.push.mockReset();
  details = Object.fromEntries(CARDS.map((c) => [c.slug, detail(c.slug)]));
  net.apiFetch.mockReset().mockImplementation(async (path: string, opts?: { method?: string }) => {
    const key = path.split('?')[0]!;
    if (key === '/products') return PAGE(CARDS);
    if (key === '/cart/items' && opts?.method === 'POST') return { ...CART, itemCount: 1 };
    if (key === '/cart') return CART;
    const m = /^\/products\/([^/]+)$/.exec(key);
    if (m && details[decodeURIComponent(m[1]!)] !== undefined) {
      const d = details[decodeURIComponent(m[1]!)];
      if (d instanceof Error) throw d;
      return d;
    }
    throw new Error(`đường dẫn lạ ${path}`);
  });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.style.overflow = '';
});

describe('HomeStoryReel (web)', () => {
  it('có dữ liệu dựng sẵn thì dải vòng đã có trong HTML đầu của máy chủ (không chờ hydrate, không nhảy trang)', () => {
    const html = renderToString(
      <QueryClientProvider client={newTestClient()}>
        <HomeStoryReel initialBestSellers={PAGE(CARDS)} />
      </QueryClientProvider>,
    );
    expect(html.match(/data-testid="story-reel-item"/g)).toHaveLength(4);
    expect(html).toContain('Câu chuyện sản phẩm');
    expect(html).not.toContain('story-reel-skeleton');
  });

  it('dữ liệu dựng sẵn: vẽ dải ngay, không gọi lại danh sách Bán chạy nhất trong thời gian còn tươi', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(3);
    expect(rings().map((r) => r.dataset.slug)).toEqual(['a', 'b', 'c', 'd']);
    expect(calls()).not.toContain('GET /products');
  });

  it('chưa có dữ liệu: khung chờ, rồi vòng thật khi danh sách về', async () => {
    let release!: (v: unknown) => void;
    net.apiFetch.mockImplementation(async (path: string) => {
      if (path.split('?')[0] === '/products') return new Promise((r) => (release = r));
      return CART;
    });
    mount(<HomeStoryReel />);
    await flush(2);
    expect(mounted!.container.querySelectorAll('[data-testid="story-reel-skeleton"]')).toHaveLength(6);
    await act(async () => release(PAGE(CARDS)));
    await flush(3);
    expect(mounted!.container.querySelector('[data-testid="story-reel-skeleton"]')).toBeNull();
    expect(rings()).toHaveLength(4);
  });

  it('dưới 3 món còn hàng thì không vẽ gì; món hết hàng không lên dải', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE([card('a'), card('b'), card('c', { inStock: false })])} />);
    await flush(2);
    expect(q('story-reel-strip')).toBeNull();
    expect(mounted!.container.textContent).toBe('');
  });

  it('API lỗi: không vẽ gì và không ném lỗi ra trang', async () => {
    net.apiFetch.mockRejectedValue(new Error('mạng'));
    mount(<HomeStoryReel />);
    await flush(4);
    expect(q('story-reel-strip')).toBeNull();
    expect(mounted!.container.textContent).toBe('');
  });

  it('dải chỉ lấy tối đa 8 món', async () => {
    const many = Array.from({ length: 12 }, (_, i) => card(`m${i}`));
    mount(<HomeStoryReel initialBestSellers={PAGE(many)} />);
    await flush(2);
    expect(rings()).toHaveLength(8);
  });

  it('chạm vòng: khung chờ toàn màn có nút đóng 44px, rồi Reel thật với vị trí, giá và "Câu chuyện kế"; vòng đổi xám và ghi vào sessionStorage', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    expect(rings()[1]!.dataset.seen).toBe('false');
    click(rings()[1]!);
    expect(q('reel-pending')!.getAttribute('role')).toBe('dialog');
    expect(q('story-close')).not.toBeNull();
    await flush(4);
    expect(q('reel-pending')).toBeNull();
    expect(q('product-story')).not.toBeNull();
    expect(q('story-position')!.textContent).toBe('2/4');
    expect(q('story-add-to-cart')!.textContent).toBe('Thêm vào giỏ · 50.000đ');
    expect(q('story-next')!.textContent).toBe('Câu chuyện kế');
    expect(q('story-buy-now')).toBeNull();
    expect(rings()[1]!.dataset.seen).toBe('true');
    expect(rings()[0]!.dataset.seen).toBe('false');
    expect(JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!)).toContain('b');
  });

  it('đã xem từ trước trong phiên: vòng xám ngay sau hydrate', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    click(q('story-close'));
    mounted!.unmount();
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    expect(rings()[0]!.dataset.seen).toBe('true');
    expect(rings()[0]!.getAttribute('aria-label')).toBe('Xem lại câu chuyện Món a');
  });

  it('đóng bằng nút Đóng và bằng phím Esc; trả cuộn trang', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    click(q('story-close'));
    expect(q('product-story')).toBeNull();
    expect(q('reel-pending')).toBeNull();
    click(rings()[0]!);
    await flush(4);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('product-story')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('đóng khi đang chờ chi tiết: khung chờ biến mất, kết quả về sau không mở lại Reel', async () => {
    let release!: (v: unknown) => void;
    net.apiFetch.mockImplementation(async (path: string) => {
      if (path.startsWith('/products/')) return new Promise((r) => (release = r));
      throw new Error('lạ');
    });
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    expect(q('reel-pending')).not.toBeNull();
    click(q('story-close'));
    expect(q('reel-pending')).toBeNull();
    await act(async () => release(detail('a')));
    await flush(3);
    expect(q('product-story')).toBeNull();
  });

  it('"Câu chuyện kế": sang món sau, vị trí tăng, đánh dấu đã xem; món cuối không có nút kế', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[2]!);
    await flush(4);
    expect(q('story-position')!.textContent).toBe('3/4');
    click(q('story-next'));
    await flush(4);
    expect(q('story-position')!.textContent).toBe('4/4');
    expect(q('story-next')).toBeNull();
    expect(rings()[3]!.dataset.seen).toBe('true');
  });

  it('tải trước chi tiết của món kế khi Reel mở (bấm "Câu chuyện kế" không phải chờ)', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(5);
    expect(calls()).toContain('GET /products/b');
  });

  it('chạm/lấy nét vòng tải trước chi tiết của món đó', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    act(() => {
      rings()[3]!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await flush(2);
    expect(calls()).toContain('GET /products/d');
  });

  it('chi tiết lỗi: đóng khung chờ và báo "Chưa mở được câu chuyện" (role=alert)', async () => {
    details.a = new Error('lỗi');
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(5);
    expect(q('reel-pending')).toBeNull();
    expect(q('product-story')).toBeNull();
    const alert = mounted!.container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Chưa mở được câu chuyện. Bạn thử lại nhé.');
  });

  it('admin đã tắt câu chuyện của món: tự nhảy sang món kế; món cuối bị tắt thì đóng', async () => {
    details.b = detail('b', { storyConfig: { version: 1, enabled: false, scenes: [] } });
    details.d = detail('d', { storyConfig: { version: 1, enabled: false, scenes: [] } });
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[1]!);
    await flush(6);
    expect(q('story-position')!.textContent).toBe('3/4');
    click(q('story-close'));
    click(rings()[3]!);
    await flush(6);
    expect(q('product-story')).toBeNull();
    expect(q('reel-pending')).toBeNull();
  });

  it('thêm giỏ khi đã đăng nhập: đóng Reel, thêm phân loại còn hàng duy nhất với số lượng 1 theo đường giỏ nhanh, báo "Đã thêm vào giỏ!"', async () => {
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    click(q('story-add-to-cart'));
    expect(q('product-story')).toBeNull();
    await flush(6);
    const post = net.apiFetch.mock.calls.find(([p, o]) => p === '/cart/items' && (o as { method?: string }).method === 'POST')!;
    expect((post[1] as { body: { variationId: string; quantity: number } }).body).toMatchObject({ variationId: 'v-a', quantity: 1 });
    expect(mounted!.container.textContent).toContain('Đã thêm vào giỏ!');
  });

  it('món nhiều phân loại: đóng Reel rồi mở bảng chọn phân loại thay vì thêm bừa', async () => {
    details.a = detail('a', {
      variations: [
        { id: 'v-a1', sku: 'a1', name: 'Bé', attributes: {}, retailPrice: 50000, salePrice: null, stock: 5 },
        { id: 'v-a2', sku: 'a2', name: 'Lớn', attributes: {}, retailPrice: 90000, salePrice: null, stock: 5 },
      ],
    });
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    click(q('story-add-to-cart'));
    await flush(6);
    expect(q('product-story')).toBeNull();
    expect(calls().filter((c) => c === 'POST /cart/items')).toHaveLength(0);
    expect(document.body.querySelector('[data-testid="variation-sheet"]')!.textContent).toBe('Món a:2');
  });

  it('khách vãng lai: nhớ món chờ thêm rồi chuyển tới đăng nhập, quay lại trang sản phẩm; không gọi API giỏ', async () => {
    net.phase = 'guest';
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    click(q('story-add-to-cart'));
    expect(net.push).toHaveBeenCalledWith('/dang-nhap?returnTo=%2Fsan-pham%2Fa');
    expect(JSON.parse(sessionStorage.getItem('tubu_pending_add')!)).toMatchObject({ variationId: 'v-a', quantity: 1 });
    expect(calls().filter((c) => c.endsWith('/cart/items'))).toHaveLength(0);
  });

  it('món hết sạch tồn ở chi tiết: nút thêm giỏ khoá và ghi "Hết hàng"', async () => {
    details.a = detail('a', { variations: [{ id: 'v-a', sku: 'a', name: 'M', attributes: {}, retailPrice: 50000, salePrice: null, stock: 0 }] });
    mount(<HomeStoryReel initialBestSellers={PAGE(CARDS)} />);
    await flush(2);
    click(rings()[0]!);
    await flush(4);
    const add = q('story-add-to-cart') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.textContent).toBe('Hết hàng');
  });
});
