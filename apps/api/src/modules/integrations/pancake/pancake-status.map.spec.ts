import { resolvePancakeStatus } from './pancake-status.map';

const status = (s: string) => ({ kind: 'status', status: s });

/**
 * Bảng mã theo enum `status` của đơn hàng trong Pancake POS Open API (api-docs.pancake.vn, schema "Đơn hàng"/
 * "Webhook đơn hàng"): 0 Mới, 17 Chờ xác nhận, 11 Chờ hàng, 12 Chờ in, 13 Đã in, 20 Đã đặt hàng, 1 Đã xác nhận,
 * 8 Đang đóng hàng, 9 Chờ chuyển hàng, 2 Đã gửi hàng, 3 Đã nhận, 16 Đã thu tiền, 4 Đang hoàn, 15 Hoàn một phần,
 * 5 Đã hoàn, 6 Đã hủy, 7 Đã xóa.
 */
describe('resolvePancakeStatus — mã số Pancake POS', () => {
  it('"Đã gửi hàng" (2) là đang giao, KHÔNG phải đóng gói', () => {
    expect(resolvePancakeStatus(2)).toEqual(status('SHIPPING'));
  });

  it('"Đã nhận" (3) và "Đã thu tiền" (16) là đã giao — đơn trả trước thường dừng ở 3', () => {
    expect(resolvePancakeStatus(3)).toEqual(status('DELIVERED'));
    expect(resolvePancakeStatus('16')).toEqual(status('DELIVERED'));
  });

  it('các bước trong kho (Chờ in, Đã in, Đang đóng hàng, Chờ chuyển hàng) → đóng gói', () => {
    for (const code of [12, 13, 8, 9]) expect(resolvePancakeStatus(code)).toEqual(status('PACKED'));
  });

  it('"Đã xác nhận" (1) → CONFIRMED; "Đã hủy" (6) → CANCELLED', () => {
    expect(resolvePancakeStatus(1)).toEqual(status('CONFIRMED'));
    expect(resolvePancakeStatus(6)).toEqual(status('CANCELLED'));
  });

  it('"Đã hoàn" (5) → hàng đã về kho (processor quyết huỷ hay trả theo việc đã giao chưa)', () => {
    expect(resolvePancakeStatus(5)).toEqual({ kind: 'returned' });
  });

  it('"Đang hoàn" (4), "Hoàn một phần" (15), "Đã xóa" (7) → cần người xử lý, KHÔNG tự đổi trạng thái/hoàn tiền', () => {
    for (const code of [4, 15, 7]) {
      const r = resolvePancakeStatus(code);
      expect(r?.kind).toBe('attention');
    }
    expect(resolvePancakeStatus(4)).not.toEqual(status('RETURNED'));
    expect(resolvePancakeStatus(15)).not.toEqual(status('DELIVERED'));
  });

  it('các bước trước xác nhận (Mới, Chờ xác nhận, Chờ hàng, Đã đặt hàng) → không đổi gì', () => {
    for (const code of [0, 17, 11, 20]) expect(resolvePancakeStatus(code)).toBeNull();
  });
});

describe('resolvePancakeStatus — chuỗi trạng thái (luồng cũ)', () => {
  it('không phân biệt hoa thường + có space', () => {
    expect(resolvePancakeStatus('Delivered')).toEqual(status('DELIVERED'));
    expect(resolvePancakeStatus('  completed ')).toEqual(status('DELIVERED'));
    expect(resolvePancakeStatus('CANCELED')).toEqual(status('CANCELLED'));
    expect(resolvePancakeStatus('shipped')).toEqual(status('SHIPPING'));
    expect(resolvePancakeStatus('returned')).toEqual({ kind: 'returned' });
    expect(resolvePancakeStatus('returning')?.kind).toBe('attention');
  });

  it('null/undefined/không khớp → null (giữ nguyên trạng thái)', () => {
    expect(resolvePancakeStatus(null)).toBeNull();
    expect(resolvePancakeStatus(undefined)).toBeNull();
    expect(resolvePancakeStatus('xyz')).toBeNull();
    expect(resolvePancakeStatus(999)).toBeNull();
  });
});
