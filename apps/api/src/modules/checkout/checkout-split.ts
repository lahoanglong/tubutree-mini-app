import { isPancakeFulfilledLine } from '../integrations/pancake/pancake-fulfilment';

/**
 * Tách một lần đặt thành một đơn cho mỗi nơi giao (docs/2026-10-14-merchant-fulfilment-design.md mục 3). Hàm thuần —
 * checkout gọi để báo giá và để ghi đơn, test khoá phép chia tiền.
 */

export type LineFulfiller =
  | { kind: 'TUBU'; storefrontId: null; name: string; ownerUserId: null }
  | { kind: 'MERCHANT'; storefrontId: string; name: string; ownerUserId: string | null }
  | { kind: 'UNAVAILABLE'; storefrontId: null; name: string; ownerUserId: null };

export const TUBU_FULFILLER_NAME = 'Tubu Tree';

export interface FulfilmentSource {
  pancakeId: string | null;
  product: {
    fulfilment: string;
    storefrontId: string | null;
    storefront?: { title: string; ownerUserId: string | null; type: string } | null;
  };
}

/**
 * Nơi giao của một biến thể. Hàng đối tác tự giao cần thuộc gian hàng đối tác (chỉ chủ gian hàng MERCHANT có màn "Đơn cần
 * giao"); hàng Tubu cần mã Pancake thật.
 */
export function fulfillerOf(v: FulfilmentSource): LineFulfiller {
  if (v.product.fulfilment === 'MERCHANT') {
    const store = v.product.storefront;
    if (v.product.storefrontId && store?.type === 'MERCHANT') {
      return {
        kind: 'MERCHANT',
        storefrontId: v.product.storefrontId,
        name: store.title,
        ownerUserId: store.ownerUserId,
      };
    }
    return { kind: 'UNAVAILABLE', storefrontId: null, name: '', ownerUserId: null };
  }
  if (isPancakeFulfilledLine({ pancakeId: v.pancakeId, fulfilment: v.product.fulfilment })) {
    return { kind: 'TUBU', storefrontId: null, name: TUBU_FULFILLER_NAME, ownerUserId: null };
  }
  return { kind: 'UNAVAILABLE', storefrontId: null, name: '', ownerUserId: null };
}

export function fulfillerKey(f: LineFulfiller): string {
  return f.kind === 'MERCHANT' ? `MERCHANT:${f.storefrontId}` : f.kind;
}

export interface SplitLine {
  variationId: string;
  total: number;
  isFlash: boolean;
  fulfiller: LineFulfiller;
}

export interface FulfilmentGroup<L extends SplitLine> {
  key: string;
  fulfiller: LineFulfiller;
  lines: L[];
}

/** Gom dòng theo nơi giao: kiện Tubu đứng đầu, rồi các gian hàng theo thứ tự xuất hiện trong giỏ. */
export function groupByFulfiller<L extends SplitLine>(lines: L[]): FulfilmentGroup<L>[] {
  const groups = new Map<string, FulfilmentGroup<L>>();
  for (const line of lines) {
    const key = fulfillerKey(line.fulfiller);
    const g = groups.get(key);
    if (g) g.lines.push(line);
    else groups.set(key, { key, fulfiller: line.fulfiller, lines: [line] });
  }
  return [...groups.values()].sort((a, b) => Number(b.fulfiller.kind === 'TUBU') - Number(a.fulfiller.kind === 'TUBU'));
}

/**
 * Chia `total` đồng theo tỉ lệ `weights` thành số nguyên, tổng đúng bằng `total` (phương pháp số dư lớn nhất; hoà thì phần
 * đứng trước được trước). Trọng số toàn 0 → dồn hết vào phần đầu.
 */
export function allocateProRata(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total === 0) return weights.map(() => 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const exact = weights.map((w) => (total * Math.max(0, w)) / sum);
  const out = exact.map((x) => Math.floor(x));
  let rest = total - out.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) out[order[k]!.i]! += 1;
  return out;
}

export interface CheckoutTotals {
  /** Combo theo dòng (variationId → đồng). */
  comboPerLine: Record<string, number>;
  comboTotal: number;
  couponDiscount: number;
  tierDiscount: number;
  pointsDiscount: number;
  pointsUsed: number;
  pointsUsedConverted: number;
}

export interface GroupAmounts {
  subtotal: number;
  comboDiscount: number;
  couponDiscount: number;
  tierDiscount: number;
  pointsDiscount: number;
  pointsUsed: number;
  pointsUsedConverted: number;
  /** Tổng các khoản giảm — cùng cách cộng của Order.discount. */
  discount: number;
  /** Tiền hàng sau mọi khoản giảm (nền tích điểm). */
  goodsAfterAll: number;
}

/**
 * Phân bổ các khoản giảm của cả lần đặt về từng kiện, cùng thứ tự áp với CheckoutService.compute:
 * combo theo đúng dòng → mã (trên hàng không flash sau combo) → hạng (trên phần còn lại không flash) → Điểm Xanh (trên phần
 * còn lại cộng hàng flash). Mọi khoản chia theo nền của chính bước đó nên tổng từng kiện khớp từng đồng với cả lần đặt.
 */
export function allocateGroupAmounts(groups: { lines: SplitLine[] }[], t: CheckoutTotals): GroupAmounts[] {
  const subtotal = groups.map((g) => g.lines.reduce((s, l) => s + l.total, 0));
  const combo = groups.map((g) =>
    g.lines.filter((l) => !l.isFlash).reduce((s, l) => s + (t.comboPerLine[l.variationId] ?? 0), 0),
  );
  const comboGap = t.comboTotal - combo.reduce((s, x) => s + x, 0);
  if (comboGap !== 0 && combo.length > 0) combo[0]! += comboGap;
  const couponBase = groups.map((g, i) =>
    Math.max(0, g.lines.filter((l) => !l.isFlash).reduce((s, l) => s + l.total, 0) - combo[i]!),
  );
  const coupon = allocateProRata(t.couponDiscount, couponBase);
  const tierBase = couponBase.map((b, i) => Math.max(0, b - coupon[i]!));
  const tier = allocateProRata(t.tierDiscount, tierBase);
  const flash = groups.map((g) => g.lines.filter((l) => l.isFlash).reduce((s, l) => s + l.total, 0));
  const redeemBase = tierBase.map((b, i) => Math.max(0, b - tier[i]!) + flash[i]!);
  const points = allocateProRata(t.pointsDiscount, redeemBase);
  const standard = allocateProRata(t.pointsUsed - t.pointsUsedConverted, points);
  const converted = allocateProRata(t.pointsUsedConverted, points);
  return groups.map((_, i) => {
    const discount = combo[i]! + coupon[i]! + tier[i]! + points[i]!;
    return {
      subtotal: subtotal[i]!,
      comboDiscount: combo[i]!,
      couponDiscount: coupon[i]!,
      tierDiscount: tier[i]!,
      pointsDiscount: points[i]!,
      pointsUsed: standard[i]! + converted[i]!,
      pointsUsedConverted: converted[i]!,
      discount,
      goodsAfterAll: Math.max(0, subtotal[i]! - discount),
    };
  });
}

/** Phương thức thanh toán mà lần đặt được phép dùng — lý do bằng tiếng Việt để FE hiện ngay cạnh lựa chọn bị tắt. */
export const PAYMENT_METHOD_NOT_ALLOWED = 'PAYMENT_METHOD_NOT_ALLOWED';
export type CheckoutPaymentMethod = 'COD' | 'BANK_TRANSFER' | 'WALLET' | 'ZALOPAY' | 'VNPAY';
const MERCHANT_METHODS: readonly CheckoutPaymentMethod[] = ['COD', 'WALLET'];

export function paymentMethodBlockReason(
  groups: { fulfiller: LineFulfiller }[],
  method: string,
): string | null {
  if (MERCHANT_METHODS.includes(method as CheckoutPaymentMethod)) return null;
  if (groups.length > 1) {
    return 'Đơn gồm hàng do nhiều nơi giao nên chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu. Muốn chuyển khoản, hãy đặt riêng phần hàng Tubu Tree giao.';
  }
  if (groups.some((g) => g.fulfiller.kind === 'MERCHANT')) {
    return 'Hàng do gian hàng đối tác tự giao chỉ thanh toán được khi nhận hàng (COD) hoặc bằng Ví Tubu.';
  }
  return null;
}
