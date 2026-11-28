import type { CheckInStatusResponse } from './api/loyalty';
import { formatVnNumber as num } from './number-format';

// Tách khỏi daily-check-in-copy.ts (cả hàm lẫn chữ của nó): mô-đun đó nằm trong gói đầu Mini App (thẻ thành viên dùng), còn dòng này chỉ thẻ cây thông Noel
// (chunk lười) gọi; để chung tệp thì Rollup kéo hàm và cả bảng chữ checkInCopy vào gói đầu (đo ở tubu-w57-01).
const lineCopy = {
  todayLead: 'Hôm nay nhận',
  todayLeadShort: 'Nhận',
  /** Phần nước còn thiếu nhưng bình đã đầy: không hứa giọt nước mà bình không chứa được. */
  tankFull: 'Bình nước đang đầy nên không cộng thêm giọt nước.',
} as const;

/**
 * "Hôm nay nhận +1.000 Điểm Xanh · +10 giọt nước": chỉ liệt kê phần CÒN THIẾU (phần đã xong, hoặc thiếu số, thì bỏ vế đó).
 * `short` (thẻ gọn ở Ưu đãi, nơi dòng phải nằm một dòng ở 360px): "Nhận +1.000 Điểm Xanh · +10 giọt nước"; ô hôm nay đã được tô sáng ngay phía trên nên không cần chữ "Hôm nay".
 */
export function checkInTodayLine(
  s: Pick<CheckInStatusResponse, 'todayPoints' | 'todayWater' | 'tankFull' | 'checkedInToday' | 'pointsDone' | 'waterDone' | 'pointsBlocked'>,
  opts: { short?: boolean } = {},
): string | null {
  if (s.checkedInToday) return null;
  const parts: string[] = [];
  if (!s.pointsBlocked && !s.pointsDone && (s.todayPoints ?? 0) > 0) parts.push(`+${num(s.todayPoints ?? 0)} Điểm Xanh`);
  if (!s.waterDone && (s.todayWater ?? 0) > 0) parts.push(`+${num(s.todayWater ?? 0)} giọt nước`);
  const tankFull = s.waterDone === false && s.tankFull === true;
  if (parts.length === 0) return tankFull ? lineCopy.tankFull : null;
  return `${opts.short ? lineCopy.todayLeadShort : lineCopy.todayLead} ${parts.join(' · ')}${tankFull ? `. ${lineCopy.tankFull}` : ''}`;
}
