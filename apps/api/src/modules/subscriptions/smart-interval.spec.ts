import { intervalCandidates, medianGapDays, nearestIntervalWeeks, SMART_INTERVAL_MAX_DAYS, SMART_INTERVAL_MIN_DAYS } from './smart-interval';
import { SUBSCRIPTION_INTERVAL_WEEKS } from './subscriptions.service';

const W = SUBSCRIPTION_INTERVAL_WEEKS;
/** 10:00 giờ VN của ngày thứ `n` tính từ 01/01/2026. */
const day = (n: number, hourVn = 10) => new Date(Date.UTC(2026, 0, 1 + n, hourVn - 7));

describe('medianGapDays', () => {
  it('một lần nhận (hoặc hai đơn cùng ngày VN) thì chưa có nhịp', () => {
    expect(medianGapDays([day(0)])).toBeNull();
    expect(medianGapDays([day(0, 8), day(0, 22)])).toBeNull();
  });

  it('trung vị khoảng cách, không phụ thuộc thứ tự', () => {
    expect(medianGapDays([day(60), day(0), day(30)])).toBe(30);
    expect(medianGapDays([day(0), day(20), day(60), day(130)])).toBe(40);
  });

  it('nửa đêm giờ VN tính theo ngày VN, không theo UTC', () => {
    expect(medianGapDays([new Date('2026-03-01T17:30:00Z'), new Date('2026-03-31T16:30:00Z')])).toBe(29);
  });
});

describe('nearestIntervalWeeks', () => {
  it.each([
    [30, 4],
    [28, 4],
    [55, 8],
    [42, 6],
    [70, 10],
    [35, 4],
    [49, 6],
  ])('%i ngày → %i tuần', (days, weeks) => {
    expect(nearestIntervalWeeks(days, W)).toBe(weeks);
  });

  it('ngoài khoảng tin được thì không gợi ý', () => {
    expect(nearestIntervalWeeks(SMART_INTERVAL_MIN_DAYS - 1, W)).toBeNull();
    expect(nearestIntervalWeeks(SMART_INTERVAL_MAX_DAYS + 1, W)).toBeNull();
    expect(nearestIntervalWeeks(Number.NaN, W)).toBeNull();
  });
});

describe('intervalCandidates', () => {
  it('chỉ phân loại có ≥ 2 lần nhận; lần nhận gần nhất đứng trước', () => {
    const out = intervalCandidates(
      [
        { variationId: 'once', deliveredAt: day(100) },
        { variationId: 'a', deliveredAt: day(0) },
        { variationId: 'a', deliveredAt: day(30) },
        { variationId: 'b', deliveredAt: day(10) },
        { variationId: 'b', deliveredAt: day(65) },
      ],
      W,
    );
    expect(out).toEqual([
      { variationId: 'b', intervalWeeks: 8, lastDeliveredAt: day(65) },
      { variationId: 'a', intervalWeeks: 4, lastDeliveredAt: day(30) },
    ]);
  });

  it('nhịp quá dày hoặc quá thưa bị bỏ', () => {
    expect(intervalCandidates([{ variationId: 'x', deliveredAt: day(0) }, { variationId: 'x', deliveredAt: day(7) }], W)).toEqual([]);
    expect(intervalCandidates([{ variationId: 'x', deliveredAt: day(0) }, { variationId: 'x', deliveredAt: day(200) }], W)).toEqual([]);
  });
});
