import { describe, expect, it } from 'vitest';
import {
  REWARD_TABS,
  WAREHOUSE_ONLY_LABEL,
  freeShipCovered,
  rewardFreeShipNote,
  isWarehousePickup,
  lockedPointsNote,
  openingHoursText,
  orderRewards,
  pointAddress,
  rewardCardState,
  warehouseConfirmText,
} from './reward-rules';

describe('REWARD_TABS', () => {
  it('ba tab theo loại quà, đúng thứ tự', () => {
    expect(REWARD_TABS.map((t) => t.label)).toEqual(['Mã giảm giá', 'Cây và hạt', 'Quà nhỏ']);
    expect(REWARD_TABS.map((t) => t.kinds)).toEqual([['VOUCHER'], ['TREE', 'SEED_PACK'], ['GIFT']]);
  });
});

describe('openingHoursText / pointAddress', () => {
  it('nhiều ngày, nhiều khung giờ; ngày không có giờ bị bỏ', () => {
    expect(
      openingHoursText({ MON: [{ open: '08:00', close: '12:00' }, { open: '13:00', close: '17:00' }], TUE: [{ open: '08:00', close: '17:00' }], WED: [] }),
    ).toBe('T2 08:00–12:00, 13:00–17:00 · T3 08:00–17:00');
  });
  it('địa chỉ điểm nhận ghép dòng, phường, tỉnh', () => {
    expect(pointAddress({ addressLine: '99 Nguyễn Văn Linh', communeName: 'Phường Tân Phong', provinceName: 'TP.HCM' })).toBe(
      '99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM',
    );
  });
});

describe('lockedPointsNote', () => {
  const ov = (o: object = {}) => ({ pointsBalance: 0, ...o });
  it('không có điểm khoá / API cũ không trả → null', () => {
    expect(lockedPointsNote(ov())).toBeNull();
    expect(lockedPointsNote(ov({ lockedPoints: 0 }))).toBeNull();
  });
  it('điểm đơn mới giao → số điểm và ngày mở theo giờ VN', () => {
    const note = lockedPointsNote(ov({ pointsBalance: 100, lockedPoints: 60, lockedReturnPoints: 0, lockedUntil: '2026-10-03T17:30:00.000Z', redeemablePoints: 40 }));
    expect(note).toContain('60 điểm từ đơn mới giao sẽ dùng được sau ngày 04/10/2026');
    expect(note).toContain('40');
  });
  it('số nghìn có dấu chấm phân cách', () => {
    const note = lockedPointsNote(ov({ pointsBalance: 5000, lockedPoints: 1250, lockedReturnPoints: 0, lockedUntil: '2026-10-03T17:30:00.000Z', redeemablePoints: 3750 }));
    expect(note).toContain('1.250 điểm từ đơn mới giao');
    expect(note).toContain('dùng được 3.750 điểm');
  });
  it('đơn đang chờ đổi/trả → không hứa ngày', () => {
    const note = lockedPointsNote(ov({ pointsBalance: 100, lockedPoints: 30, lockedReturnPoints: 30, lockedUntil: null, redeemablePoints: 70 }))!;
    expect(note).toContain('30 điểm từ đơn đang chờ xử lý đổi/trả');
    expect(note).not.toMatch(/sau ngày/);
  });
});

describe('rewardCardState (dùng số máy chủ trả)', () => {
  const c = { redeemablePoints: 14_000, pointsConvertedBalance: 40_000 };
  it.each([
    [{ kind: 'VOUCHER', pointsCost: 20_000, canRedeem: false, soldOut: true }, { kind: 'soldOut' }],
    [{ kind: 'VOUCHER', pointsCost: 10_000, canRedeem: true, soldOut: false }, { kind: 'redeem' }],
    [{ kind: 'VOUCHER', pointsCost: 20_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 6000 }],
    [{ kind: 'GIFT', pointsCost: 5_000_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 4_986_000 }],
    [{ kind: 'VOUCHER', pointsCost: 10_000, canRedeem: false, soldOut: false }, { kind: 'locked' }],
    [{ kind: 'TREE', pointsCost: 50_000, canRedeem: false, soldOut: false }, { kind: 'locked' }],
    [{ kind: 'TREE', pointsCost: 60_000, canRedeem: false, soldOut: false }, { kind: 'need', missing: 6000 }],
  ] as const)('%o → %o', (r, want) => {
    expect(rewardCardState(r, c)).toEqual(want);
  });
});

describe('quà miễn phí giao hàng và hạng đã có quyền lợi này (B-22)', () => {
  const freeship = (minOrder: number | null, sortOrder = 1) => ({
    kind: 'VOUCHER' as const,
    voucher: { type: 'FREESHIP' as const, value: 0, minOrder, maxDiscount: null, validDays: 30 },
    sortOrder,
  });
  const locBiec = { tierName: 'Lộc Biếc', freeFrom: 99_000 };

  it('ngưỡng hạng bằng hoặc thấp hơn ngưỡng của mã → thừa; cao hơn → không', () => {
    expect(freeShipCovered(freeship(99_000), locBiec)).toBe(true);
    expect(freeShipCovered(freeship(199_000), locBiec)).toBe(true);
    expect(freeShipCovered(freeship(49_000), locBiec)).toBe(false);
    expect(freeShipCovered(freeship(99_000), { tierName: 'Mầm Xanh', freeFrom: 199_000 })).toBe(false);
  });

  it('mã không đặt đơn tối thiểu: chỉ hạng freeship mọi đơn mới thừa', () => {
    expect(freeShipCovered(freeship(null), locBiec)).toBe(false);
    expect(freeShipCovered(freeship(null), { tierName: 'Đại Thụ', freeFrom: 0 })).toBe(true);
  });

  it('chỉ áp cho voucher FREESHIP; thiếu thông tin hạng (API cũ, chưa có hạng) thì không đụng tới quà', () => {
    expect(freeShipCovered({ kind: 'VOUCHER', voucher: { type: 'AMOUNT', value: 30_000, minOrder: null, maxDiscount: null, validDays: 30 } }, locBiec)).toBe(false);
    expect(freeShipCovered({ kind: 'GIFT', voucher: null }, locBiec)).toBe(false);
    expect(freeShipCovered(freeship(99_000), null)).toBe(false);
    expect(freeShipCovered(freeship(99_000), undefined)).toBe(false);
  });

  it('orderRewards: quà thừa xuống cuối, còn lại giữ thứ tự sortOrder', () => {
    const list = [{ id: 'a', ...freeship(99_000, 1) }, { id: 'b', ...freeship(49_000, 2) }, { id: 'c', kind: 'VOUCHER' as const, voucher: null, sortOrder: 3 }];
    expect(orderRewards(list, { tierFreeShip: locBiec }).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(orderRewards(list, {}).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('quà thừa với hạng vẫn đổi được (ngưỡng mã tính cả hàng đối tác); chỉ thêm ghi chú kèm ngưỡng hạng cho đơn Tubu', () => {
    const base = { pointsCost: 20_000, canRedeem: true, soldOut: false, ...freeship(99_000) };
    const c = { redeemablePoints: 50_000, pointsConvertedBalance: 0, tierFreeShip: locBiec };
    const money = (n: number) => `${n / 1000}k`;
    expect(rewardCardState(base, c)).toEqual({ kind: 'redeem' });
    expect(rewardCardState({ ...base, soldOut: true }, c)).toEqual({ kind: 'soldOut' });
    expect(rewardFreeShipNote(base, c, money)).toBe('Hạng Lộc Biếc đã được miễn phí giao hàng cho đơn Tubu từ 99k');
    expect(rewardFreeShipNote(base, { tierFreeShip: { tierName: 'Đại Thụ', freeFrom: 0 } }, money)).toBe('Hạng Đại Thụ đã được miễn phí giao hàng cho mọi đơn Tubu');
    expect(rewardFreeShipNote(base, { tierFreeShip: null }, money)).toBeNull();
    expect(rewardFreeShipNote({ ...base, voucher: { ...base.voucher!, minOrder: 49_000 } }, c, money)).toBeNull();
  });
});

describe('quà nhận tại kho (B-60)', () => {
  it('hạt giống và quà nhỏ nhận tại kho; mã giảm giá và cây góp quỹ thì không', () => {
    expect(isWarehousePickup({ kind: 'SEED_PACK' })).toBe(true);
    expect(isWarehousePickup({ kind: 'GIFT' })).toBe(true);
    expect(isWarehousePickup({ kind: 'VOUCHER' })).toBe(false);
    expect(isWarehousePickup({ kind: 'TREE' })).toBe(false);
    expect(WAREHOUSE_ONLY_LABEL).toBe('Chỉ nhận tại kho TP.HCM');
  });

  it('câu hỏi lại kèm địa chỉ kho từ cấu hình, không có thì nói chung', () => {
    const point = { name: 'Kho Tubu', addressLine: '99 Nguyễn Văn Linh', communeName: 'Phường Tân Phong', provinceName: 'TP.HCM' };
    expect(warehouseConfirmText(point)).toBe('Quà này chỉ nhận tại kho TP.HCM, không giao tận nhà: Kho Tubu, 99 Nguyễn Văn Linh, Phường Tân Phong, TP.HCM. Bạn vẫn muốn đổi?');
    expect(warehouseConfirmText(null)).toBe('Quà này chỉ nhận tại kho TP.HCM, không giao tận nhà: kho Tubu TP.HCM. Bạn vẫn muốn đổi?');
  });
});
