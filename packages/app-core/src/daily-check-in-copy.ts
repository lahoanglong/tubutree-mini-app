import type { CheckInResult, CheckInStatusResponse } from './api/loyalty';

const num = (n: number): string => ((Number.isFinite(n) ? n : 0) + 0).toLocaleString('vi-VN');

/** Chữ của khối điểm danh dùng chung cho Mini App và web (trang Điểm Xanh, Ưu đãi, Vườn Xanh). */
export const checkInCopy = {
  title: 'Điểm danh mỗi ngày',
  /** Vị trí trong vòng 7 ngày của Điểm Xanh. Không dùng chữ "chuỗi": Vườn Xanh có chuỗi nước riêng và hai số có thể khác nhau. */
  cycleDay: (day: number) => `Ngày ${day}/7`,
  rule: 'Một lần bấm nhận cả Điểm Xanh và giọt nước. Mỗi ngày 1 lần (giờ Việt Nam), lỡ 1 ngày thì vòng 7 ngày bắt đầu lại. Điểm danh không tính vào xét hạng.',
  /** Phần nước còn thiếu nhưng bình đã đầy: không hứa giọt nước mà bình không chứa được. */
  tankFull: 'Bình nước đang đầy nên không cộng thêm giọt nước.',
  alreadyDone: 'Hôm nay bạn đã điểm danh rồi',
  retryMissing: 'Còn thiếu một phần, bấm điểm danh lại để nhận nốt',
  loadError: (reason: string) => `Chưa tải được lịch điểm danh: ${reason}`,
  dayAria: (day: number, points: number, claimed: boolean) =>
    `Ngày ${day}: +${num(points)} Điểm Xanh${claimed ? ', đã nhận' : ''}`,
} as const;

/** "Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước": chỉ liệt kê phần CÒN THIẾU (phần đã xong, hoặc thiếu số, thì bỏ vế đó). */
export function checkInTodayLine(s: Pick<CheckInStatusResponse, 'todayPoints' | 'todayWater' | 'checkedInToday' | 'pointsDone' | 'waterDone'>): string | null {
  if (s.checkedInToday) return null;
  const parts: string[] = [];
  if (!s.pointsDone && (s.todayPoints ?? 0) > 0) parts.push(`+${num(s.todayPoints ?? 0)} Điểm Xanh`);
  if (!s.waterDone && (s.todayWater ?? 0) > 0) parts.push(`+${num(s.todayWater ?? 0)} giọt nước`);
  const tankFull = s.waterDone === false && s.todayWater === 0;
  if (parts.length === 0) return tankFull ? checkInCopy.tankFull : null;
  return `Hôm nay nhận ${parts.join(' · ')}${tankFull ? `. ${checkInCopy.tankFull}` : ''}`;
}

/**
 * Câu báo sau khi bấm điểm danh: "+1.000 Điểm Xanh · +10 giọt nước". Ghép theo phần THỰC SỰ cộng ở lần gọi này;
 * bên đã xong từ trước thì không nhắc lại. Còn phần thiếu do lỗi thì nhắc bấm lại.
 */
export function checkInSuccessText(r: CheckInResult): string {
  const parts: string[] = [];
  if (r.points && r.points.pointsEarned > 0) parts.push(`+${num(r.points.pointsEarned)} Điểm Xanh`);
  if (r.water && r.water.seedsEarned > 0) parts.push(`+${num(r.water.seedsEarned)} giọt nước`);
  if (r.water?.streakFrozeUsed) parts.push('đã dùng vé giữ lửa');
  if (r.water?.bonusNote) parts.push(r.water.bonusNote);
  let text: string;
  if (parts.length > 0) text = parts.join(' · ');
  else if (r.points || r.water) text = 'Điểm danh thành công!';
  else text = checkInCopy.alreadyDone;
  return r.pending.length > 0 ? `${text}. ${checkInCopy.retryMissing}` : text;
}

/** Mỗi ô ngày chỉ hiện số ngày và biểu tượng: ở 320px không đủ chỗ cho "+1.000" (số điểm nằm ở aria-label). */
export type CheckInDayIcon = 'check' | 'gift' | 'sprout';
export function checkInDayIcon(day: number, claimed: boolean): CheckInDayIcon {
  if (claimed) return 'check';
  return day === 7 ? 'gift' : 'sprout';
}
