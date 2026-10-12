import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './format-date';

// PC-9: ngày hiển thị cho khách là dd/MM/yyyy. toLocaleDateString('vi-VN') trả "1/9/2026" (không đệm số 0) hoặc dáng
// khác theo phiên bản ICU của trình duyệt/Node, và theo múi giờ máy; tự ghép theo giờ Việt Nam (UTC+7, không có giờ mùa hè).
describe('formatDate (dd/MM/yyyy, giờ Việt Nam)', () => {
  it('đệm số 0 cho ngày và tháng', () => {
    expect(formatDate('2026-09-01T03:00:00.000Z')).toBe('01/09/2026');
    expect(formatDate('2026-10-12T03:00:00.000Z')).toBe('12/10/2026');
  });

  it('tính theo giờ Việt Nam: 18:00 UTC đã sang ngày hôm sau, 16:59 UTC thì chưa', () => {
    expect(formatDate('2026-12-31T17:00:00.000Z')).toBe('01/01/2027');
    expect(formatDate('2026-12-31T16:59:59.999Z')).toBe('31/12/2026');
  });

  it('nhận Date và số mili giây', () => {
    expect(formatDate(new Date('2026-03-05T00:00:00.000Z'))).toBe('05/03/2026');
    expect(formatDate(Date.UTC(2026, 2, 5, 0, 0, 0))).toBe('05/03/2026');
  });

  it.each([null, undefined, '', 'không phải ngày', NaN])('giá trị hỏng %j thành "—", không phải "Invalid Date"', (v) => {
    expect(formatDate(v as never)).toBe('—');
  });
});

describe('formatDateTime (HH:mm dd/MM/yyyy, giờ Việt Nam)', () => {
  it('giờ trước ngày, bỏ giây, đệm số 0', () => {
    expect(formatDateTime('2026-10-01T03:04:59.000Z')).toBe('10:04 01/10/2026');
    expect(formatDateTime('2026-10-01T17:30:00.000Z')).toBe('00:30 02/10/2026');
  });

  it('hỏng thì "—"', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('x')).toBe('—');
  });
});
