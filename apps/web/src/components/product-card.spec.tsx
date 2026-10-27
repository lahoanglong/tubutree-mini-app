// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup as renderStatic } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { FlashItem } from '@/lib/flash-price';

// R4-BUYER-4: trang chủ ghi 120.000đ trong khi giỏ và đơn tính 79.000đ (giá Giờ vàng) không nhãn nào giải thích.

const api = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => api.flash }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: async () => [], post: async () => ({}), delete: async () => ({}) } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));

import ProductCard, { PRIORITY_CARDS } from './product-card';
import { resetFlashSales } from '@/lib/use-flash-sales';

const renderToStaticMarkup = (ui: ReactElement) =>
  renderStatic(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const PRODUCT = {
  id: 'p1', slug: 'nuoc-rua-chen', brand: 'Fuwa3e', name: 'Nước rửa chén sinh học 1L', thumbnail: null,
  basePrice: 120000, salePrice: null, isFeatured: false, inStock: true,
};
const FLASH: FlashItem = {
  itemId: 'f1', variationId: 'v1', productSlug: 'nuoc-rua-chen', flashPrice: 79000, retailPrice: 120000,
  salePrice: null, soldCount: 3, quota: 20, endAt: '2026-10-14T16:00:00.000Z',
};

let mounted: Rendered[] = [];
beforeEach(() => {
  resetFlashSales();
  api.flash = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

const mount = async (product: Record<string, unknown> = PRODUCT) => {
  const r = render(<ProductCard product={product as never} />);
  mounted.push(r);
  await flush();
  return r.container;
};

describe('ProductCard — giá Giờ vàng khớp giỏ và đơn (R4-BUYER-4)', () => {
  it('HTML dựng sẵn (ISR) chưa biết đợt nào: giá thường, không nhãn', () => {
    const html = renderToStaticMarkup(<ProductCard product={PRODUCT as never} />);
    expect(html).toContain('120.000đ');
    expect(html).not.toContain('Giờ vàng');
  });

  it('ở điện thoại giá cỡ 14px và tên cao 22px/dòng như thẻ Mini App', () => {
    const html = renderToStaticMarkup(<ProductCard product={PRODUCT as never} />);
    expect(html).toContain('max-md:text-sm');
    expect(html).toContain('max-md:leading-[22px]');
  });

  it('có đợt Giờ vàng: giá 79.000đ, giá gốc 120.000đ gạch ngang, nhãn "Giờ vàng -34%"', async () => {
    api.flash = [FLASH];
    const c = await mount();
    const price = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === '79.000đ')!;
    expect(price).toBeTruthy();
    const original = Array.from(c.querySelectorAll('span')).find((s) => s.textContent === '120.000đ')!;
    expect(original.className).toContain('line-through');
    expect(c.querySelector('[data-flash="true"]')!.textContent).toContain('Giờ vàng -34%');
  });

  it('không có đợt: giá thường, không nhãn giảm giá', async () => {
    const c = await mount();
    expect(c.textContent).toContain('120.000đ');
    expect(c.textContent).not.toContain('Giờ vàng');
    expect(c.textContent).not.toContain('%');
  });

  it('giảm giá thường: nhãn -17% không ghi Giờ vàng', async () => {
    const c = await mount({ ...PRODUCT, salePrice: 100000 });
    expect(c.textContent).toContain('100.000đ');
    expect(c.textContent).toContain('-17%');
    expect(c.textContent).not.toContain('Giờ vàng');
  });

  it('hết hàng: không dán nhãn giảm giá', async () => {
    api.flash = [FLASH];
    const c = await mount({ ...PRODUCT, inStock: false });
    expect(c.textContent).toContain('Hết hàng');
    expect(c.textContent).not.toContain('Giờ vàng');
  });
});

// D6-05/D6-12: ảnh thẻ trên màn hình đầu là ứng viên LCP; ảnh nào cũng cần kích thước nội tại để không nhảy bố cục (CLS).
describe('ProductCard — ảnh', () => {
  const WITH_IMG = { ...PRODUCT, thumbnail: 'https://cdn.example/a.jpg' };
  const img = (html: string) => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.querySelector('img')!;
  };

  it('thẻ thường: tải lười, không đòi ưu tiên cao, có width/height (chống nhảy bố cục)', () => {
    const el = img(renderToStaticMarkup(<ProductCard product={WITH_IMG as never} />));
    expect(el.getAttribute('loading')).toBe('lazy');
    expect(el.getAttribute('fetchpriority')).toBeNull();
    expect(el.getAttribute('width')).toBe('400');
    expect(el.getAttribute('height')).toBe('400');
    expect(el.getAttribute('decoding')).toBe('async');
  });

  it('thẻ priority: tải ngay (eager) và fetchpriority=high, vẫn có width/height', () => {
    const el = img(renderToStaticMarkup(<ProductCard product={WITH_IMG as never} priority />));
    expect(el.getAttribute('loading')).toBe('eager');
    expect(el.getAttribute('fetchpriority')).toBe('high');
    expect(el.getAttribute('width')).toBe('400');
  });

  it('PRIORITY_CARDS là 4 thẻ đầu (2 hàng trên mobile, 1 hàng từ md)', () => {
    expect(PRIORITY_CARDS).toBe(4);
  });
});

// Thẻ kiểu Mini App ở điện thoại (ProductTile): phẳng không viền, chấm màu + tên nhãn, sao · đã bán TRÊN giá, tim nổi; từ md giữ thẻ viền của máy tính.
describe('ProductCard — kiểu Mini App ở điện thoại', () => {
  const REVIEWED = { ...PRODUCT, reviewCount: 8, ratingAvg: 4.5, sold: 12 };
  const html = (p: Record<string, unknown>) => {
    const box = document.createElement('div');
    box.innerHTML = renderToStaticMarkup(<ProductCard product={p as never} />);
    return box;
  };

  it('vỏ thẻ phẳng đổ bóng elevation-1, chỉ từ md mới có viền', () => {
    const root = html(PRODUCT).firstElementChild as HTMLElement;
    expect(root.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(root.className).toContain('md:border');
    expect(root.className).toContain('var(--elevation-1)');
  });

  it('một link duy nhất tới sản phẩm; tim là anh em của link (không lồng nút trong link)', () => {
    const box = html(PRODUCT);
    const links = box.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/san-pham/nuoc-rua-chen');
    const heart = box.querySelector('button[aria-label="Thêm yêu thích"]')!;
    expect(heart).not.toBeNull();
    expect(links[0]!.contains(heart)).toBe(false);
  });

  it('hàng nhãn: chấm màu + tên nhãn (chỉ điện thoại); chip nhãn trên ảnh chỉ từ md', () => {
    const box = html(PRODUCT);
    const dotRow = box.querySelector('[data-testid="card-brand-row"]')!;
    expect(dotRow.className).toContain('md:hidden');
    expect(dotRow.textContent).toBe('Fuwa3e');
    expect(dotRow.querySelector('span[aria-hidden]')).not.toBeNull();
    expect(box.querySelector('[data-testid="card-brand-chip"]')!.className).toContain('max-md:hidden');
  });

  it('hàng sao: "★ 4.5 (8) · Đã bán 12" đứng TRƯỚC giá ở điện thoại (order), sau giá ở máy tính', () => {
    const meta = html(REVIEWED).querySelector('[data-testid="card-meta"]') as HTMLElement;
    expect(meta.textContent).toBe('★ 4.5 (8) · Đã bán 12');
    expect(meta.className).toMatch(/\border-1\b/);
    expect(meta.className).toMatch(/\bmd:order-2\b/);
  });

  it('chưa có đánh giá: không dán nhãn "★ Mới", không khoe sao; lượt bán (nếu có) không bắt đầu bằng dấu chấm giữa', () => {
    const meta = html(PRODUCT).querySelector('[data-testid="card-meta"]')!;
    expect(meta.textContent).not.toContain('Mới');
    expect(meta.textContent).not.toContain('★');
    const sold = html({ ...PRODUCT, sold: 12 }).querySelector('[data-testid="card-meta"]')!;
    expect(sold.textContent).toBe('Đã bán 12');
  });

  it('ảnh thiếu: nền pha màu nhãn, lá nhỏ và tên nhãn, ẩn khỏi trình đọc màn hình', () => {
    const ph = html(PRODUCT).querySelector('[data-testid="product-image-fallback"]')!;
    expect(ph.getAttribute('aria-hidden')).toBe('true');
    expect(ph.querySelector('svg')).not.toBeNull();
    expect(ph.textContent).toBe('Fuwa3e');
  });
});
