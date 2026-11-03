/**
 * Mã còn trong giỏ nhưng chưa áp cho đơn này, kèm lý do của máy chủ. Từng chữ bằng đầu câu `couponNotAppliedNotice` của API
 * (coupon-notice.ts); API chèn thêm "(hàng Giờ vàng không được tính vào điều kiện của mã)" trước dấu hai chấm khi giỏ có hàng Giờ vàng hay combo,
 * còn câu này là xem trước theo lý do từng mã nên không có phần đó.
 */
export const couponNotAppliedNotice = (reason: string): string => `Mã chưa được áp dụng cho đơn này: ${reason}`;
