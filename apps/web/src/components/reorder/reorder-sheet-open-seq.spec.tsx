// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';

// Wave 101B: sheet Mua lại đóng được lúc lệnh còn bay (không có dismissible). Lệnh xong muộn của lần mở trước không được đóng sheet vừa mở lại,
// hiện lời của lần mở trước vào sheet mới, hay đưa khách sang giỏ làm mất số lượng đang chỉnh.
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), getCart: vi.fn(), phase: 'guest' }));
vi.mock('@/lib/core-http', () => ({ coreHttp: { post: mocks.post } }));
vi.mock('@/lib/cart-key', () => ({ cartStorefrontSlug: () => null, useCartKey: () => ['cart', null] }));
vi.mock('@/lib/auth-phase', () => ({ useAuthPhase: () => mocks.phase }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/shop-client')>()), getCart: mocks.getCart }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

import { ReorderSheet } from './reorder-sheet';
import type { ReorderLine, ReorderTarget } from './reorder-types';

const CART = { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 199000, itemCount: 2 };
const line = (key: string, name: string, over: Partial<ReorderLine> = {}): ReorderLine => ({
  key, variationId: `v-${key}`, productName: name, variationName: 'Chanh', thumbnail: null, unitPrice: 50000,
  defaultQuantity: 2, maxQuantity: 5, available: true, notices: [], ...over,
});
const ORDER_A: ReorderTarget = { kind: 'order', orderCode: 'TUBU1', lines: [line('a', 'Nước rửa chén')] };
const ORDER_B: ReorderTarget = { kind: 'order', orderCode: 'TUBU2', lines: [line('d', 'Dầu gội')] };

const ADDED = { ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'added', addedQuantity: 2 }] };
const NOTHING = { ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'skipped', reason: 'OUT_OF_STOCK', addedQuantity: 0 }] };
const PARTIAL = { ...CART, cart: CART, results: [{ orderItemId: 'a', status: 'partial', reason: 'EXCEEDS_STOCK', addedQuantity: 1 }] };

let mounted: Rendered | null = null;
const onDone = vi.fn();

function Host({ navigateToCart = false }: { navigateToCart?: boolean }) {
  const [target, setTarget] = useState<ReorderTarget | null>(null);
  return (
    <>
      <button type="button" data-open="a" onClick={() => setTarget(ORDER_A)}>mở A</button>
      <button type="button" data-open="b" onClick={() => setTarget(ORDER_B)}>mở B</button>
      <ReorderSheet target={target} onClose={() => setTarget(null)} onDone={onDone} navigateToCart={navigateToCart} />
    </>
  );
}

const mount = (props: { navigateToCart?: boolean } = {}) => {
  mounted = render(<Host {...props} />);
};
const open = (which: 'a' | 'b') => click(document.querySelector(`[data-open="${which}"]`));
const dialog = () => document.querySelector('[role="dialog"]');
const cta = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => /^Thêm vào giỏ \(\d+\)$/.test(b.textContent ?? ''))!;
const closeByBackdrop = () => click(document.querySelector('[data-sheet-backdrop]'));
const plus = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Tăng số lượng"]')!;

const gate = () => {
  let release!: (v: unknown) => void;
  let fail!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    release = res;
    fail = rej;
  });
  mocks.post.mockImplementationOnce(() => p);
  return { release, fail };
};

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue(ADDED);
  mocks.push.mockReset();
  onDone.mockReset();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

/** Mở A, chạm thêm (lệnh treo), đóng sheet, mở lại `again` và chỉnh số lượng (chữ khách đang làm dở). */
async function sentThenReopened(again: 'a' | 'b', navigateToCart = false) {
  mount({ navigateToCart });
  const g = gate();
  open('a');
  click(cta());
  await flush();
  expect(mocks.post).toHaveBeenCalledTimes(1);
  closeByBackdrop();
  open(again);
  click(plus());
  return g;
}

const status = () => document.querySelector('[role="status"]');

describe('ReorderSheet: đóng rồi mở lại ĐƠN KHÁC lúc lệnh còn bay', () => {
  it('lệnh cũ thêm đủ xong muộn: sheet mới KHÔNG bị đóng, số lượng đang chỉnh còn, trang vẫn nhận kết quả, sheet mới có lời báo đã thêm của đơn trước', async () => {
    const g = await sentThenReopened('b');
    const before = cta().textContent;
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(dialog()).not.toBeNull();
    expect(cta().textContent).toBe(before);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toContain('Đã thêm 2 món từ lần mua lại trước vào giỏ.');
    expect(status()?.querySelector('a[href="/gio-hang"]')).not.toBeNull();
    expect(cta().disabled).toBe(false);
  });

  it('navigateToCart: lệnh cũ xong muộn không đưa khách sang giỏ khi sheet đang là đơn khác', async () => {
    const g = await sentThenReopened('b', true);
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(status()?.textContent).toContain('Đã thêm 2 món');
  });

  it('lệnh cũ chỉ thêm được một phần: lời báo số món đã vào giỏ hiện ở sheet mới, nút của sheet mới không bị khoá', async () => {
    const g = await sentThenReopened('b');
    await act(async () => g.release(PARTIAL));
    await flush(6);
    expect(status()?.textContent).toContain('Đã thêm 1 món từ lần mua lại trước vào giỏ.');
    expect(status()?.textContent).not.toContain('Chưa thêm đủ');
    expect(cta().disabled).toBe(false);
    expect(dialog()).not.toBeNull();
  });

  it('lệnh cũ không thêm được món nào: sheet mới không hiện lời nào', async () => {
    const g = await sentThenReopened('b');
    await act(async () => g.release(NOTHING));
    await flush(6);
    expect(status()).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(cta().disabled).toBe(false);
  });

  it('lệnh cũ lỗi mạng: lời lỗi của lần mở trước không hiện ở sheet mới', async () => {
    const g = await sentThenReopened('b');
    await act(async () => g.fail(new Error('Mất kết nối')));
    await flush(6);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(dialog()).not.toBeNull();
  });
});

// Cùng đơn mở lại: khách đang nhìn đúng đơn đó và sheet không có chữ gõ dở, nên lệnh muộn xử lý như khi chưa đóng. Không báo gì thì nút bật lại
// và chạm lần hai gửi lệnh thứ hai, cộng đôi mọi dòng vào giỏ.
describe('ReorderSheet: đóng rồi mở lại CÙNG ĐƠN lúc lệnh còn bay', () => {
  it('lệnh cũ thêm đủ xong muộn: sheet đóng, trang nhận kết quả, không còn nút để chạm gửi lần hai', async () => {
    const g = await sentThenReopened('a');
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(dialog()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('navigateToCart: lệnh cũ xong muộn đưa khách sang giỏ, không có lệnh thứ hai', async () => {
    const g = await sentThenReopened('a', true);
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('lệnh cũ chỉ thêm được một phần: lời "chưa thêm đủ" hiện, nút khoá nên chạm lại không cộng đôi', async () => {
    const g = await sentThenReopened('a');
    await act(async () => g.release(PARTIAL));
    await flush(6);
    expect(status()?.textContent).toContain('Chưa thêm đủ');
    expect(cta().disabled).toBe(true);
    click(cta());
    await flush(2);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it('lệnh cũ lỗi mạng: lời lỗi hiện trong sheet để khách bấm lại', async () => {
    const g = await sentThenReopened('a');
    await act(async () => g.fail(new Error('Mất kết nối')));
    await flush(6);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    expect(dialog()).not.toBeNull();
  });
});

describe('ReorderSheet: đổi thẳng sang đơn khác, không có lần đóng chen giữa', () => {
  it('lệnh của đơn cũ xong muộn không đóng sheet của đơn mới', async () => {
    mount();
    const g = gate();
    open('a');
    click(cta());
    await flush();
    open('b');
    expect(dialog()?.textContent).toContain('Từ đơn TUBU2');
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(dialog()).not.toBeNull();
    expect(dialog()?.textContent).toContain('Từ đơn TUBU2');
  });
});

describe('ReorderSheet: lần mở không bị đóng đi mở lại vẫn chạy như trước', () => {
  it('thêm đủ ở đúng lần mở đã gửi: đóng sheet, báo trang, sang giỏ', async () => {
    mount({ navigateToCart: true });
    const g = gate();
    open('a');
    click(cta());
    await flush();
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(dialog()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('khách đóng sheet lúc lệnh bay và không mở lại: lệnh xong thì trang vẫn nhận kết quả và sang giỏ như cũ', async () => {
    mount({ navigateToCart: true });
    const g = gate();
    open('a');
    click(cta());
    await flush();
    closeByBackdrop();
    await act(async () => g.release(ADDED));
    await flush(6);
    expect(dialog()).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith('/gio-hang');
  });

  it('thêm một phần ở đúng lần mở đã gửi: lời hiện, nút khoá chống cộng thêm lần nữa', async () => {
    mount();
    const g = gate();
    open('a');
    click(cta());
    await flush();
    await act(async () => g.release(PARTIAL));
    await flush(6);
    expect(document.querySelector('[role="status"]')).not.toBeNull();
    expect(cta().disabled).toBe(true);
  });

  it('lỗi mạng ở đúng lần mở đã gửi: lời lỗi hiện, sheet giữ nguyên để bấm lại', async () => {
    mount();
    const g = gate();
    open('a');
    click(cta());
    await flush();
    await act(async () => g.fail(new Error('Mất kết nối')));
    await flush(6);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Mất kết nối');
    expect(dialog()).not.toBeNull();
  });
});
