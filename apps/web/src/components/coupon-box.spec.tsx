// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { byText, click, flush, render, typeInto, type Rendered } from '@/test-utils/dom';
import { smallTouchTargets, unnamedControls } from '@/test-utils/a11y';

// R2-BUYERWEB-7: gợi ý voucher chỉ hiện mã trần, không có giá trị giảm, đơn tối thiểu hay hạn dùng.

const state = vi.hoisted(() => ({
  coupons: [] as unknown[],
  applied: [] as string[],
  applyError: null as Error | null,
  removeError: null as Error | null,
  applyGate: null as Promise<void> | null,
  applyCalls: 0,
  removeCalls: 0,
  removeGate: null as Promise<void> | null,
  couponsGate: null as Promise<void> | null,
  couponsError: null as Error | null,
  couponsCalls: 0,
  applyCart: {} as Record<string, unknown>,
  removed: 0,
  previews: vi.fn<(p: unknown) => Promise<unknown[]>>(),
}));
vi.mock('@/lib/shop-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shop-client')>()),
  getMyCoupons: async () => {
    state.couponsCalls += 1;
    await state.couponsGate;
    if (state.couponsError) throw state.couponsError;
    return state.coupons;
  },
  getCouponPreviews: (p: unknown) => state.previews(p),
  applyCoupon: async (code: string) => {
    state.applyCalls += 1;
    await state.applyGate;
    if (state.applyError) throw state.applyError;
    state.applied.push(code);
    return { items: [], couponCode: code, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0, ...state.applyCart };
  },
  removeCoupon: async () => {
    state.removeCalls += 1;
    await state.removeGate;
    if (state.removeError) throw state.removeError;
    state.removed += 1;
    return { items: [], couponCode: null, subtotal: 0, discount: 0, freeship: false, freeshipThreshold: 0, itemCount: 0 };
  },
}));

import { MutationObserver, QueryClient, useQuery } from '@tanstack/react-query';
import { cartKey } from '@/lib/cart-key';
import { ApiError, NetworkError } from '@/lib/client-api';
import { useCartWrite } from '@/lib/use-cart-write';
import { MD_DOWN } from '@/lib/use-media-query';
import { syncServerClock } from '@tubutree/app-core/server-clock';
import { COUPON_MUTATION_KEY, CouponBox, couponProductIds, forgetAutoCoupon } from './coupon-box';

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
  state.applyCalls = 0;
  state.removeCalls = 0;
  state.applyError = null;
  state.removeError = null;
  state.applyGate = null;
  state.removeGate = null;
  state.couponsGate = null;
  state.couponsError = null;
  state.couponsCalls = 0;
  state.applyCart = {};
  state.removed = 0;
  state.coupons = [];
  state.previews.mockReset();
});
afterEach(() => {
  mounted.forEach((m) => m.unmount());
  mounted = [];
  delete (window as { matchMedia?: unknown }).matchMedia;
});

/** Điện thoại (dưới md): jsdom không có matchMedia nên mặc định là máy tính; gọi trước khi dựng. */
const phone = () => {
  window.matchMedia = ((q: string) => ({
    matches: q === MD_DOWN,
    media: q,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

describe('CouponBox — thẻ voucher (R2-BUYERWEB-7)', () => {
  it('mỗi voucher hiện giá trị giảm, mức tối đa, đơn tối thiểu và hạn dùng', async () => {
    state.coupons = [c('WELCOME30', { minOrder: 200000 })];
    const box = await mount();
    const t = card(box, 'WELCOME30').textContent!;
    expect(t).toContain('WELCOME30');
    expect(t).toContain('Giảm 30%, tối đa 50k');
    expect(t).toContain('Đơn từ 200k');
    expect(t).toContain('Dùng đến 01/01/2030');
    expect(t).not.toContain('HSD');
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
    expect(card(box, 'SHIP0').textContent).toContain('Miễn phí giao hàng');
    expect(card(box, 'TIEN20').textContent).toContain('Giảm 20k');
    // Không hạn thì không có dòng hạn, không viết "Không thời hạn" hay "HSD".
    expect(card(box, 'TIEN20').textContent).not.toMatch(/Dùng đến|HSD|Không thời hạn/);
  });

  it('chưa đủ điều kiện: nói thẳng còn thiếu và khoá nút, ngay trên điện thoại (không chỉ ở tooltip)', async () => {
    state.coupons = [c('BIG', { minOrder: 500000 })];
    const box = await mount(300000);
    const t = card(box, 'BIG');
    expect(t.textContent).toContain('Mua thêm 200k để dùng');
    expect(t.textContent).not.toContain('Đơn tối thiểu');
    const btn = t.querySelector('button')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.textContent).toBe('Chưa đủ');
  });

  it('R6-BUYER-12: không tự tính "Giảm X cho đơn này" (API tính trên hàng không flash, sau combo, theo phạm vi sản phẩm của mã)', async () => {
    state.coupons = [
      c('XANH10', { value: 10, maxDiscount: 50000 }),
      c('GBUY', { type: 'AMOUNT', value: 17250, maxDiscount: null, products: [{ id: 'p1', name: 'Hạt chia' }] }),
    ];
    const box = await mount(438000);
    expect(card(box, 'XANH10').textContent).toContain('Giảm 10%, tối đa 50k');
    expect(box.textContent).not.toContain('cho đơn này');
  });

  it('R6-BUYER-12: freeship khi phí ship đã 0 thì khoá, ghi lý do, KHÔNG làm mờ cả thẻ; còn phí thì vẫn dùng được', async () => {
    state.coupons = [c('SHIP', { type: 'FREESHIP', value: 0, maxDiscount: null })];
    const free = card(await mount(438000, 0), 'SHIP');
    expect(free.querySelector('button')!.getAttribute('aria-disabled')).toBe('true');
    expect(free.querySelector('button')!.textContent).toBe('Không áp dụng');
    expect(free.querySelector('button')!.getAttribute('aria-label')).toBe('Không áp dụng mã SHIP');
    expect(free.textContent).toContain('Đơn này đã miễn phí giao hàng');
    expect(free.textContent).not.toContain('cho đơn này');
    expect(free.className).not.toContain('opacity');
    expect(free.querySelector('[class*="opacity"], [style*="opacity"]')).toBeNull();

    const paid = card(await mount(438000, 30000), 'SHIP');
    expect(paid.querySelector('button')!.getAttribute('aria-disabled')).toBeNull();
    expect(paid.textContent).not.toContain('cho đơn này');
  });

  it('mã dùng được xếp trước mã chưa đủ điều kiện; bấm Dùng mã áp đúng mã', async () => {
    state.coupons = [c('BIG', { minOrder: 500000 }), c('OK')];
    const box = await mount(300000);
    const codes = [...box.querySelectorAll('li')].map((li) => li.querySelector('button')!.getAttribute('aria-label'));
    expect(codes).toEqual(['Dùng mã OK', 'Chưa đủ điều kiện dùng mã BIG']);
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
    expect(giam).toContain('Giảm 30%, tối đa 50k');
    expect(giam).toContain('Giảm 43.800đ cho đơn này');
    expect(card(box, 'FS').textContent).toContain('Miễn phí giao hàng 19.000đ cho đơn này');
  });

  it('trang giỏ (không phí giao) hoặc freeship không miễn được gì: không ghi số tiền freeship', async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([{ code: 'FS', eligible: true, discount: 0 }]);
    const box = await mountWith({});
    expect(card(box, 'FS').textContent).not.toContain('cho đơn này');
    expect(card(box, 'FS').querySelector('button')!.getAttribute('aria-disabled')).toBeNull();
  });

  it('mã không dùng được: lý do của máy chủ, nút khoá, kể cả khi phép đoán phía máy nói đủ điều kiện', async () => {
    const reason = 'Mã này chỉ áp dụng khi mua đúng sản phẩm của chương trình. Giỏ hàng chưa có sản phẩm đó.';
    state.coupons = [c('MUACHUNG', { minOrder: 100000 })];
    state.previews.mockResolvedValue([{ code: 'MUACHUNG', eligible: false, reason, discount: 0 }]);
    const box = await mountWith({ addressId: 'a1' });
    const li = card(box, 'MUACHUNG');
    expect(li.textContent).toContain(reason);
    const btn = li.querySelector('button')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.textContent).toBe('Không áp dụng');
    click(btn);
    expect(state.applied).toEqual([]);
  });

  it('máy chủ chặn vì lý do khác dù giỏ dưới đơn tối thiểu: giữ lý do máy chủ, nhãn "Không áp dụng", không bảo mua thêm', async () => {
    const reason = 'Mã chỉ dành cho khách đặt đơn đầu tiên.';
    state.coupons = [c('WELCOME', { minOrder: 400000 })];
    state.previews.mockResolvedValue([{ code: 'WELCOME', eligible: false, reason, discount: 0 }]);
    const box = await mountWith({ addressId: 'a1' });
    const li = card(box, 'WELCOME');
    expect(li.textContent).toContain(reason);
    expect(li.textContent).not.toContain('Mua thêm');
    expect(li.querySelector('button')!.textContent).toBe('Không áp dụng');
  });

  it('API cũ / lỗi: giữ cách hiện cũ (không có số, phép đoán phía máy vẫn chạy)', async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockRejectedValue(new Error('404'));
    const box = await mountWith({ addressId: 'a1' }, 0);
    expect(state.previews).toHaveBeenCalled();
    expect(card(box, 'FS').textContent).toContain('Đơn này đã miễn phí giao hàng');
    expect(card(box, 'FS').textContent).not.toContain('cho đơn này');
  });

  it('đang tải số: thẻ hiện như cũ; không truyền tham số thì không gọi API', async () => {
    state.coupons = [c('GIAM30')];
    state.previews.mockReturnValue(new Promise(() => {}));
    const box = await mountWith({ addressId: 'a1' });
    expect(card(box, 'GIAM30').textContent).toContain('Giảm 30%, tối đa 50k');
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

  it('câu "Đơn tối thiểu … để dùng mã này." của máy chủ không lặp dòng điều kiện; đơn tối thiểu 0 không ghi "0đ"', async () => {
    state.coupons = [c('MIN199', { minOrder: 199000 }), c('ZERO', { minOrder: 0 })];
    state.previews.mockResolvedValue([
      { code: 'MIN199', eligible: false, discount: 0, reason: 'Đơn tối thiểu 199.000đ để dùng mã này.' },
      { code: 'ZERO', eligible: true, discount: 1000 },
    ]);
    const r = render(<CouponBox currentCode={null} subtotal={150000} preview={{ addressId: 'a1' }} />);
    mounted.push(r);
    await flush(8);
    // Có xem trước: chỉ câu của máy chủ, một lần (dòng điều kiện "Đơn từ 199k" bị bỏ), không tự đếm "Mua thêm".
    expect(card(r.container, 'MIN199').textContent).toContain('Đơn tối thiểu 199.000đ để dùng mã này.');
    expect(r.container.textContent?.match(/Đơn tối thiểu/g)).toHaveLength(1);
    expect(r.container.textContent).not.toMatch(/Đơn từ 199k|Mua thêm|(^|[^\d.])0đ/);
    expect(card(r.container, 'MIN199').querySelector('button')!.textContent).toBe('Chưa đủ');
  });

  it('giỏ có món Giờ vàng (subtotal gồm cả món đó): không ghi số "Mua thêm" thấp hơn thật, giữ câu đơn tối thiểu của máy chủ', async () => {
    state.coupons = [c('MIN400', { minOrder: 400000 })];
    state.previews.mockResolvedValue([{ code: 'MIN400', eligible: false, discount: 0, reason: 'Đơn tối thiểu 400.000đ để dùng mã này.' }]);
    const r = render(<CouponBox currentCode={null} subtotal={350000} preview={{ addressId: 'a1' }} />);
    mounted.push(r);
    await flush(8);
    expect(card(r.container, 'MIN400').textContent).toContain('Đơn tối thiểu 400.000đ để dùng mã này.');
    expect(r.container.textContent).not.toContain('Mua thêm');
  });
});

describe('CouponBox — dòng thu gọn nói khách đang có mã dùng được (chỉ gợi ý, không tự áp)', () => {
  const toggle = (box: HTMLElement) => box.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const mountWith = async (preview: { addressId?: string; itemIds?: string[] } | undefined, currentCode: string | null = null) => {
    const r = render(<CouponBox currentCode={currentCode} subtotal={300000} preview={preview} />);
    mounted.push(r);
    await flush(8);
    return r.container;
  };

  it('có mã dùng được → "Bạn có N mã dùng được · giảm đến X" thay câu mời, không áp mã nào', async () => {
    state.coupons = [c('GIAM30'), c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null }), c('BIG', { minOrder: 900000 })];
    state.previews.mockResolvedValue([
      { code: 'GIAM30', eligible: true, discount: 43800 },
      { code: 'FS', eligible: true, discount: 0, freeshipSaving: 19000 },
      { code: 'BIG', eligible: false, reason: 'Cần đơn tối thiểu', discount: 999000 },
    ]);
    const box = await mountWith({ addressId: 'a1' });
    expect(toggle(box).textContent).toContain('Bạn có 2 mã dùng được · giảm đến 43.800đ');
    expect(box.querySelector('[data-testid="coupon-placeholder"]')).toBeNull();
    expect(toggle(box).textContent).toContain('Chọn mã');
    expect(state.applied).toEqual([]);
  });

  it('không mã nào dùng được, đang tải hoặc lỗi → giữ câu cũ', async () => {
    state.coupons = [c('BIG', { minOrder: 900000 })];
    state.previews.mockResolvedValue([{ code: 'BIG', eligible: false, reason: 'x', discount: 9 }]);
    const invite = (el: HTMLElement) => el.querySelector('[data-testid="coupon-placeholder"]')?.textContent;
    expect(invite(toggle(await mountWith({ addressId: 'a1' })))).toBe('Chọn hoặc nhập mã');
    state.previews.mockRejectedValue(new Error('404'));
    expect(invite(toggle(await mountWith({ addressId: 'a1' })))).toBe('Chọn hoặc nhập mã');
    state.previews.mockReturnValue(new Promise(() => {}));
    const loading = toggle(await mountWith({ addressId: 'a1' }));
    expect(invite(loading)).toBe('Chọn hoặc nhập mã');
    expect(loading.textContent).not.toContain('mã dùng được');
  });

  it('giỏ đã có mã: không hỏi xem trước thừa khi dòng đang thu gọn', async () => {
    state.coupons = [c('GIAM30')];
    state.previews.mockResolvedValue([{ code: 'GIAM30', eligible: true, discount: 43800 }]);
    const box = await mountWith({ addressId: 'a1' }, 'XANH10');
    expect(state.previews).not.toHaveBeenCalled();
    expect(box.textContent).not.toContain('mã dùng được');
  });
});

// D7 việc 4: ô mã giảm giá gọn một dòng, mở rộng khi bấm (trước đây danh sách voucher chiếm cả màn hình điện thoại).
describe('CouponBox — gọn một dòng, mở khi bấm', () => {
  const toggle = (box: HTMLElement) => box.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const panel = (box: HTMLElement) => box.querySelector<HTMLElement>('#coupon-panel')!;

  it('mặc định thu gọn: chỉ một dòng "Mã giảm giá" có lời mời "Chọn mã" như Mini App (không đếm số mã), phần nhập và danh sách ẩn', async () => {
    state.coupons = [c('A1'), c('B2')];
    const box = await mount();
    expect(toggle(box).getAttribute('aria-expanded')).toBe('false');
    expect(toggle(box).getAttribute('aria-controls')).toBe('coupon-panel');
    expect(toggle(box).textContent).toContain('Mã giảm giá');
    expect(toggle(box).querySelector('[data-testid="coupon-placeholder"]')?.textContent).toBe('Chọn hoặc nhập mã');
    expect(toggle(box).textContent).toContain('Chọn mã');
    expect(panel(box).hidden).toBe(true);
  });

  it('bấm dòng thì mở ô nhập và danh sách; bấm lại thì thu gọn', async () => {
    state.coupons = [c('A1')];
    const box = await mount();
    click(toggle(box));
    expect(toggle(box).getAttribute('aria-expanded')).toBe('true');
    expect(panel(box).hidden).toBe(false);
    expect(box.querySelector('input[name="coupon-code"]')).not.toBeNull();
    click(toggle(box));
    expect(panel(box).hidden).toBe(true);
  });

  it('ví không có mã nào: vẫn mời "Chọn mã" như Mini App', async () => {
    const box = await mount();
    expect(toggle(box).textContent).toContain('Chọn mã');
  });

  it('áp mã lỗi thì mở lại ô nhập cùng lời báo, kể cả khi khách đã thu gọn dòng trong lúc chờ', async () => {
    state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    const box = await mount();
    click(toggle(box));
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
    click(byText(box, 'button', 'Áp dụng'));
    click(toggle(box));
    expect(panel(box).hidden).toBe(true);
    release();
    await flush();
    expect(toggle(box).getAttribute('aria-expanded')).toBe('true');
    expect(box.querySelector('[role="alert"]')!.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
  });

  it('sau khi báo mã lỗi, khách sửa ô nhập thì lời báo cũ biến mất (không treo lỗi của mã khác)', async () => {
    state.applyError = new Error('Mã giảm giá không tồn tại.');
    const box = await mount();
    click(toggle(box));
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
    click(byText(box, 'button', 'Áp dụng'));
    await flush();
    expect(box.querySelector('[role="alert"]')!.textContent).toBe('Mã giảm giá không tồn tại.');
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abcd');
    await flush();
    expect(box.querySelector('[role="alert"]')).toBeNull();
  });

  it('có lời báo lỗi khi bảng đang mở thì kéo lời báo vào tầm nhìn (lỗi từ hàng mã phía dưới không được khuất)', async () => {
    const scroll = vi.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      state.applyError = new Error('Mã giảm giá không tồn tại.');
      const box = await mount();
      click(toggle(box));
      typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
      click(byText(box, 'button', 'Áp dụng'));
      await flush();
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scroll.mock.instances[0]).toBe(box.querySelector('[role="alert"]'));
    } finally {
      Element.prototype.scrollIntoView = prev;
    }
  });

  // Cùng một câu lỗi lặp lại: chữ không đổi nên nếu lời báo giữ nguyên nút DOM thì trình đọc màn hình không đọc lại và bảng không cuộn lại tới lời báo.
  it('áp mã sai hai lần với cùng một câu lỗi: lời báo là nút DOM mới và được kéo vào tầm nhìn lần nữa', async () => {
    const scroll = vi.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      state.applyError = new Error('Mã giảm giá không tồn tại.');
      const box = await mount();
      click(toggle(box));
      typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
      click(byText(box, 'button', 'Áp dụng'));
      await flush();
      const first = box.querySelector('[role="alert"]')!;
      expect(first.textContent).toBe('Mã giảm giá không tồn tại.');
      expect(scroll).toHaveBeenCalledTimes(1);

      click(byText(box, 'button', 'Áp dụng'));
      await flush();
      const second = box.querySelector('[role="alert"]')!;
      expect(second.textContent).toBe('Mã giảm giá không tồn tại.');
      expect(second).not.toBe(first);
      expect(first.isConnected).toBe(false);
      expect(box.querySelectorAll('[role="alert"]')).toHaveLength(1);
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(scroll.mock.instances[1]).toBe(second);
    } finally {
      Element.prototype.scrollIntoView = prev;
    }
  });

  it('chọn mã ở danh sách bị lỗi hai lần liền: mỗi lần lời báo dựng lại và cuộn tới, lời báo cũ không còn trên trang', async () => {
    const scroll = vi.fn();
    const prev = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
      state.coupons = [c('A1')];
      const box = await mount();
      click(toggle(box));
      await flush(3);
      click(card(box, 'A1').querySelector('button[aria-label$="mã A1"]'));
      await flush();
      const first = box.querySelector('[role="alert"]')!;
      expect(first.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
      expect(scroll).toHaveBeenCalledTimes(1);

      click(card(box, 'A1').querySelector('button[aria-label$="mã A1"]'));
      await flush();
      const second = box.querySelector('[role="alert"]')!;
      expect(second).not.toBe(first);
      expect(first.isConnected).toBe(false);
      expect(scroll).toHaveBeenCalledTimes(2);
      expect(scroll.mock.instances[1]).toBe(second);
    } finally {
      Element.prototype.scrollIntoView = prev;
    }
  });

  it('panel tại chỗ (desktop): lời báo nằm trong khung ô nhập, không dưới cả danh sách mã (thẻ tóm tắt dính cắt phần đuôi)', async () => {
    state.applyError = new Error('Mã giảm giá không tồn tại.');
    state.coupons = [c('A1'), c('B2')];
    const box = await mount();
    click(toggle(box));
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
    click(byText(box, 'button', 'Áp dụng'));
    await flush();
    const alerts = box.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(box.querySelector('input[name="coupon-code"]')!.closest('div.rounded-card')!.contains(alerts[0]!)).toBe(true);
  });

  const press = (el: Element | null, key: string, init: KeyboardEventInit = {}) =>
    act(() => {
      el!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    });

  it('Enter ở ô nhập áp mã như nút "Áp dụng" (mã được chuẩn hoá chữ hoa)', async () => {
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    typeInto(input, 'abc');
    press(input, 'Enter');
    await flush(6);
    expect(state.applied).toEqual(['ABC']);
  });

  it('Enter khi ô trống hay chỉ có dấu cách, hoặc phím khác Enter: không áp mã', async () => {
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    press(input, 'Enter');
    typeInto(input, '   ');
    press(input, 'Enter');
    typeInto(input, 'abc');
    press(input, 'Tab');
    press(input, 'a');
    await flush(6);
    expect(state.applied).toEqual([]);
  });

  it('Enter lúc bộ gõ tiếng Việt đang chốt chữ (isComposing) không áp mã dở', async () => {
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    typeInto(input, 'giam');
    press(input, 'Enter', { isComposing: true });
    await flush(6);
    expect(state.applied).toEqual([]);
  });

  it('Enter chốt chữ của bộ gõ trên Safari (keyCode 229, isComposing không đặt) không áp mã dở', async () => {
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    typeInto(input, 'giam');
    press(input, 'Enter', { keyCode: 229 });
    await flush(6);
    expect(state.applied).toEqual([]);
  });

  it('giữ phím Enter (repeat) chỉ áp mã một lần, kể cả khi mã sai và ô vẫn còn chữ', async () => {
    state.applyError = new Error('Mã giảm giá không tồn tại.');
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    typeInto(input, 'abc');
    press(input, 'Enter');
    await flush(6);
    expect(box.querySelectorAll('[role="alert"]')).toHaveLength(1);
    state.applyError = null;
    press(input, 'Enter', { repeat: true });
    press(input, 'Enter', { repeat: true });
    await flush(6);
    expect(state.applied).toEqual([]);
  });

  it('Enter lúc đang áp mã (nút "Áp dụng" bận) không gửi lần hai', async () => {
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    const box = await mount();
    click(toggle(box));
    const input = box.querySelector('input[name="coupon-code"]');
    typeInto(input, 'abc');
    press(input, 'Enter');
    await flush(2);
    press(input, 'Enter');
    press(input, 'Enter');
    release();
    await flush(6);
    expect(state.applied).toEqual(['ABC']);
  });

  it('lời báo lỗi chỉ có một nút DOM: gập hay mở panel xoá nó, không dời sang chỗ khác nên không bị đọc lại', async () => {
    state.applyError = new Error('Mã giảm giá không tồn tại.');
    const box = await mount();
    click(toggle(box));
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
    click(byText(box, 'button', 'Áp dụng'));
    await flush();
    const first = box.querySelector('[role="alert"]');
    expect(first).not.toBeNull();
    click(toggle(box));
    await flush();
    expect(box.querySelectorAll('[role="alert"]')).toHaveLength(0);
    click(toggle(box));
    await flush();
    expect(box.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('đã áp mã: chỉ hiện thẻ mã đang dùng, chưa mở ô nhập khi khách chưa bấm', async () => {
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    expect(r.container.textContent).toContain('WELCOME30');
    expect(r.container.querySelector('#coupon-panel')).toBeNull();
  });

  it('máy tính (từ md), đã áp mã: thẻ mã có nút "Đổi mã" riêng, bấm mở đúng ô nhập và danh sách, bấm lại thu gọn (K2)', async () => {
    state.coupons = [c('A1')];
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    const btn = byText(r.container, 'button', 'Đổi mã')!;
    expect(btn.closest('div')!.className).toMatch(/\bmax-md:hidden\b/);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('coupon-panel');
    click(btn);
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    expect(panel.hidden).toBe(false);
    expect(panel.className).not.toMatch(/\bmd:hidden\b/);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(byText(panel, 'button', 'Bỏ mã đang áp dụng')).not.toBeNull();
    click(btn);
    await flush(2);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(r.container.querySelector('#coupon-panel')).toBeNull();
  });

  it('chưa áp mã: không có nút "Đổi mã" (đã có dòng "Chọn mã")', async () => {
    const box = await mount();
    expect(byText(box, 'button', 'Đổi mã')).toBeNull();
  });

  it('điện thoại, mã dài: chip xuống dòng trong chip (không truncate), khoảng cách icon và nút như Mini (gap-2, gap-0.5)', async () => {
    phone();
    const long = 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026';
    const r = render(<CouponBox currentCode={long} subtotal={100000} appliedDiscount={30000} />);
    mounted.push(r);
    await flush(4);
    const card = r.container.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]')!;
    const code = card.querySelector('[data-testid="coupon-code"]')!;
    expect(code.textContent).toBe(long);
    expect(code.className).not.toMatch(/\btruncate\b/);
    expect(code.className).toContain('[overflow-wrap:anywhere]');
    expect(card.querySelector('[data-testid="coupon-cta"]')!.className).toMatch(/\bgap-0\.5\b/);
    expect(card.firstElementChild!.className).toMatch(/\bgap-2\b/);
    expect(card.firstElementChild!.className).not.toMatch(/\bgap-2\.5\b/);
  });

  it('điện thoại, đã áp mã: thẻ như Mini App có chip mã, số đã giảm và chữ "Thay đổi"; bấm mở bảng chọn mã, có nút bỏ mã', async () => {
    phone();
    state.coupons = [c('A1')];
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} appliedDiscount={30000} />);
    mounted.push(r);
    await flush(4);
    const card = r.container.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]')!;
    expect(card.className).toMatch(/\bmd:hidden\b/);
    expect(card.textContent).toContain('WELCOME30');
    expect(card.textContent).toContain('-30.000đ');
    expect(card.textContent).toContain('Thay đổi');
    expect(card.textContent).not.toContain('Chọn mã');
    expect(card.getAttribute('aria-haspopup')).toBe('dialog');
    expect(document.querySelector('#coupon-panel')).toBeNull();
    click(card);
    await flush(3);
    const panel = dialog().querySelector<HTMLElement>('#coupon-panel')!;
    expect(panel).not.toBeNull();
    expect(r.container.querySelector('#coupon-panel')).toBeNull();
    expect(byText(panel, 'button', 'Bỏ mã đang áp dụng')).not.toBeNull();
  });

  it('máy tính, đã áp mã: không có bảng hay panel mở rộng, chỉ thẻ mã và nút bỏ mã (đổi mã thì bỏ rồi chọn lại)', async () => {
    state.coupons = [c('A1')];
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    expect(r.container.querySelector('#coupon-panel')).toBeNull();
    expect(r.container.querySelector('button[aria-label="Bỏ mã giảm giá WELCOME30"]')).not.toBeNull();
  });

  it('điện thoại, đã áp FREESHIP30 và phí ship 0: mở "Thay đổi" thì hỏi máy chủ, mã đang dùng ghi "Đang dùng" và "Bỏ chọn", mã freeship khác không bị "Không áp dụng"', async () => {
    phone();
    state.coupons = [c('FREESHIP30', { type: 'FREESHIP', value: 30000, maxDiscount: null }), c('FREESHIP15', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([
      { code: 'FREESHIP30', eligible: true, discount: 0 },
      { code: 'FREESHIP15', eligible: true, discount: 0 },
    ]);
    const r = render(<CouponBox currentCode="FREESHIP30" subtotal={300000} shippingFee={0} preview={{ addressId: 'a1' }} />);
    mounted.push(r);
    await flush(8);
    expect(state.previews).not.toHaveBeenCalled();
    click(r.container.querySelector('[data-testid="coupon-change"]'));
    await flush(8);
    expect(state.previews).toHaveBeenCalledWith({ addressId: 'a1' });
    expect(card(document.body, 'FREESHIP30').textContent).toContain('Đang dùng');
    expect(card(document.body, 'FREESHIP30').querySelector('button')!.getAttribute('aria-label')).toBe('Bỏ chọn mã FREESHIP30');
    expect(card(document.body, 'FREESHIP15').textContent).not.toContain('Không áp dụng');
  });

  it('chưa có số máy chủ: mã đang áp vẫn ghi "Đang dùng" và gỡ được, không bị khoá "Không áp dụng"', async () => {
    phone();
    state.coupons = [c('FREESHIP30', { type: 'FREESHIP', value: 30000, maxDiscount: null })];
    const r = render(<CouponBox currentCode="FREESHIP30" subtotal={300000} shippingFee={0} />);
    mounted.push(r);
    await flush(4);
    click(r.container.querySelector('[data-testid="coupon-change"]'));
    await flush(3);
    const t = card(document.body, 'FREESHIP30').textContent!;
    expect(t).toContain('Đang dùng');
    expect(t).not.toContain('Không áp dụng');
  });

  it('ô nhập có nhãn hiện "Nhập mã giảm giá khác" như Mini App và vùng chạm 44px', async () => {
    state.coupons = [c('A1')];
    const box = await mount();
    const field = box.querySelector<HTMLInputElement>('input[name="coupon-code"]')!;
    expect(box.querySelector(`label[for="${field.id}"]`)!.textContent).toBe('Nhập mã giảm giá khác');
    expect(field.placeholder).toBe('Nhập mã');
    expect(smallTouchTargets(box)).toEqual([]);
    expect(unnamedControls(box)).toEqual([]);
  });
});

describe('CouponBox — báo mã chưa áp dụng theo lý do máy chủ', () => {
  const REASON = 'Đơn này đã được miễn phí giao hàng.';
  const apply = async (code: string, cart: Record<string, unknown>, pv: Record<string, unknown>[]) => {
    state.coupons = [c(code, { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue(pv);
    state.applyCart = cart;
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={0} preview={{ addressId: 'a1' }} />);
    mounted.push(r);
    await flush(8);
    const box = r.container;
    click(box.querySelector<HTMLButtonElement>('button[aria-controls="coupon-panel"]')!);
    typeInto(box.querySelector('input[name="coupon-code"]'), code.toLowerCase());
    click(byText(box, 'button', 'Áp dụng'));
    await flush(6);
    return box;
  };
  const warn = (box: HTMLElement) => box.querySelector('[data-testid="coupon-apply-warning"]');

  it('xem trước eligible:false kèm reason và giỏ chưa giảm: báo mã chưa được áp dụng cùng lý do', async () => {
    const box = await apply('FS', { couponCode: 'FS', freeship: true }, [{ code: 'FS', eligible: false, reason: REASON, discount: 0 }]);
    expect(state.applied).toEqual(['FS']);
    expect(warn(box)!.textContent).toBe(`Mã chưa được áp dụng cho đơn này: ${REASON}`);
    expect(warn(box)!.closest('[role="status"]')).not.toBeNull();
  });

  it('xem trước eligible:true: không báo', async () => {
    const box = await apply('FS', { couponCode: 'FS' }, [{ code: 'FS', eligible: true, discount: 0, freeshipSaving: 19000 }]);
    expect(warn(box)).toBeNull();
  });

  it('giỏ đã giảm (discount > 0): không báo dù xem trước nói không', async () => {
    const box = await apply('FS', { couponCode: 'FS', discount: 20000 }, [{ code: 'FS', eligible: false, reason: REASON, discount: 0 }]);
    expect(warn(box)).toBeNull();
  });

  it('giỏ giữ mã kèm couponNotice, chưa giảm, không freeship: không báo thêm (chỉ couponNotice của giỏ)', async () => {
    const box = await apply('FS', { couponCode: 'FS', couponNotice: 'Mã chưa được áp dụng cho đơn này (phần giảm combo không được tính vào điều kiện của mã): Đơn tối thiểu 500.000đ' }, [
      { code: 'FS', eligible: false, reason: 'Đơn tối thiểu 500.000đ', discount: 0 },
    ]);
    expect(state.applied).toEqual(['FS']);
    expect(warn(box)).toBeNull();
  });

  it('prop notice trùng lời báo: chỉ một dòng trạng thái hiện', async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([{ code: 'FS', eligible: false, reason: REASON, discount: 0 }]);
    state.applyCart = { couponCode: 'FS', freeship: true };
    const text = `Mã chưa được áp dụng cho đơn này: ${REASON}`;
    phone();
    const r = render(<CouponBox currentCode="FS" subtotal={300000} shippingFee={0} preview={{ addressId: 'a1' }} notice={text} />);
    mounted.push(r);
    await flush(8);
    const box = r.container;
    click(box.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]')!);
    await flush(8);
    typeInto(dialog().querySelector('input[name="coupon-code"]'), 'fs');
    click(byText(dialog(), 'button', 'Áp dụng'));
    await flush(6);
    expect(state.applied).toEqual(['FS']);
    expect(box.querySelector('[data-testid="coupon-notice"]')!.textContent).toBe(text);
    expect(warn(box)).toBeNull();
  });

  describe('W28: lời báo mã đã bị gỡ vì giỏ rơi dưới đơn tối thiểu', () => {
    const REMOVED = { code: 'MIN300', text: 'Đã gỡ mã MIN300 vì giỏ chưa đủ đơn tối thiểu. Mua thêm 90.000đ để dùng lại.' };

    it('giỏ không còn mã: hiện lời báo trong vùng trạng thái, có nút Đóng đủ lớn và bấm được', async () => {
      phone();
      const onDismiss = vi.fn();
      const r = render(<CouponBox currentCode={null} subtotal={210000} removedNotice={REMOVED} onDismissRemoved={onDismiss} />);
      mounted.push(r);
      await flush(6);
      const note = r.container.querySelector('[data-testid="coupon-removed-notice"]')!;
      expect(note.textContent).toContain(REMOVED.text);
      expect(note.closest('[role="status"]')).not.toBeNull();
      const close = note.querySelector<HTMLButtonElement>('button')!;
      expect(close.getAttribute('aria-label')).toBe('Đóng lời báo mã MIN300 đã gỡ');
      expect(smallTouchTargets(r.container)).toEqual([]);
      expect(unnamedControls(r.container)).toEqual([]);
      click(close);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('giỏ đã có mã (áp lại hay mã khác): không hiện lời báo gỡ dù trang còn giữ chữ', async () => {
      phone();
      const r = render(<CouponBox currentCode="GIAM10" subtotal={310000} removedNotice={REMOVED} />);
      mounted.push(r);
      await flush(6);
      expect(r.container.querySelector('[data-testid="coupon-removed-notice"]')).toBeNull();
    });

    it('không có removedNotice: không dựng gì, vùng trạng thái vẫn có mặt', async () => {
      phone();
      const r = render(<CouponBox currentCode={null} subtotal={210000} />);
      mounted.push(r);
      await flush(6);
      expect(r.container.querySelector('[data-testid="coupon-removed-notice"]')).toBeNull();
      expect(r.container.querySelector('[role="status"]')).not.toBeNull();
    });

    it('không có onDismissRemoved: không có nút Đóng (trang nào không giữ trí nhớ thì lời báo là chữ thuần)', async () => {
      phone();
      const r = render(<CouponBox currentCode={null} subtotal={210000} removedNotice={REMOVED} />);
      mounted.push(r);
      await flush(6);
      expect(r.container.querySelector('[data-testid="coupon-removed-notice"] button')).toBeNull();
    });
  });

  it('lời báo tự tắt sau 5 giây', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const box = await apply('FS', { couponCode: 'FS', freeship: true }, [{ code: 'FS', eligible: false, reason: REASON, discount: 0 }]);
      expect(warn(box)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(5100);
      await flush(2);
      expect(warn(box)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CouponBox — vùng báo và đồng hồ lời báo (A11Y-02, A11Y-05)', () => {
  const warnBox = (box: HTMLElement) => box.querySelector<HTMLElement>('[data-testid="coupon-apply-warning"]');
  const REASON2 = 'Đơn tối thiểu 500.000đ';
  const setup = async () => {
    state.coupons = [c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null })];
    state.previews.mockResolvedValue([{ code: 'FS', eligible: false, reason: REASON2, discount: 0 }]);
    state.applyCart = { couponCode: 'FS', freeship: true };
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={0} preview={{ addressId: 'a1' }} />);
    mounted.push(r);
    await flush(8);
    return r.container;
  };
  const applyCode = async (box: HTMLElement) => {
    click(box.querySelector<HTMLButtonElement>('button[aria-controls="coupon-panel"]')!);
    typeInto(box.querySelector('input[name="coupon-code"]'), 'fs');
    click(byText(box, 'button', 'Áp dụng'));
    await flush(6);
  };

  it('A11Y-02: vùng role=status có sẵn trước khi có lời báo; lời báo đến thì chính nút DOM đó chứa chữ', async () => {
    const box = await setup();
    const region = box.querySelector('[role="status"]:not([aria-label])')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    await applyCode(box);
    expect(region.isConnected).toBe(true);
    expect(box.querySelector('[role="status"]:not([aria-label])')).toBe(region);
    expect(region.textContent).toContain(REASON2);
  });

  it('A11Y-05: lời báo không tắt khi trỏ đang ở trên nó, rời đi thì đếm lại đủ 5 giây', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const box = await setup();
      await applyCode(box);
      const note = warnBox(box)!;
      act(() => { note.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
      await vi.advanceTimersByTimeAsync(20_000);
      await flush(2);
      expect(warnBox(box)).not.toBeNull();
      act(() => { note.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })); });
      await vi.advanceTimersByTimeAsync(4_000);
      await flush(2);
      expect(warnBox(box)).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1_200);
      await flush(2);
      expect(warnBox(box)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CouponBox — tự áp mã giảm nhiều nhất ở thanh toán', () => {
  const PREVIEWS = [
    { code: 'GIAM30', eligible: true, discount: 43800 },
    { code: 'FS', eligible: true, discount: 0, freeshipSaving: 19000 },
    { code: 'BIG', eligible: false, reason: 'Cần đơn tối thiểu', discount: 999000 },
  ];
  /** Giỏ sống trong bộ nhớ đệm như ở trang thanh toán: áp/gỡ mã ghi vào đó và CouponBox đọc lại `currentCode`. */
  function Harness({ initial = null, autoApply = true, uid = 'u1' }: { initial?: string | null; autoApply?: boolean; uid?: string }) {
    const q = useQuery({ queryKey: cartKey(), queryFn: () => null, enabled: false, initialData: { couponCode: initial } as { couponCode: string | null } });
    return <CouponBox currentCode={q.data?.couponCode ?? null} subtotal={300000} preview={{ addressId: 'a1' }} autoApply={autoApply} memoryUserId={uid} />;
  }
  const mountHarness = async (props: { initial?: string | null; autoApply?: boolean; uid?: string } = {}) => {
    const r = render(<Harness {...props} />);
    mounted.push(r);
    await flush(10);
    return r.container;
  };
  const label = (box: HTMLElement) => box.querySelector('[data-testid="coupon-auto-label"]');
  const remove = (box: HTMLElement) => box.querySelector<HTMLButtonElement>('[data-testid="coupon-auto-remove"]');

  beforeEach(() => {
    sessionStorage.clear();
    state.coupons = [c('GIAM30'), c('FS', { type: 'FREESHIP', value: 15000, maxDiscount: null }), c('BIG', { minOrder: 900000 })];
    state.previews.mockResolvedValue(PREVIEWS);
  });

  it('giỏ chưa có mã → áp mã tiết kiệm nhiều nhất, hiện "Đã tự áp" và nút Gỡ', async () => {
    const box = await mountHarness();
    expect(state.applied).toEqual(['GIAM30']);
    expect(label(box)!.textContent).toBe('Tubu đã tự áp mã tốt nhất');
    expect(remove(box)!.textContent).toBe('Gỡ');
    expect(box.textContent).toContain('GIAM30');
  });

  it('W71B: lúc mã tự áp còn đang chạy, bấm "Áp dụng" mã gõ tay không gọi thêm lần nào (nút aria-disabled)', async () => {
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    const box = await mountHarness();
    typeInto(box.querySelector('input[name="coupon-code"]'), 'MANUAL');
    const btn = byText(box, 'button', 'Áp dụng') as HTMLButtonElement;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('aria-busy')).toBeNull();
    click(btn);
    await flush(2);
    release();
    await flush(8);
    expect(state.applied).toEqual(['GIAM30']);
  });

  it('bấm Gỡ → gỡ mã bằng đường gỡ sẵn có, không áp lại, câu gợi ý hiện lại', async () => {
    const box = await mountHarness();
    click(remove(box));
    await flush(10);
    expect(state.removed).toBe(1);
    expect(label(box)).toBeNull();
    expect(box.textContent).toContain('Bạn có 2 mã dùng được · giảm đến 43.800đ');
    expect(state.applied).toEqual(['GIAM30']);
  });

  it('điện thoại: gỡ mã tự áp lỗi khi bảng đang đóng thì lỗi hiện dưới hàng mã, mã vẫn còn', async () => {
    phone();
    const box = await mountHarness();
    state.removeError = new Error('Mất mạng, thử lại nhé');
    click(remove(box));
    await flush(10);
    expect(box.querySelector('[role="alert"]')?.textContent).toContain('Mất mạng');
    expect(label(box)).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('điện thoại: gỡ mã lỗi hai lần với cùng một câu lỗi khi bảng đang đóng: lời báo dưới hàng mã là nút DOM mới, chỉ còn một', async () => {
    phone();
    const box = await mountHarness();
    state.removeError = new Error('Mất mạng, thử lại nhé');
    click(remove(box));
    await flush(10);
    const first = box.querySelector('[role="alert"]')!;
    expect(first.textContent).toContain('Mất mạng');

    click(remove(box));
    await flush(10);
    const second = box.querySelector('[role="alert"]')!;
    expect(second.textContent).toContain('Mất mạng');
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(box.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  it('điện thoại: lỗi gỡ mã ở cuối hàng, mở bảng thì lỗi cũ biến mất (không hiện thêm một lời báo thứ hai trong bảng)', async () => {
    phone();
    const box = await mountHarness();
    state.removeError = new Error('Mất mạng, thử lại nhé');
    click(remove(box));
    await flush(10);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    click(box.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]'));
    await flush(3);
    expect(dialog()).not.toBeNull();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });

  it('khách tự chọn mã khác → nhãn "Đã tự áp" biến mất', async () => {
    phone();
    const box = await mountHarness();
    click(box.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]'));
    await flush(3);
    click(dialog().querySelector<HTMLButtonElement>('button[aria-label$="mã FS"]'));
    await flush(10);
    expect(state.applied).toEqual(['GIAM30', 'FS']);
    expect(label(box)).toBeNull();
  });

  it('giỏ đã có mã, hoặc chưa bật tự áp → không tự áp', async () => {
    const withCode = await mountHarness({ initial: 'XANH10' });
    expect(state.applied).toEqual([]);
    expect(label(withCode)).toBeNull();
    const off = await mountHarness({ autoApply: false });
    expect(state.applied).toEqual([]);
    expect(off.textContent).toContain('Bạn có 2 mã dùng được');
  });

  it('không mã nào dùng được → không áp', async () => {
    state.previews.mockResolvedValue([{ code: 'BIG', eligible: false, reason: 'x', discount: 9 }]);
    await mountHarness();
    expect(state.applied).toEqual([]);
  });

  it('áp lỗi → im lặng: không báo lỗi, giữ câu gợi ý', async () => {
    state.applyError = new Error('mạng');
    const box = await mountHarness();
    expect(box.querySelector('[role="alert"]')).toBeNull();
    expect(label(box)).toBeNull();
    expect(box.textContent).toContain('Bạn có 2 mã dùng được');
  });

  it('tải lại sau khi gỡ → không áp lại; theo từng khách', async () => {
    const box = await mountHarness();
    click(remove(box));
    await flush(10);
    mounted.pop()!.unmount();
    state.applied = [];
    await mountHarness();
    expect(state.applied).toEqual([]);
    await mountHarness({ uid: 'u2' });
    expect(state.applied).toEqual(['GIAM30']);
  });

  it('tải lại khi mã tự áp còn trên giỏ → vẫn hiện "Đã tự áp"', async () => {
    await mountHarness();
    mounted.pop()!.unmount();
    state.applied = [];
    const box = await mountHarness({ initial: 'GIAM30' });
    expect(label(box)!.textContent).toBe('Tubu đã tự áp mã tốt nhất');
    expect(state.applied).toEqual([]);
  });

  it('gỡ bằng nút "Bỏ chọn" trong bảng rồi chọn lại đúng mã đó bằng tay → không còn nhãn', async () => {
    phone();
    const box = await mountHarness();
    click(box.querySelector<HTMLButtonElement>('[data-testid="coupon-change"]'));
    await flush(3);
    click(dialog().querySelector<HTMLButtonElement>('button[aria-label="Bỏ chọn mã GIAM30"]'));
    await flush(10);
    expect(label(box)).toBeNull();
    expect(state.removed).toBe(1);
    // Gỡ mã không đóng bảng (như Mini App): chọn lại ngay trong bảng đang mở.
    click(dialog().querySelector<HTMLButtonElement>('button[aria-label$="mã GIAM30"]'));
    await flush(10);
    expect(box.textContent).toContain('GIAM30');
    expect(label(box)).toBeNull();
  });

  it('forgetAutoCoupon xoá trí nhớ của khách', async () => {
    await mountHarness();
    expect(sessionStorage.getItem('tubu.autocoupon.applied:u1')).toBe('GIAM30');
    forgetAutoCoupon('u1');
    expect(sessionStorage.getItem('tubu.autocoupon.applied:u1')).toBeNull();
  });

  it('đang tự áp mã → ô mã bận (nút gỡ và áp bị khoá)', async () => {
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    phone();
    const box = await mountHarness();
    click(box.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(dialog().querySelector<HTMLButtonElement>('button[aria-label$="mã FS"]')!.getAttribute('aria-disabled')).toBe('true');
    release();
    await flush(10);
    expect(label(box)).not.toBeNull();
  });

  it('chưa biết khách (memoryUserId trống) → chưa tự áp', async () => {
    const r = render(<CouponBox currentCode={null} subtotal={300000} preview={{ addressId: 'a1' }} autoApply />);
    mounted.push(r);
    await flush(10);
    expect(state.applied).toEqual([]);
    expect(r.container.textContent).toContain('Bạn có 2 mã dùng được');
  });
});

describe('CouponBox — "Mỗi đơn dùng 1 mã"', () => {
  it('dạng inline: mở hộp chọn mã thì thấy dòng nhắc, nằm sau danh sách mã', async () => {
    state.coupons = [c('WELCOME30')];
    const box = await mount();
    // Hộp chọn thu gọn mặc định: dòng nhắc nằm trong khung đang ẩn.
    expect(box.querySelector<HTMLElement>('#coupon-panel')!.hidden).toBe(true);
    click(box.querySelector('button[aria-expanded]'));
    await flush(3);
    expect(box.querySelector<HTMLElement>('#coupon-panel')!.hidden).toBe(false);
    const hint = byText(box, 'p', 'Mỗi đơn dùng 1 mã')!;
    expect(hint).not.toBeNull();
    expect(box.querySelector('ul[aria-label="Mã giảm giá của bạn"]')!.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('dạng bảng trượt: mở bảng thấy dòng nhắc, kể cả khi ví chưa có mã nào', async () => {
    const r = render(<CouponBox sheet currentCode={null} subtotal={300000} />);
    mounted.push(r);
    await flush(6);
    click(r.container.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(dialog().textContent).toContain('Mỗi đơn dùng 1 mã');
  });
});

describe('CouponBox — dạng bảng trượt (điện thoại, trong thanh dính đáy)', () => {
  const mountSheet = async (currentCode: string | null = null) => {
    const r = render(<CouponBox sheet currentCode={currentCode} subtotal={300000} />);
    mounted.push(r);
    await flush(6);
    return r.container;
  };

  it('chỉ còn một hàng mở hộp thoại; ô nhập và danh sách mã chưa dựng trong thân', async () => {
    state.coupons = [c('WELCOME30')];
    const box = await mountSheet();
    const row = box.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    expect(row.getAttribute('aria-expanded')).toBeNull();
    expect(box.querySelector('input[name="coupon-code"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  // Hàng này là CouponRow của Mini (pages/cart.tsx): hàng 44px, icon 20, "Mã giảm giá", gợi ý, "Chọn mã ›"; hết chỗ (320px) thì gợi ý xuống dưới nhãn.
  // Không có ô icon 36px và không có cột hai dòng cố định (nhãn trên, gợi ý dưới): hàng cao bằng Mini nên không chiếm thêm chỗ của thanh dính.
  const oneLine = (row: HTMLElement) => {
    expect(row.className).toMatch(/\bmin-h-11\b/);
    expect(row.querySelector('.flex-col'), 'không cột hai dòng').toBeNull();
    expect(row.querySelector('.h-9.w-9'), 'không ô icon 36px').toBeNull();
    expect(row.querySelector('svg.h-5.w-5'), 'icon vé 20px').not.toBeNull();
  };

  it('chưa có mã: hàng 44px, lời mời không cắt "…" (320px thì xuống dòng) và "Chọn mã" ở mép phải', async () => {
    const box = await mountSheet();
    const row = box.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    oneLine(row);
    expect(row.textContent).toContain('Mã giảm giá');
    const hint = [...row.querySelectorAll('span')].find((el) => el.children.length === 0 && el.textContent === 'Chọn hoặc nhập mã')!;
    expect(hint.className).not.toMatch(/\btruncate\b/);
    expect(hint.className).toMatch(/\bleading-4\b/);
    expect(hint.className).toMatch(/\bmin-w-0\b/);
    expect(row.textContent!.endsWith('Chọn mã')).toBe(true);
  });

  it('máy 320px: nhãn và nội dung chung một khối flex-wrap để nội dung xuống dưới nhãn thay vì bị cắt; hàng giữ min-h-11', async () => {
    const box = await mountSheet();
    const row = box.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    expect(row.getAttribute('data-testid')).toBe('coupon-row');
    const label = row.querySelector('[data-testid="coupon-label"]')!;
    const invite = row.querySelector('[data-testid="coupon-placeholder"]')!;
    expect(invite.textContent).toBe('Chọn hoặc nhập mã');
    expect(label.parentElement).toBe(invite.parentElement);
    expect(label.parentElement!.className).toMatch(/\bflex-wrap\b/);
    expect(row.querySelector('[data-testid="coupon-cta"]')!.textContent).toBe('Chọn mã');
  });

  it('đã áp mã: mã và số giảm cùng khối flex-wrap với nhãn, nút ghi "Thay đổi"', async () => {
    const r = render(<CouponBox sheet currentCode="WELCOME30" appliedDiscount={30000} subtotal={300000} />);
    mounted.push(r);
    await flush(6);
    const row = r.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    const label = row.querySelector('[data-testid="coupon-label"]')!;
    const code = row.querySelector('[data-testid="coupon-code"]')!;
    expect(code.textContent).toBe('WELCOME30');
    expect(code.parentElement!.parentElement).toBe(label.parentElement);
    expect(label.parentElement!.className).toMatch(/\bflex-wrap\b/);
    expect(row.querySelector('[data-testid="coupon-discount"]')!.textContent).toBe('-30.000đ');
    expect(row.querySelector('[data-testid="coupon-cta"]')!.textContent).toBe('Thay đổi');
  });

  it('mã dài (trên 15 ký tự): pill xuống dòng ngay trong pill (không truncate), đủ ký tự', async () => {
    const long = 'KHUYENMAI-THANG-MUOI-MOT-VIP-2026';
    const r = render(<CouponBox sheet currentCode={long} appliedDiscount={30000} subtotal={300000} />);
    mounted.push(r);
    await flush(6);
    const code = r.container.querySelector('[data-testid="coupon-code"]')!;
    expect(code.textContent).toBe(long);
    expect(code.className).not.toMatch(/\btruncate\b/);
    expect(code.className).toContain('[overflow-wrap:anywhere]');
    expect(code.className).toMatch(/\bmax-w-full\b/);
  });

  it('chưa có mã nhưng có mã dùng được: gợi ý bản ngắn "N mã · giảm đến X" cũng nằm trong dòng đó', async () => {
    state.coupons = [c('GIAM30')];
    state.previews.mockResolvedValue([{ code: 'GIAM30', eligible: true, discount: 43800 }]);
    const r = render(<CouponBox sheet currentCode={null} subtotal={300000} preview={{ itemIds: ['i1'] }} previewKey="k" />);
    mounted.push(r);
    await flush(8);
    const row = r.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    oneLine(row);
    // 43.800đ rút xuống 43k: "giảm đến" không nói quá mức giảm thật, và chữ không phụ thuộc số lẻ.
    expect(row.textContent).toContain('1 mã · giảm đến 43k');
  });

  it('đang có mã: chip mã, số đã giảm và "Thay đổi" cùng một dòng', async () => {
    const r = render(<CouponBox sheet currentCode="WELCOME30" appliedDiscount={30000} subtotal={300000} />);
    mounted.push(r);
    await flush(6);
    const row = r.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
    oneLine(row);
    expect(row.textContent).toContain('WELCOME30');
    expect(row.textContent).toContain('-30.000đ');
    expect(row.textContent!.endsWith('Thay đổi')).toBe(true);
    expect(row.className).not.toMatch(/\bmd:hidden\b/);
  });

  it('bấm hàng mở bảng, dùng mã trong bảng thì áp mã và đóng bảng', async () => {
    state.coupons = [c('WELCOME30')];
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    click(dialog.querySelector('button[aria-label$="mã WELCOME30"]'));
    await flush(6);
    expect(state.applied).toEqual(['WELCOME30']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('đang có mã không nằm trong ví: hàng hiện mã, bảng có nút "Bỏ mã đang áp dụng"', async () => {
    state.coupons = [c('OTHER')];
    const box = await mountSheet('WELCOME30');
    expect(box.textContent).toContain('WELCOME30');
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    click(byText(dialog(), 'button', 'Bỏ mã đang áp dụng'));
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('đang có mã nằm trong ví: hàng mã ghi "Đang dùng" kèm "Bỏ chọn" gỡ mã, không thêm nút "Bỏ mã đang áp dụng"', async () => {
    state.coupons = [c('WELCOME30'), c('OTHER')];
    const box = await mountSheet('WELCOME30');
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(byText(dialog(), 'button', 'Bỏ mã đang áp dụng')).toBeNull();
    expect(card(document.body, 'WELCOME30').textContent).toContain('Đang dùng');
    click(dialog().querySelector('button[aria-label="Bỏ chọn mã WELCOME30"]'));
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('đang có mã nằm trong ví mà ví (cache cũ) báo hết hạn theo đồng hồ máy: vẫn còn nút "Bỏ chọn", không mất đường gỡ mã', async () => {
    state.coupons = [c('WELCOME30', { endAt: new Date(Date.now() - 60_000).toISOString() })];
    const box = await mountSheet('WELCOME30');
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(byText(dialog(), 'button', 'Bỏ mã đang áp dụng')).toBeNull();
    click(dialog().querySelector('button[aria-label="Bỏ chọn mã WELCOME30"]'));
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('hạn tính theo giờ máy chủ: điện thoại chạy nhanh hơn nhưng máy chủ nói mã còn hạn thì vẫn có nút "Dùng"', async () => {
    const device = Date.now();
    syncServerClock(new Date(device - 86_400_000).toISOString());
    try {
      state.coupons = [c('SOONEND', { endAt: new Date(device - 43_200_000).toISOString() })];
      const box = await mountSheet();
      click(box.querySelector('button[aria-haspopup="dialog"]'));
      await flush(3);
      expect(dialog().querySelector('button[aria-label="Dùng mã SOONEND"]')).not.toBeNull();
    } finally {
      syncServerClock(new Date().toISOString());
    }
  });

  it('ví đang tải: bảng có tiêu đề mục và khung chờ như Mini App, chưa hiện "chưa có mã"', async () => {
    let release!: () => void;
    state.couponsGate = new Promise<void>((r) => (release = r));
    state.coupons = [c('WELCOME30')];
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(dialog().textContent).toContain('Mã giảm giá của bạn');
    const wait = dialog().querySelector('[role="status"]')!;
    expect(wait.getAttribute('aria-label')).toBe('Đang tải danh sách mã');
    expect(wait.querySelectorAll('.tubu-skeleton')).toHaveLength(2);
    expect(dialog().textContent).not.toContain('Bạn chưa có mã giảm giá trong ví');
    release();
    await flush(6);
    expect(dialog().querySelector('[role="status"]')).toBeNull();
    expect(card(document.body, 'WELCOME30')).not.toBeNull();
  });

  it('ví lỗi: bảng có tiêu đề mục, lý do và "Thử lại" tải lại được, không hiện "chưa có mã"', async () => {
    state.couponsError = new Error('Mạng lỗi');
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(6);
    expect(dialog().textContent).toContain('Mã giảm giá của bạn');
    expect(dialog().querySelector('[data-testid="error-message"]')!.textContent).toMatch(/^Không thể tải danh sách mã giảm giá: /);
    expect(dialog().textContent).not.toContain('Bạn chưa có mã giảm giá trong ví');
    state.couponsError = null;
    state.coupons = [c('WELCOME30')];
    click(byText(dialog(), 'button', 'Thử lại'));
    await flush(8);
    expect(card(document.body, 'WELCOME30')).not.toBeNull();
    expect(dialog().querySelector('[role="alert"]')).toBeNull();
  });

  it('chưa có xem trước, có productIds: mã gắn sản phẩm khác giỏ ghi "Chỉ áp cho …" và khoá nút như Mini App', async () => {
    state.coupons = [c('MUACHUNG', { type: 'AMOUNT', value: 20000, maxDiscount: null, products: [{ id: 'p-x', name: 'Chậu gốm' }] })];
    const r = render(<CouponBox sheet currentCode={null} subtotal={300000} productIds={['p-1', 'p-2']} />);
    mounted.push(r);
    await flush(6);
    click(r.container.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    const li = card(document.body, 'MUACHUNG');
    expect(li.textContent).toContain('Chỉ áp cho Chậu gốm');
    const btn = li.querySelector('button')!;
    expect(btn.textContent).toBe('Không áp dụng');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    click(btn);
    expect(state.applied).toEqual([]);
  });

  it('couponProductIds: đủ productId thì trả danh sách, thiếu một dòng (API cũ) thì undefined', () => {
    expect(couponProductIds([{ productId: 'a' }, { productId: 'b' }])).toEqual(['a', 'b']);
    expect(couponProductIds([{ productId: 'a' }, {}])).toBeUndefined();
  });

  it('ví chưa có mã: bảng nói chưa có mã và mời nhập mã ở trên (cùng chữ với Mini App)', async () => {
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(dialog().textContent).toContain('Bạn chưa có mã giảm giá trong ví');
    expect(dialog().textContent).toContain('Nhập mã giảm giá ở trên để áp dụng.');
  });

  it('đang áp một mã: nút của mã đó aria-busy, các mã khác aria-disabled', async () => {
    let release!: () => void;
    state.applyGate = new Promise<void>((r) => (release = r));
    state.coupons = [c('A1'), c('B2')];
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    click(dialog().querySelector('button[aria-label$="mã A1"]'));
    await flush(2);
    expect(dialog().querySelector('button[aria-label$="mã A1"]')!.getAttribute('aria-busy')).toBe('true');
    const other = dialog().querySelector('button[aria-label$="mã B2"]')!;
    expect(other.getAttribute('aria-disabled')).toBe('true');
    expect(other.getAttribute('aria-busy')).toBeNull();
    release();
    await flush(6);
  });

  it('mã sai: lỗi hiện ngay trong bảng (bảng che phần thân) và bảng vẫn mở', async () => {
    state.applyError = new Error('Mã không hợp lệ');
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    typeInto(dialog.querySelector('input[name="coupon-code"]'), 'SAI');
    click(byText(dialog, 'button', 'Áp dụng'));
    await flush(6);
    const still = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(still.querySelector('[role="alert"]')).not.toBeNull();
    expect(box.querySelector('[role="alert"]')).toBeNull();
  });

  it('mã sai: lời báo nằm trong khung ô nhập, trước danh sách mã (ở 320x568 cuối bảng nằm ngoài màn hình)', async () => {
    state.applyError = new Error('Mã không hợp lệ');
    state.coupons = [c('A1'), c('B2')];
    const box = await mountSheet();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    typeInto(dialog.querySelector('input[name="coupon-code"]'), 'SAI');
    click(byText(dialog, 'button', 'Áp dụng'));
    await flush(6);
    const still = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const alerts = still.querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    const card = still.querySelector('input[name="coupon-code"]')!.closest('div.rounded-card')!;
    expect(card.contains(alerts[0]!)).toBe(true);
    const mine = byText(still, 'p', 'Mã giảm giá của bạn')!;
    expect(alerts[0]!.compareDocumentPosition(mine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('CouponBox — panel tại chỗ (từ md): ví tải, lỗi, trống giống bảng trượt và VoucherSheet của Mini (W49A)', () => {
  const desktop = () => {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  };
  beforeEach(() => desktop());
  const open = async (box: HTMLElement) => {
    click(box.querySelector('button[aria-expanded]'));
    await flush(3);
  };
  const panel = (box: HTMLElement) => box.querySelector<HTMLElement>('#coupon-panel')!;

  it('ví đang tải: mở panel thấy tiêu đề mục và khung chờ, chưa hiện "chưa có mã"; tải xong thì khung chờ biến mất', async () => {
    let release!: () => void;
    state.couponsGate = new Promise<void>((r) => (release = r));
    state.coupons = [c('WELCOME30')];
    const box = await mount();
    expect(panel(box).hidden).toBe(true);
    await open(box);
    expect(panel(box).hidden).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(panel(box).textContent).toContain('Mã giảm giá của bạn');
    const wait = panel(box).querySelector('[role="status"]')!;
    expect(wait.getAttribute('aria-label')).toBe('Đang tải danh sách mã');
    expect(wait.querySelectorAll('.tubu-skeleton')).toHaveLength(2);
    expect(panel(box).textContent).not.toContain('Bạn chưa có mã giảm giá trong ví');
    release();
    await flush(6);
    expect(panel(box).querySelector('[role="status"]')).toBeNull();
    expect(card(box, 'WELCOME30')).not.toBeNull();
  });

  it('ví lỗi: mở panel thấy tiêu đề mục, lý do và "Thử lại" tải lại được, không hiện "chưa có mã"', async () => {
    state.couponsError = new Error('Mạng lỗi');
    const box = await mount();
    await open(box);
    await flush(6);
    expect(panel(box).textContent).toContain('Mã giảm giá của bạn');
    expect(panel(box).querySelector('[data-testid="error-message"]')!.textContent).toMatch(/^Không thể tải danh sách mã giảm giá: /);
    expect(panel(box).textContent).not.toContain('Bạn chưa có mã giảm giá trong ví');
    state.couponsError = null;
    state.coupons = [c('WELCOME30')];
    click(byText(panel(box), 'button', 'Thử lại'));
    await flush(8);
    expect(card(box, 'WELCOME30')).not.toBeNull();
    expect(panel(box).querySelector('[data-testid="error-message"]')).toBeNull();
  });

  it('tải lại lỗi khi đã có danh sách cũ: chỉ hiện lỗi kèm "Thử lại" như VoucherSheet, không hiện danh sách dưới lỗi', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    state.coupons = [c('WELCOME30')];
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />, client);
    mounted.push(r);
    await flush(6);
    await open(r.container);
    expect(card(r.container, 'WELCOME30')).not.toBeNull();
    state.couponsError = new Error('Mạng lỗi');
    await act(async () => {
      await client.refetchQueries({ queryKey: ['my-coupons'] });
    });
    await flush(4);
    expect(byText(panel(r.container), 'button', 'Thử lại')).not.toBeNull();
    expect(panel(r.container).querySelector('ul')).toBeNull();
    expect(r.container.querySelector('button[aria-label$="mã WELCOME30"]')).toBeNull();
  });

  // Tải lại lỗi khi ví đã có dữ liệu: react-query giữ dữ liệu cũ và `refetch` thứ hai sẽ huỷ rồi gọi lại API, nên chỉ cú chạm đầu được đi.
  // (Ví chưa từng có dữ liệu thì refetch thứ hai dùng chung lượt đang bay và thẻ lỗi biến mất ngay, nên ca đó không phân biệt được có khoá hay không.)
  it('tải lại lỗi khi ví đã có mã: chạm đúp "Thử lại" trong cùng một khung hình chỉ gọi API thêm một lần, nút báo aria-busy tới khi dữ liệu mới về', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    state.coupons = [c('WELCOME30')];
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />, client);
    mounted.push(r);
    await flush(6);
    await open(r.container);
    state.couponsError = new Error('Mạng lỗi');
    await act(async () => {
      await client.refetchQueries({ queryKey: ['my-coupons'] });
    });
    await flush(4);
    const retry = byText(panel(r.container), 'button', 'Thử lại') as HTMLButtonElement;
    expect(retry).not.toBeNull();
    const before = state.couponsCalls;

    let release!: () => void;
    state.couponsGate = new Promise<void>((res) => (release = res));
    state.couponsError = null;
    act(() => {
      retry.click();
      retry.click();
    });
    await flush(2);
    expect(state.couponsCalls).toBe(before + 1);
    const busy = byText(panel(r.container), 'button', 'Thử lại') as HTMLButtonElement;
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.disabled).toBe(false);

    await act(async () => release());
    await flush(6);
    expect(card(r.container, 'WELCOME30')).not.toBeNull();
    expect(byText(panel(r.container), 'button', 'Thử lại')).toBeNull();
  });

  it('ví chưa có mã: mở panel thấy tiêu đề mục và lời mời nhập mã, không có danh sách rỗng', async () => {
    const box = await mount();
    await open(box);
    expect(panel(box).textContent).toContain('Mã giảm giá của bạn');
    expect(panel(box).textContent).toContain('Bạn chưa có mã giảm giá trong ví');
    expect(panel(box).textContent).toContain('Nhập mã giảm giá ở trên để áp dụng.');
    expect(panel(box).querySelector('ul')).toBeNull();
    expect(byText(panel(box), 'p', 'Mỗi đơn dùng 1 mã')).not.toBeNull();
  });

  it('panel đóng thì thân (tiêu đề, trạng thái) nằm trong khung ẩn, không tốn chiều cao', async () => {
    state.couponsError = new Error('Mạng lỗi');
    const box = await mount();
    expect(panel(box).hidden).toBe(true);
    expect(panel(box).contains(byText(panel(box), 'p', 'Mã giảm giá của bạn'))).toBe(true);
  });

  it('ví có mã: tiêu đề mục hiện đúng một lần, không khung chờ, không lời trống', async () => {
    state.coupons = [c('WELCOME30')];
    const box = await mount();
    await open(box);
    expect(Array.from(panel(box).querySelectorAll('p')).filter((p) => p.textContent === 'Mã giảm giá của bạn')).toHaveLength(1);
    expect(panel(box).querySelector('[role="status"]')).toBeNull();
    expect(panel(box).textContent).not.toContain('Bạn chưa có mã giảm giá trong ví');
  });
});

describe('CouponBox — điện thoại ngoài thanh dính (thanh toán): bảng trượt giống Mini App, không bung tại chỗ', () => {
  beforeEach(() => phone());

  it('bấm hàng mở bảng "Chọn mã giảm giá" có ô nhập và đủ mọi mã (không "Xem thêm"); panel tại chỗ không dựng', async () => {
    state.coupons = ['A', 'B', 'C', 'D', 'E'].map((x) => c(x));
    const box = await mount();
    expect(box.querySelector('#coupon-panel')).toBeNull();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    expect(dialog().getAttribute('aria-label') ?? dialog().textContent).toContain('Chọn mã giảm giá');
    expect(dialog().querySelector('input[name="coupon-code"]')).not.toBeNull();
    expect(dialog().querySelectorAll('li')).toHaveLength(5);
    expect(byText(dialog(), 'button', /Xem thêm/)).toBeNull();
    expect(box.querySelector('input[name="coupon-code"]')).toBeNull();
  });

  it('dùng mã trong bảng thì áp mã và đóng bảng', async () => {
    state.coupons = [c('A1')];
    const box = await mount();
    click(box.querySelector('button[aria-haspopup="dialog"]'));
    await flush(3);
    click(dialog().querySelector('button[aria-label$="mã A1"]'));
    await flush(6);
    expect(state.applied).toEqual(['A1']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

// W71B: áp/gỡ mã khoá đồng bộ bằng ref dùng chung cho cả ba đường (ô nhập, Enter, danh sách mã) và cả nút gỡ. `busy` (state) chỉ đúng sau lần vẽ
// kế nên hai cú bấm sát nhau vẫn đều gọi API (hai lần áp, hoặc áp rồi gỡ chồng nhau). Nút đang bấm giữ focus: aria-busy + aria-disabled, không `disabled` thật.
describe('CouponBox — áp/gỡ mã khoá đồng bộ chống bấm đúp (W71B)', () => {
  const hold = (which: 'applyGate' | 'removeGate') => {
    let release!: () => void;
    state[which] = new Promise<void>((r) => (release = r));
    return () => release();
  };
  const field = (root: ParentNode) => root.querySelector<HTMLInputElement>('input[name="coupon-code"]')!;
  const applyBtn = (root: ParentNode) => byText(root, 'button', 'Áp dụng') as HTMLButtonElement;
  const dropX = (root: ParentNode, code: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="Bỏ mã giảm giá ${code}"]`)!;
  const enter = (el: Element) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const twice = (...els: Element[]) => act(() => { for (const el of els) (el as HTMLElement).click(); });

  it('hai cú bấm "Áp dụng" mã gõ tay trong cùng một khung hình chỉ áp một lần', async () => {
    const release = hold('applyGate');
    const box = await mount();
    typeInto(field(box), 'welcome30');
    twice(applyBtn(box), applyBtn(box));
    release();
    await flush(6);
    expect(state.applied).toEqual(['WELCOME30']);
  });

  it('Enter hai lần liền trong ô nhập chỉ áp một lần', async () => {
    const release = hold('applyGate');
    const box = await mount();
    typeInto(field(box), 'WELCOME30');
    act(() => {
      field(box).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      field(box).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    release();
    await flush(6);
    expect(state.applied).toEqual(['WELCOME30']);
  });

  it('bấm "Áp dụng" rồi Enter trong cùng khung hình: chung một khoá, chỉ một lần', async () => {
    const release = hold('applyGate');
    const box = await mount();
    typeInto(field(box), 'WELCOME30');
    twice(applyBtn(box));
    enter(field(box));
    release();
    await flush(6);
    expect(state.applied).toEqual(['WELCOME30']);
  });

  it('hai cú bấm vào cùng một mã trong ví chỉ áp một lần; bấm hai mã khác nhau sát nhau chỉ áp mã đầu', async () => {
    state.coupons = [c('A1'), c('B2')];
    const release = hold('applyGate');
    const box = await mount();
    const a1 = card(box, 'A1').querySelector('button')!;
    const b2 = card(box, 'B2').querySelector('button')!;
    twice(a1, a1, b2);
    release();
    await flush(6);
    expect(state.applied).toEqual(['A1']);
  });

  it('hai cú bấm nút X gỡ mã chỉ gỡ một lần', async () => {
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="A1" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    twice(dropX(r.container, 'A1'), dropX(r.container, 'A1'));
    release();
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('hai cú bấm "Bỏ mã đang áp dụng" trong panel chỉ gỡ một lần', async () => {
    state.coupons = [c('OTHER')];
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    const drop = byText(panel, 'button', 'Bỏ mã đang áp dụng')!;
    twice(drop, drop);
    release();
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('nút "Gỡ" của mã tự áp: hai cú bấm chỉ gỡ một lần', async () => {
    sessionStorage.setItem('tubu.autocoupon.applied:u1', 'WELCOME30');
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} memoryUserId="u1" />);
    mounted.push(r);
    await flush(4);
    const auto = r.container.querySelector<HTMLButtonElement>('[data-testid="coupon-auto-remove"]')!;
    expect(auto).not.toBeNull();
    twice(auto, auto);
    release();
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('áp một mã rồi bấm gỡ mã cũ sát nhau: gỡ không chồng lên lần áp đang chạy', async () => {
    state.coupons = [c('A1')];
    const release = hold('applyGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    typeInto(field(panel), 'A1');
    twice(applyBtn(panel), dropX(r.container, 'WELCOME30'));
    release();
    await flush(6);
    expect(state.applied).toEqual(['A1']);
    expect(state.removed).toBe(0);
  });

  it('đang áp mã gõ tay: nút "Áp dụng" aria-busy + aria-disabled, không `disabled` thật, giữ focus; nút gỡ aria-disabled (không busy)', async () => {
    const release = hold('applyGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    expect(applyBtn(panel).getAttribute('aria-busy')).toBeNull();
    typeInto(field(panel), 'A1');
    applyBtn(panel).focus();
    click(applyBtn(panel));
    await flush(2);
    const btn = applyBtn(panel);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.disabled).toBe(false);
    expect(document.activeElement).toBe(btn);
    const x = dropX(r.container, 'WELCOME30');
    expect(x.getAttribute('aria-disabled')).toBe('true');
    expect(x.getAttribute('aria-busy')).toBeNull();
    expect(x.disabled).toBe(false);
    release();
    await flush(6);
  });

  it('đang gỡ mã: nút X aria-busy + aria-disabled, không `disabled` thật', async () => {
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="A1" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    dropX(r.container, 'A1').focus();
    click(dropX(r.container, 'A1'));
    await flush(2);
    const x = dropX(r.container, 'A1');
    expect(x.getAttribute('aria-busy')).toBe('true');
    expect(x.getAttribute('aria-disabled')).toBe('true');
    expect(x.disabled).toBe(false);
    expect(document.activeElement).toBe(x);
    release();
    await flush(6);
  });

  it('áp lỗi: nhả khoá và bỏ aria-busy, lời báo role=alert còn nguyên, nút giữ focus; bấm lại gửi được', async () => {
    state.applyError = new Error('Mã không hợp lệ');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    typeInto(field(panel), 'SAI');
    applyBtn(panel).focus();
    click(applyBtn(panel));
    await flush(6);
    expect(panel.querySelector('[role="alert"]')!.textContent).toContain('Mã không hợp lệ');
    expect(applyBtn(panel).getAttribute('aria-busy')).toBeNull();
    expect(applyBtn(panel).getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(applyBtn(panel));
    state.applyError = null;
    typeInto(field(panel), 'DUNG');
    twice(applyBtn(panel), applyBtn(panel));
    await flush(6);
    expect(state.applied).toEqual(['DUNG']);
  });

  it('gỡ lỗi: nhả khoá để gỡ lại được', async () => {
    state.removeError = new Error('Không gỡ được');
    const r = render(<CouponBox currentCode="A1" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(dropX(r.container, 'A1'));
    await flush(6);
    expect(r.container.querySelector('[role="alert"]')!.textContent).toContain('Không gỡ được');
    expect(dropX(r.container, 'A1').getAttribute('aria-busy')).toBeNull();
    state.removeError = null;
    twice(dropX(r.container, 'A1'), dropX(r.container, 'A1'));
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('ô trống: "Áp dụng" vẫn là `disabled` thật (không phải lúc bận) và bấm không gọi API', async () => {
    const box = await mount();
    expect(applyBtn(box).disabled).toBe(true);
    expect(applyBtn(box).getAttribute('aria-busy')).toBeNull();
    click(applyBtn(box));
    await flush(2);
    expect(state.applied).toEqual([]);
  });

  it('trang đang đặt hàng (disabled): mọi nút đổi mã giữ `disabled` thật như trước, không gọi API', async () => {
    state.coupons = [c('OTHER')];
    sessionStorage.setItem('tubu.autocoupon.applied:u1', 'WELCOME30');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} disabled memoryUserId="u1" />);
    mounted.push(r);
    await flush(4);
    expect(dropX(r.container, 'WELCOME30').disabled).toBe(true);
    const auto = r.container.querySelector<HTMLButtonElement>('[data-testid="coupon-auto-remove"]')!;
    expect(auto.disabled).toBe(true);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    expect((byText(panel, 'button', 'Bỏ mã đang áp dụng') as HTMLButtonElement).disabled).toBe(true);
    typeInto(field(panel), 'A1');
    expect(applyBtn(panel).disabled).toBe(true);
    for (const btn of [dropX(r.container, 'WELCOME30'), auto, byText(panel, 'button', 'Bỏ mã đang áp dụng')!, applyBtn(panel)]) click(btn);
    await flush(2);
    expect(state.removed).toBe(0);
    expect(state.applied).toEqual([]);
  });

  it('mã bấm từ danh sách: nút "Áp dụng" chỉ aria-disabled (không aria-busy), nút của mã đó aria-busy', async () => {
    state.coupons = [c('A1'), c('B2')];
    const release = hold('applyGate');
    const box = await mount();
    typeInto(field(box), 'KHAC');
    click(card(box, 'A1').querySelector('button'));
    await flush(2);
    expect(applyBtn(box).getAttribute('aria-disabled')).toBe('true');
    expect(applyBtn(box).getAttribute('aria-busy')).toBeNull();
    expect(card(box, 'A1').querySelector('button')!.getAttribute('aria-busy')).toBe('true');
    release();
    await flush(6);
  });

  it('"Bỏ chọn" ở hàng mã trong danh sách: hai cú bấm chỉ gỡ một lần', async () => {
    state.coupons = [c('WELCOME30')];
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const row = card(r.container, 'WELCOME30').querySelector('button')!;
    expect(row.textContent).toBe('Bỏ chọn');
    twice(row, row);
    release();
    await flush(6);
    expect(state.removed).toBe(1);
  });

  it('đang gỡ bằng "Bỏ mã đang áp dụng" hoặc "Gỡ" của mã tự áp: nút aria-busy + aria-disabled, không `disabled` thật', async () => {
    state.coupons = [c('OTHER')];
    sessionStorage.setItem('tubu.autocoupon.applied:u1', 'WELCOME30');
    const release = hold('removeGate');
    const r = render(<CouponBox currentCode="WELCOME30" subtotal={100000} memoryUserId="u1" />);
    mounted.push(r);
    await flush(4);
    click(byText(r.container, 'button', 'Đổi mã'));
    await flush(2);
    const panel = r.container.querySelector<HTMLElement>('#coupon-panel')!;
    const auto = r.container.querySelector<HTMLButtonElement>('[data-testid="coupon-auto-remove"]')!;
    const drop = byText(panel, 'button', 'Bỏ mã đang áp dụng') as HTMLButtonElement;
    click(drop);
    await flush(2);
    for (const btn of [drop, auto]) {
      expect(btn.getAttribute('aria-busy')).toBe('true');
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.disabled).toBe(false);
    }
    release();
    await flush(6);
  });
});

describe('CouponBox — lệnh đổi mã từ nơi khác còn bay (W91B)', () => {
  /** Giả lệnh áp mã ở giỏ còn bay: cùng QueryClient, cùng COUPON_MUTATION_KEY, treo tới khi gọi release. */
  const startExternalCouponMutation = (client: QueryClient) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const observer = new MutationObserver(client, { mutationKey: COUPON_MUTATION_KEY, mutationFn: () => gate });
    void observer.mutate();
    return release;
  };
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  it('bấm mã trong lúc lệnh áp mã khác còn bay: không gửi lệnh áp thứ hai; hết bay thì bấm được', async () => {
    state.coupons = [c('OK')];
    const client = newClient();
    const release = startExternalCouponMutation(client);
    const r = render(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />, client);
    mounted.push(r);
    await flush(6);
    click(card(r.container, 'OK').querySelector('button'));
    await flush(4);
    expect(state.applied).toEqual([]);
    await act(async () => release());
    await flush(4);
    click(card(r.container, 'OK').querySelector('button'));
    await flush(4);
    expect(state.applied).toEqual(['OK']);
  });

  it('tự áp mã: chờ lệnh đổi mã khác bay xong; giỏ đã có mã sau đó thì không áp thêm mã nào', async () => {
    sessionStorage.clear();
    state.coupons = [c('GIAM30')];
    state.previews.mockResolvedValue([{ code: 'GIAM30', eligible: true, discount: 43800 }]);
    const client = newClient();
    const release = startExternalCouponMutation(client);
    function Harness() {
      const q = useQuery({ queryKey: cartKey(), queryFn: () => null, enabled: false, initialData: { couponCode: null } as { couponCode: string | null } });
      return <CouponBox currentCode={q.data?.couponCode ?? null} subtotal={300000} preview={{ addressId: 'a1' }} autoApply memoryUserId="u1" />;
    }
    const r = render(<Harness />, client);
    mounted.push(r);
    await flush(10);
    expect(state.applied).toEqual([]);
    client.setQueryData(cartKey(), { couponCode: 'FROM-CART' });
    await act(async () => release());
    await flush(10);
    expect(state.applied).toEqual([]);
  });

  it('tự áp mã: lệnh khác bay xong mà giỏ vẫn chưa có mã thì mới tự áp, đúng một lần', async () => {
    sessionStorage.clear();
    state.coupons = [c('GIAM30')];
    state.previews.mockResolvedValue([{ code: 'GIAM30', eligible: true, discount: 43800 }]);
    const client = newClient();
    const release = startExternalCouponMutation(client);
    const r = render(<CouponBox currentCode={null} subtotal={300000} preview={{ addressId: 'a1' }} autoApply memoryUserId="u1" />, client);
    mounted.push(r);
    await flush(10);
    expect(state.applied).toEqual([]);
    await act(async () => release());
    await flush(10);
    expect(state.applied).toEqual(['GIAM30']);
  });
});

// W100B pha 2: lệnh đổi mã trả NGUYÊN giỏ nên ghi cache chung một đường với lệnh dòng/món bù. Lệnh dòng giả lập bằng `begin()` của chính đường đó.
// Giỏ có người đọc thật (useQuery) nên "tải lại giỏ" là một lần fetch thật, và lệnh đổi mã chỉ nhả khi fetch đó về.
describe('CouponBox: ghi giỏ chung đường với lệnh giỏ khác đang bay (W100B pha 2)', () => {
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const out: { w?: ReturnType<typeof useCartWrite> } = {};
  const reads = { gets: 0, gate: null as Promise<void> | null };
  const SEED = { items: [], couponCode: null, mark: 'cũ' };
  function Probe() {
    out.w = useCartWrite();
    useQuery({
      queryKey: cartKey(),
      queryFn: async () => {
        reads.gets += 1;
        if (reads.gate) await reads.gate;
        return { ...SEED, mark: 'máy chủ' };
      },
      staleTime: Infinity,
    });
    return null;
  }
  beforeEach(() => {
    reads.gets = 0;
    reads.gate = null;
  });
  const holdReads = () => {
    let release!: () => void;
    reads.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return async () => {
      await act(async () => release());
      await flush(4);
    };
  };
  const cached = (client: QueryClient) => client.getQueryData(cartKey()) as { mark?: string; couponCode?: string | null };
  const mountShared = async (ui: React.ReactElement) => {
    const client = newClient();
    client.setQueryData(cartKey(), SEED);
    const r = render(<>{ui}<Probe /></>, client);
    mounted.push(r);
    await flush(8);
    return { client, box: r.container };
  };
  const toggle = (box: HTMLElement) => box.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  const typeAndApply = async (box: HTMLElement) => {
    click(toggle(box));
    typeInto(box.querySelector('input[name="coupon-code"]'), 'abc');
    click(byText(box, 'button', 'Áp dụng'));
    await flush(6);
  };
  const finishOtherCommand = async (cmd: ReturnType<NonNullable<typeof out.w>['begin']>) => {
    await act(async () => {
      out.w!.write(cmd, { ...SEED, mark: 'dòng' } as never);
    });
    await flush(4);
  };
  const mutating = (client: QueryClient) => client.isMutating({ mutationKey: COUPON_MUTATION_KEY });

  it('áp mã gõ tay khi lệnh giỏ khác còn bay: không ghi đè giỏ; lệnh kia xong thì giỏ được tải lại từ máy chủ đúng một lần', async () => {
    const { client, box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
    const cmd = out.w!.begin();
    await typeAndApply(box);
    expect(state.applied).toEqual(['ABC']);
    expect(cached(client).mark).toBe('cũ');
    expect(reads.gets).toBe(0);
    await finishOtherCommand(cmd);
    expect(reads.gets).toBe(1);
    expect(cached(client).mark).toBe('máy chủ');
  });

  it('áp mã gõ tay đi một mình: ghi thẳng phản hồi vào giỏ, không tải lại', async () => {
    const { client, box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
    await typeAndApply(box);
    expect(cached(client).couponCode).toBe('ABC');
    expect(reads.gets).toBe(0);
  });

  it('áp mã lỗi trả lại chỗ trong sổ: lệnh giỏ bắt đầu sau đó không bị coi là chồng', async () => {
    state.applyError = new Error('Mã giảm giá đã hết lượt dùng.');
    const { box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
    await typeAndApply(box);
    expect(box.querySelector('[role="alert"]')!.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
    expect(out.w!.begin().stale).toBe(false);
  });

  it('gỡ mã khi lệnh giỏ khác còn bay: không ghi đè giỏ; lệnh kia xong thì giỏ được tải lại', async () => {
    const { client, box } = await mountShared(<CouponBox currentCode="ABC" subtotal={300000} shippingFee={null} />);
    const cmd = out.w!.begin();
    click(toggle(box));
    click(byText(box, 'button', 'Bỏ mã đang áp dụng'));
    await flush(6);
    expect(state.removed).toBe(1);
    expect(cached(client).mark).toBe('cũ');
    await finishOtherCommand(cmd);
    expect(reads.gets).toBe(1);
    expect(cached(client).mark).toBe('máy chủ');
  });

  it('áp mã gõ tay bị bỏ phản hồi vì chồng lệnh khác: hộp báo bận tới khi lần tải giỏ thật về, không nhả khi lần tải còn chạy', async () => {
    const { client, box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
    const cmd = out.w!.begin();
    await typeAndApply(box);
    expect(mutating(client)).toBe(1);
    expect(byText(box, 'button', 'Áp dụng')!.getAttribute('aria-disabled')).toBe('true');
    const releaseReads = holdReads();
    await finishOtherCommand(cmd);
    expect(reads.gets).toBe(1);
    expect(mutating(client)).toBe(1);
    expect(byText(box, 'button', 'Áp dụng')!.getAttribute('aria-disabled')).toBe('true');
    await releaseReads();
    expect(mutating(client)).toBe(0);
    expect(cached(client).mark).toBe('máy chủ');
  });

  it('gỡ mã bị bỏ phản hồi vì chồng lệnh khác: lệnh còn pending tới khi lần tải giỏ thật về', async () => {
    const { client, box } = await mountShared(<CouponBox currentCode="ABC" subtotal={300000} shippingFee={null} />);
    const cmd = out.w!.begin();
    click(toggle(box));
    click(byText(box, 'button', 'Bỏ mã đang áp dụng'));
    await flush(6);
    expect(mutating(client)).toBe(1);
    const releaseReads = holdReads();
    await finishOtherCommand(cmd);
    expect(mutating(client)).toBe(1);
    await releaseReads();
    expect(mutating(client)).toBe(0);
  });

  it('gỡ mã lỗi trả lại chỗ trong sổ: lệnh giỏ bắt đầu sau đó không bị coi là chồng', async () => {
    state.removeError = new Error('Không gỡ được mã.');
    const { box } = await mountShared(<CouponBox currentCode="ABC" subtotal={300000} shippingFee={null} />);
    click(toggle(box));
    click(byText(box, 'button', 'Bỏ mã đang áp dụng'));
    await flush(6);
    expect(box.querySelector('[role="alert"]')!.textContent).toBe('Không gỡ được mã.');
    expect(out.w!.begin().stale).toBe(false);
  });

  describe('máy chủ từ chối vì màn đã cũ (W121): giữ khoá tới khi giỏ, ví mã và số xem trước mới về', () => {
    const applyBtn = (box: HTMLElement) => byText(box, 'button', 'Áp dụng')!;

    it.each([400, 404, 409, 422])('áp mã %i: lời lỗi hiện ngay, giỏ và ví mã tải lại, nút báo bận tới khi giỏ về; chạm lần hai không gửi', async (status) => {
      state.applyError = new ApiError('Mã giảm giá đã hết lượt dùng.', status);
      state.coupons = [c('GIAM30')];
      const { client, box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
      const couponReads = state.couponsCalls;
      const releaseReads = holdReads();
      await typeAndApply(box);
      expect(box.querySelector('[role="alert"]')!.textContent).toBe('Mã giảm giá đã hết lượt dùng.');
      expect(reads.gets).toBe(1);
      expect(state.couponsCalls).toBe(couponReads + 1);
      expect(mutating(client)).toBe(1);
      expect(applyBtn(box).getAttribute('aria-disabled')).toBe('true');
      click(applyBtn(box));
      click(applyBtn(box));
      await flush(4);
      expect(state.applyCalls).toBe(1);
      await releaseReads();
      expect(mutating(client)).toBe(0);
      expect(applyBtn(box).getAttribute('aria-disabled')).not.toBe('true');
      click(applyBtn(box));
      await flush(6);
      expect(state.applyCalls).toBe(2);
    });

    it('gỡ mã bị từ chối 404 (mã đã bị gỡ ở tab khác): giỏ tải lại, lệnh còn pending tới khi giỏ về, chạm lần hai không gửi', async () => {
      state.removeError = new ApiError('Giỏ không còn mã này.', 404);
      const { client, box } = await mountShared(<CouponBox currentCode="ABC" subtotal={300000} shippingFee={null} />);
      const releaseReads = holdReads();
      click(toggle(box));
      click(byText(box, 'button', 'Bỏ mã đang áp dụng'));
      await flush(6);
      expect(box.querySelector('[role="alert"]')!.textContent).toBe('Giỏ không còn mã này.');
      expect(reads.gets).toBe(1);
      expect(mutating(client)).toBe(1);
      click(byText(box, 'button', 'Bỏ mã đang áp dụng'));
      await flush(4);
      expect(state.removeCalls).toBe(1);
      await releaseReads();
      expect(mutating(client)).toBe(0);
    });

    it.each([
      ['lỗi 500', () => new ApiError('Máy chủ bận.', 500)],
      ['mất mạng', () => new NetworkError(false)],
    ])('%s: lời lỗi hiện, KHÔNG tải lại giỏ (lần tải cũng hỏng), nhả khoá ngay', async (_name, makeError) => {
      state.applyError = makeError();
      const { client, box } = await mountShared(<CouponBox currentCode={null} subtotal={300000} shippingFee={null} />);
      await typeAndApply(box);
      expect(box.querySelector('[role="alert"]')).not.toBeNull();
      expect(reads.gets).toBe(0);
      expect(mutating(client)).toBe(0);
    });
  });

  const mountAuto = async () => {
    sessionStorage.clear();
    state.coupons = [c('GIAM30')];
    state.previews.mockResolvedValue([{ code: 'GIAM30', eligible: true, discount: 43800 }]);
    const client = newClient();
    client.setQueryData(cartKey(), SEED);
    const r = render(<>
      <CouponBox currentCode={null} subtotal={300000} preview={{ addressId: 'a1' }} autoApply memoryUserId="u1" />
      <Probe />
    </>, client);
    mounted.push(r);
    return client;
  };

  it('tự áp mã bị bỏ phản hồi vì chồng lệnh khác: lệnh còn pending tới khi lần tải giỏ thật về', async () => {
    const client = await mountAuto();
    // `begin()` chạy trước khi dải tự áp kịp bắn (đợi xem trước mã), nên lệnh giả lập còn bay lúc phản hồi về.
    const cmd = out.w!.begin();
    await flush(10);
    expect(state.applied).toEqual(['GIAM30']);
    expect(mutating(client)).toBe(1);
    const releaseReads = holdReads();
    await finishOtherCommand(cmd);
    expect(mutating(client)).toBe(1);
    await releaseReads();
    expect(mutating(client)).toBe(0);
  });

  it('tự áp mã lỗi trả lại chỗ trong sổ: lệnh giỏ bắt đầu sau đó không bị coi là chồng', async () => {
    state.applyError = new Error('Mã đã hết lượt.');
    const client = await mountAuto();
    await flush(10);
    expect(client.getMutationCache().findAll({ mutationKey: COUPON_MUTATION_KEY }).map((mu) => mu.state.status)).toEqual(['error']);
    expect(out.w!.begin().stale).toBe(false);
  });

  it('tự áp mã khi lệnh giỏ khác còn bay: không ghi đè giỏ; lệnh kia xong thì giỏ được tải lại', async () => {
    const client = await mountAuto();
    const cmd = out.w!.begin();
    await flush(10);
    expect(state.applied).toEqual(['GIAM30']);
    expect(cached(client).mark).toBe('cũ');
    await finishOtherCommand(cmd);
    expect(reads.gets).toBe(1);
    expect(cached(client).mark).toBe('máy chủ');
  });
});
