import { describe, expect, it } from 'vitest';
import type { CouponPreviewDTO } from '@tubutree/shared-types';
import type { CouponDTO } from '../api/loyalty';
import { offerAmount, offerRows, pickerRows, type PickerContext } from './voucher-picker';

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

  it('chưa đủ tiền hàng: chưa có xem trước thì "Mua thêm 49k để dùng"; có xem trước thì chỉ câu của máy chủ, không tự đếm lại', () => {
    const coupon = c('SHORT', { minOrder: 199_000 });
    expect(pickerRows([coupon], ctx())[0]).toMatchObject({ group: 'short', reason: 'Mua thêm 49k để dùng' });
    const withServer = pickerRows([coupon], ctx({ previews: previewMap(preview('SHORT', { eligible: false, reason: MIN_SENTENCE })) }))[0]!;
    expect(withServer).toMatchObject({ group: 'short', action: 'short', label: 'Chưa đủ', reason: MIN_SENTENCE });
    expect(withServer.reason).not.toContain('Mua thêm');
    expect(withServer.view.condition).toBe('');
  });

  it('giỏ có món Giờ vàng: tiền hàng phía máy gồm cả món đó nhưng máy chủ không tính nó, nên không ghi số "Mua thêm" thấp hơn thật', () => {
    // Giờ vàng 300k + hàng thường 50k = subtotal 350k; máy chủ chỉ tính 50k nên đòi 400k hàng không Giờ vàng. Mua thêm 50k vẫn bị từ chối.
    const coupon = c('MIN400', { minOrder: 400_000 });
    const serverSentence = 'Đơn tối thiểu 400.000đ để dùng mã này.';
    const row = pickerRows([coupon], ctx({ subtotal: 350_000, previews: previewMap(preview('MIN400', { eligible: false, reason: serverSentence })) }))[0]!;
    expect(row).toMatchObject({ group: 'short', label: 'Chưa đủ', reason: serverSentence });
    expect(row.reason).not.toContain('Mua thêm');
  });

  it('máy chủ chặn câu đơn tối thiểu dù tạm tính đã đủ (máy chủ không tính hàng Giờ vàng, trừ combo): vẫn "Chưa đủ" nhưng nói đúng vì sao, bỏ dòng điều kiện trùng', () => {
    const row = pickerRows([c('GV', { minOrder: 199_000 })], ctx({ subtotal: 250_000, previews: previewMap(preview('GV', { eligible: false, reason: MIN_SENTENCE })) }))[0]!;
    expect(row).toMatchObject({ group: 'short', action: 'short', label: 'Chưa đủ', reason: 'Đơn tối thiểu 199k không tính hàng Giờ vàng và phần giảm combo' });
    expect(row.reason).not.toContain('để dùng mã này');
    expect(row.view.condition).toBe('');
  });

  it('biên của đơn tối thiểu: tạm tính đúng bằng ngưỡng đã "đủ" nên nói lý do Giờ vàng, thiếu một đồng thì giữ nguyên câu máy chủ', () => {
    const coupon = c('EDGE', { minOrder: 199_000 });
    const server = previewMap(preview('EDGE', { eligible: false, reason: MIN_SENTENCE }));
    expect(pickerRows([coupon], ctx({ subtotal: 199_000, previews: server }))[0]!.reason).toBe('Đơn tối thiểu 199k không tính hàng Giờ vàng và phần giảm combo');
    expect(pickerRows([coupon], ctx({ subtotal: 198_999, previews: server }))[0]!.reason).toBe(MIN_SENTENCE);
  });

  it('máy chủ chặn vì lý do khác: giữ nguyên câu, điều kiện vẫn hiện một lần', () => {
    const row = pickerRows([c('NEW', { minOrder: 100_000 })], ctx({ previews: previewMap(preview('NEW', { eligible: false, reason: 'Mã chỉ dành cho đơn đầu tiên.' })) }))[0]!;
    expect(row).toMatchObject({ group: 'blocked', reason: 'Mã chỉ dành cho đơn đầu tiên.' });
    expect(row.view.condition).toBe('Đơn từ 100k');
  });

  it('máy chủ chặn vì lý do khác dù giỏ dưới đơn tối thiểu: không bảo khách mua thêm, giữ câu máy chủ, nhãn "Không áp dụng"', () => {
    const coupon = c('WELCOME', { minOrder: 200_000 });
    for (const reason of ['Mã chỉ dành cho khách đặt đơn đầu tiên.', 'Mã không áp dụng cho sản phẩm trong giỏ.', 'Bạn đã dùng hết lượt cho mã này.']) {
      const row = pickerRows([coupon], ctx({ subtotal: 120_000, previews: previewMap(preview('WELCOME', { eligible: false, reason })) }))[0]!;
      expect(row).toMatchObject({ group: 'blocked', action: 'blocked', label: 'Không áp dụng', reason });
      expect(row.reason).not.toContain('Mua thêm');
    }
  });

  it('máy chủ không nêu lý do và giỏ dưới đơn tối thiểu: "Chưa đủ", không tự đếm "Mua thêm" (dòng điều kiện của phiếu đã ghi đơn tối thiểu)', () => {
    const row = pickerRows([c('SHORT', { minOrder: 200_000 })], ctx({ subtotal: 120_000, previews: previewMap(preview('SHORT', { eligible: false })) }))[0]!;
    expect(row).toMatchObject({ group: 'short', label: 'Chưa đủ', reason: null });
    expect(row.view.condition).toBe('Đơn từ 200k');
  });

  it('câu đơn tối thiểu của máy chủ chỉ bỏ dòng "Đơn từ …", mã gắn sản phẩm vẫn nói chỉ áp cho sản phẩm nào', () => {
    const scoped = c('GCHIA', { minOrder: 200_000, products: [{ id: 'p1', name: 'Hạt chia' }] });
    const row = pickerRows([scoped], ctx({ subtotal: 300_000, productIds: ['p1', 'p2'], previews: previewMap(preview('GCHIA', { eligible: false, reason: 'Đơn tối thiểu 200.000đ để dùng mã này.' })) }))[0]!;
    expect(row).toMatchObject({ group: 'short', reason: 'Đơn tối thiểu 200k không tính hàng Giờ vàng và phần giảm combo' });
    expect(row.view.condition).toBe('Chỉ áp cho Hạt chia');
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

  it('mã đang áp không rơi vào "hết hạn" theo đồng hồ máy: vẫn "applied", state saved để phiếu còn nút "Bỏ chọn"', () => {
    const expired = c('APPLIED', { endAt: iso(NOW - 60_000) });
    const row = pickerRows([expired], ctx({ currentCode: 'applied' }))[0]!;
    expect(row).toMatchObject({ group: 'applied', action: 'remove', label: 'Bỏ chọn' });
    expect(row.view.state).toBe('saved');
    // mã không áp thì vẫn là hết hạn
    expect(pickerRows([expired], ctx())[0]!.view.state).toBe('expired');
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

describe('offerRows: món đang Giờ vàng (số giảm = 0)', () => {
  const NOTHING = 'Không có sản phẩm nào trong đơn được giảm theo mã này';
  const wallet = [c('A20'), c('FREE', { type: 'FREESHIP', value: 0 }), c('MIN', { minOrder: 199_000 })];

  it('mã không đơn tối thiểu mà món không được giảm: không dùng được, kèm lý do máy chủ; freeship vẫn dùng được; mã có đơn tối thiểu vẫn "Mua thêm"', () => {
    const rows = offerRows(wallet, { amount: offerAmount(250_000, 1, true), now: NOW });
    expect(rows.map((r) => r.coupon.code)).toEqual(['FREE', 'MIN', 'A20']);
    expect(rows.map((r) => r.group)).toEqual(['usable', 'short', 'blocked']);
    const a20 = rows[2]!;
    expect(a20.reason).toBe(NOTHING);
    expect(a20.view.state).toBe('ineligible');
    expect(rows[0]).toMatchObject({ reason: null });
    expect(rows[0]!.view.state).toBe('saved');
    expect(rows[1]).toMatchObject({ reason: 'Mua thêm 199k để dùng' });
    expect(rows[1]!.view.state).toBe('saved');
  });

  it('món giá thường: mã không đơn tối thiểu vẫn dùng được, không lý do', () => {
    const rows = offerRows(wallet, { amount: 120_000, now: NOW });
    expect(rows.find((r) => r.coupon.code === 'A20')).toMatchObject({ group: 'usable', reason: null });
  });
});

describe('offerAmount: tiền hàng của món đang xem cho mã', () => {
  it('giá thường nhân số lượng; món đang Giờ vàng góp 0 vì máy chủ không tính dòng Giờ vàng vào tiền hàng áp mã', () => {
    expect(offerAmount(120_000, 2, false)).toBe(240_000);
    expect(offerAmount(90_000, 2, true)).toBe(0);
  });

  it('món Giờ vàng: mã có đơn tối thiểu hiện "Mua thêm" đủ số, không bảo là đã đủ', () => {
    const rows = offerRows([c('MIN', { minOrder: 199_000 })], { amount: offerAmount(250_000, 1, true), now: NOW });
    expect(rows[0]!.reason).toBe('Mua thêm 199k để dùng');
  });
});
