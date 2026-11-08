import { describe, expect, it } from 'vitest';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '../api/loyalty';
import { fillCopy } from '../shop-copy';
import { CART_VOUCHER_UNLOCK_MAX_GAP, cartVoucherHint } from './cart-voucher-hint';
import type { PickerContext } from './voucher-picker';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const c = (code: string, over: Partial<CouponDTO> = {}): CouponDTO => ({
  code,
  type: 'AMOUNT',
  value: 20_000,
  minOrder: null,
  maxDiscount: null,
  endAt: iso(NOW + 10 * D),
  ...over,
});
const usable = (code: string, discount: number, over: Partial<CouponPreviewDTO> = {}): CouponPreviewDTO => ({ code, eligible: true, discount, ...over });
const short = (code: string, shortfall: number | undefined): CouponPreviewDTO => ({
  code,
  eligible: false,
  discount: 0,
  reason: 'Đơn tối thiểu 300.000đ để dùng mã này.',
  ...(shortfall === undefined ? {} : { shortfall }),
});
const map = (...list: CouponPreviewDTO[]) => new Map(list.map((p) => [p.code.toUpperCase(), p]));
const ctx = (previews: Map<string, CouponPreviewDTO>, over: Partial<PickerContext> = {}): PickerContext => ({ subtotal: 250_000, previews, now: NOW, ...over });

describe('cartVoucherHint: mã dùng được (apply)', () => {
  it('chọn mã giảm nhiều nhất theo số máy chủ, ghi đúng số đó, kèm mã thật để áp', () => {
    const h = cartVoucherHint([c('SMALL'), c('BIG', { value: 5_000 })], ctx(map(usable('SMALL', 20_000), usable('BIG', 45_000))));
    expect(h.apply).toMatchObject({ code: 'BIG', saving: 45_000, text: '🎟️ Bạn có mã giảm giá 45.000đ đủ điều kiện', ariaLabel: 'Áp dụng ngay mã BIG' });
    expect(h.unlock).toBeNull();
  });

  it('hoà số giảm thì mã hết hạn sớm hơn trước', () => {
    const late = c('LATE', { endAt: iso(NOW + 30 * D) });
    const soon = c('SOON', { endAt: iso(NOW + 2 * D) });
    expect(cartVoucherHint([late, soon], ctx(map(usable('LATE', 30_000), usable('SOON', 30_000)))).apply?.code).toBe('SOON');
  });

  it('mã giảm 0 (freeship khi giỏ chưa biết phí giao) không được mời áp', () => {
    const h = cartVoucherHint([c('SHIP', { type: 'FREESHIP', value: 0 })], ctx(map(usable('SHIP', 0))));
    expect(h.apply).toBeNull();
  });

  it('mã freeship đã biết số tiền miễn được (có freeshipSaving) thì mời áp theo số đó', () => {
    const h = cartVoucherHint([c('SHIP', { type: 'FREESHIP', value: 0 })], ctx(map(usable('SHIP', 0, { freeshipSaving: 19_000 }))));
    expect(h.apply).toMatchObject({ code: 'SHIP', saving: 19_000 });
  });

  it('mã chặn bởi máy chủ (không phải thiếu đơn tối thiểu) không được mời áp', () => {
    const blocked: CouponPreviewDTO = { code: 'NEWONLY', eligible: false, discount: 0, reason: 'Mã chỉ dành cho khách mới.' };
    const h = cartVoucherHint([c('NEWONLY')], ctx(map(blocked)));
    expect(h).toEqual({ apply: null, unlock: null });
  });

  it('mã tự cấp có tên thân thiện: hiện tên, vẫn gửi mã thật', () => {
    const h = cartVoucherHint([c('MILESTONE5-u1')], ctx(map(usable('MILESTONE5-u1', 10_000)), { displayCode: () => 'Quà mốc 5 đơn' }));
    expect(h.apply).toMatchObject({ code: 'MILESTONE5-u1', label: 'Quà mốc 5 đơn', ariaLabel: 'Áp dụng ngay mã Quà mốc 5 đơn' });
  });
});

describe('cartVoucherHint: mã sắp mở khoá (unlock)', () => {
  it('mã giảm tiền: nói số còn thiếu của máy chủ và mức giảm của mã; thanh = phần đã đạt của đơn tối thiểu', () => {
    const h = cartVoucherHint([c('MID', { value: 40_000, minOrder: 300_000 })], ctx(map(short('MID', 50_000))));
    expect(h.apply).toBeNull();
    expect(h.unlock).toMatchObject({ code: 'MID', missing: 50_000, pct: 83, text: '🔥 Mua thêm 50.000đ để mở khoá mã giảm giá 40.000đ', barAria: 'Đã đạt 83% đơn tối thiểu của mã giảm giá' });
  });

  it('mã giảm theo %: nói %, không bịa số tiền (số tiền phụ thuộc giỏ cuối cùng)', () => {
    const h = cartVoucherHint([c('P10', { type: 'PERCENT', value: 10, maxDiscount: 60_000, minOrder: 300_000 })], ctx(map(short('P10', 50_000))));
    expect(h.unlock?.text).toBe('🔥 Mua thêm 50.000đ để mở khoá mã giảm giá 10%');
  });

  it('mã freeship: nói Miễn phí giao hàng, không nói số tiền', () => {
    const h = cartVoucherHint([c('SHIP', { type: 'FREESHIP', value: 0, minOrder: 300_000 })], ctx(map(short('SHIP', 50_000))));
    expect(h.unlock?.text).toBe('🔥 Mua thêm 50.000đ để mở khoá mã Miễn phí giao hàng');
  });

  it('chỉ tin số `shortfall` của máy chủ: thiếu số đó (API cũ) thì không nhắc, dù tạm tính phía máy đoán được', () => {
    const h = cartVoucherHint([c('MID', { minOrder: 300_000 })], ctx(map(short('MID', undefined))));
    expect(h).toEqual({ apply: null, unlock: null });
  });

  it('thiếu quá trần (CART_VOUCHER_UNLOCK_MAX_GAP) thì không nhắc: không ép khách mua thêm nhiều', () => {
    const at = cartVoucherHint([c('A', { minOrder: 300_000 })], ctx(map(short('A', CART_VOUCHER_UNLOCK_MAX_GAP))));
    const over = cartVoucherHint([c('A', { minOrder: 300_000 })], ctx(map(short('A', CART_VOUCHER_UNLOCK_MAX_GAP + 1))));
    expect(at.unlock?.missing).toBe(CART_VOUCHER_UNLOCK_MAX_GAP);
    expect(over.unlock).toBeNull();
  });

  it('nhiều mã chưa đủ: chọn mã thiếu ít nhất; hoà thì mã giảm nhiều hơn', () => {
    const coupons = [c('FAR', { value: 90_000, minOrder: 500_000 }), c('NEAR', { value: 30_000, minOrder: 300_000 }), c('NEAR2', { value: 35_000, minOrder: 300_000 })];
    const h = cartVoucherHint(coupons, ctx(map(short('FAR', 80_000), short('NEAR', 30_000), short('NEAR2', 30_000))));
    expect(h.unlock?.code).toBe('NEAR2');
  });

  it('thanh không bao giờ đạt 100 khi còn thiếu', () => {
    const h = cartVoucherHint([c('A', { value: 10_000, minOrder: 300_000 })], ctx(map(short('A', 1))));
    expect(h.unlock?.pct).toBe(99);
  });

  it('đã có mã dùng được: chỉ nhắc mã mở khoá sẽ giảm HƠN mã đó', () => {
    const coupons = [c('HAVE', { value: 30_000 }), c('LESS', { value: 20_000, minOrder: 300_000 }), c('MORE', { value: 60_000, minOrder: 320_000 })];
    const h = cartVoucherHint(coupons, ctx(map(usable('HAVE', 30_000), short('LESS', 20_000), short('MORE', 70_000))));
    expect(h.apply?.code).toBe('HAVE');
    expect(h.unlock?.code).toBe('MORE');
    const onlyLess = cartVoucherHint(coupons.slice(0, 2), ctx(map(usable('HAVE', 30_000), short('LESS', 20_000))));
    expect(onlyLess.apply?.code).toBe('HAVE');
    expect(onlyLess.unlock).toBeNull();
  });

  it('mã % khi đã có mã dùng được: so bằng mức giảm tối thiểu khi vừa đủ đơn tối thiểu, không bằng số hứa suông', () => {
    // 10% của 300k = 30k, trần 60k; mã đang dùng giảm 30k: mở khoá cũng không giảm hơn nên không nhắc.
    const coupons = [c('HAVE', { value: 30_000 }), c('P10', { type: 'PERCENT', value: 10, maxDiscount: 60_000, minOrder: 300_000 })];
    expect(cartVoucherHint(coupons, ctx(map(usable('HAVE', 30_000), short('P10', 50_000)))).unlock).toBeNull();
    // 20% của 300k = 60k > 30k: nhắc.
    const better = [c('HAVE', { value: 30_000 }), c('P20', { type: 'PERCENT', value: 20, maxDiscount: 90_000, minOrder: 300_000 })];
    expect(cartVoucherHint(better, ctx(map(usable('HAVE', 30_000), short('P20', 50_000)))).unlock?.code).toBe('P20');
  });

  it('mã đang mời áp là %: tăng theo giỏ nên mã mở khoá phải hơn mức giảm SAU khi mua thêm, không chỉ mức giảm hiện tại', () => {
    // A giảm 10% (47k trên 470k). B giảm 48k, đòi 500k, thiếu 30k. Mua thêm 30k thì A giảm 50k > 48k: nhắc B là nhắc mã kém hơn.
    const coupons = [c('A', { type: 'PERCENT', value: 10, maxDiscount: null }), c('B', { value: 48_000, minOrder: 500_000 })];
    const h = cartVoucherHint(coupons, ctx(map(usable('A', 47_000), short('B', 30_000)), { subtotal: 470_000 }));
    expect(h.apply?.code).toBe('A');
    expect(h.unlock).toBeNull();
    // B giảm 80k thì hơn mức A đạt được sau khi mua thêm (50k): vẫn nhắc.
    const bigger = [c('A', { type: 'PERCENT', value: 10, maxDiscount: null }), c('B', { value: 80_000, minOrder: 500_000 })];
    expect(cartVoucherHint(bigger, ctx(map(usable('A', 47_000), short('B', 30_000)), { subtotal: 470_000 })).unlock?.code).toBe('B');
    // A bị trần 47k thì mua thêm cũng không giảm hơn: B 48k hơn, nhắc.
    const capped = [c('A', { type: 'PERCENT', value: 10, maxDiscount: 47_000 }), c('B', { value: 48_000, minOrder: 500_000 })];
    expect(cartVoucherHint(capped, ctx(map(usable('A', 47_000), short('B', 30_000)), { subtotal: 470_000 })).unlock?.code).toBe('B');
  });

  it('mã % có trần đã chạm ngay tại đơn tối thiểu: nói số trần thay vì %; trần chưa chạm thì vẫn nói %', () => {
    // 10% của 300k = 30k >= trần 20k: giảm chắc chắn 20k, nói 20.000đ.
    const capped = cartVoucherHint([c('P10', { type: 'PERCENT', value: 10, maxDiscount: 20_000, minOrder: 300_000 })], ctx(map(short('P10', 50_000))));
    expect(capped.unlock?.text).toBe('🔥 Mua thêm 50.000đ để mở khoá mã giảm giá 20.000đ');
    // 10% của 300k = 30k < trần 50k: mua thêm giảm thêm nên nói %.
    const open = cartVoucherHint([c('P10', { type: 'PERCENT', value: 10, maxDiscount: 50_000, minOrder: 300_000 })], ctx(map(short('P10', 50_000))));
    expect(open.unlock?.text).toBe('🔥 Mua thêm 50.000đ để mở khoá mã giảm giá 10%');
  });

  it('có thể có cả hai: apply và unlock cùng lúc', () => {
    const coupons = [c('HAVE', { value: 20_000 }), c('MORE', { value: 50_000, minOrder: 300_000 })];
    const h = cartVoucherHint(coupons, ctx(map(usable('HAVE', 20_000), short('MORE', 50_000))));
    expect(h.apply?.code).toBe('HAVE');
    expect(h.unlock?.code).toBe('MORE');
  });
});

describe('cartVoucherHint: khi nào im lặng', () => {
  const coupons = [c('HAVE', { value: 20_000 }), c('MORE', { value: 50_000, minOrder: 300_000 })];
  const previews = () => map(usable('HAVE', 20_000), short('MORE', 50_000));

  it('giỏ đã có mã: không gợi ý', () => {
    expect(cartVoucherHint(coupons, ctx(previews(), { currentCode: 'have' }))).toEqual({ apply: null, unlock: null });
  });

  it('chưa có xem trước của máy chủ (đang tải, giỏ vừa đổi, lỗi): không đoán', () => {
    expect(cartVoucherHint(coupons, ctx(new Map()))).toEqual({ apply: null, unlock: null });
  });

  it('ví rỗng: không gợi ý', () => {
    expect(cartVoucherHint([], ctx(previews()))).toEqual({ apply: null, unlock: null });
  });

  it('mảng vào không bị đổi', () => {
    const copy = [...coupons];
    cartVoucherHint(coupons, ctx(previews()));
    expect(coupons).toEqual(copy);
  });

  it('chữ không có dấu chấm than và không dính thuật ngữ cấm "voucher"', () => {
    const h = cartVoucherHint(coupons, ctx(previews()));
    for (const t of [h.apply?.text, h.apply?.ariaLabel, h.unlock?.text, h.unlock?.barAria]) {
      expect(t).toBeTruthy();
      expect(t).not.toContain('!');
      expect(t!.toLowerCase()).not.toContain('voucher');
    }
  });
});

describe('cart.voucherHint.shopMoreCta: nhãn nút ở dòng sắp mở khoá', () => {
  it('"Mua thêm", ngắn, không dấu chấm than, không dính thuật ngữ cấm "voucher"', () => {
    const t = fillCopy('cart.voucherHint.shopMoreCta');
    expect(t).toBe('Mua thêm');
    expect(t).not.toContain('!');
    expect(t.toLowerCase()).not.toContain('voucher');
  });
});
