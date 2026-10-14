import type { LineFulfiller } from './shop-client';

export interface FulfillerGroup<T> {
  key: string;
  fulfiller: LineFulfiller;
  items: T[];
}

const TUBU: LineFulfiller = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree' };

const keyOf = (f: LineFulfiller) => (f.kind === 'MERCHANT' ? `MERCHANT:${f.storefrontId}` : f.kind);

/**
 * Chia dòng giỏ theo nơi giao, cùng thứ tự với đơn tách ở checkout (D4): kho Tubu trước, rồi từng gian hàng tự giao theo thứ tự
 * xuất hiện, dòng không giao được cuối cùng. Dòng chưa có `fulfiller` (API cũ) coi là Tubu giao.
 */
export function groupByFulfiller<T extends { fulfiller?: LineFulfiller }>(items: T[]): FulfillerGroup<T>[] {
  const groups = new Map<string, FulfillerGroup<T>>();
  for (const it of items) {
    const f = it.fulfiller ?? TUBU;
    const key = keyOf(f);
    const g = groups.get(key) ?? { key, fulfiller: f, items: [] };
    g.items.push(it);
    groups.set(key, g);
  }
  const rank = (g: FulfillerGroup<T>) => (g.fulfiller.kind === 'TUBU' ? 0 : g.fulfiller.kind === 'MERCHANT' ? 1 : 2);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

/** Có cần hiện tiêu đề "Giao bởi …" không: chỉ khi giỏ không phải toàn hàng Tubu giao. */
export function showFulfillerHeaders(groups: FulfillerGroup<unknown>[]): boolean {
  return groups.length > 1 || groups.some((g) => g.fulfiller.kind !== 'TUBU');
}

export function fulfillerLabel(f: LineFulfiller): string {
  if (f.kind === 'TUBU') return 'Tubu Tree giao';
  if (f.kind === 'MERCHANT') return `${f.name} giao`;
  return 'Không giao được';
}

/** Tiền hàng phần kho Tubu giao — ngưỡng miễn phí vận chuyển chỉ tính trên phần này (hàng gian hàng tự giao có phí riêng). */
export function tubuSubtotal<T extends { fulfiller?: LineFulfiller; total: number }>(items: T[]): number {
  return items.reduce((s, it) => s + ((it.fulfiller?.kind ?? 'TUBU') === 'TUBU' ? it.total : 0), 0);
}
