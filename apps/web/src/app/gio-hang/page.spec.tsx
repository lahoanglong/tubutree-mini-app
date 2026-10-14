// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, flush, render, type Rendered } from '@/test-utils/dom';
import { recallCheckoutSelection } from '@/lib/checkout-selection';

// BUYERWEB-10: bấm "+" trên dòng hết hàng làm dòng bị xoá (quantity kẹp về 0) mà không báo gì.
// BUYERWEB-11: tên sản phẩm dài không khoảng trắng làm giỏ tràn ngang ở 390px.

const state = vi.hoisted(() => ({
  cart: null as unknown,
  updates: [] as { id: string; q: number }[],
  removed: [] as string[],
}));
vi.mock('@/lib/auth-context', () => ({ useAuth: () => ({ user: { id: 'u' }, status: 'authenticated', initialized: true }) }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getCart: async () => state.cart,
  getMyCoupons: async () => [],
  updateCartItem: async (id: string, q: number) => {
    state.updates.push({ id, q });
    return state.cart;
  },
  removeCartItem: async (id: string) => {
    state.removed.push(id);
    return state.cart;
  },
}));

import CartPage from './page';

const line = (over: Record<string, unknown>) => ({
  id: 'i1', variationId: 'v1', productName: 'Dầu gội bồ kết', variationName: '500ml', slug: 'dau-goi', thumbnail: null,
  unitPrice: 150000, quantity: 2, stock: 5, total: 300000, ...over,
});
const cartOf = (items: unknown[]) => ({
  items, couponCode: null, subtotal: 300000, discount: 0, freeship: false, freeshipThreshold: 500000, itemCount: 2,
});

let mounted: Rendered[] = [];
const mount = async () => {
  const r = render(<CartPage />);
  mounted.push(r);
  await flush(6);
  return r;
};
const button = (c: HTMLElement, label: string) => c.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

beforeEach(() => {
  sessionStorage.clear();
  state.updates = [];
  state.removed = [];
  state.cart = cartOf([line({})]);
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('/gio-hang — dòng hết hàng / chạm trần tồn kho (BUYERWEB-10)', () => {
  it('dòng hết hàng: không có nút +/− (không thể làm mất dòng), có nhãn Hết hàng và nút Xóa rõ ràng', async () => {
    state.cart = cartOf([line({ stock: 0 })]);
    const { container } = await mount();
    expect(container.textContent).toContain('Hết hàng');
    expect(button(container, 'Tăng số lượng Dầu gội bồ kết')).toBeNull();
    expect(button(container, 'Giảm số lượng Dầu gội bồ kết')).toBeNull();
    click(button(container, 'Xóa Dầu gội bồ kết khỏi giỏ hàng'));
    await flush();
    expect(state.removed).toEqual(['i1']);
    expect(state.updates).toEqual([]);
  });

  it('chạm trần tồn kho: nút + bị khoá kèm chú thích "Chỉ còn N"; bấm không gửi lệnh nào', async () => {
    state.cart = cartOf([line({ stock: 2, quantity: 2 })]);
    const { container } = await mount();
    const plus = button(container, 'Tăng số lượng Dầu gội bồ kết')!;
    expect(plus.disabled).toBe(true);
    expect(container.textContent).toContain('Chỉ còn 2 sản phẩm');
    click(plus);
    await flush();
    expect(state.updates).toEqual([]);
  });

  it('còn dư tồn kho: + tăng đúng 1, không bao giờ gửi số lượng 0', async () => {
    const { container } = await mount();
    click(button(container, 'Tăng số lượng Dầu gội bồ kết'));
    await flush();
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }]);
  });

  it('tồn kho tụt dưới số đang có trong giỏ: − kéo số lượng về đúng mức còn lại thay vì chỉ trừ 1', async () => {
    state.cart = cartOf([line({ stock: 3, quantity: 5 })]);
    const { container } = await mount();
    click(button(container, 'Giảm số lượng Dầu gội bồ kết'));
    await flush();
    expect(state.updates).toEqual([{ id: 'i1', q: 3 }]);
  });

  it('có dòng hết hàng: nút Thanh toán bị khoá và giải thích phải xóa dòng đó', async () => {
    state.cart = cartOf([line({}), line({ id: 'i2', stock: 0, productName: 'Xà phòng' })]);
    const { container } = await mount();
    expect(container.querySelector('a[href="/thanh-toan"]')).toBeNull();
    const pay = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Thanh toán'))!;
    expect(pay.disabled).toBe(true);
    expect(container.textContent).toContain('hết hàng hoặc vượt số lượng còn lại');
  });

  it('giỏ hợp lệ: Thanh toán là liên kết sang /thanh-toan', async () => {
    const { container } = await mount();
    expect(container.querySelector('a[href="/thanh-toan"]')).not.toBeNull();
  });
});

describe('/gio-hang — tên dài không làm vỡ bố cục 390px (BUYERWEB-11)', () => {
  const LONG = 'A'.repeat(90);

  it('tên + phân loại dài được phép xuống dòng và co lại (min-w-0 + break-words), cột lưới không phình', async () => {
    state.cart = cartOf([line({ productName: LONG, variationName: 'B'.repeat(60) })]);
    const { container } = await mount();
    const name = Array.from(container.querySelectorAll('div')).find((d) => d.textContent === LONG)!;
    expect(name.className).toContain('break-words');
    expect(name.parentElement!.className).toContain('min-w-0');
    expect(container.querySelector('.grid')!.className).toContain('grid-cols-1');
    expect(container.querySelector('.grid > div')!.className).toContain('min-w-0');
  });

  it('danh sách "đã ngừng bán" cũng cho tên dài xuống dòng và giữ nút Xoá không bị đẩy ra ngoài', async () => {
    state.cart = {
      ...cartOf([line({})]),
      unavailableItems: [{ id: 'u1', productName: LONG, variationName: '', quantity: 1 }],
    };
    const { container } = await mount();
    const span = Array.from(container.querySelectorAll('li span')).find((s) => s.textContent?.includes(LONG))!;
    expect(span.className).toContain('min-w-0');
    expect(span.className).toContain('break-words');
    expect(container.querySelector('li button')!.className).toContain('shrink-0');
  });
});

describe('/gio-hang — chia theo nơi giao (D4)', () => {
  it('giỏ toàn hàng Tubu: không có tiêu đề nơi giao (giữ giao diện cũ)', async () => {
    state.cart = cartOf([line({ fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } })]);
    const { container } = await mount();
    expect(container.querySelector('section h2')).toBeNull();
    expect(container.textContent).not.toContain('nhiều nơi giao');
  });

  it('có hàng gian hàng tự giao: mỗi nơi giao một nhóm (Tubu trước), báo tách đơn, freeship chỉ cho phần Tubu', async () => {
    state.cart = cartOf([
      line({ id: 'm1', productName: 'Mật ong rừng', fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } }),
      line({ id: 't1', productName: 'Dầu gội bồ kết', fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } }),
    ]);
    const { container } = await mount();
    const sections = Array.from(container.querySelectorAll('section'));
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['Tubu Tree giao', 'Mật ong Linh giao']);
    expect(sections[0]!.textContent).toContain('Dầu gội bồ kết');
    expect(sections[1]!.textContent).toContain('Mật ong rừng');
    expect(container.textContent).toContain('mỗi nơi giao thành một đơn riêng');
    expect(container.textContent).toContain('miễn phí vận chuyển phần hàng Tubu Tree giao');
  });

  it('ngưỡng miễn phí vận chuyển tính trên phần hàng Tubu Tree giao, không cộng hàng gian hàng tự giao', async () => {
    state.cart = {
      ...cartOf([
        line({ id: 'm1', productName: 'Mật ong rừng', fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } }),
        line({ id: 't1', fulfiller: { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' } }),
      ]),
      subtotal: 600000,
    };
    const { container } = await mount();
    expect(container.textContent).toMatch(/Mua thêm\s*200\.000/);
  });

  it('chỉ có hàng gian hàng tự giao: không hiện lời mời mua thêm để được miễn phí vận chuyển', async () => {
    state.cart = cartOf([line({ id: 'm1', fulfiller: { kind: 'MERCHANT', storefrontId: 'sf1', name: 'Mật ong Linh' } })]);
    const { container } = await mount();
    expect(container.textContent).not.toContain('Mua thêm');
  });
});

describe('/gio-hang — chọn món để thanh toán một phần giỏ (R2-BUYERWEB-6)', () => {
  const two = () => ({
    ...cartOf([
      line({ id: 'i1', productName: 'Dầu gội', quantity: 1, total: 150000 }),
      line({ id: 'i2', productName: 'Xà phòng', quantity: 2, unitPrice: 50000, total: 100000 }),
    ]),
    subtotal: 250000,
    itemCount: 3,
  });
  const pick = (c: HTMLElement, name: string) => c.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="Chọn ${name} để thanh toán"]`)!;
  const selectAll = (c: HTMLElement) => c.querySelector<HTMLInputElement>('input[type="checkbox"][aria-label="Chọn tất cả sản phẩm"]')!;
  const pay = (c: HTMLElement) => c.querySelector<HTMLAnchorElement>('a[href="/thanh-toan"]');

  it('mặc định chọn hết; Thanh toán đếm tổng số lượng và nhớ "toàn giỏ"', async () => {
    state.cart = two();
    const { container } = await mount();
    expect(pick(container, 'Dầu gội').checked).toBe(true);
    expect(pick(container, 'Xà phòng').checked).toBe(true);
    expect(selectAll(container).checked).toBe(true);
    expect(pay(container)!.textContent).toBe('Thanh toán (3)');
    click(pay(container));
    expect(recallCheckoutSelection()).toBeNull();
  });

  it('bỏ chọn một món: tạm tính và số lượng theo phần đã chọn, nhớ đúng các dòng đã chọn', async () => {
    state.cart = two();
    const { container } = await mount();
    click(pick(container, 'Dầu gội'));
    await flush(2);
    expect(selectAll(container).checked).toBe(false);
    expect(pay(container)!.textContent).toBe('Thanh toán (2)');
    expect(container.textContent).toMatch(/Tạm tính\s*100\.000đ/);
    click(pay(container));
    expect(recallCheckoutSelection()).toEqual(['i2']);
  });

  it('bỏ chọn hết: không thanh toán được; Chọn tất cả chọn lại hết', async () => {
    state.cart = two();
    const { container } = await mount();
    click(selectAll(container));
    await flush(2);
    expect(pay(container)).toBeNull();
    const payBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith('Thanh toán'))!;
    expect(payBtn.disabled).toBe(true);
    click(selectAll(container));
    await flush(2);
    expect(pay(container)).not.toBeNull();
  });

  it('chỉ giảm giá khi chọn cả giỏ (phần chọn một phần do báo giá thanh toán tính lại)', async () => {
    state.cart = { ...two(), couponCode: 'WELCOME', discount: 25000 };
    const { container } = await mount();
    expect(container.textContent).toContain('-25.000đ');
    click(pick(container, 'Dầu gội'));
    await flush(2);
    expect(container.textContent).not.toContain('-25.000đ');
  });

  it('dòng hết hàng chỉ chặn khi đang được chọn: bỏ chọn nó thì thanh toán phần còn lại', async () => {
    state.cart = cartOf([line({ id: 'i1' }), line({ id: 'i2', stock: 0, productName: 'Xà phòng' })]);
    const { container } = await mount();
    expect(pay(container)).toBeNull();
    click(pick(container, 'Xà phòng'));
    await flush(2);
    expect(pay(container)).not.toBeNull();
    click(pay(container));
    expect(recallCheckoutSelection()).toEqual(['i1']);
  });

  it('món mới thêm vào giỏ tự được chọn, món đã xoá không còn nằm trong lựa chọn', async () => {
    state.cart = two();
    const { container } = await mount();
    click(pick(container, 'Dầu gội'));
    state.cart = { ...two(), items: [...two().items, line({ id: 'i3', productName: 'Mật ong', quantity: 1, total: 90000 })] };
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Tăng số lượng Xà phòng"]'));
    await flush(4);
    expect(pick(container, 'Mật ong').checked).toBe(true);
    expect(pick(container, 'Dầu gội').checked).toBe(false);
  });
});
