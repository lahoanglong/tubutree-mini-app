import { describe, expect, it } from 'vitest';
import { mergeLocalRhythmDays, parseLocalRhythmDays, vnDayKey, weekRhythm, weekRhythmCopy, RHYTHM_KEEP_DAYS } from './game-week-rhythm';

// Tuần 09/11 (Thứ 2) đến 15/11/2026 (Chủ nhật); 11/11 là Thứ 4.
const WED_10H = new Date('2026-11-11T03:00:00Z');
const states = (r: ReturnType<typeof weekRhythm>) => r.cells.map((c) => c.state);

describe('vnDayKey', () => {
  it('đổi ngày theo giờ VN, không theo UTC', () => {
    expect(vnDayKey(new Date('2026-11-10T17:30:00Z'))).toBe('2026-11-11');
    expect(vnDayKey(new Date('2026-11-10T16:59:00Z'))).toBe('2026-11-10');
  });
});

describe('weekRhythm', () => {
  const base = { now: WED_10H, streakDays: undefined, lastCheckInAt: null, todayDone: false, localDays: [] as string[] };

  it('bảy ô từ Thứ 2 đến Chủ nhật, hôm nay chưa chăm vườn thì mở, ngày sau là chưa tới', () => {
    const r = weekRhythm(base);
    expect(r.cells.map((c) => c.label)).toEqual(['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']);
    expect(r.cells[0]!.key).toBe('2026-11-09');
    expect(r.cells[6]!.key).toBe('2026-11-15');
    expect(states(r)).toEqual(['missed', 'missed', 'today-open', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(r.cells.filter((c) => c.today).map((c) => c.label)).toEqual(['T4']);
    expect(r.doneCount).toBe(0);
  });

  it('chuỗi điểm danh kết thúc hôm qua phủ các ngày trước đó trong tuần', () => {
    const r = weekRhythm({ ...base, streakDays: 2, lastCheckInAt: '2026-11-10T08:00:00+07:00' });
    expect(states(r).slice(0, 3)).toEqual(['done', 'done', 'today-open']);
    expect(r.doneCount).toBe(2);
  });

  it('chuỗi kết thúc hôm nay tính cả hôm nay; hôm nay xong thì ô hôm nay thành done', () => {
    const r = weekRhythm({ ...base, streakDays: 3, lastCheckInAt: '2026-11-11T09:00:00+07:00', todayDone: true });
    expect(states(r).slice(0, 3)).toEqual(['done', 'done', 'done']);
    expect(r.doneCount).toBe(3);
  });

  it('chuỗi cũ hơn hôm qua đã đứt: không phủ ngày nào', () => {
    const r = weekRhythm({ ...base, streakDays: 5, lastCheckInAt: '2026-11-09T08:00:00+07:00' });
    expect(states(r).slice(0, 3)).toEqual(['missed', 'missed', 'today-open']);
  });

  it('chuỗi dài hơn tuần chỉ phủ phần nằm trong tuần này', () => {
    const r = weekRhythm({ ...base, streakDays: 30, lastCheckInAt: '2026-11-10T08:00:00+07:00' });
    expect(states(r).slice(0, 3)).toEqual(['done', 'done', 'today-open']);
    expect(states(r).slice(3)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('ngày chỉ chơi mini game (ghi trên máy) cũng tính là đã chăm vườn', () => {
    const r = weekRhythm({ ...base, localDays: ['2026-11-09'] });
    expect(states(r).slice(0, 3)).toEqual(['done', 'missed', 'today-open']);
  });

  it('ngày ghi trên máy ở tương lai không làm ô chưa tới thành done', () => {
    expect(states(weekRhythm({ ...base, localDays: ['2026-11-13'] }))[4]).toBe('upcoming');
  });

  it('qua nửa đêm giờ VN thì đổi sang ngày mới dù UTC chưa đổi', () => {
    const r = weekRhythm({ ...base, now: new Date('2026-11-10T17:30:00Z') });
    expect(r.cells.find((c) => c.today)!.key).toBe('2026-11-11');
  });

  it('Chủ nhật là ô cuối của tuần, Thứ 2 là ô đầu', () => {
    const sun = weekRhythm({ ...base, now: new Date('2026-11-15T05:00:00Z'), todayDone: true });
    expect(sun.cells[0]!.key).toBe('2026-11-09');
    expect(sun.cells[6]!.today).toBe(true);
    expect(sun.cells[6]!.state).toBe('done');
    const mon = weekRhythm({ ...base, now: new Date('2026-11-08T20:00:00Z') });
    expect(mon.cells[0]!.today).toBe(true);
    expect(mon.cells[0]!.key).toBe('2026-11-09');
  });

  it('mỗi ô có câu đọc cho trình đọc màn hình gồm thứ và trạng thái', () => {
    const r = weekRhythm({ ...base, streakDays: 1, lastCheckInAt: '2026-11-10T08:00:00+07:00' });
    expect(r.cells[1]!.aria).toBe('Thứ Ba: đã chăm vườn');
    expect(r.cells[2]!.aria).toBe('Thứ Tư: hôm nay chưa chăm vườn');
    expect(r.cells[5]!.aria).toBe('Thứ Bảy: chưa tới');
    expect(weekRhythm({ ...base, todayDone: true }).cells[2]!.aria).toBe('Hôm nay (Thứ Tư): đã chăm vườn');
  });
});

describe('ghi nhớ ngày trên máy', () => {
  it('đọc giá trị hỏng, sai kiểu hay vắng đều cho mảng rỗng', () => {
    expect(parseLocalRhythmDays(null)).toEqual([]);
    expect(parseLocalRhythmDays('')).toEqual([]);
    expect(parseLocalRhythmDays('{oops')).toEqual([]);
    expect(parseLocalRhythmDays('{"a":1}')).toEqual([]);
    expect(parseLocalRhythmDays('["2026-11-10", 5, "hôm qua", "2026-13-45"]')).toEqual(['2026-11-10']);
  });

  it('ghi thêm hôm nay khi đã chăm vườn, bỏ trùng và sắp tăng dần', () => {
    expect(mergeLocalRhythmDays(['2026-11-10', '2026-11-11'], WED_10H, true)).toEqual(['2026-11-10', '2026-11-11']);
    expect(mergeLocalRhythmDays(['2026-11-10'], WED_10H, true)).toEqual(['2026-11-10', '2026-11-11']);
    expect(mergeLocalRhythmDays(['2026-11-10'], WED_10H, false)).toEqual(['2026-11-10']);
  });

  it(`bỏ ngày quá ${RHYTHM_KEEP_DAYS} ngày và ngày ở tương lai (đồng hồ máy lệch)`, () => {
    expect(mergeLocalRhythmDays(['2026-10-01', '2026-11-10', '2026-12-25'], WED_10H, false)).toEqual(['2026-11-10']);
  });
});

describe('chữ của dải', () => {
  it('tiêu đề và đếm đủ ngắn để vừa một dòng ở 375px', () => {
    expect(weekRhythmCopy.title.length).toBeLessThanOrEqual(24);
    expect(weekRhythmCopy.count(7)).toBe('7/7');
    expect(weekRhythmCopy.labels.every((l) => l.length <= 2)).toBe(true);
    expect(weekRhythmCopy.labels).toHaveLength(7);
    expect(weekRhythmCopy.names).toHaveLength(7);
  });
});
