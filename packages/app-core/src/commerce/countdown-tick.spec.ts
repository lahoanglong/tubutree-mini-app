import { describe, expect, it } from 'vitest';
import { countdownClockParts, countdownDelay, countdownFrame } from './countdown-tick';

const H = 3_600_000;
const M = 60_000;

describe('countdownFrame', () => {
  it('còn 1 giây: chưa hết giờ, đồng hồ 00:01', () => {
    const f = countdownFrame(1000, 0);
    expect(f.ended).toBe(false);
    expect(f.clock).toBe('00:01');
  });

  it('đúng mốc hoặc quá mốc hoặc số rác: hết giờ, không chữ', () => {
    for (const end of [0, -5000, Number.NaN]) {
      const f = countdownFrame(end, 0);
      expect(f.ended, String(end)).toBe(true);
      expect(f.text).toBe('');
      expect(f.spoken).toBe('');
    }
    expect(countdownFrame(5000, 5000).ended).toBe(true);
  });

  it('2 giờ 5 phút 33 giây: ba dạng chữ và số phút', () => {
    const f = countdownFrame(7_533_000, 0);
    expect(f.clock).toBe('02:05:33');
    expect(f.text).toBe('2 giờ 05 phút');
    expect(f.spoken).toBe('2 giờ 5 phút');
    expect(f.minute).toBe(125);
    expect(f.ms).toBe(7_533_000);
  });
});

describe('countdownDelay', () => {
  it('clock: tới lần đổi giây kế tiếp', () => {
    expect(countdownDelay(2500, 'clock')).toBe(500);
    expect(countdownDelay(2000, 'clock')).toBe(1000);
  });

  it('text: tới lần đổi phút kế tiếp (phút làm tròn xuống)', () => {
    expect(countdownDelay(125_000, 'text')).toBe(5001);
    expect(countdownDelay(120_000, 'text')).toBe(1);
  });

  it('hết giờ hoặc số rác: không trả 0 hay NaN để timer không quay vòng', () => {
    for (const ms of [0, -1, Number.NaN]) {
      expect(countdownDelay(ms, 'clock')).toBe(1000);
      expect(countdownDelay(ms, 'text')).toBe(1000);
    }
  });
});

describe('countdownClockParts', () => {
  it('giờ, phút, giây thành ba ô', () => {
    expect(countdownClockParts(2 * H + 5 * M + 33_000)).toEqual({ prefix: null, cells: ['02', '05', '33'] });
  });

  it('dưới 1 giờ còn hai ô', () => {
    expect(countdownClockParts(5 * M + 33_000)).toEqual({ prefix: null, cells: ['05', '33'] });
  });

  it('từ 24 giờ có chữ ngày đứng trước hai ô giờ:phút', () => {
    expect(countdownClockParts(2 * 86_400_000 + 3 * H + 15 * M)).toEqual({ prefix: '2 ngày', cells: ['03', '15'] });
  });

  it('hết giờ: 00:00', () => {
    expect(countdownClockParts(0)).toEqual({ prefix: null, cells: ['00', '00'] });
  });
});
