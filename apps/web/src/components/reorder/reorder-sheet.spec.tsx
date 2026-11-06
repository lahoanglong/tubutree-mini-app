// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { unnamedControls } from '@/test-utils/a11y';

// Chép ý nghĩa reorder-sheet.spec của Mini App: chọn dòng + số lượng, dòng hết hàng khoá, tổng tạm tính, lỗi giữ lựa chọn, chạm đúp một request.
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { ReorderSheet } from './reorder-sheet';
import { orderReorderTarget, type ReorderLine, type ReorderTarget } from './reorder-types';
import type { OrderItemView } from '@tubutree/app-core/api/orders';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, notices: [], ...over,
});
const ORDER: ReorderTarget = {
  kind: 'order',
  orderCode: 'TUBU1',
  lines: [line('a', 'Nước rửa chén'), line('b', 'Xà phòng', { available: false, maxQuantity: 0, notices: [{ kind: 'out', tone: 'danger', text: 'Tạm hết hàng' }] })],
};
const ITEM: ReorderTarget = { kind: 'item', line: line('a', 'Nước rửa chén', { defaultQuantity: 1 }) };
const ITEM_B: ReorderTarget = { kind: 'item', line: line('d', 'Dầu gội', { defaultQuantity: 1 }) };

let mounted: Rendered | null = null;
const mount = (props: { target: ReorderTarget | null; onClose?: () => void; navigateToCart?: boolean; source?: 'notification' }) => {
  mounted = render(<ReorderSheet target={props.target} source={props.source} onClose={props.onClose ?? (() => undefined)} navigateToCart={props.navigateToCart} />);
  return document.body;
};
const cta = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^Thêm vào giỏ \(\d+\)$/.test(b.textContent ?? ''))!;
const plus = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]')!;
const checkbox = (name: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Chọn ${name}"]`)!;

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] });
  mocks.push.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const item = (id: string, productName: string, over: Partial<OrderItemView> = {}): OrderItemView => ({
  id, variationId: `v-${id}`, productName, productSlug: id, variationName: '', unitPrice: 60000, quantity: 1, total: 60000, backorderedQty: 0,
  stock: 50, available: true, discontinued: false, currentPrice: 60000, ...over,
});
const noticesByRow = () =>
  Array.from(document.querySelectorAll('[data-testid="reorder-line"]')).map((row) => Array.from(row.querySelectorAll('[data-notice]')).map((n) => n.textContent));
const skippedNote = () => document.querySelector('[data-testid="reorder-skipped-note"]')?.textContent ?? null;

describe('ReorderSheet: câu báo từng món của đơn cũ', () => {
  it('hết hàng, ngừng bán, đã giảm số lượng, giá tăng: mỗi dòng nói rõ; đầu sheet nêu số món không thêm được', () => {
    mount({
      target: orderReorderTarget({
        code: 'TUBU2',
        items: [
          item('i1', 'Trà xanh', { stock: 0, available: false }),
          item('i2', 'Mật ong', { stock: 3, available: false, discontinued: true }),
          item('i3', 'Nước rửa chén', { quantity: 5, stock: 2, currentPrice: 65000 }),
          item('i4', 'Xà phòng', { currentPrice: 50000 }),
        ],
      }),
    });
    expect(skippedNote()).toBe('2 món hết hàng hoặc ngừng bán sẽ không được thêm vào giỏ.');
    expect(noticesByRow()).toEqual([
      ['Tạm hết hàng'],
      ['Ngừng bán'],
      ['Không đủ 5 như đơn trước, đã giảm số lượng', 'Giá tăng so với đơn trước (60.000đ)'],
      ['Giá giảm so với đơn trước (60.000đ)'],
    ]);
    expect(document.querySelector('[data-notice="priceUp"]')?.className).toContain('text-warning-fg');
    expect(document.querySelector('[data-notice="priceDown"]')?.className).toContain('text-success-fg');
    expect(document.querySelector('[data-notice="out"]')?.className).toContain('text-danger-fg');
    expect(cta().textContent).toBe('Thêm vào giỏ (3)');
  });

  it('cả đơn không còn món nào bán được: câu đầu sheet riêng, CTA (0) bị khoá', () => {
    mount({ target: orderReorderTarget({ code: 'TUBU3', items: [item('i1', 'Trà xanh', { stock: 0, available: false }), item('i2', 'Mật ong', { available: false, discontinued: true })] }) });
    expect(skippedNote()).toBe('Các món trong đơn này đều đã hết hàng hoặc ngừng bán.');
    expect(cta().textContent).toBe('Thêm vào giỏ (0)');
    expect(cta().disabled).toBe(true);
  });

  it('mọi món còn bán, giá như cũ: không có câu báo nào', () => {
    mount({ target: orderReorderTarget({ code: 'TUBU4', items: [item('i1', 'Trà xanh')] }) });
    expect(skippedNote()).toBeNull();
    expect(document.querySelector('[data-notice]')).toBeNull();
  });
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

  it('đổi target khi đang mở: lựa chọn của target mới có ngay, không lấy của target cũ', async () => {
    function Host() {
      const [t, setT] = useState<ReorderTarget | null>(ORDER);
      return (
        <>
          <button type="button" data-testid="swap" onClick={() => setT(ITEM_B)}>swap</button>
          <ReorderSheet target={t} onClose={() => setT(null)} />
        </>
      );
    }
    mounted = render(<Host />);
    await flush();
    click(mounted.container.querySelector('[data-testid="swap"]'));
    await flush();
    expect(cta().textContent).toBe('Thêm vào giỏ (1)');
    expect(document.body.textContent).toContain('Dầu gội');
    expect(document.body.textContent).not.toContain('Nước rửa chén');
  });

  it('mở từ thông báo nhắc (source=notification): thêm một sản phẩm gửi addSource reorder_notification', async () => {
    mount({ target: ITEM, source: 'notification' });
    await act(async () => {
      cta().click();
    });
    await flush(4);
    expect(mocks.post).toHaveBeenCalledWith('/cart/items', { variationId: 'v-a', quantity: 1, addSource: 'reorder_notification' }, undefined);
  });

  it('mọi điều khiển có tên truy cập', () => {
    mount({ target: ORDER });
    expect(unnamedControls(document.body)).toEqual([]);
  });
});

describe('ReorderSheet — truy cập (A11Y-06/08)', () => {
  it('nút số lượng của mỗi dòng mang tên sản phẩm nên không trùng tên', () => {
    mount({ target: { kind: 'order', orderCode: 'T', lines: [line('a', 'Nước rửa chén'), line('c', 'Dầu gội')] } });
    const names = Array.from(document.querySelectorAll('button[aria-label$="Nước rửa chén"], button[aria-label$="Dầu gội"]')).map((b) => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(4);
  });

  it('dòng hết hàng chỉ mờ ảnh, chữ không bị opacity (đủ tương phản)', () => {
    mount({ target: ORDER });
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="reorder-line"]');
    expect(rows[1]!.className).not.toContain('opacity');
    expect(rows[1]!.querySelector('.opacity-50')).not.toBeNull();
    expect(rows[1]!.querySelector('.opacity-50')!.textContent).toBe('');
  });
});
