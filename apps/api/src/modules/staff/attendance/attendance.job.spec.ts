import { computeAutoClose } from './attendance.job';

const now = new Date('2026-07-03T05:00:00Z');

describe('computeAutoClose', () => {
  it('heartbeat cũ quá ngưỡng → STALE tại heartbeat cuối', () => {
    const hb = new Date('2026-07-03T04:40:00Z'); // 20' trước, stale 10'
    const r = computeAutoClose({ lastHeartbeatAt: hb, shift: { approvedEnd: null, endAt: new Date('2026-07-03T09:00:00Z') } }, now, 10);
    expect(r).toEqual({ at: hb, reason: 'STALE' });
  });

  it('heartbeat còn mới + chưa hết ca → null', () => {
    const hb = new Date('2026-07-03T04:57:00Z'); // 3' trước
    const r = computeAutoClose({ lastHeartbeatAt: hb, shift: { approvedEnd: null, endAt: new Date('2026-07-03T09:00:00Z') } }, now, 10);
    expect(r).toBeNull();
  });

  it('heartbeat mới nhưng đã quá giờ hết ca → SHIFT_END tại giờ hết ca', () => {
    const hb = new Date('2026-07-03T04:58:00Z');
    const end = new Date('2026-07-03T04:00:00Z'); // ca đã hết lúc 04:00
    const r = computeAutoClose({ lastHeartbeatAt: hb, shift: { approvedEnd: null, endAt: end } }, now, 10);
    expect(r).toEqual({ at: end, reason: 'SHIFT_END' });
  });

  it('dùng approvedEnd nếu có (ưu tiên hơn endAt)', () => {
    const hb = new Date('2026-07-03T04:58:00Z');
    const r = computeAutoClose(
      { lastHeartbeatAt: hb, shift: { approvedEnd: new Date('2026-07-03T04:30:00Z'), endAt: new Date('2026-07-03T09:00:00Z') } },
      now,
      10,
    );
    expect(r).toEqual({ at: new Date('2026-07-03T04:30:00Z'), reason: 'SHIFT_END' });
  });
});
