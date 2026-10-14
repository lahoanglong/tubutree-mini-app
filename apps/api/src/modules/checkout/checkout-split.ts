import { isPancakeFulfilledLine } from '../integrations/pancake/pancake-fulfilment';
import { MERCHANT_PORTAL_ROLES } from '../merchant/merchant-config';

/**
 * Tách một lần đặt thành một đơn cho mỗi nơi giao (docs/2026-10-14-merchant-fulfilment-design.md mục 3). Hàm thuần —
 * checkout gọi để báo giá và để ghi đơn, test khoá phép chia tiền.
 */

/**
 * Vì sao dòng không giao được: gian hàng tạm nghỉ (đối tác tự bật), gian hàng ngừng bán (chủ gian hàng bị khoá hoặc không còn
 * vào được Cổng người bán). Không có = không có đường giao (thiếu mã Pancake, mất gian hàng).
 */
export type UnavailableReason = 'STORE_PAUSED' | 'STORE_CLOSED';

export type LineFulfiller =
  | { kind: 'TUBU'; storefrontId: null; name: string; ownerUserId: null }
  | { kind: 'MERCHANT'; storefrontId: string; name: string; ownerUserId: string | null }
  | { kind: 'UNAVAILABLE'; storefrontId: null; name: string; ownerUserId: null; reason?: UnavailableReason };

export const TUBU_FULFILLER_NAME = 'Tubu Tree';

export interface FulfilmentSource {
  pancakeId: string | null;
  product: {
    fulfilment: string;
    storefrontId: string | null;
    storefront?: {
      title: string;
      ownerUserId: string | null;
      type: string;
      ordersPausedAt: Date | null;
      owner: { role: string; isBlocked: boolean } | null;
    } | null;
  };
}

const PORTAL_ROLES: readonly string[] = MERCHANT_PORTAL_ROLES;

/**
 * Gian hàng đối tác không nhận đơn lúc này: chủ gian hàng bị khoá hoặc không còn vào được Cổng người bán (ngừng bán), hoặc đối tác
 * bấm "Tạm nghỉ". Một nguồn cho giỏ, checkout và trang sản phẩm.
 */
export function merchantStoreUnavailableReason(store: {
  ordersPausedAt: Date | null;
  owner: { role: string; isBlocked: boolean } | null;
}): UnavailableReason | null {
  const owner = store.owner;
  if (!owner || owner.isBlocked || !PORTAL_ROLES.includes(owner.role)) return 'STORE_CLOSED';
  if (store.ordersPausedAt) return 'STORE_PAUSED';
  return null;
}

/**
 * Nơi giao của một biến thể. Hàng đối tác tự giao cần thuộc gian hàng đối tác (chỉ chủ gian hàng MERCHANT có màn "Đơn cần
 * giao") mà chủ còn vào được Cổng người bán và gian hàng không tạm nghỉ; hàng Tubu cần mã Pancake thật.
 */
export function fulfillerOf(v: FulfilmentSource): LineFulfiller {
  if (v.product.fulfilment === 'MERCHANT') {
    const store = v.product.storefront;
    if (v.product.storefrontId && store?.type === 'MERCHANT') {
      const reason = merchantStoreUnavailableReason(store);
      if (reason) return { kind: 'UNAVAILABLE', storefrontId: null, name: store.title, ownerUserId: null, reason };
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
  /** Sản phẩm của dòng — để mã gắn sản phẩm (`Coupon.applyTo.productIds`) chỉ rơi vào đúng dòng đó. */
  productId?: string;
  total: number;
  isFlash: boolean;
  fulfiller: LineFulfiller;
  /** Hàng của gian hàng đối tác (cart/partner-goods.ts) — gồm hàng Tubu giao hộ, nằm trong kiện Tubu. */
  partnerOwned?: boolean;
}

/** Dòng không nhận Điểm Xanh: hàng của gian hàng đối tác, kể cả hàng tự giao (luôn là hàng của gian hàng). */
function partnerLine(l: SplitLine): boolean {
  return l.partnerOwned === true || l.fulfiller.kind === 'MERCHANT';
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
  /** Sản phẩm mã giảm giá áp được (null/không có = mọi sản phẩm không flash). */
  couponProductIds?: string[] | null;
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
  /** Tiền khách thực trả từng dòng của kiện (cùng thứ tự `lines`) — lưu vào OrderItem.paidTotal; cộng lại = goodsAfterAll. */
  linePaid: number[];
  /** Phần Điểm Xanh (đồng) của từng dòng — lưu vào OrderItem.pointsDiscount; dòng hàng đối tác luôn 0. */
  linePoints: number[];
}

/** Các khoản giảm của một dòng và tiền khách thực trả cho dòng đó. */
export interface LineAmounts {
  total: number;
  combo: number;
  coupon: number;
  tier: number;
  points: number;
  paid: number;
}

const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** allocateProRata trên bộ trọng số đầu tiên có tổng dương (bộ sau là đường lùi khi bộ trước không có dòng nào được hưởng). */
function spread(amount: number, ...weightSets: number[][]): number[] {
  const chosen = weightSets.find((w) => sumOf(w.map((x) => Math.max(0, x))) > 0) ?? weightSets[weightSets.length - 1] ?? [];
  return allocateProRata(amount, chosen);
}

/** Combo về đúng dòng không flash của nó; phần lệch (nếu có) vào dòng không flash đầu tiên. */
function lineCombos(lines: SplitLine[], t: Pick<CheckoutTotals, 'comboPerLine' | 'comboTotal'>): number[] {
  const combo = lines.map((l) => (l.isFlash ? 0 : (t.comboPerLine[l.variationId] ?? 0)));
  const gap = t.comboTotal - sumOf(combo);
  if (gap !== 0 && lines.length > 0) combo[Math.max(0, lines.findIndex((l) => !l.isFlash))]! += gap;
  return combo;
}

function couponEligible(l: SplitLine, productIds: string[] | null | undefined): boolean {
  return !l.isFlash && (!productIds || (l.productId != null && productIds.includes(l.productId)));
}

/** Nền từng bước của các dòng: sau combo (hàng không flash) và phần mã giảm giá được hưởng. */
function lineBases(lines: SplitLine[], combo: number[], productIds: string[] | null | undefined) {
  const afterCombo = lines.map((l, k) => (l.isFlash ? 0 : Math.max(0, l.total - combo[k]!)));
  const eligible = lines.map((l, k) => (couponEligible(l, productIds) ? afterCombo[k]! : 0));
  return { afterCombo, eligible };
}

function splitOverLines(
  lines: SplitLine[],
  combo: number[],
  amounts: { coupon: number; tier: number; points: number },
  productIds: string[] | null | undefined,
): LineAmounts[] {
  const { afterCombo, eligible } = lineBases(lines, combo, productIds);
  const coupon = spread(amounts.coupon, eligible, afterCombo);
  const afterCoupon = afterCombo.map((b, k) => Math.max(0, b - coupon[k]!));
  const tier = spread(amounts.tier, afterCoupon, afterCombo);
  const redeem = lines.map((l, k) =>
    partnerLine(l) ? 0 : l.isFlash ? Math.max(0, l.total) : Math.max(0, afterCoupon[k]! - tier[k]!),
  );
  const points = allocateProRata(amounts.points, redeem);
  return lines.map((l, k) => ({
    total: l.total,
    combo: combo[k]!,
    coupon: coupon[k]!,
    tier: tier[k]!,
    points: points[k]!,
    paid: l.total - combo[k]! - coupon[k]! - tier[k]! - points[k]!,
  }));
}

/**
 * Chia các khoản giảm của cả lần đặt về TỪNG DÒNG theo đúng dòng được hưởng, cùng thứ tự áp với CheckoutService.compute:
 * combo về dòng của nó → mã trên các dòng không flash mà mã áp được (mã gắn sản phẩm: chỉ dòng sản phẩm đó), sau combo →
 * hạng trên phần còn lại không flash → Điểm Xanh trên phần còn lại của hàng Tubu cộng hàng Tubu flash. Dòng không được hưởng
 * khoản nào thì không gánh đồng nào của khoản đó (hàng giao hộ của đối tác không gánh mã gắn sản phẩm Tubu, hàng flash không
 * gánh mã/hạng, hàng của gian hàng đối tác không nhận Điểm Xanh).
 */
export function allocateLineAmounts(lines: SplitLine[], t: CheckoutTotals): LineAmounts[] {
  return splitOverLines(
    lines,
    lineCombos(lines, t),
    { coupon: t.couponDiscount, tier: t.tierDiscount, points: t.pointsDiscount },
    t.couponProductIds,
  );
}

/**
 * Nền tối đa của Điểm Xanh: tiền hàng Tubu sau combo, mã, hạng (cộng hàng Tubu flash). Hàng của gian hàng đối tác chỉ trả bằng
 * tiền nên không vào nền. Giỏ chỉ hàng Tubu: đúng bằng nền cũ (tiền hàng không flash sau combo, mã, hạng + hàng flash).
 */
export function pointsRedeemBase(lines: SplitLine[], t: Omit<CheckoutTotals, 'pointsDiscount' | 'pointsUsed' | 'pointsUsedConverted'>): number {
  const out = allocateLineAmounts(lines, { ...t, pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0 });
  return lines.reduce((s, l, k) => s + (partnerLine(l) ? 0 : Math.max(0, out[k]!.paid)), 0);
}

/**
 * Phân bổ các khoản giảm của cả lần đặt về từng kiện rồi về từng dòng của kiện, cùng luật allocateLineAmounts: mã gắn sản
 * phẩm chỉ vào kiện có sản phẩm đó, hàng flash không nhận mã/hạng, Điểm Xanh chỉ vào dòng hàng Tubu. Mỗi khoản chia theo nền
 * của chính bước đó nên tổng từng kiện (và từng dòng) khớp từng đồng với cả lần đặt.
 */
export function allocateGroupAmounts(groups: { lines: SplitLine[] }[], t: CheckoutTotals): GroupAmounts[] {
  const flat = groups.flatMap((g) => g.lines);
  const combo = lineCombos(flat, t);
  const { afterCombo, eligible } = lineBases(flat, combo, t.couponProductIds);
  const starts: number[] = [];
  groups.reduce((at, g) => {
    starts.push(at);
    return at + g.lines.length;
  }, 0);
  const slice = <T>(xs: T[], i: number) => xs.slice(starts[i]!, starts[i]! + groups[i]!.lines.length);
  const perGroup = (xs: number[]) => groups.map((_, i) => sumOf(slice(xs, i)));
  const subtotal = perGroup(flat.map((l) => l.total));
  const comboG = perGroup(combo);
  const afterComboG = perGroup(afterCombo);
  const coupon = spread(t.couponDiscount, perGroup(eligible), afterComboG);
  const tierBase = afterComboG.map((b, i) => Math.max(0, b - coupon[i]!));
  const tier = spread(t.tierDiscount, tierBase, afterComboG);
  const redeemBase = groups.map((g, i) => {
    const before = splitOverLines(g.lines, slice(combo, i), { coupon: coupon[i]!, tier: tier[i]!, points: 0 }, t.couponProductIds);
    return g.lines.reduce((s, l, k) => s + (partnerLine(l) ? 0 : Math.max(0, before[k]!.paid)), 0);
  });
  const points = allocateProRata(t.pointsDiscount, redeemBase);
  const standard = allocateProRata(t.pointsUsed - t.pointsUsedConverted, points);
  const converted = allocateProRata(t.pointsUsedConverted, points);
  return groups.map((g, i) => {
    const discount = comboG[i]! + coupon[i]! + tier[i]! + points[i]!;
    const lines = splitOverLines(
      g.lines,
      slice(combo, i),
      { coupon: coupon[i]!, tier: tier[i]!, points: points[i]! },
      t.couponProductIds,
    );
    return {
      subtotal: subtotal[i]!,
      comboDiscount: comboG[i]!,
      couponDiscount: coupon[i]!,
      tierDiscount: tier[i]!,
      pointsDiscount: points[i]!,
      pointsUsed: standard[i]! + converted[i]!,
      pointsUsedConverted: converted[i]!,
      discount,
      goodsAfterAll: Math.max(0, subtotal[i]! - discount),
      linePaid: lines.map((l) => l.paid),
      linePoints: lines.map((l) => l.points),
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

export interface PublicLineFulfiller {
  kind: LineFulfiller['kind'];
  storefrontId: string | null;
  name: string;
  reason?: UnavailableReason;
}

/** Nơi giao trả cho khách (giỏ, báo giá): không kèm ID chủ gian hàng (R2-MERCHANT-14). */
export function publicFulfiller(f: LineFulfiller): PublicLineFulfiller {
  const { ownerUserId: _owner, ...rest } = f;
  return rest;
}

/** Giỏ trả cho khách: nơi giao từng dòng không kèm ID chủ gian hàng (R2-MERCHANT-14). */
export function toPublicCart<C extends { items: { fulfiller: LineFulfiller }[] }>(cart: C) {
  return { ...cart, items: cart.items.map((it) => ({ ...it, fulfiller: publicFulfiller(it.fulfiller) })) };
}

/** Câu báo cho khách khi thêm vào giỏ hàng của gian hàng chưa nhận đơn (R3-MERCHANT-3). */
export function storeUnavailableOnAddMessage(productName: string, storeName: string, reason: UnavailableReason): string {
  return reason === 'STORE_PAUSED'
    ? `${storeName} đang tạm nghỉ, chưa nhận đơn "${productName}". Bạn quay lại đặt sau nhé.`
    : `${storeName} đã ngừng bán trên Tubu Tree, "${productName}" không đặt được nữa.`;
}

/** Câu báo cho khách khi lần đặt có dòng không giao được. */
export function unavailableLineMessage(productName: string, f: Extract<LineFulfiller, { kind: 'UNAVAILABLE' }>): string {
  if (f.reason === 'STORE_PAUSED') {
    return `${f.name} đang tạm nghỉ, chưa nhận đơn "${productName}". Vui lòng bỏ sản phẩm này khỏi đơn hoặc đặt lại sau.`;
  }
  if (f.reason === 'STORE_CLOSED') {
    return `${f.name} đã ngừng bán trên Tubu Tree, "${productName}" không đặt được nữa. Vui lòng bỏ sản phẩm này khỏi đơn.`;
  }
  return `Sản phẩm "${productName}" đang được cập nhật thông tin giao hàng, tạm thời chưa đặt được. Vui lòng bỏ khỏi đơn hoặc thử lại sau.`;
}
