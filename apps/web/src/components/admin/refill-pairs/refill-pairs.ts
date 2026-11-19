import type { Tone } from '@/lib/recycling';
import type { AdminRefillPairRow, AdminRefillPairs, RefillPairStatus, SaveRefillPairsInput } from './api';

export type RefillPairFilter = 'all' | 'live' | 'waiting' | 'off';

export const FILTERS: { key: RefillPairFilter; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'live', label: 'Đang mời đổi' },
  { key: 'waiting', label: 'Chờ ghép tay' },
  { key: 'off', label: 'Đã tắt' },
];

const IN_FILTER: Record<RefillPairFilter, readonly RefillPairStatus[]> = {
  all: ['auto', 'manual', 'size', 'ambiguous', 'blocked'],
  live: ['auto', 'manual'],
  waiting: ['size', 'ambiguous'],
  off: ['blocked'],
};

export const filterRows = (rows: readonly AdminRefillPairRow[], f: RefillPairFilter) => rows.filter((r) => IN_FILTER[f].includes(r.status));
export const countRows = (rows: readonly AdminRefillPairRow[], f: RefillPairFilter) => filterRows(rows, f).length;

/** "×2,6": gói Refill gấp mấy lần chai. */
export const ratioText = (ratio: number | null) => (ratio == null ? null : `×${String(ratio).replace('.', ',')}`);


export function statusOf(row: AdminRefillPairRow, maxRatio: number): { text: string; tone: Tone } {
  switch (row.status) {
    case 'auto':
      return { text: 'Tự ghép', tone: 'success' };
    case 'manual':
      return { text: 'Ghép tay', tone: 'info' };
    case 'size':
      return { text: row.ratio == null ? 'Không đọc được dung tích: chờ ghép tay' : row.ratio > maxRatio ? `Gói lớn hơn ${maxRatio} lần chai: chờ ghép tay` : 'Gói không lớn hơn chai: chờ ghép tay', tone: 'warning' };
    case 'ambiguous':
      return { text: `${row.candidates} gói Refill cùng công thức: chọn ở Ghép tay`, tone: 'warning' };
    case 'blocked':
      return { text: 'Đã tắt', tone: 'neutral' };
  }
}

/** `label` trên nút, `done` mở đầu câu báo đã lưu. */
export type RowAction = { label: string; done: string; input: (data: AdminRefillPairs) => SaveRefillPairsInput } | null;

const without = <T>(xs: readonly T[], drop: (x: T) => boolean) => xs.filter((x) => !drop(x));

/**
 * Việc một chạm của từng dòng: tắt cặp tự ghép (chặn chai), bỏ ghép tay, ghép tay đúng cặp đang gợi ý (lệch lượng), bật lại chai đã tắt.
 * Dòng nhiều gói Refill không có nút: admin chọn gói ở ô Ghép tay.
 */
export function rowAction(row: AdminRefillPairRow): RowAction {
  const slug = row.bottle.slug;
  switch (row.status) {
    case 'auto':
      return { label: 'Tắt cặp', done: 'Đã tắt cặp', input: (d) => ({ block: [...d.block.map((b) => b.slug), slug] }) };
    case 'manual':
      return { label: 'Bỏ ghép tay', done: 'Đã bỏ ghép tay', input: (d) => ({ overrides: without(d.overrides, (o) => o.bottleSlug === slug) }) };
    case 'size':
      return row.refill ? { label: 'Ghép tay cặp này', done: 'Đã ghép tay', input: (d) => addOverride(d, slug, row.refill!.slug) } : null;
    case 'blocked':
      return { label: 'Bật lại', done: 'Đã bật lại', input: (d) => ({ block: without(d.block.map((b) => b.slug), (s) => s === slug) }) };
    default:
      return null;
  }
}

/** Ghép tay: mỗi chai một cặp, cặp mới thay cặp cũ của cùng chai. */
export const addOverride = (d: AdminRefillPairs, bottleSlug: string, refillSlug: string): SaveRefillPairsInput => ({
  overrides: [...without(d.overrides, (o) => o.bottleSlug === bottleSlug), { bottleSlug, refillSlug }],
});

/** Slug đang chặn mà không phải chai của dòng nào (thường là gói Refill bị chặn): hiện riêng để bỏ chặn. */
export function looseBlocks(d: AdminRefillPairs): { slug: string; name: string | null }[] {
  const bottles = new Set(d.rows.map((r) => r.bottle.slug));
  return d.block.filter((b) => !bottles.has(b.slug));
}
