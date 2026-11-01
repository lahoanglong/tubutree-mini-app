import { describe, expect, it } from 'vitest';
import { countdownClock, countdownSpoken, countdownText } from './countdown';

const H = 3_600_000;
const D = 86_400_000;

describe('countdownClock', () => {
  it('dưới 24 giờ hiện HH:MM:SS, dưới 1 giờ hiện MM:SS', () => {
    expect(countdownClock(7_533_000)).toBe('02:05:33');
    expect(countdownClock(333_000)).toBe('05:33');
    expect(countdownClock(H)).toBe('01:00:00');
    expect(countdownClock(H - 1000)).toBe('59:59');
  });
  it('từ 24 giờ hiện "N ngày HH:MM"', () => {
    expect(countdownClock(2 * D + 11_700_000)).toBe('2 ngày 03:15');
    expect(countdownClock(D)).toBe('1 ngày 00:00');
  });
  it('làm tròn LÊN giây: chưa hết giờ thì không hiện 00:00', () => {
    expect(countdownClock(500)).toBe('00:01');
  });
  it('sát ranh giới 24 giờ không tràn "00:60"', () => {
    expect(countdownClock(D - 500)).toBe('1 ngày 00:00');
    expect(countdownClock(D + 3_599_000)).toBe('1 ngày 00:59');
  });
  it('hết giờ, âm hoặc NaN thì "00:00", không ném lỗi', () => {
    for (const ms of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) expect(countdownClock(ms)).toBe('00:00');
  });
});

describe('countdownText', () => {
  it('giờ và phút, phút đệm hai chữ số', () => {
    expect(countdownText(7_500_000)).toBe('2 giờ 05 phút');
    expect(countdownText(H)).toBe('1 giờ 00 phút');
  });
  it('dưới 1 giờ chỉ phút; dưới 1 phút "dưới 1 phút"', () => {
    expect(countdownText(60_000)).toBe('1 phút');
    expect(countdownText(59_000)).toBe('dưới 1 phút');
    expect(countdownText(1)).toBe('dưới 1 phút');
  });
  it('từ 24 giờ "N ngày H giờ", tròn ngày bỏ phần giờ', () => {
    expect(countdownText(25 * H)).toBe('1 ngày 1 giờ');
    expect(countdownText(D)).toBe('1 ngày');
  });
  it('hết giờ, âm hoặc NaN thì rỗng', () => {
    for (const ms of [0, -1, Number.NaN]) expect(countdownText(ms)).toBe('');
  });
});

describe('countdownSpoken', () => {
  it('bản đọc không đệm số 0 và bỏ phần bằng 0', () => {
    expect(countdownSpoken(7_500_000)).toBe('2 giờ 5 phút');
    expect(countdownSpoken(2 * H)).toBe('2 giờ');
    expect(countdownSpoken(300_000)).toBe('5 phút');
    expect(countdownSpoken(30_000)).toBe('dưới 1 phút');
    expect(countdownSpoken(25 * H)).toBe('1 ngày 1 giờ');
  });
  it('hết giờ thì rỗng', () => {
    expect(countdownSpoken(0)).toBe('');
    expect(countdownSpoken(Number.NaN)).toBe('');
  });
});
