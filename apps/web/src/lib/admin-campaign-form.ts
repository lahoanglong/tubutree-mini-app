const VN_OFFSET_MS = 7 * 3_600_000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * "yyyy-mm-ddTHH:mm" của ô nhập (VnDateTimeInput) hiểu là giờ Việt Nam, đổi sang ISO UTC. Ghép +07:00 thay vì `new Date(local)`
 * (giờ máy admin) để mốc đúng kể cả khi máy đặt múi giờ khác. Ngày không có thật (31/02) hay thiếu giờ thì null.
 */
export function vnLocalToIso(local: string): string | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(probe.getTime() - VN_OFFSET_MS).toISOString();
}

/** Ngược lại: ISO của máy chủ thành "yyyy-mm-ddTHH:mm" giờ Việt Nam cho ô nhập; không đọc được thì rỗng. */
export function isoToVnLocal(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t + VN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

function vnDisplay(iso: string): string {
  const local = isoToVnLocal(iso);
  const m = LOCAL.exec(local);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : '';
}

/** "01/11/2026 00:00 → 10/11/2026 23:59", giờ Việt Nam. */
export function formatVnRange(startIso: string, endIso: string): string {
  return `${vnDisplay(startIso)} → ${vnDisplay(endIso)}`;
}

/** Ô "mã gắn kèm": cách nhau bởi dấu phẩy, xuống dòng hoặc khoảng trắng; bỏ ô trống và mã trùng (không phân biệt hoa thường), giữ thứ tự gõ. */
export function parseCouponCodes(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const code = raw.trim();
    if (!code || seen.has(code.toUpperCase())) continue;
    seen.add(code.toUpperCase());
    out.push(code);
  }
  return out;
}
