/**
 * Ngày giờ hiển thị cho người dùng web: dd/MM/yyyy và HH:mm dd/MM/yyyy theo giờ Việt Nam, mọi nơi cùng một dáng.
 * Tự ghép thay vì dùng các hàm toLocale*String của Date: chúng không đệm số 0 ("1/9/2026"), kèm giây, đổi dáng theo
 * phiên bản ICU của trình duyệt/Node và theo múi giờ máy khách. Việt Nam là UTC+7 quanh năm (không có
 * giờ mùa hè) nên cộng cố định 7 giờ rồi đọc bằng getUTC* là đủ, không cần Intl.
 * Mini App có bản riêng (apps/miniapp/src/utils/format.ts) theo giờ máy; hai app không dùng chung mã.
 */
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

const pad2 = (n: number) => String(n).padStart(2, '0');

type DateInput = string | number | Date | null | undefined;

function toVnClock(v: DateInput): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : new Date(ms + VN_OFFSET_MS);
}

const dayPart = (c: Date) => `${pad2(c.getUTCDate())}/${pad2(c.getUTCMonth() + 1)}/${c.getUTCFullYear()}`;

/** "05/10/2026"; rỗng hoặc không phải ngày thì "—". */
export function formatDate(v: DateInput): string {
  const c = toVnClock(v);
  return c ? dayPart(c) : '—';
}

/** "07:04 05/10/2026" (giờ trước ngày, bỏ giây); rỗng hoặc không phải ngày thì "—". */
export function formatDateTime(v: DateInput): string {
  const c = toVnClock(v);
  return c ? `${pad2(c.getUTCHours())}:${pad2(c.getUTCMinutes())} ${dayPart(c)}` : '—';
}
