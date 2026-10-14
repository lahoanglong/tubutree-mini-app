import { describe, it, expect } from 'vitest';
import {
  isReorderable,
  orderPointsNote,
  orderStamp,
  orderUnitCount,
  returnWindowState,
  timelineIndex,
  timelineStepsFor,
  discountRows,
  TIMELINE_STEPS,
} from './order-status';

describe('order-status helpers', () => {
  it('mua lại được với đơn đã xong (giao/huỷ/hoàn) — cùng điều kiện nút ở chi tiết đơn', () => {
    expect(['DELIVERED', 'CANCELLED', 'RETURNED'].every(isReorderable)).toBe(true);
    expect(['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING'].some(isReorderable)).toBe(false);
  });
  it('số món = tổng số lượng, không phải số dòng (A2-47)', () => {
    expect(orderUnitCount([{ quantity: 2 }, { quantity: 1 }])).toBe(3);
    expect(orderUnitCount([])).toBe(0);
  });
});

// BUYERMINI-14: đơn đã giao/đã hoàn vẫn hiện "Nhận +N Điểm Xanh khi giao thành công".
describe('orderPointsNote', () => {
  it('đơn chưa giao → "sẽ nhận" kèm điều kiện giao thành công', () => {
    for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'PACKED', 'SHIPPING']) {
      expect(orderPointsNote(status, 35)).toEqual({ text: 'Nhận +35 Điểm Xanh khi giao thành công', tone: 'success' });
    }
  });
  it('đơn đã giao → "Đã cộng", không còn hứa tương lai', () => {
    expect(orderPointsNote('DELIVERED', 35)).toEqual({ text: 'Đã cộng +35 Điểm Xanh vào tài khoản', tone: 'success' });
  });
  it('đơn đã hoàn → điểm đã thu hồi', () => {
    expect(orderPointsNote('RETURNED', 35)).toEqual({ text: 'Điểm Xanh của đơn này đã được thu hồi', tone: 'muted' });
  });
  it('đơn huỷ hoặc không có điểm → không hiện dòng nào', () => {
    expect(orderPointsNote('CANCELLED', 35)).toBeNull();
    expect(orderPointsNote('DELIVERED', 0)).toBeNull();
  });
});

// BUYERMINI-15: giờ đầu trang là giờ TẠO đơn nhưng nằm cạnh trạng thái "Giao thành công"; COD vẫn có bước "Chờ thanh toán".
describe('orderStamp', () => {
  const base = { createdAt: '2026-10-13T16:33:00.000Z', deliveredAt: '2026-10-15T03:00:00.000Z' };
  it('đơn đã giao có mốc giao → "Giao lúc" + deliveredAt', () => {
    expect(orderStamp({ ...base, status: 'DELIVERED' })).toEqual({ label: 'Giao lúc', at: base.deliveredAt });
  });
  it('các trường hợp còn lại → "Đặt lúc" + createdAt (kể cả đã giao nhưng thiếu mốc giao)', () => {
    expect(orderStamp({ ...base, status: 'SHIPPING' })).toEqual({ label: 'Đặt lúc', at: base.createdAt });
    expect(orderStamp({ createdAt: base.createdAt, status: 'DELIVERED' })).toEqual({ label: 'Đặt lúc', at: base.createdAt });
    expect(orderStamp({ ...base, status: 'RETURNED' })).toEqual({ label: 'Đặt lúc', at: base.createdAt });
  });
});

describe('timelineStepsFor', () => {
  it('COD và Ví Tubu không có bước chờ thanh toán (R2-BUYERMINI-5); phương thức khác giữ đủ 5 bước', () => {
    expect(timelineStepsFor('COD')).toEqual(['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']);
    expect(timelineStepsFor('WALLET')).toEqual(['CONFIRMED', 'PACKED', 'SHIPPING', 'DELIVERED']);
    expect(timelineStepsFor('BANK_TRANSFER')).toEqual([...TIMELINE_STEPS]);
    expect(timelineStepsFor('ZALOPAY')).toEqual([...TIMELINE_STEPS]);
    expect(timelineStepsFor(undefined)).toEqual([...TIMELINE_STEPS]);
  });
  it('timelineIndex tính theo danh sách bước đã chọn; trạng thái ngoài hành trình → -1', () => {
    const cod = timelineStepsFor('COD');
    expect(timelineIndex('CONFIRMED', cod)).toBe(0);
    expect(timelineIndex('DELIVERED', cod)).toBe(3);
    expect(timelineIndex('CANCELLED', cod)).toBe(-1);
    expect(timelineIndex('PENDING_PAYMENT', cod)).toBe(-1);
    expect(timelineIndex('CONFIRMED')).toBe(1);
  });
});

// BUYERMINI-16: nút đổi/trả hiện cả khi quá hạn và ghi cứng "7 ngày".
describe('returnWindowState', () => {
  const now = new Date('2026-10-20T00:00:00.000Z').getTime();
  const daysAgo = (d: number) => new Date(now - d * 864e5).toISOString();
  it('trong hạn → open, còn bao nhiêu ngày', () => {
    expect(returnWindowState({ deliveredAt: daysAgo(2) }, 7, now)).toEqual({ open: true, daysLeft: 5 });
    expect(returnWindowState({ deliveredAt: daysAgo(6.5) }, 7, now)).toEqual({ open: true, daysLeft: 1 });
  });
  it('quá hạn → closed', () => {
    expect(returnWindowState({ deliveredAt: daysAgo(7.1) }, 7, now)).toEqual({ open: false, daysLeft: 0 });
    expect(returnWindowState({ deliveredAt: daysAgo(30) }, 14, now)).toEqual({ open: false, daysLeft: 0 });
  });
  it('hạn theo cấu hình admin (14 ngày)', () => {
    expect(returnWindowState({ deliveredAt: daysAgo(10) }, 14, now)).toEqual({ open: true, daysLeft: 4 });
  });
  it('thiếu mốc giao → tính từ updatedAt như API; không có gì → coi như còn hạn để API quyết', () => {
    expect(returnWindowState({ updatedAt: daysAgo(10) }, 7, now).open).toBe(false);
    expect(returnWindowState({}, 7, now)).toEqual({ open: true, daysLeft: 7 });
  });
});

describe('discountRows (R2-BUYERMINI-8: tách mã giảm giá và Điểm Xanh bằng số tiền thật)', () => {
  it('đơn có chi tiết từng khoản: mỗi khoản một dòng, Điểm Xanh kèm số điểm', () => {
    expect(
      discountRows({ discount: 98_000, couponCode: 'XANH10', couponDiscount: 38_000, comboDiscount: 0, tierDiscount: 0, pointsDiscount: 60_000, pointsUsed: 60 }),
    ).toEqual([
      { label: 'Mã giảm giá (XANH10)', amount: 38_000 },
      { label: 'Điểm Xanh (60 điểm)', amount: 60_000 },
    ]);
  });
  it('combo, hạng thành viên và phần giảm không rõ nguồn đều có dòng riêng; tổng các dòng = discount', () => {
    const rows = discountRows({ discount: 100_000, couponDiscount: 0, comboDiscount: 30_000, tierDiscount: 20_000, pointsDiscount: 0, pointsUsed: 0 });
    expect(rows).toEqual([
      { label: 'Ưu đãi combo', amount: 30_000 },
      { label: 'Ưu đãi hạng thành viên', amount: 20_000 },
      { label: 'Giảm giá khác', amount: 50_000 },
    ]);
  });
  it('đơn cũ không có chi tiết: một dòng Giảm giá, ghi rõ đã gồm Điểm Xanh nếu có dùng điểm', () => {
    expect(discountRows({ discount: 98_000, pointsUsed: 60 })).toEqual([{ label: 'Giảm giá (gồm Điểm Xanh)', amount: 98_000 }]);
    expect(discountRows({ discount: 38_000, pointsUsed: 0 })).toEqual([{ label: 'Giảm giá', amount: 38_000 }]);
    expect(discountRows({ discount: 0, pointsUsed: 0 })).toEqual([]);
  });
});
