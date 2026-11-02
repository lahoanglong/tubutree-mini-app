import { describe, expect, it } from 'vitest';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '../api/loyalty';
import { offerRows, pickerRows, type PickerContext } from './voucher-picker';

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
const preview = (code: string, over: Partial<CouponPreviewDTO> = {}): CouponPreviewDTO => ({ code, eligible: true, discount: 0, ...over });
const previewMap = (...list: CouponPreviewDTO[]) => new Map(list.map((p) => [p.code.toUpperCase(), p]));
const ctx = (over: Partial<PickerContext> = {}): PickerContext => ({ subtotal: 150_000, previews: new Map(), now: NOW, ...over });
const byCode = <T extends { coupon: CouponDTO }>(rows: T[], code: string) => rows.find((r) => r.coupon.code === code)!;

const MIN_SENTENCE = 'Đơn tối thiểu 199.000đ để dùng mã này.';

describe('pickerRows: thứ tự', () => {
  const coupons = [
    c('BLOCKED', { type: 'FREESHIP', value: 0 }),
    c('BIG', { minOrder: 500_000 }),
    c('MID', { minOrder: 200_000 }),
    c('A20', { value: 20_000 }),
    c('P10', { type: 'PERCENT', value: 10, maxDiscount: 50_000 }),
    c('APPLIED', { value: 5_000 }),
  ];

  it('đang áp, rồi dùng được (giảm nhiều trước), rồi chưa đủ (thiếu ít trước), rồi không áp dụng', () => {
    const rows = pickerRows(coupons, ctx({ currentCode: 'applied', shippingFee: 0 }));
    expect(rows.map((r) => r.coupon.code)).toEqual(['APPLIED', 'A20', 'P10', 'MID', 'BIG', 'BLOCKED']);
    expect(rows.map((r) => r.group)).toEqual(['applied', 'usable', 'usable', 'short', 'short', 'blocked']);
  });

  it('không có xem trước: mức giảm ước theo giá trị mã, tiền hàng (10% của 150k = 15k) và phí giao; không ghi số cho khách', () => {
    const rows = pickerRows(coupons, ctx({ shippingFee: 30_000 }));
    expect(rows.map((r) => r.coupon.code)).toEqual(['BLOCKED', 'A20', 'P10', 'APPLIED', 'MID', 'BIG']);
    expect(rows.every((r) => r.saving === null)).toBe(true);
  });

  it('có xem trước thì xếp theo số máy chủ báo, hoà thì hạn sớm trước', () => {
    const a = c('LATE', { endAt: iso(NOW + 20 * D) });
    const b = c('SOON', { endAt: iso(NOW + 2 * D) });
    const big = c('BIGGER');
    const rows = pickerRows([a, b, big], ctx({ previews: previewMap(preview('LATE', { discount: 30_000 }), preview('SOON', { discount: 30_000 }), preview('BIGGER', { discount: 45_000 })) }));
    expect(rows.map((r) => r.coupon.code)).toEqual(['BIGGER', 'SOON', 'LATE']);
  });

  it('mảng vào không bị đổi', () => {
    const copy = [...coupons];
    pickerRows(coupons, ctx());
    expect(coupons).toEqual(copy);
  });
});

describe('pickerRows: nhãn nút, lý do, mức giảm', () => {
  it('mỗi nhóm một nhãn và một tên đọc có mã', () => {
    const rows = pickerRows(
      [c('OK'), c('APPLIED'), c('SHORT', { minOrder: 199_000 }), c('SHIP', { type: 'FREESHIP', value: 0 })],
      ctx({ currentCode: 'APPLIED', shippingFee: 0 }),
    );
    expect(byCode(rows, 'OK')).toMatchObject({ action: 'use', label: 'Dùng', ariaLabel: 'Dùng mã OK' });
    expect(byCode(rows, 'APPLIED')).toMatchObject({ action: 'remove', label: 'Bỏ chọn', ariaLabel: 'Bỏ chọn mã APPLIED', applied: true });
    expect(byCode(rows, 'SHORT')).toMatchObject({ action: 'short', label: 'Chưa đủ', ariaLabel: 'Chưa đủ điều kiện dùng mã SHORT' });
    expect(byCode(rows, 'SHIP')).toMatchObject({ action: 'blocked', label: 'Không áp dụng', ariaLabel: 'Không áp dụng mã SHIP' });
  });

  it('view.state: ineligible cho chưa đủ và không áp dụng, saved cho còn lại', () => {
    const rows = pickerRows([c('OK'), c('SHORT', { minOrder: 199_000 })], ctx());
    expect(byCode(rows, 'OK').view.state).toBe('saved');
    expect(byCode(rows, 'SHORT').view.state).toBe('ineligible');
  });

  it('chưa đủ tiền hàng: lý do "Mua thêm 49k để dùng"; máy chủ chặn bằng câu đơn tối thiểu thì câu đó không hiện lại', () => {
    const coupon = c('SHORT', { minOrder: 199_000 });
    const withServer = pickerRows([coupon], ctx({ previews: previewMap(preview('SHORT', { eligible: false, reason: MIN_SENTENCE })) }));
    expect(withServer[0]).toMatchObject({ group: 'short', reason: 'Mua thêm 49k để dùng' });
    expect(withServer[0]!.reason).not.toContain('Đơn tối thiểu');
    expect(pickerRows([coupon], ctx())[0]).toMatchObject({ group: 'short', reason: 'Mua thêm 49k để dùng' });
  });

  it('máy chủ chặn câu đơn tối thiểu dù tiền hàng đủ (hàng Giờ vàng không tính): giữ câu máy chủ, bỏ dòng điều kiện trùng', () => {
    const row = pickerRows([c('GV', { minOrder: 199_000 })], ctx({ subtotal: 250_000, previews: previewMap(preview('GV', { eligible: false, reason: MIN_SENTENCE })) }))[0]!;
    expect(row).toMatchObject({ group: 'blocked', reason: MIN_SENTENCE });
    expect(row.view.condition).toBe('');
  });

  it('máy chủ chặn vì lý do khác: giữ nguyên câu, điều kiện vẫn hiện một lần', () => {
    const row = pickerRows([c('NEW', { minOrder: 100_000 })], ctx({ previews: previewMap(preview('NEW', { eligible: false, reason: 'Mã chỉ dành cho đơn đầu tiên.' })) }))[0]!;
    expect(row).toMatchObject({ group: 'blocked', reason: 'Mã chỉ dành cho đơn đầu tiên.' });
    expect(row.view.condition).toBe('Đơn từ 100k');
  });

  it('đơn tối thiểu 0 hoặc null: không có dòng điều kiện', () => {
    const rows = pickerRows([c('ZERO', { minOrder: 0 }), c('NULL', { minOrder: null })], ctx());
    expect(byCode(rows, 'ZERO').view.condition).toBe('');
    expect(byCode(rows, 'NULL').view.condition).toBe('');
    expect(byCode(rows, 'ZERO').group).toBe('usable');
  });

  it('mức giảm chỉ từ xem trước của máy chủ; freeship ghi số phí được miễn', () => {
    const rows = pickerRows(
      [c('GIAM'), c('SHIP', { type: 'FREESHIP', value: 0 }), c('NONE')],
      ctx({ previews: previewMap(preview('GIAM', { discount: 30_000 }), preview('SHIP', { freeshipSaving: 25_000 }), preview('NONE')) }),
    );
    expect(byCode(rows, 'GIAM').saving).toBe('Giảm 30.000đ cho đơn này');
    expect(byCode(rows, 'SHIP').saving).toBe('Miễn phí giao hàng 25.000đ cho đơn này');
    expect(byCode(rows, 'NONE').saving).toBeNull();
  });

  it('mã đang áp không bao giờ bị khoá dù xem trước báo không giảm được', () => {
    const row = pickerRows([c('APPLIED')], ctx({ currentCode: 'APPLIED', previews: previewMap(preview('APPLIED', { eligible: false, reason: 'x' })) }))[0]!;
    expect(row).toMatchObject({ group: 'applied', action: 'remove' });
  });

  it('freeship khi phí giao đã 0 (chưa có xem trước): không áp dụng, nói đơn đã miễn phí giao hàng; còn phí thì dùng được', () => {
    const ship = c('SHIP', { type: 'FREESHIP', value: 0 });
    expect(pickerRows([ship], ctx({ shippingFee: 0 }))[0]).toMatchObject({ group: 'blocked', reason: 'Đơn này đã miễn phí giao hàng' });
    expect(pickerRows([ship], ctx({ shippingFee: 30_000 }))[0]).toMatchObject({ group: 'usable', reason: null });
    expect(pickerRows([ship], ctx({ shippingFee: null }))[0]!.group).toBe('usable');
  });

  it('mã gắn sản phẩm khác với món đang mua: không áp dụng, lý do nêu tên sản phẩm; đúng sản phẩm thì tên nằm ở dòng điều kiện', () => {
    const scoped = c('GBUY', { minOrder: 99_000, products: [{ id: 'p1', name: 'Hạt chia' }] });
    expect(pickerRows([scoped], ctx({ productIds: ['p2'] }))[0]).toMatchObject({ group: 'blocked', reason: 'Chỉ áp cho Hạt chia' });
    const ok = pickerRows([scoped], ctx({ productIds: ['p1', 'p2'] }))[0]!;
    expect(ok.group).toBe('usable');
    expect(ok.view.condition).toBe('Đơn từ 99k · Chỉ áp cho Hạt chia');
    expect(pickerRows([scoped], ctx())[0]!.group).toBe('usable');
  });

  it('có xem trước thì tin máy chủ: đủ điều kiện dù tiền hàng ở máy thấp hơn đơn tối thiểu', () => {
    const row = pickerRows([c('OK', { minOrder: 500_000 })], ctx({ previews: previewMap(preview('OK', { discount: 20_000 })) }))[0]!;
    expect(row.group).toBe('usable');
  });

  it('mã tự cấp: displayCode thay chữ mã hiện cho khách, coupon.code giữ nguyên để áp đúng mã', () => {
    const raw = 'MILESTONE1000000-2026-10-CMV9MLSLB009KFKRUMVZQLRA7';
    const row = pickerRows([c(raw)], ctx({ displayCode: (code) => (code.startsWith('MILESTONE') ? 'Quà mốc chi tiêu 1 triệu' : null) }))[0]!;
    expect(row.view.code).toBe('Quà mốc chi tiêu 1 triệu');
    expect(row.coupon.code).toBe(raw);
    expect(row.ariaLabel).toBe('Dùng mã Quà mốc chi tiêu 1 triệu');
  });

  it('chữ hạn của phiếu dùng expiryText (có năm khi khác năm, lùi một ngày khi hạn đúng 00:00 VN)', () => {
    const rows = pickerRows([c('NYE', { endAt: '2026-12-31T17:00:00Z' }), c('FAR', { endAt: '2027-03-10T10:00:00Z' })], ctx());
    expect(byCode(rows, 'NYE').view.expiry).toBe('Dùng đến 31/12');
    expect(byCode(rows, 'FAR').view.expiry).toBe('Dùng đến 10/03/2027');
  });
});

describe('offerRows: sheet Ưu đãi ở trang sản phẩm', () => {
  const wallet = [
    c('XANH10', { type: 'PERCENT', value: 10, minOrder: 250_000, maxDiscount: 30_000 }),
    c('FREESHIP', { type: 'FREESHIP', value: 0, minOrder: 99_000 }),
    c('GIAM20K', { value: 20_000 }),
  ];

  it('mã đủ điều kiện cho món trước (giảm tiền trước freeship), mã chưa đủ sau kèm "Mua thêm … để dùng"', () => {
    const rows = offerRows(wallet, { amount: 120_000, now: NOW });
    expect(rows.map((r) => r.coupon.code)).toEqual(['GIAM20K', 'FREESHIP', 'XANH10']);
    expect(rows.map((r) => r.reason)).toEqual([null, null, 'Mua thêm 130k để dùng']);
    expect(rows.every((r) => r.view.state === 'saved')).toBe(true);
  });

  it('món đắt hơn: mã phần trăm lên đầu theo mức giảm thật (có trần)', () => {
    const rows = offerRows(wallet, { amount: 400_000, now: NOW });
    expect(rows.map((r) => r.coupon.code)).toEqual(['XANH10', 'GIAM20K', 'FREESHIP']);
    expect(rows.every((r) => r.reason === null)).toBe(true);
  });

  it('mã tự cấp hiện tên thân thiện qua displayCode, không lộ mã thô kèm id khách; mã thường giữ mã', () => {
    const raw = 'WELCOME-CMV9MLSLB009KFKRUMVZQLRA7';
    const rows = offerRows([c(raw), c('GIAM20K', { value: 20_000 })], {
      amount: 400_000,
      now: NOW,
      displayCode: (code) => (code === raw ? 'Quà chào mừng' : null),
    });
    expect(rows.map((r) => r.view.code)).toEqual(['Quà chào mừng', 'GIAM20K']);
    expect(rows.map((r) => r.coupon.code)).toEqual([raw, 'GIAM20K']);
  });

  it('nhiều mã chưa đủ: thiếu ít trước; hoà giảm thì hạn sớm trước', () => {
    const rows = offerRows(
      [c('FAR', { minOrder: 900_000 }), c('NEAR', { minOrder: 150_000 }), c('A', { endAt: iso(NOW + 9 * D) }), c('B', { endAt: iso(NOW + 3 * D) })],
      { amount: 100_000, now: NOW },
    );
    expect(rows.map((r) => r.coupon.code)).toEqual(['B', 'A', 'NEAR', 'FAR']);
  });
});
