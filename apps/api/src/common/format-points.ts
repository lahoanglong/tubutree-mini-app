/** Số điểm trong câu gửi khách: nhóm nghìn kiểu vi-VN (5.000), không phụ thuộc ICU của máy chạy. */
export function formatPoints(n: number): string {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v)) return '0';
  return String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/^/, v < 0 ? '-' : '');
}
