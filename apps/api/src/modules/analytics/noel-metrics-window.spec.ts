import { adventRequiredDays, adventSpan, dayKeysBetween, noelWindow, parseNoelDays, pct, round1, shiftDayKey, vnDayStart } from './noel-metrics-window';

describe('parseNoelDays', () => {
  it.each([
    ['1', 1],
    ['7', 7],
    ['14', 14],
    [14, 14],
  ])('nhận %p', (raw, want) => expect(parseNoelDays(raw)).toBe(want));

  it.each([undefined, null, '', 'abc', '30', '0', '-7', '7.5', {}, ['7']])('giá trị lạ %p về mặc định 7', (raw) => {
    expect(parseNoelDays(raw)).toBe(7);
  });
});

describe('shiftDayKey / dayKeysBetween', () => {
  it('qua tháng, qua năm và năm nhuận', () => {
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2027-01-01', -1)).toBe('2026-12-31');
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('liệt kê đủ hai đầu, tăng dần', () => {
    expect(dayKeysBetween('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(dayKeysBetween('2026-12-14', '2026-12-14')).toEqual(['2026-12-14']);
  });
});

describe('vnDayStart', () => {
  it('00:00 giờ VN là 17:00 UTC của ngày trước', () => {
    expect(vnDayStart('2026-12-14').toISOString()).toBe('2026-12-13T17:00:00.000Z');
  });
});

describe('noelWindow (giờ VN)', () => {
  it('lúc 23:59:59 giờ VN vẫn còn là ngày đó; 00:00:00 là ngày kế', () => {
    expect(noelWindow(new Date('2026-12-14T16:59:59.999Z'), 1).todayKey).toBe('2026-12-14');
    expect(noelWindow(new Date('2026-12-14T17:00:00.000Z'), 1).todayKey).toBe('2026-12-15');
  });

  it('7 ngày kết thúc hôm nay (đủ 7 khoá, cả hôm nay)', () => {
    const w = noelWindow(new Date('2026-12-20T03:00:00Z'), 7);
    expect(w.dayKeys).toEqual(['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18', '2026-12-19', '2026-12-20']);
    expect(w.fromKey).toBe('2026-12-14');
    expect(w.toKey).toBe('2026-12-20');
  });

  it('mốc UTC: bắt đầu 00:00 VN ngày đầu, kết thúc (loại trừ) 00:00 VN ngày mai', () => {
    const w = noelWindow(new Date('2026-12-20T03:00:00Z'), 7);
    expect(w.since.toISOString()).toBe('2026-12-13T17:00:00.000Z');
    expect(w.until.toISOString()).toBe('2026-12-20T17:00:00.000Z');
  });

  it('1 ngày: chỉ hôm nay; sự kiện 17:00 UTC của hôm qua UTC thuộc ngày VN kế tiếp', () => {
    const w = noelWindow(new Date('2026-12-20T02:00:00Z'), 1);
    expect(w.dayKeys).toEqual(['2026-12-20']);
    expect(w.since.toISOString()).toBe('2026-12-19T17:00:00.000Z');
    // Một sự kiện lúc 16:59:59Z ngày 19 là 23:59:59 ngày 19 VN: ngoài cửa sổ; 17:00:00Z là 00:00 ngày 20 VN: trong cửa sổ.
    expect(new Date('2026-12-19T16:59:59.999Z') < w.since).toBe(true);
    expect(new Date('2026-12-19T17:00:00.000Z') >= w.since).toBe(true);
  });

  it('khoảng trước đó liền kề, cùng số ngày, không chồng', () => {
    const w = noelWindow(new Date('2026-12-20T03:00:00Z'), 7);
    expect(w.prevFromKey).toBe('2026-12-07');
    expect(w.prevToKey).toBe('2026-12-13');
    expect(w.prevUntil.getTime()).toBe(w.since.getTime());
  });

  it('nhóm quay lại D+1 dừng ở hôm kia để ngày kế tiếp (hôm qua) đã đủ 24 giờ', () => {
    const w = noelWindow(new Date('2026-12-20T03:00:00Z'), 7);
    expect(w.cohortToKey).toBe('2026-12-18');
    expect(w.cohortFromKey).toBe('2026-12-12');
    // Hoạt động ngày kế tiếp của ngày cuối nhóm (19/12) nằm trước 00:00 VN hôm nay (20/12).
    expect(w.cohortUntil.toISOString()).toBe('2026-12-19T17:00:00.000Z');
    expect(w.cohortSince.toISOString()).toBe('2026-12-11T17:00:00.000Z');
  });

  it('qua năm mới: 1 ngày ở 2027-01-01', () => {
    const w = noelWindow(new Date('2026-12-31T17:30:00Z'), 1);
    expect(w.todayKey).toBe('2027-01-01');
    expect(w.cohortToKey).toBe('2026-12-30');
  });

  it('không phụ thuộc TZ máy chủ (so sánh theo ISO UTC)', () => {
    const old = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(noelWindow(new Date('2026-12-14T17:00:00Z'), 1).todayKey).toBe('2026-12-15');
    } finally {
      if (old === undefined) delete process.env.TZ;
      else process.env.TZ = old;
    }
  });
});

describe('adventSpan', () => {
  it('trước 14/12: chưa có ô nào tới ngày', () => {
    const a = adventSpan('2026-12-13');
    expect(a).toMatchObject({ year: 2026, phase: 'before', daysElapsed: 0 });
    expect(a.keys).toHaveLength(12);
    expect(a.keys[0]).toBe('2026-12-14');
    expect(a.keys[11]).toBe('2026-12-25');
  });

  it('14/12 là ô 1, 25/12 là ô 12', () => {
    expect(adventSpan('2026-12-14')).toMatchObject({ phase: 'during', daysElapsed: 1 });
    expect(adventSpan('2026-12-25')).toMatchObject({ phase: 'during', daysElapsed: 12 });
  });

  it('26/12 trở đi: đã qua, đủ 12 ô', () => {
    expect(adventSpan('2026-12-26')).toMatchObject({ phase: 'after', daysElapsed: 12 });
  });

  it('số ô phải mở đủ: trước và đúng ngày đầu là 0, đang chạy là tới hôm qua, sau 25/12 là 12', () => {
    expect(adventRequiredDays(adventSpan('2026-12-13'))).toBe(0);
    expect(adventRequiredDays(adventSpan('2026-12-14'))).toBe(0);
    expect(adventRequiredDays(adventSpan('2026-12-15'))).toBe(1);
    expect(adventRequiredDays(adventSpan('2026-12-25'))).toBe(11);
    expect(adventRequiredDays(adventSpan('2026-12-26'))).toBe(12);
  });

  it('tháng 1 vẫn thuộc mùa năm trước', () => {
    const a = adventSpan('2027-01-03');
    expect(a.year).toBe(2026);
    expect(a.phase).toBe('after');
  });
});

describe('pct / round1', () => {
  it('pct làm tròn 1 chữ số và null khi mẫu số 0', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(2, 3)).toBe(66.7);
    expect(pct(0, 5)).toBe(0);
    expect(pct(0, 0)).toBeNull();
  });

  it('round1 chịu null/NaN', () => {
    expect(round1(2.345)).toBe(2.3);
    expect(round1(null)).toBeNull();
    expect(round1(undefined)).toBeNull();
    expect(round1(Number.NaN)).toBeNull();
  });
});
