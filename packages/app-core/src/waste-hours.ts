import type { WasteOpeningHours } from '@tubutree/shared-types';

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
const WEEKDAY_NAMES = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** Giờ Việt Nam tính từ mốc thời gian, không đọc múi giờ máy. */
const vnTime = (d: Date) => new Date(d.getTime() + 7 * 3_600_000);

/** "08:00" thành "8:00" cho gọn. */
const shortTime = (t: string) => t.replace(/^0(\d)/, '$1');

const windowsOn = (hours: WasteOpeningHours, dayIndex: number) =>
  [...(hours[WEEKDAYS[dayIndex % 7]!] ?? [])].sort((a, b) => (a.open < b.open ? -1 : a.open > b.open ? 1 : 0));

export const NO_OPENING_HOURS_TEXT = 'Chưa cập nhật giờ mở cửa';

export interface OpeningStatus {
  /** null khi điểm chưa có giờ mở cửa nào: không khẳng định đang mở hay đóng. */
  open: boolean | null;
  /** Một dòng cho khách: "Đang mở, đến 20:00" / "Đang đóng, mở lại 8:00 ngày mai". */
  text: string;
}

export function hasOpeningHours(hours: WasteOpeningHours): boolean {
  return WEEKDAYS.some((_, i) => windowsOn(hours, i).length > 0);
}

export function openingStatus(hours: WasteOpeningHours, now: Date): OpeningStatus {
  if (!hasOpeningHours(hours)) return { open: null, text: NO_OPENING_HOURS_TEXT };
  const v = vnTime(now);
  const day = v.getUTCDay();
  const t = `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
  const today = windowsOn(hours, day);
  const current = today.find((w) => w.open <= t && t < w.close);
  if (current) return { open: true, text: `Đang mở, đến ${shortTime(current.close)}` };
  const later = today.find((w) => w.open > t);
  if (later) return { open: false, text: `Đang đóng, mở lúc ${shortTime(later.open)} hôm nay` };
  for (let ahead = 1; ahead <= 7; ahead++) {
    const w = windowsOn(hours, day + ahead)[0];
    if (!w) continue;
    const when = ahead === 1 ? 'ngày mai' : WEEKDAY_NAMES[(day + ahead) % 7]!;
    return { open: false, text: `Đang đóng, mở lại ${shortTime(w.open)} ${when}` };
  }
  return { open: false, text: 'Đang đóng' };
}

/** "Hôm nay 8:00–20:00" (nhiều khung giờ thì nối bằng dấu phẩy) hoặc "Hôm nay nghỉ"; null khi chưa có giờ nào. */
export function todayHoursText(hours: WasteOpeningHours, now: Date): string | null {
  if (!hasOpeningHours(hours)) return null;
  const today = windowsOn(hours, vnTime(now).getUTCDay());
  if (today.length === 0) return 'Hôm nay nghỉ';
  return `Hôm nay ${today.map((w) => `${shortTime(w.open)}–${shortTime(w.close)}`).join(', ')}`;
}
