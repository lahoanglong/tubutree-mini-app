import { describe, expect, it } from 'vitest';
import { REWARD_TABS, lockedPointsNote, openingHoursText, pointAddress, rewardCardState } from './reward-rules';

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
