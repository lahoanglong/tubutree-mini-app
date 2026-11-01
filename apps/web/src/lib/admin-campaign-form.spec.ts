import { describe, expect, it } from 'vitest';
import { formatVnRange, isoToVnLocal, parseCouponCodes, vnLocalToIso } from './admin-campaign-form';

describe('mốc giờ chiến dịch theo giờ Việt Nam', () => {
  it('nhập 01/11/2026 00:00 thì gửi 2026-10-31T17:00:00.000Z, bất kể múi giờ của máy admin', () => {
    expect(vnLocalToIso('2026-11-01T00:00')).toBe('2026-10-31T17:00:00.000Z');
    expect(vnLocalToIso('2026-11-10T23:45')).toBe('2026-11-10T16:45:00.000Z');
  });

  it('chuỗi thiếu hoặc sai dạng thì null (không đoán)', () => {
    expect(vnLocalToIso('')).toBeNull();
    expect(vnLocalToIso('2026-11-01')).toBeNull();
    expect(vnLocalToIso('2026-13-01T00:00')).toBeNull();
    expect(vnLocalToIso('2026-02-31T00:00')).toBeNull();
  });

  it('đọc lại ISO của máy chủ thành giờ VN "yyyy-mm-ddTHH:mm" cho ô nhập, qua ngày đúng', () => {
    expect(isoToVnLocal('2026-10-31T17:00:00.000Z')).toBe('2026-11-01T00:00');
    expect(isoToVnLocal('2026-12-31T16:59:00.000Z')).toBe('2026-12-31T23:59');
    expect(isoToVnLocal('không phải ngày')).toBe('');
  });

  it('vòng đi vòng về giữ nguyên mốc', () => {
    const iso = '2026-11-05T09:15:00.000Z';
    expect(vnLocalToIso(isoToVnLocal(iso))).toBe(iso);
  });

  it('khoảng ngày hiển thị theo giờ VN: dd/MM/yyyy HH:mm → dd/MM/yyyy HH:mm', () => {
    expect(formatVnRange('2026-10-31T17:00:00.000Z', '2026-11-10T16:59:00.000Z')).toBe('01/11/2026 00:00 → 10/11/2026 23:59');
  });
});

describe('parseCouponCodes: ô nhập mã gắn kèm', () => {
  it('tách theo dấu phẩy, xuống dòng hay khoảng trắng; bỏ ô trống và mã trùng (không phân biệt hoa thường)', () => {
    expect(parseCouponCodes('THU10, thu10\nFREESHIP  XANH5,,')).toEqual(['THU10', 'FREESHIP', 'XANH5']);
  });
  it('rỗng thì không có mã', () => {
    expect(parseCouponCodes('  \n ')).toEqual([]);
  });
});
