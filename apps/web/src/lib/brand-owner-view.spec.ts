import { describe, expect, it } from 'vitest';
import { promoDateRangeInvalid, promoPayload, promoToForm, ownerLoadError, ownerActionError, OWNER_FORBIDDEN, EMPTY_PROMO } from './brand-owner-view';

const NOW = Date.parse('2026-10-19T00:00:00Z');
const form = (o: Partial<typeof EMPTY_PROMO>) => ({ ...EMPTY_PROMO, title: 'KM', ...o });

describe('promoDateRangeInvalid', () => {
  it('không nhập ngày kết thúc thì hợp lệ', () => expect(promoDateRangeInvalid(form({}), NOW)).toBe(false));
  it('kết thúc trước bắt đầu là sai', () => expect(promoDateRangeInvalid(form({ startAt: '2026-11-10', endAt: '2026-11-01' }), NOW)).toBe(true));
  it('chỉ có ngày kết thúc đã qua là sai, còn ở tương lai là đúng', () => {
    expect(promoDateRangeInvalid(form({ endAt: '2026-10-01' }), NOW)).toBe(true);
    expect(promoDateRangeInvalid(form({ endAt: '2026-12-01' }), NOW)).toBe(false);
  });
});

describe('promoPayload', () => {
  it('cắt khoảng trắng, viết hoa mã, bỏ trường rỗng', () => {
    const p = promoPayload(form({ title: ' A ', couponCode: ' tubu20 ' }), NOW);
    expect(p).toMatchObject({ title: 'A', couponCode: 'TUBU20', subtitle: undefined });
  });
  it('kết thúc mặc định là bắt đầu + 30 ngày kể cả khi bắt đầu ở xa', () => {
    const p = promoPayload(form({ startAt: '2027-03-01' }), NOW);
    expect(Date.parse(p.endAt) - Date.parse(p.startAt)).toBe(30 * 864e5);
  });
});

describe('promoToForm', () => {
  it('đổi ISO về yyyy-mm-dd, null về chuỗi rỗng', () => {
    expect(promoToForm({ id: 'p', title: 'T', subtitle: null, couponCode: null, startAt: '2026-10-01T00:00:00.000Z', endAt: '2026-10-30T00:00:00.000Z', isActive: true })).toEqual({
      title: 'T', subtitle: '', couponCode: '', startAt: '2026-10-01', endAt: '2026-10-30',
    });
  });
});

describe('lỗi', () => {
  it('403 thành lời dễ hiểu, lỗi khác giữ thông báo', () => {
    const e403 = Object.assign(new Error('Forbidden resource'), { status: 403 });
    expect(ownerLoadError(e403)).toBe(OWNER_FORBIDDEN);
    expect(ownerActionError(e403)).toBe('Bạn không có quyền thực hiện thao tác này.');
    expect(ownerActionError(new Error('Mã sai'))).toBe('Mã sai');
    expect(ownerLoadError('x')).toBe('Có chút trục trặc, thử lại nhé');
  });
});
