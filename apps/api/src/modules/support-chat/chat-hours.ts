import { VN_OFFSET_MS } from '../../common/vn-time';

/** Nửa mở [start, end) theo giờ VN, tính bằng số học UTC nên không phụ thuộc TZ của máy chủ. */
export function isWithinHours(now: Date, hours: { start: string; end: string }): boolean {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const minutes = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  const toMinutes = (hhmm: string) => {
    const [h = 0, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  return minutes >= toMinutes(hours.start) && minutes < toMinutes(hours.end);
}
