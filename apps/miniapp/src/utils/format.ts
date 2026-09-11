/** Định dạng VND: 289000 → "289.000đ". */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

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
export function addressLine(a: {
  street?: string | null;
  ward?: string | null;
  district?: string | null;
  province?: string | null;
}): string {
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
  return `${(Number.isFinite(v) ? v : 0).toLocaleString('vi-VN')} điểm`;
}

/**
 * VND rút gọn cho câu chữ marketing: 50000 → "50k", 1500000 → "1,5tr".
 * Số lẻ không tròn nghìn thì trả về dạng đầy đủ để không nói sai con số.
 */
export function formatVndShort(amount: number | null | undefined): string {
  const v = Number(amount ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '0đ';
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
