import { describe, expect, it } from 'vitest';
import type { CouponDTO } from '../api/loyalty';
import { vnd, vndShort } from './money';
import { couponLabel, couponTitle, sortVouchers, voucherView } from './voucher';

const NOW = Date.parse('2026-11-01T05:00:00Z');
const D = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const coupon = (over: Partial<CouponDTO> = {}): CouponDTO => ({
  code: 'TUBU30',
  type: 'AMOUNT',
  value: 30_000,
  minOrder: 199_000,
  maxDiscount: null,
  endAt: iso(NOW + 10 * D),
  ...over,
});

describe('vnd / vndShort', () => {
  it('đầy đủ có dấu chấm nghìn', () => {
    expect(vnd(39_000)).toBe('39.000đ');
  });
  it('rút gọn k và tr, số lẻ không tròn thì dạng đầy đủ', () => {
    expect(vndShort(50_000)).toBe('50k');
    expect(vndShort(199_000)).toBe('199k');
    expect(vndShort(1_500_000)).toBe('1,5tr');
    expect(vndShort(12_345)).toBe('12.345đ');
    expect(vndShort(0)).toBe('0đ');
  });
});

describe('couponLabel (chữ giữ như bốn bản cũ)', () => {
  it('freeship, phần trăm, phần trăm có trần, số tiền', () => {
    expect(couponLabel({ type: 'FREESHIP', value: 0, maxDiscount: null })).toBe('Miễn phí giao hàng');
    expect(couponLabel({ type: 'PERCENT', value: 10, maxDiscount: null })).toBe('Giảm 10%');
    expect(couponLabel({ type: 'PERCENT', value: 10, maxDiscount: 30_000 })).toBe('Giảm 10% (tối đa 30.000đ)');
    expect(couponLabel({ type: 'AMOUNT', value: 20_000, maxDiscount: null })).toBe('Giảm 20.000đ');
  });
});

describe('voucherView', () => {
  it('mã số tiền còn hạn trong ví', () => {
    expect(voucherView(coupon(), NOW)).toEqual({
      id: 'TUBU30',
      code: 'TUBU30',
      title: 'Giảm 30k',
      kind: 'discount',
      condition: 'Đơn từ 199k',
      expiry: 'Dùng đến 11/11',
      state: 'saved',
      name: null,
      quota: null,
    });
  });
  it('name là tên admin đặt (title) đã trim; rỗng hoặc toàn khoảng trắng thì null', () => {
    expect(voucherView(coupon({ title: '  Chào bạn mới  ' }), NOW).name).toBe('Chào bạn mới');
    expect(voucherView(coupon({ title: '   ' }), NOW).name).toBeNull();
    expect(voucherView(coupon({ title: null }), NOW).name).toBeNull();
    expect(voucherView(coupon(), NOW).name).toBeNull();
  });
  it('quota "Còn n lượt" chỉ khi mã chưa nhận và còn 1 đến 10 lượt', () => {
    const open = (remaining: number | null, over: Record<string, unknown> = {}) =>
      voucherView({ ...coupon(), claimed: false, remaining, ...over }, NOW).quota;
    expect(open(3)).toBe('Còn 3 lượt');
    expect(open(1)).toBe('Còn 1 lượt');
    expect(open(10)).toBe('Còn 10 lượt');
    expect(open(11)).toBeNull();
    expect(open(0)).toBeNull();
    expect(open(null)).toBeNull();
    expect(open(3, { claimed: true })).toBeNull();
    expect(open(3, { endAt: iso(NOW - 1) })).toBeNull();
  });
  it('không có đơn tối thiểu thì điều kiện rỗng', () => {
    expect(voucherView(coupon({ minOrder: null }), NOW).condition).toBe('');
  });
  it('loại theo mã: freeship; shop chỉ khi báo shop; mã mua chung (products) vẫn là discount', () => {
    expect(voucherView(coupon({ type: 'FREESHIP' }), NOW).kind).toBe('freeship');
    expect(voucherView({ ...coupon(), shop: true }, NOW).kind).toBe('shop');
    expect(voucherView(coupon({ products: [{ id: 'p1', name: 'A' }] }), NOW).kind).toBe('discount');
  });
  it('chữ hạn: ngày lịch giờ Việt Nam, hết hạn', () => {
    expect(voucherView(coupon({ endAt: iso(NOW + 5 * 3_600_000) }), NOW).expiry).toBe('Hết hạn hôm nay');
    expect(voucherView(coupon({ endAt: iso(NOW + 2 * D) }), NOW).expiry).toBe('Còn 2 ngày');
    expect(voucherView(coupon({ endAt: iso(NOW + 3 * D) }), NOW).expiry).toBe('Còn 3 ngày');
    expect(voucherView(coupon({ endAt: iso(NOW + 4 * D) }), NOW).expiry).toBe('Dùng đến 05/11');
    expect(voucherView(coupon({ endAt: iso(NOW - 1) }), NOW).expiry).toBe('Đã hết hạn');
  });
  it('ngày lịch VN, không phải cửa sổ 24 giờ: 20:00 VN, hạn 10:00 sáng hôm sau là "Còn 1 ngày" (không phải "hôm nay"); 23:59 hôm sau cũng 1 ngày (không phải 2)', () => {
    const now = Date.parse('2026-10-31T13:00:00Z'); // 20:00 31/10 giờ VN
    expect(voucherView(coupon({ endAt: '2026-11-01T03:00:00Z' }), now).expiry).toBe('Còn 1 ngày');
    expect(voucherView(coupon({ endAt: '2026-11-01T16:59:00Z' }), now).expiry).toBe('Còn 1 ngày');
    expect(voucherView(coupon({ endAt: '2026-10-31T16:59:00Z' }), now).expiry).toBe('Hết hạn hôm nay');
  });
  it('ranh giới nửa đêm VN: 23:59 VN hạn 00:01 VN hôm sau là còn 1 ngày, hạn 23:58 cùng ngày là hôm nay', () => {
    const now = Date.parse('2026-10-31T16:59:00Z'); // 23:59 31/10 VN
    expect(voucherView(coupon({ endAt: '2026-10-31T17:01:00Z' }), now).expiry).toBe('Còn 1 ngày');
    expect(voucherView(coupon({ endAt: '2026-10-31T16:59:30Z' }), now).expiry).toBe('Hết hạn hôm nay');
  });
  it('hạn không đọc được thì không đoán: còn dùng được, chữ hạn rỗng', () => {
    const v = voucherView(coupon({ endAt: 'không phải ngày' }), NOW);
    expect(v.state).toBe('saved');
    expect(v.expiry).toBe('');
  });
  it('trạng thái: đã dùng > hết hạn > hết lượt > chưa đủ điều kiện > chưa nhận > đã lưu', () => {
    const expired = coupon({ endAt: iso(NOW - 1) });
    expect(voucherView({ ...expired, used: true }, NOW).state).toBe('used');
    expect(voucherView({ ...expired, soldOut: true }, NOW).state).toBe('expired');
    expect(voucherView({ ...coupon(), soldOut: true, ineligible: true }, NOW).state).toBe('soldout');
    expect(voucherView({ ...coupon(), ineligible: true, claimed: false }, NOW).state).toBe('ineligible');
    expect(voucherView({ ...coupon(), claimed: false }, NOW).state).toBe('collectable');
    expect(voucherView({ ...coupon(), claimed: true }, NOW).state).toBe('saved');
  });
});

describe('couponTitle (nhãn trên thẻ: một cách ghi số, rút gọn)', () => {
  it('số tiền, phần trăm có và không có trần, freeship', () => {
    expect(couponTitle({ type: 'AMOUNT', value: 20_000, maxDiscount: null })).toBe('Giảm 20k');
    expect(couponTitle({ type: 'PERCENT', value: 10, maxDiscount: 50_000 })).toBe('Giảm 10%, tối đa 50k');
    expect(couponTitle({ type: 'PERCENT', value: 15, maxDiscount: null })).toBe('Giảm 15%');
    expect(couponTitle({ type: 'FREESHIP', value: 0, maxDiscount: null })).toBe('Miễn phí giao hàng');
  });
  it('số không tròn nghìn thì đủ số (cùng luật vndShort), triệu rút gọn', () => {
    expect(couponTitle({ type: 'AMOUNT', value: 12_500, maxDiscount: null })).toBe('Giảm 12.500đ');
    expect(couponTitle({ type: 'AMOUNT', value: 1_500_000, maxDiscount: null })).toBe('Giảm 1,5tr');
  });
});

describe('voucherView: tên admin nhắc lại số thì bỏ (một phiếu không hai cách ghi số)', () => {
  const view = (title: string | null, over: Partial<CouponDTO> = {}) => voucherView(coupon({ title, ...over }), NOW);
  it('tên nhắc lại số của nhãn hoặc điều kiện thì name null, điều kiện giữ', () => {
    expect(view('Giảm 10% tối đa 50.000đ', { type: 'PERCENT', value: 10, maxDiscount: 50_000, minOrder: 300_000 }).name).toBeNull();
    const ship = view('Miễn phí giao hàng đơn từ 99.000đ', { type: 'FREESHIP', value: 0, minOrder: 99_000 });
    expect(ship.name).toBeNull();
    expect(ship.condition).toBe('Đơn từ 99k');
    expect(view('Giảm 20.000đ đơn từ 150k', { value: 20_000, minOrder: 150_000 }).name).toBeNull();
    expect(view('Giảm 20k', { value: 20_000 }).name).toBeNull();
    expect(view('Đơn từ 1,5tr tặng bạn', { minOrder: 1_500_000 }).name).toBeNull();
    expect(view('Giảm 30000đ', { value: 30_000 }).name).toBeNull();
  });
  it('tên nhắc lại nguyên chữ nhãn (không số) cũng bỏ', () => {
    expect(view('Miễn phí giao hàng', { type: 'FREESHIP', value: 0, minOrder: null }).name).toBeNull();
  });
  it('tên còn phạm vi hay đối tượng ngoài số của mã thì giữ (phiếu không có chỗ nào khác nói điều đó)', () => {
    expect(view('Giảm 20k cho đơn đầu tiên', { value: 20_000 }).name).toBe('cho đơn đầu tiên');
    expect(view('Giảm 10% riêng mỹ phẩm', { type: 'PERCENT', value: 10, maxDiscount: null }).name).toBe('riêng mỹ phẩm');
    expect(view('Giảm 10% tối đa 50.000đ cho khách mới', { type: 'PERCENT', value: 10, maxDiscount: 50_000, minOrder: null }).name).toBe('cho khách mới');
  });
  it('tên được giữ ghi số của mã theo cách của phiếu (một cách ghi số), số lạ để nguyên', () => {
    const v = view('Giảm 20.000đ cho đơn đầu tiên, tặng 5 lần dùng', { value: 20_000, minOrder: 150_000 });
    expect(v.title).toBe('Giảm 20k');
    expect(v.name).toBe('cho đơn đầu tiên, tặng 5 lần dùng');
    expect(view('Đơn từ 150.000. Riêng khách mới', { value: 20_000, minOrder: 150_000 }).name).toBe('Đơn từ 150k. Riêng khách mới');
    expect(view('Mua 10 trở lên được giảm 20k', { value: 20_000 }).name).toBe('Mua 10 trở lên được giảm 20k');
  });
  it('tiền viết bằng chữ ("đồng", "VND", "vnđ") đi cùng số thì đổi cả cụm, không bao giờ ra "20k đồng"', () => {
    expect(view('Tặng 20.000 đồng cho bạn', { value: 20_000 }).name).toBeNull();
    expect(view('Giảm 20.000 VND', { value: 20_000 }).name).toBeNull();
    expect(view('Giảm 20.000vnđ', { value: 20_000 }).name).toBeNull();
    expect(view('Tặng 20.000 đồng cho đơn đầu tiên', { value: 20_000 }).name).toBe('cho đơn đầu tiên');
    expect(view('Giảm 20000 đồng cho khách mới', { value: 20_000 }).name).toBe('cho khách mới');
    expect(view('Giảm 20.000 VND cho khách mới', { value: 20_000 }).name).toBe('cho khách mới');
    for (const t of ['Tặng 20.000 đồng cho đơn đầu tiên', 'Giảm 20.000 VND cho khách mới', 'Giảm 20000 đồng cho khách mới']) {
      expect(view(t, { value: 20_000 }).name).not.toMatch(/k (đồng|VND)/);
    }
    // 5.000 không phải số của mã: để nguyên cả cụm.
    expect(view('Tặng 5.000 đồng vào ví', { value: 20_000 }).name).toBe('Tặng 5.000 đồng vào ví');
  });
  it('số nhỏ không đơn vị (số đơn, số lượt, số bạn) là thông tin riêng: tên giữ, không bị coi là nhắc lại mã', () => {
    const base = { value: 20_000, minOrder: 300_000 };
    expect(view('Giảm 20k cho 3 đơn', base).name).toBe('cho 3 đơn');
    expect(view('Giảm 20.000đ cho 2 đơn', base).name).toBe('cho 2 đơn');
    expect(view('Giảm 20k khi mua 2', base).name).toBe('khi mua 2');
    expect(view('Giảm 20k cho 100 bạn', base).name).toBe('cho 100 bạn');
    expect(view('Freeship 2 đơn từ 99k', { type: 'FREESHIP', value: 0, minOrder: 99_000 }).name).toBe('Freeship 2 đơn từ 99k');
  });
  it('phần đầu tên chép lại nhãn thì cắt để dòng tên nhỏ bắt đầu bằng phần mới (dòng ~100px không đẩy "3 đơn" ra khỏi tầm nhìn)', () => {
    const base = { value: 20_000, minOrder: 300_000 };
    expect(view('Giảm 20k, cho 3 đơn', base).name).toBe('cho 3 đơn');
    expect(view('Tặng 20k cho khách mới', base).name).toBe('cho khách mới');
    expect(view('GIẢM 20K cho 3 đơn', base).name).toBe('cho 3 đơn');
    // Không có số của mã trong phần đầu thì không cắt: "Giảm" bỏ ra thành "giá khách VIP" mất nghĩa.
    expect(view('Giảm giá khách VIP', base).name).toBe('Giảm giá khách VIP');
    // Phần đầu mở bằng từ ngoài nhãn thì giữ nguyên, kể cả sau đó có số của mã.
    expect(view('Khách mới giảm 20k', base).name).toBe('Khách mới giảm 20k');
    expect(view('Đơn từ 300k tặng 20k cho 3 đơn', base).name).toBe('Đơn từ 300k tặng 20k cho 3 đơn');
    // Số lạ đứng giữa phần đầu: dừng ở đó, không cắt qua số của đơn.
    expect(view('Giảm 20k 3 đơn', base).name).toBe('3 đơn');
    expect(view('Tặng 3 đơn giảm 20k', base).name).toBe('Tặng 3 đơn giảm 20k');
  });
  it('phần đầu chỉ bị cắt khi chép đúng nhãn: số của đơn tối thiểu hay trần giảm đứng đầu tên thì tên giữ nguyên (số vẫn hiện trên phiếu)', () => {
    // FREESHIP có trần 30k nhưng nhãn "Miễn phí giao hàng" không in số nào: "Freeship 30k" không chép nhãn.
    const ship = { type: 'FREESHIP' as const, value: 0, maxDiscount: 30_000, minOrder: null };
    expect(view('Freeship 30k cho đơn đầu', ship).name).toBe('Freeship 30k cho đơn đầu');
    // Nhãn "Giảm 20k": 100k là đơn tối thiểu, không phải số của nhãn.
    expect(view('Giảm 100k cho khách mới', { value: 20_000, minOrder: 100_000 }).name).toBe('Giảm 100k cho khách mới');
    const pct = { type: 'PERCENT' as const, value: 10, maxDiscount: 50_000, minOrder: 300_000 };
    // Nhãn "Giảm 10%, tối đa 50k": chữ và số đều của nhãn thì cắt; 300k (đơn tối thiểu) thì không.
    expect(view('Giảm 10% tối đa 50k cho khách mới', pct).name).toBe('cho khách mới');
    expect(view('Giảm 300k cho khách mới', pct).name).toBe('Giảm 300k cho khách mới');
  });
  it('tên không nhắc số thì giữ, kể cả có số khác', () => {
    expect(view('Quà khách mới').name).toBe('Quà khách mới');
    expect(view('Tặng 5 lần dùng', { value: 30_000, minOrder: 199_000 }).name).toBe('Tặng 5 lần dùng');
    expect(view('  ').name).toBeNull();
  });
});

describe('sortVouchers', () => {
  const v = (id: string, endAt?: string | null) => ({ id, endAt });
  it('sắp hết hạn trước, không hạn sau mã còn hạn, hết hạn cuối cùng', () => {
    const list = [v('none'), v('late', iso(NOW + 9 * D)), v('gone', iso(NOW - D)), v('soon', iso(NOW + D)), v('mid', iso(NOW + 4 * D))];
    expect(sortVouchers(list, NOW).map((x) => x.id)).toEqual(['soon', 'mid', 'late', 'none', 'gone']);
  });
  it('nhận CouponDTO thật, sắp theo endAt', () => {
    const list = [coupon({ code: 'late', endAt: iso(NOW + 9 * D) }), coupon({ code: 'soon', endAt: iso(NOW + D) })];
    expect(sortVouchers(list, NOW).map((x) => x.code)).toEqual(['soon', 'late']);
  });
  it('ổn định khi hoà và không đổi mảng vào', () => {
    const list = [v('a', iso(NOW + D)), v('b', iso(NOW + D)), v('c', null), v('d', null)];
    const copy = [...list];
    expect(sortVouchers(list, NOW).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(list).toEqual(copy);
  });
  it('hạn không đọc được xếp như không hạn', () => {
    expect(sortVouchers([v('x', 'rác'), v('y', iso(NOW + D))], NOW).map((r) => r.id)).toEqual(['y', 'x']);
  });
});
