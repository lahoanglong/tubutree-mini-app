import { fillCopy } from '../shop-copy';

const pad2 = (n: number) => String(n).padStart(2, '0');
const DAY_SEC = 86_400;

/**
 * Đồng hồ nhảy từng giây ở đầu khối Giờ vàng: "02:05:33"; dưới 1 giờ "05:33"; từ 24 giờ "2 ngày 03:15"; hết giờ "00:00".
 * Giây làm tròn LÊN (chưa hết giờ thì không hiện 00:00); nhánh ngày cắt phút XUỐNG để không tràn "00:60".
 */
export function countdownClock(ms: number): string {
  if (!(ms > 0)) return '00:00';
  const sec = Math.ceil(ms / 1000);
  const h = Math.floor((sec % DAY_SEC) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (sec >= DAY_SEC) return fillCopy('time.daysClock', { d: Math.floor(sec / DAY_SEC), clock: `${pad2(h)}:${pad2(m)}` });
  const s = sec % 60;
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

/** Tách phút còn lại (làm tròn xuống) thành ngày, giờ, phút; null khi hết giờ. */
function parts(ms: number): { d: number; h: number; m: number; totalMin: number } | null {
  if (!(ms > 0)) return null;
  const totalMin = Math.floor(ms / 60_000);
  return { d: Math.floor(totalMin / 1440), h: Math.floor((totalMin % 1440) / 60), m: totalMin % 60, totalMin };
}

/** Chữ đếm ngược cập nhật theo phút, dùng ngoài đầu khối Giờ vàng: "2 giờ 05 phút". Hết giờ → ''. */
export function countdownText(ms: number): string {
  const p = parts(ms);
  if (!p) return '';
  if (p.d > 0) return p.h > 0 ? fillCopy('time.daysHours', { d: p.d, h: p.h }) : fillCopy('time.days', { d: p.d });
  if (p.h > 0) return fillCopy('time.hoursMinutes', { h: p.h, m: pad2(p.m) });
  return p.totalMin > 0 ? fillCopy('time.minutes', { m: p.m }) : fillCopy('time.underMinute');
}

/** Bản cho trình đọc màn hình (aria-label của role=timer): không đệm số 0, bỏ phần bằng 0: "2 giờ 5 phút". */
export function countdownSpoken(ms: number): string {
  const p = parts(ms);
  if (!p) return '';
  if (p.d > 0) return p.h > 0 ? fillCopy('time.daysHours', { d: p.d, h: p.h }) : fillCopy('time.days', { d: p.d });
  if (p.h > 0) return p.m > 0 ? fillCopy('time.hoursMinutes', { h: p.h, m: p.m }) : fillCopy('time.hours', { h: p.h });
  return p.totalMin > 0 ? fillCopy('time.minutes', { m: p.m }) : fillCopy('time.underMinute');
}
