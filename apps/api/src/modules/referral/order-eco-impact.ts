import { measureOf, parseMeasure } from '../catalog/product-compare.unit';
import { isRefillProduct } from '../catalog/refill/refill-pairs';
import { factsForVariation } from '../eco-impact/eco-facts.rules';

/**
 * Thẻ "Đơn này bạn đã giảm X chai nhựa dùng 1 lần" ở chi tiết đơn (tubu-w11-03, cờ growth.referral_viral_enabled). Hàm thuần: số chỉ từ
 * hàng khách còn giữ (đã trừ trả hàng), không phát điểm, không ghi gì.
 */

/** Chặng đơn đã chốt nhưng chưa giao: chỉ hiện khi đã thanh toán (COD chưa giao chưa phải hàng của khách). */
const PAID_STAGES = new Set(['CONFIRMED', 'PACKED', 'SHIPPING']);

export function ecoImpactEligible(o: { status: string; paymentStatus: string; type: string; placedForCustomer: boolean }): boolean {
  // Đơn CTV lên hộ mang userId của CTV, đơn đại lý là hàng buôn: chai bớt là của người dùng cuối, không phải người xem.
  if (o.type !== 'RETAIL' || o.placedForCustomer) return false;
  if (o.status === 'DELIVERED') return true;
  return PAID_STAGES.has(o.status) && o.paymentStatus === 'PAID';
}

/**
 * Một gói Refill thay bao nhiêu chai: lượng gói (theo biến thể đã mua, không có thì theo tên sản phẩm) / lượng chai ghép với nó (cùng
 * chiều ml hay g). Nhiều chai ghép cùng gói thì lấy chai LỚN nhất, ra ít chai nhất. Không đọc được lượng, khác chiều hay gói không lớn
 * hơn chai: một gói thay một chai.
 */
export function refillBottlesPerPack(refillName: string, bottleNames: readonly string[], refillVariationName = ''): number {
  const r = measureOf(refillVariationName, refillName);
  if (!r) return 1;
  let largest = 0;
  for (const name of bottleNames) {
    const b = parseMeasure(name);
    if (b && b.unit === r.unit && b.qty > largest) largest = b.qty;
  }
  return largest > 0 ? Math.max(1, r.qty / largest) : 1;
}

export interface EcoImpactLine {
  productId: string;
  variationId: string;
  slug: string;
  /** Tên sản phẩm hiện hành (đọc lượng của gói Refill khi tên biến thể không ghi lượng). */
  name: string;
  /** Tên biến thể lúc đặt (dòng đơn). */
  variationName?: string | null;
  /** Số lượng khách còn giữ: số mua trừ số thuộc yêu cầu trả chưa bị từ chối. Quà 0đ không có dòng ở đây. */
  netQty: number;
}

export interface EcoImpactFact {
  productId: string;
  variationId: string | null;
  kind: string;
  valueGrams: number | null;
}

export interface EcoImpactContext {
  /** Bảng cặp hiện hành: id chai → id gói Refill. */
  pairs: ReadonlyMap<string, string>;
  /** Tên sản phẩm theo id, ít nhất cho các chai ghép với gói Refill có trong đơn. */
  names: ReadonlyMap<string, string>;
  /** Sự thật xanh ĐÃ DUYỆT của sản phẩm trong đơn; rỗng khi cờ eco.product_badges_enabled tắt. */
  facts: readonly EcoImpactFact[];
}

export interface EcoImpactNumbers {
  bottlesSaved: number;
  refillPacks: number;
  plasticGrams: number;
}

const pos = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

export function computeOrderEcoImpact(lines: readonly EcoImpactLine[], ctx: EcoImpactContext): EcoImpactNumbers {
  const bottlesOf = new Map<string, string[]>();
  for (const [bottleId, refillId] of ctx.pairs) bottlesOf.set(refillId, [...(bottlesOf.get(refillId) ?? []), bottleId]);
  const factsByProduct = new Map<string, EcoImpactFact[]>();
  for (const f of ctx.facts) factsByProduct.set(f.productId, [...(factsByProduct.get(f.productId) ?? []), f]);

  let bottles = 0;
  let packs = 0;
  let grams = 0;
  for (const l of lines) {
    const qty = Math.floor(pos(l.netQty));
    if (qty === 0) continue;
    if (isRefillProduct({ slug: l.slug, name: l.name })) {
      const bottleNames = (bottlesOf.get(l.productId) ?? []).map((id) => ctx.names.get(id)).filter((n): n is string => !!n);
      packs += qty;
      // Làm tròn xuống trên cả dòng; tỉ lệ ≥ 1 nên mỗi gói luôn ≥ một chai. Cộng một chút để 10L/500ml không ra 19,999…
      bottles += Math.floor(qty * refillBottlesPerPack(l.name, bottleNames, l.variationName ?? '') + 1e-9);
    }
    for (const f of factsForVariation(factsByProduct.get(l.productId) ?? [], l.variationId)) {
      if (f.kind === 'PLASTIC_AVOIDED') grams += pos(f.valueGrams) * qty;
    }
  }
  return { bottlesSaved: bottles, refillPacks: packs, plasticGrams: Math.round(grams) };
}
