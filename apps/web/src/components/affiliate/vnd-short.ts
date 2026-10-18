import { formatVnd } from '@/lib/format-vnd';

/** "50k" / "1,5tr" cho mức rút tối thiểu trong lời giới thiệu; số lẻ thì in đầy đủ, cùng quy tắc formatVndShort của Mini App. */
export function formatVndShort(v: number): string {
  if (v <= 0) return '0đ';
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v >= 1_000_000 && v % 100_000 === 0) return `${trim(v / 1_000_000)}tr`;
  if (v >= 1_000 && v % 1_000 === 0) return `${Math.round(v / 1_000)}k`;
  return formatVnd(v);
}
