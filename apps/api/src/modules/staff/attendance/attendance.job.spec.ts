import { computeAutoClose } from './attendance.job';

const now = new Date('2026-07-03T05:00:00Z');

describe('computeAutoClose', () => {
  it('chưa hết ca → null (không cắt dù không có heartbeat — điện thoại cất túi)', () => {
    const r = computeAutoClose({ shift: { approvedEnd: null, endAt: new Date('2026-07-03T09:00:00Z') } }, now);
    expect(r).toBeNull();
  });

  it('đã quá giờ hết ca → SHIFT_END tại giờ hết ca', () => {
    const end = new Date('2026-07-03T04:00:00Z'); // ca hết lúc 04:00, now 05:00
    const r = computeAutoClose({ shift: { approvedEnd: null, endAt: end } }, now);
    expect(r).toEqual({ at: end, reason: 'SHIFT_END' });
  });

  it('ưu tiên approvedEnd nếu có', () => {
    const r = computeAutoClose(
      { shift: { approvedEnd: new Date('2026-07-03T04:30:00Z'), endAt: new Date('2026-07-03T09:00:00Z') } },
      now,
    );
    expect(r).toEqual({ at: new Date('2026-07-03T04:30:00Z'), reason: 'SHIFT_END' });
  });
});
