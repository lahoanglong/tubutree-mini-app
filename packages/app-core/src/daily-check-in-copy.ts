import type { CheckInResult } from './api/loyalty';
import { formatVnNumber as num } from './number-format';

/** Chữ của khối điểm danh dùng chung cho Mini App và web (trang Điểm Xanh, Ưu đãi, Vườn Xanh). */
export const checkInCopy = {
  title: 'Điểm danh mỗi ngày',
  /** Tên đọc của nút mở/đóng đoạn luật ở bản gọn (Ưu đãi): đoạn luật dài không đứng sẵn trên thẻ. */
  ruleToggle: 'Luật điểm danh',
  /** Chữ nhìn thấy trên nút đó: ngắn để "Ngày 1/7" và nút luôn nằm một dòng cạnh nút Điểm danh ở 375px; nằm trọn trong tên đọc (WCAG 2.5.3). */
  ruleToggleLabel: 'Luật',
  /** Vị trí trong lịch 7 ngày: một chuỗi chung cho Điểm Xanh và giọt nước ở Vườn Xanh. */
  cycleDay: (day: number) => `Ngày ${day}/7`,
  rule: 'Mỗi ngày nhận 1 lần cả Điểm Xanh và giọt nước (giờ Việt Nam). Lỡ 1 ngày: có vé giữ lửa thì giữ chuỗi, không thì lịch 7 ngày bắt đầu lại. Không tính vào xét hạng.',
  alreadyDone: 'Hôm nay bạn đã điểm danh rồi',
  retryMissing: 'Còn thiếu một phần, bấm điểm danh lại để nhận nốt',
  /** Tiêu đề khối lỗi; thân chỉ ghi lý do để câu không lặp ý. */
  loadErrorTitle: 'Chưa tải được lịch điểm danh',
  dayAria: (day: number, points: number, claimed: boolean) =>
    `Ngày ${day}: +${num(points)} Điểm Xanh${claimed ? ', đã nhận' : ''}`,
  /** Khách vãng lai (API báo `pointsBlocked`): vẫn điểm danh và nhận giọt nước, nhưng Điểm Xanh chỉ có sau khi đăng nhập Zalo. */
  guestPoints: 'Đăng nhập Zalo để nhận Điểm Xanh',
} as const;

/** Số giọt nước đã là TỔNG gồm các khoản thưởng; ghi chúng trong ngoặc để khách không cộng dồn lần hai. */
function waterIncludes(w: NonNullable<CheckInResult['water']>): string {
  if (w.bonuses) {
    const items = w.bonuses.filter((b) => b.seeds > 0).map((b) => `${num(b.seeds)} ${b.label}`);
    return items.length > 0 ? ` (gồm ${items.join(', ')})` : '';
  }
  return w.bonusNote ? ` (${w.bonusNote.replace(/!\s*$/, '')})` : '';
}

/**
 * Câu báo sau khi bấm điểm danh: "+1.000 Điểm Xanh · +10 giọt nước". Ghép theo phần THỰC SỰ cộng ở lần gọi này;
 * bên đã xong từ trước thì không nhắc lại. Còn phần thiếu do lỗi thì nhắc bấm lại.
 */
export function checkInSuccessText(r: CheckInResult): string {
  const parts: string[] = [];
  if (r.points && r.points.pointsEarned > 0) parts.push(`+${num(r.points.pointsEarned)} Điểm Xanh`);
  if (r.water && r.water.seedsEarned > 0) parts.push(`+${num(r.water.seedsEarned)} giọt nước${waterIncludes(r.water)}`);
  if (r.water?.streakFrozeUsed) parts.push('đã dùng vé giữ lửa');
  let text: string;
  if (parts.length > 0) text = parts.join(' · ');
  else if (r.points || r.water) text = 'Điểm danh thành công!';
  else text = checkInCopy.alreadyDone;
  // Khách vãng lai: API không cộng Điểm Xanh; nói thẳng cách nhận thay vì để khách tưởng điểm đã vào.
  if (r.points?.pointsBlocked) text = `${text.replace(/[.!]$/, '')}. ${checkInCopy.guestPoints}`;
  return r.pending.length > 0 ? `${text}. ${checkInCopy.retryMissing}` : text;
}

/** Mỗi ô ngày chỉ hiện số ngày và biểu tượng: ở 320px không đủ chỗ cho "+1.000" (số điểm nằm ở aria-label). */
export type CheckInDayIcon = 'check' | 'gift' | 'sprout';
export function checkInDayIcon(day: number, claimed: boolean): CheckInDayIcon {
  if (claimed) return 'check';
  return day === 7 ? 'gift' : 'sprout';
}
