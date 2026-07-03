import { vnDateKey, weekStartVN, addDays, rangesOverlap, overlapMinutes } from './time.util';

describe('time.util', () => {
  it('vnDateKey theo giờ VN (UTC+7)', () => {
    // 2026-07-03T18:30:00Z = 2026-07-04 01:30 VN
    expect(vnDateKey(new Date('2026-07-03T18:30:00Z'))).toBe('2026-07-04');
    // 2026-07-03T02:00:00Z = 2026-07-03 09:00 VN
    expect(vnDateKey(new Date('2026-07-03T02:00:00Z'))).toBe('2026-07-03');
  });

  it('weekStartVN trả Thứ 2 00:00 VN (2026-07-03 là Thứ 6 → tuần bắt đầu 2026-06-29)', () => {
    const ws = weekStartVN(new Date('2026-07-03T10:00:00Z'));
    expect(vnDateKey(ws)).toBe('2026-06-29');
  });

  it('weekStartVN với Chủ nhật vẫn thuộc tuần bắt đầu Thứ 2 trước đó', () => {
    // 2026-07-05 là Chủ nhật → tuần bắt đầu 2026-06-29
    const ws = weekStartVN(new Date('2026-07-05T10:00:00Z'));
    expect(vnDateKey(ws)).toBe('2026-06-29');
  });

  it('addDays cộng ngày', () => {
    expect(vnDateKey(addDays(new Date('2026-06-29T00:00:00Z'), 7))).toBe('2026-07-06');
  });

  it('rangesOverlap: chồng nhau', () => {
    expect(
      rangesOverlap(
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T05:00:00Z'),
        new Date('2026-07-03T04:00:00Z'),
        new Date('2026-07-03T06:00:00Z'),
      ),
    ).toBe(true);
  });

  it('rangesOverlap: biên chạm (a.end == b.start) → không chồng', () => {
    expect(
      rangesOverlap(
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T04:00:00Z'),
        new Date('2026-07-03T04:00:00Z'),
        new Date('2026-07-03T06:00:00Z'),
      ),
    ).toBe(false);
  });

  it('rangesOverlap: rời nhau → false', () => {
    expect(
      rangesOverlap(
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T02:00:00Z'),
        new Date('2026-07-03T05:00:00Z'),
        new Date('2026-07-03T06:00:00Z'),
      ),
    ).toBe(false);
  });

  it('overlapMinutes: session nằm trong cửa sổ ca', () => {
    expect(
      overlapMinutes(
        new Date('2026-07-03T01:10:00Z'),
        new Date('2026-07-03T03:00:00Z'),
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T05:00:00Z'),
      ),
    ).toBe(110);
  });

  it('overlapMinutes: cắt biên (checkin trước giờ ca chỉ tính từ giờ ca)', () => {
    expect(
      overlapMinutes(
        new Date('2026-07-03T00:30:00Z'),
        new Date('2026-07-03T02:00:00Z'),
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T05:00:00Z'),
      ),
    ).toBe(60);
  });

  it('overlapMinutes: rời nhau → 0', () => {
    expect(
      overlapMinutes(
        new Date('2026-07-03T06:00:00Z'),
        new Date('2026-07-03T07:00:00Z'),
        new Date('2026-07-03T01:00:00Z'),
        new Date('2026-07-03T05:00:00Z'),
      ),
    ).toBe(0);
  });
});
