// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, render, type Rendered } from '@/test-utils/dom';
import type { FlashItem } from '@/lib/flash-price';

// R4-BUYER-4: trang chủ ghi 120.000đ trong khi giỏ và đơn tính 79.000đ (giá Giờ vàng) không nhãn nào giải thích.

const api = vi.hoisted(() => ({ flash: [] as unknown[] }));
vi.mock('@/lib/shop-client', () => ({ getActiveFlashSales: async () => api.flash }));

import ProductCard, { PRIORITY_CARDS } from './product-card';
import { resetFlashSales } from '@/lib/use-flash-sales';

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
