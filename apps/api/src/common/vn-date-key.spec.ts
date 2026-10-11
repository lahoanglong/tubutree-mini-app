import { vnDateKey } from './vn-time';

// Bảy nơi từng chép tay công thức này (loyalty, game-gift, game-quiz, game-economy, subscriptions,
// staff/shifts, game.service) đều cho đúng các kết quả dưới đây trên bản chép tay cũ trước khi gom.
const CASES: Array<[string, string]> = [
  ['2026-03-09T16:59:59.999Z', '2026-03-09'],
  ['2026-03-09T17:00:00.000Z', '2026-03-10'],
  ['2026-10-10T00:00:00.000Z', '2026-10-10'],
  ['2026-12-31T16:59:59.999Z', '2026-12-31'],
  ['2026-12-31T17:00:00.000Z', '2027-01-01'],
  ['2028-02-28T17:00:00.000Z', '2028-02-29'],
  ['2027-02-28T17:00:00.000Z', '2027-03-01'],
  ['1970-01-01T00:00:00.000Z', '1970-01-01'],
];

describe('vnDateKey (YYYY-MM-DD theo giờ VN)', () => {
  it.each(CASES)('%s → %s', (iso, expected) => {
    expect(vnDateKey(new Date(iso))).toBe(expected);
  });

  it('bỏ tham số → ngày hiện tại theo giờ VN', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-10T18:30:00Z'));
    try {
      expect(vnDateKey()).toBe('2026-10-11');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Date không hợp lệ ném RangeError (giữ như các bản cũ)', () => {
    expect(() => vnDateKey(new Date('invalid'))).toThrow(RangeError);
  });
});
