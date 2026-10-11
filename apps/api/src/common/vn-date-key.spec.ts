import { LoyaltyService } from '../modules/loyalty/loyalty.service';
import { GameGiftService } from '../modules/game/game-gift.service';
import { GameQuizService } from '../modules/game/game-quiz.service';
import { GameService } from '../modules/game/game.service';
import { GameEconomyService } from '../modules/game/game-economy.service';
import { SubscriptionsService } from '../modules/subscriptions/subscriptions.service';
import { vnDateKey as shiftsVnDateKey } from '../modules/staff/shifts/time.util';

type Fn = (d: Date) => string;

/**
 * Bảy nơi từng chép tay "YYYY-MM-DD theo giờ VN (UTC+7)". Cả bảy cho cùng kết quả trên mọi mốc dưới
 * đây (đo trên bản chép tay cũ trước khi gom), nên gom được về một hàm duy nhất mà không đổi hành vi.
 */
const call = (proto: object, name: string): Fn => (d) => (proto as Record<string, Fn>)[name]!.call({}, d);

const COPIES: Array<[string, Fn]> = [
  ['loyalty getVnDayKey', call(LoyaltyService.prototype, 'getVnDayKey')],
  ['game-gift dayKey', call(GameGiftService.prototype, 'dayKey')],
  ['game-quiz dayKey', call(GameQuizService.prototype, 'dayKey')],
  ['game dayKey', call(GameService.prototype, 'dayKey')],
  ['game-economy dayKey', call(GameEconomyService.prototype, 'dayKey')],
  ['subscriptions vnDateOf', call(SubscriptionsService.prototype, 'vnDateOf')],
  ['staff/shifts vnDateKey', shiftsVnDateKey],
];

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

describe('dayKey giờ VN (đặc tả hành vi từng bản chép tay)', () => {
  describe.each(COPIES)('%s', (_name, fn) => {
    it.each(CASES)('%s → %s', (iso, expected) => {
      expect(fn(new Date(iso))).toBe(expected);
    });

    it('Date không hợp lệ ném RangeError', () => {
      expect(() => fn(new Date('invalid'))).toThrow(RangeError);
    });
  });
});
