const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' theo giờ VN (UTC+7). */
export function vnDateKey(d: Date): string {
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** 00:00 VN của Thứ 2 tuần chứa d, trả Date (thời điểm UTC tương ứng). */
export function weekStartVN(d: Date): Date {
  const vn = new Date(d.getTime() + VN_OFFSET_MS);
  const dow = vn.getUTCDay(); // 0=CN..6=T7 (theo giờ VN vì đã shift)
  const daysFromMonday = (dow + 6) % 7; // T2→0, CN→6
  const midnightVN =
    Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - daysFromMonday * 86400000;
  return new Date(midnightVN - VN_OFFSET_MS); // đổi lại về UTC thực
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Giao thời gian (biên chạm không tính chồng). */
export function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Số phút giao nhau giữa [aStart,aEnd] và [bStart,bEnd] (≥0). Dùng cho tính lương Phase D. */
export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end > start ? Math.round((end - start) / 60000) : 0;
}
