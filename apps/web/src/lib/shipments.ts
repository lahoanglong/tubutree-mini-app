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
  if (f.reason === 'STORE_PAUSED' && f.name) return `${f.name} đang tạm nghỉ, chưa nhận đơn`;
  if (f.reason === 'STORE_CLOSED' && f.name) return `${f.name} đã ngừng bán`;
  return 'Không giao được';
}

/**
 * Câu dưới danh sách món ở màn thanh toán theo các kiện báo giá trả về (D4): nhiều nơi giao thì nói lần đặt thành mấy đơn riêng;
 * một kiện của gian hàng đối tác thì nói gian hàng nào giao; một kiện Tubu (hoặc chưa có báo giá) thì không cần câu nào.
 */
export function shipmentsNote(shipments: readonly { fulfiller: LineFulfiller }[]): string | null {
  if (shipments.length > 1) {
    return `Hàng do ${shipments.length} nơi giao nên sẽ thành ${shipments.length} đơn riêng, mỗi đơn có phí giao và mã đơn riêng.`;
  }
  const only = shipments[0]?.fulfiller;
  return only?.kind === 'MERCHANT' ? `Đơn này do ${only.name} giao, phí giao theo gian hàng.` : null;
}

/** Tiền hàng phần kho Tubu giao — ngưỡng miễn phí vận chuyển chỉ tính trên phần này (hàng gian hàng tự giao có phí riêng). */
export function tubuSubtotal<T extends { fulfiller?: LineFulfiller; total: number }>(items: T[]): number {
  return items.reduce((s, it) => s + ((it.fulfiller?.kind ?? 'TUBU') === 'TUBU' ? it.total : 0), 0);
}
