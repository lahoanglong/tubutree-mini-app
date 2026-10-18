// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { click, flush, mockFetch, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, orderReorderTarget, type ReorderTarget } from './reorder';

// Mini App reorder-sheet.spec.tsx + use-reorder.spec.tsx: chọn dòng, số lượng, CTA, lỗi giữ lựa chọn, chống chạm đúp.

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn() }) }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, cartKey: () => ['cart', null], useCartKey: () => ['cart', null] }));

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 0 };
const oi = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, variationId: `v-${id}`, productName: name, productSlug: 's', variationName: '', unitPrice: 50000, quantity: 2, total: 100000,
  backorderedQty: 0, stock: 10, available: true, currentPrice: 50000, thumbnail: null, ...over,
});
const ORDER = orderReorderTarget({
  code: 'TUBU1',
  items: [oi('a', 'Nước rửa chén') as never, oi('b', 'Xà phòng', { stock: 0, available: false }) as never],
});
const PURCHASED = itemReorderTarget({
  variationId: 'v9', productId: 'p9', slug: 'dau-goi', productName: 'Dầu gội', variationName: '500ml', brand: 'Tubu', thumbnail: null,
  price: 90000, salePrice: null, stock: 5, inStock: true, timesBought: 3, lastPurchasedAt: '2026-09-01T00:00:00Z',
});

const added = (key: string, qty: number) => ({ ...CART, results: [{ orderItemId: key, status: 'added', addedQuantity: qty }] });

let mounted: Rendered[] = [];
let api: ReturnType<typeof mockFetch>;
const body = () => document.body;
const button = (label: string) => Array.from(body().querySelectorAll('button')).find((b) => b.textContent === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
const checkbox = (name: string) => body().querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${name}"]`)!;

function mount(target: ReorderTarget | null, onClose = vi.fn(), onNotice = vi.fn()) {
  const r = render(<ReorderSheet target={target} source="order_card" navigateToCart onClose={onClose} onNotice={onNotice} />);
  mounted.push(r);
  return { onClose, onNotice };
}
const stub = (routes: Parameters<typeof mockFetch>[0]) => {
  api = mockFetch(routes);
  vi.stubGlobal('fetch', vi.fn(api.fn));
};

beforeEach(() => {
  nav.push.mockReset();
  stub({ '/orders/TUBU1/repurchase': { body: added('a', 2) }, '/cart/items': { body: CART } });
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  vi.unstubAllGlobals();
});

describe('ReorderSheet', () => {
  it('dòng hết hàng: mờ, ô chọn bị khoá, không tính vào CTA; tạm tính theo dòng chọn', async () => {
    mount(ORDER);
    await flush();
    expect(checkbox('Chọn Xà phòng').disabled).toBe(true);
    expect(checkbox('Chọn Nước rửa chén').checked).toBe(true);
    expect(body().textContent).toContain('Tạm hết hàng');
    expect(button('Thêm vào giỏ (2)')).toBeTruthy();
    expect(body().textContent).toContain('100.000đ');
    expect(body().textContent).toContain('Từ đơn TUBU1');
  });

  it('bỏ chọn hết → CTA "(0)" bị vô hiệu', async () => {
    mount(ORDER);
    click(checkbox('Chọn Nước rửa chén'));
    await flush();
    expect(button('Thêm vào giỏ (0)').disabled).toBe(true);
  });

  it('+ số lượng cập nhật CTA; gửi đúng endpoint và body như Mini App; thành công sạch → đóng sheet và sang giỏ', async () => {
    stub({ '/orders/TUBU1/repurchase': { body: added('a', 3) } });
    const { onClose } = mount(ORDER);
    click(body().querySelectorAll<HTMLElement>('[aria-label="Tăng số lượng"]')[0]!);
    await flush();
    click(button('Thêm vào giỏ (3)'));
    await flush(8);
    const call = api.calls.find((c) => c.url.includes('/orders/TUBU1/repurchase'))!;
    expect(call.init?.method).toBe('POST');
    expect(JSON.parse(String(call.init?.body))).toEqual({ items: [{ orderItemId: 'a', quantity: 3 }], addSource: 'repurchase' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('mua lại MỘT sản phẩm dùng POST /cart/items kèm addSource=repurchase', async () => {
    mount(PURCHASED);
    await flush();
    click(button('Thêm vào giỏ (1)'));
    await flush(8);
    const call = api.calls.find((c) => c.url.includes('/cart/items'))!;
    expect(JSON.parse(String(call.init?.body))).toEqual({ variationId: 'v9', quantity: 1, addSource: 'repurchase' });
    expect(nav.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('thêm một phần: báo dòng nào không thêm được, không tự sang giỏ để khách còn đọc được', async () => {
    stub({
      '/orders/TUBU1/repurchase': { body: { ...CART, results: [{ orderItemId: 'a', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 }] } },
    });
    const { onClose, onNotice } = mount(ORDER);
    click(button('Thêm vào giỏ (2)'));
    await flush(8);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(nav.push).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith({ tone: 'warning', text: 'Đã thêm 1 món vào giỏ. Chưa thêm đủ: Nước rửa chén (chỉ thêm được 1)' });
  });

  it('không thêm được món nào (hết hàng): ở lại, không đóng, không sang giỏ trống', async () => {
    stub({
      '/orders/TUBU1/repurchase': { body: { ...CART, results: [{ orderItemId: 'a', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 }] } },
    });
    const { onClose } = mount(ORDER);
    click(button('Thêm vào giỏ (2)'));
    await flush(8);
    expect(onClose).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
    expect(body().querySelector('[role="alert"]')?.textContent).toBe('Chưa thêm được món nào vào giỏ: Nước rửa chén (hết hàng)');
  });

  it('lỗi mạng → KHÔNG đóng, giữ nguyên lựa chọn để bấm lại', async () => {
    stub({ '/orders/TUBU1/repurchase': { status: 500, body: { message: 'Máy chủ bận' } } });
    const { onClose } = mount(ORDER);
    click(button('Thêm vào giỏ (2)'));
    await flush(8);
    expect(onClose).not.toHaveBeenCalled();
    expect(body().querySelector('[role="alert"]')?.textContent).toContain('Máy chủ bận');
    expect(button('Thêm vào giỏ (2)').disabled).toBe(false);
    expect(checkbox('Chọn Nước rửa chén').checked).toBe(true);
  });

  it('chạm đúp CTA → chỉ MỘT request', async () => {
    mount(ORDER);
    await flush();
    const cta = button('Thêm vào giỏ (2)');
    click(cta);
    click(cta);
    click(cta);
    await flush(8);
    expect(api.calls.filter((c) => c.url.includes('/repurchase'))).toHaveLength(1);
  });

  it('target=null → không hiện gì', async () => {
    mount(null);
    await flush();
    expect(body().querySelector('[role="dialog"]')).toBeNull();
  });

  it('KHUNG HÌNH ĐẦU đã có dòng được chọn và CTA đúng số lượng (không nháy "(0)")', () => {
    mount(ORDER);
    expect(button('Thêm vào giỏ (2)')).toBeTruthy();
    expect(body().textContent).not.toContain('Thêm vào giỏ (0)');
  });

  it('đổi target khi đang mở: lựa chọn của target mới có ngay, không lấy của target cũ', async () => {
    function Host() {
      const [t, setT] = useState<ReorderTarget | null>(ORDER);
      return (
        <>
          <button type="button" data-testid="swap" onClick={() => setT(PURCHASED)}>swap</button>
          <ReorderSheet target={t} source="order_card" onClose={() => setT(null)} />
        </>
      );
    }
    const r = render(<Host />);
    mounted.push(r);
    await flush();
    click(r.container.querySelector('[data-testid="swap"]'));
    await flush();
    expect(button('Thêm vào giỏ (1)')).toBeTruthy();
    expect(body().textContent).toContain('Dầu gội');
    expect(body().textContent).not.toContain('Nước rửa chén');
  });

  it('mọi nút và ô chọn có tên', async () => {
    mount(ORDER);
    await flush();
    expect(unnamedControls(body())).toEqual([]);
    await act(async () => undefined);
  });
});
