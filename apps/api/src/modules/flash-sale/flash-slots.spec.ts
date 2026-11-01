import { ACTIVE_FLASH_ORDER_BY } from './flash-active';
import {
  SLOT_ITEM_ORDER_BY,
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

describe('thứ tự suất', () => {
  it('SLOT_ITEM_ORDER_BY: sortOrder đứng đầu, rồi giá, rồi id ổn định', () => {
    expect(SLOT_ITEM_ORDER_BY).toEqual([{ sortOrder: 'asc' }, { flashPrice: 'asc' }, { variationId: 'asc' }, { id: 'asc' }]);
  });

  it('ACTIVE_FLASH_ORDER_BY cũng để sortOrder đứng đầu để Trang chủ và trang Giờ vàng cùng thứ tự', () => {
    expect(ACTIVE_FLASH_ORDER_BY[0]).toEqual({ sortOrder: 'asc' });
  });
});
