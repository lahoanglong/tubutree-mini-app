import type { CheckInReward, CheckInStatusResponse } from './api/loyalty';
import { checkInCopy } from './daily-check-in-copy';

/** Chữ riêng cho khách vãng lai (API báo `pointsBlocked`); tách file để khỏi nằm trong entry Mini App, nơi chỉ cần câu báo sau khi bấm. */
export const guestCheckInCopy = {
  cta: 'Đăng nhập Zalo',
  rule: 'Mỗi ngày điểm danh 1 lần (giờ Việt Nam) để nhận giọt nước. Lỡ 1 ngày mà có vé giữ lửa thì chuỗi được giữ, không thì lịch 7 ngày bắt đầu lại.',
  dayAria: (day: number, claimed: boolean) => `Ngày ${day}${claimed ? ', đã nhận' : ''}`,
} as const;

/** Nhãn đọc màn hình của một ô ngày: khách vãng lai không được hứa điểm. */
export function checkInDayAria(s: Pick<CheckInStatusResponse, 'pointsBlocked'>, r: Pick<CheckInReward, 'day' | 'points' | 'claimed'>): string {
  return s.pointsBlocked ? guestCheckInCopy.dayAria(r.day, r.claimed) : checkInCopy.dayAria(r.day, r.points, r.claimed);
}

/** Thể lệ ngắn dưới nút điểm danh; bản của khách vãng lai không nhắc Điểm Xanh. */
export function checkInRule(s: Pick<CheckInStatusResponse, 'pointsBlocked'>): string {
  return s.pointsBlocked ? guestCheckInCopy.rule : checkInCopy.rule;
}
