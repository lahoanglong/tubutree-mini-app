import { describe, expect, it } from 'vitest';
import { fillCopy } from '../shop-copy';
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

/**
 * Thẻ Giờ vàng rộng 128px, trừ lề trong 8px mỗi bên còn 112px cho một dòng chữ 12px không xuống dòng (ProductTile cắt bằng dấu ba chấm; Inter 500 ≈ 5,9px/ký tự),
 * nên dòng "Sắp diễn ra" trên thẻ không được dài quá 18 ký tự với mọi dạng `countdownText` (23 giờ 59 phút, 99 ngày 23 giờ). jsdom không đo bề rộng nên giữ
 * trần ký tự ở đây; câu "Bắt đầu sau ..." dài 26 ký tự bị cắt thành "Bắt đầu sau 2 giờ 0…".
 */
describe('dòng "Sắp diễn ra" trên thẻ Giờ vàng vừa 112px', () => {
  const worst = [(23 * H) + 59 * 60_000, (99 * D) + 23 * H, 12 * H + 5 * 60_000 + 30_000, 3 * D + 12 * H, 59 * 60_000, 30_000];
  it.each(worst)('còn %s ms', (ms) => {
    const note = fillCopy('flash.startsInTile', { t: countdownText(ms) });
    expect(note.length).toBeLessThanOrEqual(18);
    expect(note).toMatch(/^Sau /);
  });
  it('ghi theo luật chữ, không "2h 05m"', () => {
    expect(fillCopy('flash.startsInTile', { t: countdownText(2 * H + 5 * 60_000 + 30_000) })).toBe('Sau 2 giờ 05 phút');
  });
});
