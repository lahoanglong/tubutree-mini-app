// @vitest-environment jsdom
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTestClient } from '@/test-utils/render-hook';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { ApiError } from '@/lib/client-api';
import { formatVnd } from '@/lib/format-vnd';

// Chép ý nghĩa purchased-rail.spec của Mini App: kệ "Mua lại" cho khách cũ, ẩn khi rỗng/404/khách, sheet → thêm giỏ → sang giỏ, lỗi làm mới.
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), push: vi.fn(), phase: 'authenticated', flash: [] as unknown[] }));
vi.mock('@/lib/use-flash-sales', () => ({ useActiveFlashSales: () => mocks.flash }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { get: mocks.get, post: mocks.post } }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { PurchasedRail } from './purchased-rail';

const ITEM = {
  variationId: 'v1', productId: 'p1', slug: 'nuoc-rua-chen', productName: 'Nước rửa chén', variationName: 'Chanh', brand: 'Tubu',
  thumbnail: null, price: 65000, salePrice: null, stock: 8, inStock: true, timesBought: 2, retailOnly: false, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
};
const CART = { items: [], couponCode: null, subtotal: 65000, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 1 };

let rail: () => Promise<unknown>;
let mounted: Rendered | null = null;
const mount = async (props: React.ComponentProps<typeof PurchasedRail> = {}) => {
  mounted = render(<PurchasedRail {...props} />);
  await flush(8);
  return mounted.container;
};

beforeEach(() => {
  mocks.phase = 'authenticated';
  mocks.flash = [];
  rail = async () => ({ items: [ITEM], nextCursor: null });
  mocks.get.mockReset().mockImplementation(() => rail());
  mocks.post.mockReset().mockResolvedValue(CART);
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = '';
});

describe('PurchasedRail', () => {
  it('1 món: thẻ ngang thấp (không phải kệ cuộn) với tên, phân loại, giá và hai nút; hỏi đúng /me/purchased-items?limit=10', async () => {
    const c = await mount();
    const region = c.querySelector('section[aria-label="Mua lại"]')!;
    expect(region.textContent).toContain('Nước rửa chén');
    expect(region.textContent).toContain('Chanh');
    expect(region.textContent).toContain('65.000đ');
    expect(byText(region as HTMLElement, 'button', 'Mua lại')).not.toBeNull();
    expect(Array.from(region.querySelectorAll('button')).some((b) => /Định kỳ/.test(b.textContent ?? ''))).toBe(true);
    expect(region.querySelector('ul')).toBeNull();
    expect(mocks.get).toHaveBeenCalledWith('/me/purchased-items', { query: { limit: 10 } });
  });

  it('tab Đơn hàng: tiêu đề không có "Xem tất cả" (khách đang ở đúng danh sách đó)', async () => {
    const c = await mount();
    expect(c.querySelector('a[aria-label^="Xem tất cả"]')).toBeNull();
  });

  // D7-29/D7-30: tên SP cao đúng hai dòng; kệ nhiều món không giãn thẻ theo bề ngang từ md (thẻ giãn làm lệch hàng ở 1280px).
  it('từ 3 món: kệ cuộn ngang, tên cao đúng hai dòng, thẻ không giãn từ md', async () => {
    rail = async () => ({ items: [ITEM, { ...ITEM, variationId: 'v2' }, { ...ITEM, variationId: 'v3' }], nextCursor: null });
    const c = await mount();
    const name = c.querySelector('section[aria-label="Mua lại"] a.tubu-tile-link > span') as HTMLElement;
    expect(name.style.webkitLineClamp).toBe('2');
    expect(name.style.minHeight).toBe('44px');
    const tile = c.querySelector('section[aria-label="Mua lại"] [data-ds="product-tile"]') as HTMLElement;
    expect(tile.className).not.toContain('md:flex-1');
    expect(tile.textContent).toContain('Đã mua 2 lần');
    expect((tile.closest('[style*="--tile-w-md"]') as HTMLElement).style.width).toBe('var(--tile-w-md)');
    // Hàng cuộn bên trong là vùng riêng: không trùng tên khối "Mua lại" (trình đọc màn hình nghe hai vùng cùng tên lồng nhau).
    expect(c.querySelectorAll('section[aria-label="Mua lại"], [role="region"][aria-label="Mua lại"]')).toHaveLength(1);
    expect(c.querySelector('[role="region"][aria-label="Sản phẩm đã mua"]')).not.toBeNull();
  });

  it('có giá sale thì hiện giá sale kèm giá gạch', async () => {
    rail = async () => ({ items: [{ ...ITEM, timesBought: 1, salePrice: 59000 }], nextCursor: null });
    const c = await mount();
    expect(c.textContent).toContain('59.000đ');
    expect(c.querySelector('[style*="line-through"]')?.textContent).toBe('65.000đ');
  });

  it('khách mới (rỗng) → không render gì', async () => {
    rail = async () => ({ items: [], nextCursor: null });
    expect((await mount()).textContent).toBe('');
  });

  it('API cũ trả 404 hoặc lỗi ở lần tải đầu → ẩn im lặng, không "Thử lại" (Trang chủ tự dựng khối lỗi cho lỗi thật)', async () => {
    rail = async () => {
      throw new ApiError('Không tìm thấy', 404);
    };
    expect((await mount()).textContent).toBe('');
  });

  it('chưa đăng nhập → không gọi API, không render', async () => {
    mocks.phase = 'guest';
    expect((await mount()).textContent).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('đang tải → khung chờ ẩn với trình đọc màn hình, không phải region', async () => {
    rail = () => new Promise(() => undefined);
    const c = await mount();
    expect(c.querySelector('[data-testid="purchased-rail-loading"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(c.querySelector('section')).toBeNull();
  });

  it('"Mua lại" → sheet → "Thêm vào giỏ (1)" → POST /cart/items addSource repurchase rồi tự sang giỏ', async () => {
    const c = await mount();
    click(byText(c, 'button', 'Mua lại'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const cta = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Thêm vào giỏ (1)')!;
    click(cta);
    await flush(8);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v1', quantity: 1, addSource: 'repurchase' }, undefined);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('SP hết hàng: thẻ không có nút mua lại, ghi "Tạm hết hàng"', async () => {
    rail = async () => ({ items: [{ ...ITEM, inStock: false, stock: 0 }], nextCursor: null });
    const c = await mount();
    expect(byText(c, 'button', 'Mua lại')).toBeNull();
    expect(c.textContent).toContain('Tạm hết hàng');
  });

  it('chạm tên/ảnh thẻ → trang sản phẩm', async () => {
    const c = await mount();
    click(c.querySelector('button[aria-label="Nước rửa chén"]'));
    expect(mocks.push).toHaveBeenCalledWith('/san-pham/nuoc-rua-chen?pv=v1');
  });

  it('B-146: liên kết thẻ mở đúng phân loại đã mua (?v= khi đang Giờ vàng, ?pv= khi không), thẻ hiện giá Giờ vàng của phân loại đó', async () => {
    rail = async () => ({ items: [ITEM, { ...ITEM, variationId: 'v3', slug: 'xa-bong' }, { ...ITEM, variationId: 'v4', slug: 'tay' }], nextCursor: null });
    mocks.flash = [{ itemId: 'f', variationId: 'v1', productSlug: 'nuoc-rua-chen', flashPrice: 50_000, retailPrice: 65_000, salePrice: null, endAt: new Date(Date.now() + 3_600_000).toISOString() }];
    const c = await mount();
    const tileOf = (href: string) => c.querySelector(`a[href="${href}"]`)!.closest('[data-ds="product-tile"]') as HTMLElement;
    expect(tileOf('/san-pham/nuoc-rua-chen?v=v1').textContent).toContain(formatVnd(50_000));
    expect(tileOf('/san-pham/xa-bong?pv=v3').textContent).toContain(formatVnd(65_000));
  });

  describe('làm mới lỗi (React Query v5 giữ dữ liệu cũ, status=error)', () => {
    it('còn dữ liệu cũ → kệ KHÔNG biến mất: vẫn hiện thẻ cũ + dòng báo nhẹ + "Thử lại"; thử lại xong thì dòng báo mất', async () => {
      const client = newTestClient();
      mounted = render(
        <QueryClientProvider client={client}>
          <PurchasedRail />
        </QueryClientProvider>,
      );
      await flush(8);
      expect(mounted.container.textContent).toContain('Nước rửa chén');

      rail = async () => {
        throw new ApiError('Máy chủ đang bận', 503);
      };
      await act(async () => {
        await client.refetchQueries({ queryKey: ['purchased-items', 10] });
      });
      await flush(4);
      expect(mounted.container.textContent).toContain('Nước rửa chén');
      expect(mounted.container.textContent).toContain('Máy chủ đang bận');

      rail = async () => ({ items: [ITEM], nextCursor: null });
      click(mounted.container.querySelector('button[aria-label="Thử lại Mua lại"]'));
      await flush(8);
      expect(mounted.container.textContent).not.toContain('Máy chủ đang bận');
      expect(mounted.container.textContent).toContain('Nước rửa chén');
    });

    it('lỗi ở lần tải đầu (chưa có gì để giữ): hiện khối lỗi "Thử lại"; API cũ 404 thì vẫn ẩn', async () => {
      rail = async () => {
        throw new ApiError('Máy chủ đang bận', 503);
      };
      const c = await mount();
      expect(c.textContent).toContain('Mua lại');
      expect(c.textContent).toContain('Máy chủ đang bận');
      expect(c.querySelector('button[aria-label="Thử lại Mua lại"]')).not.toBeNull();
      mounted!.unmount();
      rail = async () => {
        throw new ApiError('Không tìm thấy', 404);
      };
      expect((await mount()).textContent).toBe('');
    });
  });

  describe('thẻ gọn (1–2 món)', () => {
    const labels = (c: HTMLElement) => Array.from(c.querySelectorAll('button')).map((b) => b.textContent ?? '');
    it('API báo hàng chỉ bán lẻ (retailOnly): không mời "Định kỳ", vẫn có "Mua lại"', async () => {
      rail = async () => ({ items: [{ ...ITEM, retailOnly: true }], nextCursor: null });
      const c = await mount();
      expect(labels(c).some((t) => /Định kỳ/.test(t))).toBe(false);
      expect(byText(c, 'button', 'Mua lại')).not.toBeNull();
    });

    it('API cũ chưa trả retailOnly: không mời "Định kỳ"', async () => {
      const { retailOnly: _omit, ...old } = ITEM;
      rail = async () => ({ items: [old], nextCursor: null });
      const c = await mount();
      expect(labels(c).some((t) => /Định kỳ/.test(t))).toBe(false);
    });

    it('hết hàng: ghi "Tạm hết hàng", không có nút Mua lại / Định kỳ', async () => {
      rail = async () => ({ items: [{ ...ITEM, stock: 0, inStock: false }], nextCursor: null });
      const c = await mount();
      expect(c.textContent).toContain('Tạm hết hàng');
      expect(byText(c, 'button', 'Mua lại')).toBeNull();
      expect(labels(c).some((t) => /Định kỳ/.test(t))).toBe(false);
    });

    it('"Đã mua N lần" chỉ khi mua từ 2 lần', async () => {
      expect((await mount()).textContent).toContain('Đã mua 2 lần');
      mounted!.unmount();
      rail = async () => ({ items: [{ ...ITEM, timesBought: 1 }], nextCursor: null });
      expect((await mount()).textContent).not.toMatch(/Đã mua \d+ lần/);
    });
  });
});

describe('PurchasedRail — Trang chủ (Q6)', () => {
  const home = (extra: React.ComponentProps<typeof PurchasedRail> = {}) => mount({ source: 'home_rail', ...extra });
  const heightOf = (c: HTMLElement) => (c.querySelector('[data-testid="purchased-rail-loading"]') as HTMLElement).style.height;

  it('tiêu đề SectionHeader có "Xem tất cả" sang danh sách Đã giao', async () => {
    const c = await home();
    expect(c.querySelector('section h2')?.textContent).toBe('Mua lại');
    expect(c.querySelector('[data-testid="section-header"]')).not.toBeNull();
    expect(c.querySelector('a[aria-label="Xem tất cả Mua lại"]')?.getAttribute('href')).toBe('/tai-khoan/don-hang?tab=delivered');
  });

  it('một món: MỘT dòng cao 88px, nút "Mua lại" cùng hàng, không mời "Định kỳ" (còn ở tab Đơn hàng)', async () => {
    const c = await home();
    const line = c.querySelector('[data-testid="rebuy-line"]') as HTMLElement;
    expect(line.style.height).toBe('88px');
    expect(line.textContent).toContain('Nước rửa chén');
    expect(line.textContent).toContain('Chanh · Đã mua 2 lần');
    expect(line.textContent).toContain('65.000đ');
    expect(byText(line, 'button', 'Mua lại')).not.toBeNull();
    expect(Array.from(c.querySelectorAll('button')).some((b) => /Định kỳ/.test(b.textContent ?? ''))).toBe(false);
  });

  it('một món hết hàng: dòng ghi "Tạm hết hàng", không có nút Mua lại', async () => {
    rail = async () => ({ items: [{ ...ITEM, stock: 0 }], nextCursor: null });
    const c = await home();
    const line = c.querySelector('[data-testid="rebuy-line"]') as HTMLElement;
    expect(line.textContent).toContain('Tạm hết hàng');
    expect(byText(line, 'button', 'Mua lại')).toBeNull();
  });

  it('chạm tên/ảnh dòng → trang sản phẩm ở đúng phân loại đã mua', async () => {
    const c = await home();
    click(c.querySelector('[data-testid="rebuy-line"] button[aria-label="Nước rửa chén"]'));
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/san-pham/nuoc-rua-chen'));
  });

  it('hai món trở lên: kệ cuộn ngang thẻ, không còn thẻ gọn của tab Đơn hàng', async () => {
    rail = async () => ({ items: [ITEM, { ...ITEM, variationId: 'v2', slug: 'sp-2' }], nextCursor: null });
    const c = await home();
    expect(c.querySelector('[data-testid="rebuy-line"]')).toBeNull();
    expect(c.querySelectorAll('[role="region"] a.tubu-tile-link, [role="region"] .tubu-tile-link').length).toBeGreaterThanOrEqual(2);
  });

  it('bỏ phân loại đã nằm ở Giờ vàng: phân loại trùng không lặp lại, hết món thì khối ẩn', async () => {
    rail = async () => ({ items: [ITEM, { ...ITEM, variationId: 'v2', slug: 'sp-2', productName: 'Sản phẩm hai' }], nextCursor: null });
    const c = await home({ excludeVariations: new Set(['v1']) });
    expect(c.textContent).not.toContain('Nước rửa chén');
    expect(c.querySelector('[data-testid="rebuy-line"]')).not.toBeNull();
    mounted!.unmount();
    const none = await home({ excludeVariations: new Set(['v1', 'v2']) });
    expect(none.textContent).toBe('');
  });

  it('Giờ vàng giữ phân loại khác của cùng sản phẩm thì phân loại đã mua vẫn hiện ở Mua lại (P2 #3)', async () => {
    rail = async () => ({ items: [{ ...ITEM, variationId: 'v-5l', slug: 'can', productName: 'Can nước rửa', variationName: '5L' }, { ...ITEM, variationId: 'v2', slug: 'sp-2' }], nextCursor: null });
    const c = await home({ excludeVariations: new Set(['v-1l']) });
    expect(c.textContent).toContain('Can nước rửa');
  });

  it('khung chờ cao đúng dòng 88px + tiêu đề 44px khi chưa nhớ hay nhớ "một món"; cao hơn khi nhớ "nhiều món"', async () => {
    rail = () => new Promise(() => undefined);
    try { localStorage.clear(); } catch { /* không có kho */ }
    let c = await home();
    expect(heightOf(c)).toBe('132px');
    mounted!.unmount();
    try { localStorage.setItem('tubu_home_purchased', 'many'); } catch { /* không có kho */ }
    c = await home();
    expect(Number.parseInt(heightOf(c), 10)).toBeGreaterThan(132);
  });

  it('ghi dấu nhớ số món sau khi tải xong để lần sau khung chờ cao đúng', async () => {
    try { localStorage.clear(); } catch { /* không có kho */ }
    await home();
    expect(localStorage.getItem('tubu_home_purchased')).toBe('one');
  });
});
