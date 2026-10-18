import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { dayMonth, isOpenNow } from './waste-labels';

/** vitest-global-setup.ts ghim TZ=Asia/Ho_Chi_Minh; file này đổi máy sang UTC để chứng minh hai hàm tính theo giờ VN từ mốc thời gian (spec 16.1, 17.3). */
describe('waste-labels không phụ thuộc múi giờ máy', () => {
  let saved: string | undefined;
  beforeAll(() => { saved = process.env.TZ; process.env.TZ = 'UTC'; });
  afterAll(() => { process.env.TZ = saved; });

  it('máy đã chạy ở UTC', () => {
    const d = new Date('2026-10-24T17:30:00Z');
    expect(d.getHours()).toBe(d.getUTCHours());
  });
  it('ngày theo giờ VN: 17:30Z ngày 24 là 00:30 ngày 25 ở VN', () => {
    expect(dayMonth('2026-10-24T17:30:00Z')).toBe('25/10');
  });
  it('giờ mở cửa theo giờ VN', () => {
    const hours = { MON: [{ open: '08:00', close: '18:00' }] };
    expect(isOpenNow(hours, new Date('2026-10-19T02:00:00Z'))).toBe(true); // Thứ Hai 09:00 VN, 02:00 UTC
    expect(isOpenNow(hours, new Date('2026-10-19T12:00:00Z'))).toBe(false); // Thứ Hai 19:00 VN, 12:00 UTC
  });
});
