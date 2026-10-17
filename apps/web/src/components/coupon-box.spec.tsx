// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-7: gợi ý voucher chỉ hiện mã trần, không có giá trị giảm, đơn tối thiểu hay hạn dùng.

const state = vi.hoisted(() => ({
  coupons: [] as unknown[],
  applied: [] as string[],
  previews: vi.fn<(p: unknown) => Promise<unknown[]>>(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMyCoupons: async () => state.coupons,
  getCouponPreviews: (p: unknown) => state.previews(p),
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
const mount = async (subtotal = 300000, shippingFee: number | null = null) => {
  const r = render(<CouponBox currentCode={null} subtotal={subtotal} shippingFee={shippingFee} />);
  mounted.push(r);
  await flush(6);
  return r.container;
};
const card = (box: HTMLElement, code: string) => box.querySelector<HTMLButtonElement>(`button[aria-label$="mã ${code}"]`)!.closest('li')!;

beforeEach(() => {
  state.applied = [];
  state.coupons = [];
  state.previews.mockReset();
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

  it('mã tự cấp hiện tên thân thiện, không lộ mã thô kèm id khách; bấm vẫn áp đúng mã (R6-BUYER-3)', async () => {
    const raw = 'MILESTONE1000000-2026-10-CMV9MLSLB009KFKRUMVZQLRA7';
    state.coupons = [c(raw, { type: 'AMOUNT', value: 30000, maxDiscount: null })];
    const box = await mount();
    const li = card(box, 'Quà mốc chi tiêu 1 triệu');
    expect(li.textContent).toContain('Quà mốc chi tiêu 1 triệu');
    expect(li.textContent).not.toContain('CMV9MLSLB009');
    click(li.querySelector('button'));
    await flush();
    expect(state.applied).toEqual([raw]);
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

  it('R6-BUYER-12: không tự tính "Giảm X cho đơn này" (API tính trên hàng không flash, sau combo, theo phạm vi sản phẩm của mã)', async () => {
    state.coupons = [
      c('XANH10', { value: 10, maxDiscount: 50000 }),
      c('GBUY', { type: 'AMOUNT', value: 17250, maxDiscount: null, products: [{ id: 'p1', name: 'Hạt chia' }] }),
    ];
    const box = await mount(438000);
    expect(card(box, 'XANH10').textContent).toContain('Giảm 10% (tối đa 50.000đ)');
    expect(box.textContent).not.toContain('cho đơn này');
  });

  it('R6-BUYER-12: freeship khi phí ship đã 0 thì mờ và khoá; còn phí thì vẫn dùng được', async () => {
    state.coupons = [c('SHIP', { type: 'FREESHIP', value: 0, maxDiscount: null })];
    const free = card(await mount(438000, 0), 'SHIP');
    expect(free.querySelector('button')!.disabled).toBe(true);
    expect(free.querySelector('button')!.textContent).toBe('Không cần');
    expect(free.querySelector('button')!.getAttribute('aria-label')).toBe('Không cần dùng mã SHIP');
    expect(free.textContent).toContain('Đơn này đã miễn phí vận chuyển');
    expect(free.textContent).not.toContain('cho đơn này');
    expect(free.className).toContain('opacity-60');

    const paid = card(await mount(438000, 30000), 'SHIP');
    expect(paid.querySelector('button')!.disabled).toBe(false);
    expect(paid.textContent).not.toContain('cho đơn này');
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

describe('CouponBox — mức giảm thật của từng mã từ máy chủ (/checkout/coupon-previews)', () => {
  const mountWith = async (preview: { addressId?: string; itemIds?: string[] } | undefined, shippingFee: number | null = null) => {
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={shippingFee} preview={preview} />);
    mounted.push(r);
    await flush(8);
    return r.container;
  };

  it('có số: "Giảm X cho đơn này" (giữ "tối đa" của mã), freeship ghi phí ship miễn được, gửi đúng tham số', async () => {
    state.coupons = [c('GIAM30'), c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([
      { code: 'GIAM30', eligible: true, discount: 43800 },
      { code: 'FS', eligible: true, discount: 0, freeshipSaving: 19000 },
    ]);
    const box = await mountWith({ addressId: 'a1', itemIds: ['l1'] }, 19000);
    expect(state.previews).toHaveBeenCalledWith({ addressId: 'a1', itemIds: ['l1'] });
    const giam = card(box, 'GIAM30').textContent!;
    expect(giam).toContain('Giảm 30% (tối đa 50.000đ)');
    expect(giam).toContain('Giảm 43.800đ cho đơn này');
    expect(card(box, 'FS').textContent).toContain('Miễn phí ship 19.000đ cho đơn này');
  });

  it('trang giỏ (không phí giao) hoặc freeship không miễn được gì: không ghi số tiền freeship', async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([{ code: 'FS', eligible: true, discount: 0 }]);
    const box = await mountWith({});
    expect(card(box, 'FS').textContent).not.toContain('cho đơn này');
    expect(card(box, 'FS').querySelector('button')!.disabled).toBe(false);
  });

  it('mã không dùng được: lý do của máy chủ, nút khoá, kể cả khi phép đoán phía máy nói đủ điều kiện', async () => {
    const reason = 'Mã này chỉ áp dụng khi mua đúng sản phẩm của chương trình. Giỏ hàng chưa có sản phẩm đó.';
    state.coupons = [c('MUACHUNG', { minOrder: 100000 })];
    state.previews.mockResolvedValue([{ code: 'MUACHUNG', eligible: false, reason, discount: 0 }]);
    const box = await mountWith({ addressId: 'a1' });
    const li = card(box, 'MUACHUNG');
    expect(li.textContent).toContain(reason);
    const btn = li.querySelector('button')!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('Không áp dụng');
    click(btn);
    expect(state.applied).toEqual([]);
  });

  it('API cũ / lỗi: giữ cách hiện cũ (không có số, phép đoán phía máy vẫn chạy)', async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockRejectedValue(new Error('404'));
    const box = await mountWith({ addressId: 'a1' }, 0);
    expect(state.previews).toHaveBeenCalled();
    expect(card(box, 'FS').textContent).toContain('Đơn này đã miễn phí vận chuyển');
    expect(card(box, 'FS').textContent).not.toContain('cho đơn này');
  });

  it('đang tải số: thẻ hiện như cũ; không truyền tham số thì không gọi API', async () => {
    state.coupons = [c('GIAM30')];
    state.previews.mockReturnValue(new Promise(() => {}));
    const box = await mountWith({ addressId: 'a1' });
    expect(card(box, 'GIAM30').textContent).toContain('Giảm 30% (tối đa 50.000đ)');
    expect(card(box, 'GIAM30').textContent).not.toContain('cho đơn này');
    state.previews.mockClear();
    await mountWith(undefined);
    expect(state.previews).not.toHaveBeenCalled();
  });

  it('ví không có mã nào: không gọi API xem trước dù có tham số giỏ', async () => {
    state.coupons = [];
    await mountWith({ addressId: 'a1', itemIds: ['l1'] });
    expect(state.previews).not.toHaveBeenCalled();
  });
});
