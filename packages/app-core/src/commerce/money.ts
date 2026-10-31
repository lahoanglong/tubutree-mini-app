import { formatVnNumber } from '../number-format';

/** 39000 → "39.000đ". */
export function vnd(n: number): string {
  return `${formatVnNumber(n)}đ`;
}

/**
 * VND rút gọn cho chữ gọn: 50000 → "50k", 1500000 → "1,5tr". Số lẻ không tròn nghìn thì dạng đầy đủ để không nói sai con số
 * (cùng luật `formatVndShort` của Mini App).
 */
export function vndShort(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0đ';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (n >= 1_000_000 && n % 100_000 === 0) return `${trim(n / 1_000_000)}tr`;
  if (n >= 1_000 && n % 1_000 === 0) return `${Math.round(n / 1_000)}k`;
  return vnd(n);
}
