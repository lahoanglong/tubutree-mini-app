// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

// Chép ý nghĩa reorder-sheet.spec của Mini App: chọn dòng + số lượng, dòng hết hàng khoá, tổng tạm tính, lỗi giữ lựa chọn, chạm đúp một request.
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { ReorderSheet } from './reorder-sheet';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 200000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, ...over,
});
const ORDER: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU1',
  lines: [line('a', 'Nước rửa chén'), line('b', 'Xà phòng', { available: false, maxQuantity: 0 })],
};
const ITEM: ReorderTarget = { kind: 'item', line: line('a', 'Nước rửa chén', { defaultQuantity: 1 }) };

let mounted: Rendered | null = null;
const mount = (props: { target: ReorderTarget | null; onClose?: () => void; navigateToCart?: boolean }) => {
  mounted = render(<ReorderSheet target={props.target} onClose={props.onClose ?? (() => undefined)} navigateToCart={props.navigateToCart} />);
  return document.body;
};
const cta = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^Thêm vào giỏ \(\d+\)$/.test(b.textContent ?? ''))!;
const plus = () => document.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng"]')!;
const checkbox = (name: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Chọn ${name}"]`)!;

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('ReorderSheet', () => {
  it('target=null → không hiện gì', () => {
    mount({ target: null });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('khung hình đầu đã có dòng được chọn và CTA đúng số lượng; dòng hết hàng mờ, khoá, không tính vào CTA; tạm tính theo dòng chọn', () => {
    mount({ target: ORDER });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Từ đơn TUBU1');
    expect(cta().textContent).toBe('Thêm vào giỏ (2)');
    expect(checkbox('Nước rửa chén').checked).toBe(true);
    expect(checkbox('Xà phòng').checked).toBe(false);
    expect(checkbox('Xà phòng').disabled).toBe(true);
    expect(document.body.textContent).toContain('Tạm hết hàng');
    expect(document.querySelector('[data-sheet-footer]')?.textContent).toContain('100.000đ');
    expect(document.querySelector('[data-sheet-footer]')?.textContent).toContain('Giá theo hiện tại, xem chính xác ở giỏ hàng.');
  });

  it('bỏ chọn hết → CTA "(0)" bị vô hiệu', () => {
    mount({ target: ORDER });
    click(checkbox('Nước rửa chén'));
    expect(cta().textContent).toBe('Thêm vào giỏ (0)');
    expect(cta().disabled).toBe(true);
  });

  it('+ số lượng cập nhật CTA; gửi đúng dòng khả dụng; thành công → đóng sheet và sang giỏ', async () => {
    const onClose = vi.fn();
    mount({ target: ORDER, onClose, navigateToCart: true });
    click(plus());
    expect(cta().textContent).toBe('Thêm vào giỏ (3)');
    click(cta());
    await flush(6);
    expect(mocks.post).toHaveBeenCalledWith('/orders/TUBU1/repurchase', { items: [{ orderItemId: 'a', quantity: 3 }], addSource: 'repurchase' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('lỗi mạng → KHÔNG đóng, giữ nguyên lựa chọn, báo lỗi để bấm lại', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Mất kết nối'));
    const onClose = vi.fn();
    mount({ target: ORDER, onClose });
    click(plus());
    click(cta());
    await flush(6);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    expect(cta().textContent).toBe('Thêm vào giỏ (3)');
    expect(checkbox('Nước rửa chén').checked).toBe(true);
  });

  it('có dòng không thêm được → ở lại, nêu lý do và có lối "Xem giỏ"; không thêm được món nào → báo, không đóng', async () => {
    mocks.post.mockResolvedValueOnce({
      ...CART,
      cart: CART,
      results: [{ orderItemId: 'a', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 }],
    });
    const onClose = vi.fn();
    mount({ target: ORDER, onClose, navigateToCart: true });
    click(cta());
    await flush(6);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    const status = document.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Chưa thêm đủ');
    expect(status.textContent).toContain('Nước rửa chén (chỉ thêm được 1)');
    expect(status.querySelector('a[href="/gio-hang"]')?.textContent).toBe('Xem giỏ');
  });

  it('đã thêm một phần rồi: CTA khoá, chạm lần hai không gửi lại (khỏi nhân đôi số lượng dòng đã thêm)', async () => {
    mocks.post.mockResolvedValueOnce({
      ...CART,
      cart: CART,
      results: [{ orderItemId: 'a', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 }],
    });
    mount({ target: ORDER });
    click(cta());
    await flush(6);
    expect(cta().disabled).toBe(true);
    click(cta());
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('không thêm được món nào (addedUnits = 0) → vẫn cho thử lại', async () => {
    mocks.post.mockResolvedValueOnce({
      ...CART,
      cart: CART,
      results: [{ orderItemId: 'a', status: 'out_of_stock', reason: 'OUT_OF_STOCK', addedQuantity: 0 }],
    });
    mount({ target: ORDER });
    click(cta());
    await flush(6);
    expect(cta().disabled).toBe(false);
  });

  it('chạm đúp CTA → chỉ MỘT request', async () => {
    let release: (v: unknown) => void = () => undefined;
    mocks.post.mockReturnValue(new Promise((r) => (release = r)));
    mount({ target: ITEM });
    act(() => {
      cta().click();
      cta().click();
    });
    await act(async () => {
      release({ ...CART });
    });
    await flush(4);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v-a', quantity: 1, addSource: 'repurchase' }, undefined);
  });

  it('mọi điều khiển có tên truy cập', () => {
    mount({ target: ORDER });
    expect(unnamedControls(document.body)).toEqual([]);
  });
});
