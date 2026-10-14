// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-7: gợi ý voucher chỉ hiện mã trần, không có giá trị giảm, đơn tối thiểu hay hạn dùng.

const state = vi.hoisted(() => ({ coupons: [] as unknown[], applied: [] as string[] }));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMyCoupons: async () => state.coupons,
  applyCoupon: async (code: string) => {
    state.applied.push(code);
    return { items: [], couponCode: code, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 };
  },
}));

import { CouponBox } from './coupon-box';

const c = (code: string, over: Record<string, unknown> = {}) => ({
  code, type: 'PERCENT', value: 30, minOrder: null, maxDiscount: 50000, endAt: '2030-01-01T00:00:00Z', ...over,
});

let mounted: Rendered[] = [];
const mount = async (subtotal = 300000) => {
  const r = render(<CouponBox currentCode={null} subtotal={subtotal} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const card = (box: HTMLElement, code: string) => box.querySelector<HTMLButtonElement>(`button[aria-label="Dùng mã ${code}"]`)!.closest('li')!;

beforeEach(() => {
  state.applied = [];
  state.coupons = [];
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
});

describe('CouponBox — thẻ voucher (R2-BUYERWEB-7)', () => {
  it('mỗi voucher hiện giá trị giảm, mức tối đa, đơn tối thiểu và hạn dùng', async () => {
    state.coupons = [c('WELCOME30', { minOrder: 200000 })];
    const box = await mount();
    const t = card(box, 'WELCOME30').textContent!;
    expect(t).toContain('WELCOME30');
    expect(t).toContain('Giảm 30% (tối đa 50.000đ)');
    expect(t).toContain('Đơn tối thiểu 200.000đ');
    expect(t).toContain('HSD 01/01/2030');
  });

  it('freeship và giảm tiền cố định có nhãn riêng; mã không hạn dùng nói không thời hạn', async () => {
    state.coupons = [
      c('SHIP0', { type: 'FREESHIP', value: 0, maxDiscount: null }),
      c('TIEN20', { type: 'AMOUNT', value: 20000, maxDiscount: null, endAt: null }),
    ];
    const box = await mount();
    expect(card(box, 'SHIP0').textContent).toContain('Miễn phí vận chuyển');
    expect(card(box, 'TIEN20').textContent).toContain('Giảm 20.000đ');
    expect(card(box, 'TIEN20').textContent).toContain('Không thời hạn');
  });

  it('chưa đủ điều kiện: nói thẳng còn thiếu và khoá nút, ngay trên điện thoại (không chỉ ở tooltip)', async () => {
    state.coupons = [c('BIG', { minOrder: 500000 })];
    const box = await mount(300000);
    const t = card(box, 'BIG');
    expect(t.textContent).toContain('Cần đơn tối thiểu 500.000đ — mua thêm 200.000đ để dùng mã này');
    const btn = t.querySelector('button')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Chưa đủ');
  });

  it('mã dùng được xếp trước mã chưa đủ điều kiện; bấm Dùng mã áp đúng mã', async () => {
    state.coupons = [c('BIG', { minOrder: 500000 }), c('OK')];
    const box = await mount(300000);
    const codes = [...box.querySelectorAll('li')].map((li) => li.querySelector('button')!.getAttribute('aria-label'));
    expect(codes).toEqual(['Dùng mã OK', 'Dùng mã BIG']);
    click(card(box, 'OK').querySelector('button'));
    await flush(4);
    expect(state.applied).toEqual(['OK']);
  });

  it('nhiều hơn 3 mã: mặc định hiện 3 và có nút xem thêm', async () => {
    state.coupons = ['A', 'B', 'C', 'D', 'E'].map((x) => c(x));
    const box = await mount();
    expect(box.querySelectorAll('li')).toHaveLength(3);
    click(byText(box, 'button', 'Xem thêm 2 mã'));
    await flush(2);
    expect(box.querySelectorAll('li')).toHaveLength(5);
  });

  it('có tên truy cập và vùng chạm 44px', async () => {
    state.coupons = [c('A', { minOrder: 999999 }), c('B')];
    const box = await mount();
    expect(unnamedControls(box)).toEqual([]);
    expect(smallTouchTargets(box)).toEqual([]);
  });
});
