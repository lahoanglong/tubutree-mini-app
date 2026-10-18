/**
 * Số có dấu phân cách nghìn kiểu Việt: 1250000 → "1.250.000". Mọi số tiền/điểm/giọt nước hiển thị
 * cho khách đi qua đây (trực tiếp hoặc qua formatVnd/formatPoints/formatDrops) — không gọi
 * toLocaleString rải rác trong pages, nên cùng một con số không còn hiện ba dáng khác nhau.
 * Rác (null/NaN/vô cực) → "0" thay vì "NaN".
 */
export function formatNumber(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  // `+ 0` đổi -0 thành 0 (toLocaleString in "-0").
  return ((Number.isFinite(v) ? v : 0) + 0).toLocaleString('vi-VN');
}

/** Chữ hiện thay cho giá/số tiền không có: "0đ" nghĩa là miễn phí, không được dùng để che giá thiếu. */
export const MISSING_AMOUNT = '—';

/** Số tiền hợp lệ, hoặc null khi thiếu (null/undefined/chuỗi rỗng/NaN/vô cực/chuỗi không phải số). */
function toAmount(v: number | string | null | undefined): number | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Định dạng VND: 289000 → "289.000đ". 0 là giá hợp lệ ("0đ"); giá thiếu → "—", KHÔNG phải "0đ". */
export function formatVnd(amount: number | string | null | undefined): string {
  const v = toAmount(amount);
  return v === null ? MISSING_AMOUNT : `${formatNumber(v)}đ`;
}

/** Giọt nước 💧 của Vườn Xanh: 1250 → "1.250💧". */
export function formatDrops(n: number | null | undefined): string {
  return `${formatNumber(n)}💧`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function toValidDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Ngày dd/MM/yyyy theo giờ máy. Tự ghép thay vì toLocaleDateString('vi-VN'): định dạng đó đổi theo
 * phiên bản ICU của webview (Node 24 trả "15-10"), nên cùng một ngày có thể hiện hai dáng.
 */
export function formatDate(v: string | number | Date | null | undefined): string {
  const d = toValidDate(v);
  return d ? `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}` : '—';
}

/** Giờ + ngày: "07:04 05/10/2026" (bỏ giây). Rỗng/hỏng → "—". */
export function formatDateTime(v: string | number | Date | null | undefined): string {
  const d = toValidDate(v);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())} ${formatDate(d)}` : '—';
}

// Bản sao của formatSold ở apps/web/src/lib/api.ts. Chưa gom vào packages/shared-types (nay chỉ có kiểu, enum, hằng);
// sửa một nơi thì sửa cả nơi kia, spec hai bên dùng cùng bảng ca.
/** "Đã bán" kiểu Shopee: <1 → null (ẩn); <1000 → "Đã bán 12"; ≥1000 → "Đã bán 1,2k+"; ≥1tr → "...tr+". */
export function formatSold(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return `Đã bán ${v}`;
  if (v < 1_000_000) return `Đã bán ${trim(v / 1000)}k+`;
  return `Đã bán ${trim(v / 1_000_000)}tr+`;
}

/** Ghép dòng địa chỉ, bỏ phần rỗng (hệ 2 cấp không còn quận/huyện → tránh ", ,"). */
export function addressLine(a?: {
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
} | null): string {
  if (!a) return '';
  return [a.street, a.ward, a.district, a.province].filter(Boolean).join(', ');
}

/**
 * Tỉ lệ hoàn tiền lưu ở DB dạng PHÂN SỐ (0.035 = 3,5%) — không phải phần trăm.
 * Trước đây FE render thẳng `{Number(baseRate)}%` nên mọi sàn đều hiện "0.035%" thay vì
 * "3,5%", sai 100 lần trên đúng con số mời chào người dùng.
 * Trả chuỗi đã kèm "%", dùng dấu phẩy thập phân kiểu Việt, bỏ ",0" thừa.
 */
export function formatRatePct(rate: number | string | null | undefined): string {
  const v = Number(rate ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0%';
  const pct = v * 100;
  // 1 chữ số thập phân là đủ cho khoảng 0,5%–10% thường gặp; số tròn thì bỏ phần thập phân.
  return `${pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')}%`;
}

/**
 * Điểm Xanh: LUÔN có dấu phân cách nghìn + đơn vị "điểm".
 * Trước đây mỗi màn tự format một kiểu — "1.250 điểm" (Ví), "1250 Điểm Xanh" (Điểm Xanh),
 * "1250" (Cá nhân) — cùng một con số trông như ba giá trị khác nhau.
 */
export function formatPoints(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${formatNumber(v)} điểm`;
}

/**
 * VND rút gọn cho câu chữ marketing: 50000 → "50k", 1500000 → "1,5tr".
 * Số lẻ không tròn nghìn thì trả về dạng đầy đủ để không nói sai con số.
 */
export function formatVndShort(amount: number | null | undefined): string {
  const v = toAmount(amount);
  if (v === null) return MISSING_AMOUNT;
  if (v <= 0) return '0đ';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v >= 1_000_000 && v % 100_000 === 0) return `${trim(v / 1_000_000)}tr`;
  if (v >= 1_000 && v % 1_000 === 0) return `${Math.round(v / 1_000)}k`;
  return formatVnd(v);
}

/** Hệ số nhân kiểu Việt: 1.5 → "1,5" (không có ",0" thừa với số tròn). */
export function formatMultiplier(x: number | null | undefined): string {
  const v = Number(x ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '1';
  return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}
