import { parseConsignmentSettleFrom } from './merchant-config';

describe('parseConsignmentSettleFrom — mốc bắt đầu đối soát giao hộ (Q8 review S6)', () => {
  it('nhận thời điểm ISO 8601 hợp lệ; không ghi múi giờ thì hiểu là UTC', () => {
    expect(parseConsignmentSettleFrom('2026-10-14T00:00:00Z')).toEqual(new Date('2026-10-14T00:00:00Z'));
    expect(parseConsignmentSettleFrom('2026-10-14T07:30:00+07:00')).toEqual(new Date('2026-10-14T00:30:00Z'));
    expect(parseConsignmentSettleFrom('2026-10-14T00:00:00.250Z')).toEqual(new Date('2026-10-14T00:00:00.250Z'));
    expect(parseConsignmentSettleFrom('2026-10-14')).toEqual(new Date('2026-10-14T00:00:00Z'));
    expect(parseConsignmentSettleFrom('2026-10-14T08:00')).toEqual(new Date('2026-10-14T08:00:00Z'));
    expect(parseConsignmentSettleFrom('2024-02-29')).toEqual(new Date('2024-02-29T00:00:00Z'));
  });

  it('ngày giờ không có thật, sai dạng hoặc không phải chuỗi → null (không giới hạn), không ném lỗi', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2025-02-29', '2026-10-14T25:00:00Z', '2026-10-14T23:60:00Z', '2026-10-14T00:00:00+25:00', '14/10/2026', 'abc', '', ' 2026-10-14']) {
      expect([bad, parseConsignmentSettleFrom(bad)]).toEqual([bad, null]);
    }
    for (const bad of [null, undefined, 20261014, {}, ['2026-10-14']]) expect(parseConsignmentSettleFrom(bad)).toBeNull();
  });
});
