import { ACTIVE_FLASH_ORDER_BY } from './flash-active';
import {
  DEFAULT_SLOT_CLOCKS,
  FLASH_SLOT_MINUTES,
  SLOT_ITEM_ORDER_BY,
  parseSlotClocks,
  slotStartsFor,
  slotStatus,
  vnDayStart,
  vnHorizonEnd,
} from './flash-slots';

const at = (iso: string) => new Date(iso);

describe('slotStatus', () => {
  const slot = { startAt: at('2026-11-01T05:00:00Z'), endAt: at('2026-11-01T07:00:00Z') };

  it('chưa tới giờ là UPCOMING, đúng mốc bắt đầu là LIVE, đúng mốc kết thúc là ENDED', () => {
    expect(slotStatus(slot, at('2026-11-01T04:59:59Z'))).toBe('UPCOMING');
    expect(slotStatus(slot, at('2026-11-01T05:00:00Z'))).toBe('LIVE');
    expect(slotStatus(slot, at('2026-11-01T06:59:59Z'))).toBe('LIVE');
    expect(slotStatus(slot, at('2026-11-01T07:00:00Z'))).toBe('ENDED');
  });
});

describe('vnDayStart / vnHorizonEnd', () => {
  it('01:00 ngày 2 giờ VN thuộc ngày 2: 00:00 VN là 17:00Z hôm trước', () => {
    const now = at('2026-11-01T18:00:00Z');
    expect(vnDayStart(now).toISOString()).toBe('2026-11-01T17:00:00.000Z');
    expect(vnHorizonEnd(now).toISOString()).toBe('2026-11-03T17:00:00.000Z');
  });

  it('23:59 giờ VN vẫn thuộc ngày đó; 00:00 giờ VN sang ngày mới', () => {
    expect(vnDayStart(at('2026-11-01T16:59:59Z')).toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(vnDayStart(at('2026-11-01T17:00:00Z')).toISOString()).toBe('2026-11-01T17:00:00.000Z');
  });
});

describe('parseSlotClocks', () => {
  it('bỏ giá trị hỏng và trùng, sắp tăng dần', () => {
    expect(parseSlotClocks(['20:00', '12:00', '12:00', '25:99', 'x'])).toEqual(['12:00', '20:00']);
  });

  it('không phải mảng, mảng rỗng hoặc toàn giá trị hỏng thì về mặc định', () => {
    expect(parseSlotClocks(null)).toEqual([...DEFAULT_SLOT_CLOCKS]);
    expect(parseSlotClocks('12:00')).toEqual([...DEFAULT_SLOT_CLOCKS]);
    expect(parseSlotClocks([])).toEqual([...DEFAULT_SLOT_CLOCKS]);
    expect(parseSlotClocks(['abc', 7])).toEqual([...DEFAULT_SLOT_CLOCKS]);
  });

  it('chấp nhận 00:00 và 23:59, từ chối 24:00 và 9:00 thiếu số 0', () => {
    expect(parseSlotClocks(['23:59', '00:00'])).toEqual(['00:00', '23:59']);
    expect(parseSlotClocks(['24:00', '9:00', '08:00'])).toEqual(['08:00']);
  });
});

describe('slotStartsFor', () => {
  const clocks = ['12:00', '20:00'];

  it('hằng thời lượng là 120 phút', () => {
    expect(FLASH_SLOT_MINUTES).toBe(120);
  });

  it('13:00 giờ VN, hai khung, 2 ngày: 12:00 hôm nay còn chạy nên còn đủ 4 mốc', () => {
    const now = at('2026-11-01T06:00:00Z');
    expect(slotStartsFor(now, clocks, 2).map((d) => d.toISOString())).toEqual([
      '2026-11-01T05:00:00.000Z',
      '2026-11-01T13:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
    ]);
  });

  it('14:00 giờ VN: khung 12:00 hôm nay đã kết thúc nên bị bỏ, còn 3 mốc', () => {
    const now = at('2026-11-01T07:00:00Z');
    expect(slotStartsFor(now, clocks, 2).map((d) => d.toISOString())).toEqual([
      '2026-11-01T13:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
    ]);
  });

  it('days <= 0 không sinh mốc nào', () => {
    expect(slotStartsFor(at('2026-11-01T06:00:00Z'), clocks, 0)).toEqual([]);
  });
});

describe('thứ tự suất', () => {
  it('SLOT_ITEM_ORDER_BY: sortOrder đứng đầu, rồi giá, rồi id ổn định', () => {
    expect(SLOT_ITEM_ORDER_BY).toEqual([{ sortOrder: 'asc' }, { flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }]);
  });

  it('ACTIVE_FLASH_ORDER_BY cũng để sortOrder đứng đầu để Trang chủ và trang Giờ vàng cùng thứ tự', () => {
    expect(ACTIVE_FLASH_ORDER_BY[0]).toEqual({ sortOrder: 'asc' });
  });
});
