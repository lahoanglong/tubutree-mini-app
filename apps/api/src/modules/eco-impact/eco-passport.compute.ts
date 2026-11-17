import { VN_OFFSET_MS } from '../../common/vn-time';
import { factsForVariation } from './eco-facts.rules';

export const PASSPORT_MONTHS = 6;

export type EcoStampId = 'first_order' | 'plastic_1kg' | 'refill_5' | 'waste_3' | 'tree_1';

/** Cùng dạng với `EcoPassport` ở `packages/app-core/src/eco/passport.ts` (API không phụ thuộc app-core; app-core kiểm dạng lúc đọc). */
export interface EcoPassport {
  /** Ngày giao của đơn giao đầu tiên (ISO); null khi khách chưa có đơn giao. */
  firstOrderAt: string | null;
  plasticAvoidedGrams: number;
  refillPacks: number;
  wasteReturned: { requests: number; grams: number; unitsWithoutWeight: number };
  trees: { pledged: number; planted: number };
  /** Chỉ có số khi ít nhất một sự thật đã tính có `co2Grams`; không thì null và giao diện không vẽ ô này. */
  co2Grams: number | null;
  /** 6 tháng gần nhất theo giờ Việt Nam, cũ trước: số việc xanh (đơn có món mang sự thật xanh, lần Đổi rác xong, cây cam kết). */
  monthly: { month: string; actions: number }[];
  stamps: { id: EcoStampId; reached: boolean }[];
}

export interface PassportFact {
  productId: string;
  variationId: string | null;
  kind: string;
  valueGrams: number | null;
  co2Grams: number | null;
}

export interface PassportInput {
  /** Dòng của đơn DELIVERED, đã trừ số lượng thuộc yêu cầu trả hàng chưa bị từ chối (`netQty`). */
  items: { orderId: string; productId: string; variationId: string; netQty: number; at: Date }[];
  firstDeliveredAt: Date | null;
  facts: PassportFact[];
  waste: { at: Date; lines: { receivedQty: number | null; gramsPerUnit: number | null }[] }[];
  trees: { at: Date; planted: boolean }[];
}

/** 'YYYY-MM' giờ Việt Nam. */
const monthKey = (d: Date): string => new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 7);

function lastMonths(now: Date, n: number): string[] {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const pos = (n: number | null | undefined): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Hộ chiếu Xanh từ số liệu đã đọc, thuần để kiểm bằng spec. Chỉ sự thật đã duyệt được truyền vào; sự thật của một phân loại chỉ áp cho
 * dòng đơn của đúng phân loại đó (xem `factsForVariation`). Không ghi gì, không phát điểm.
 */
export function computePassport(input: PassportInput, now: Date): EcoPassport {
  const factsByProduct = new Map<string, PassportFact[]>();
  for (const f of input.facts) {
    const list = factsByProduct.get(f.productId);
    if (list) list.push(f);
    else factsByProduct.set(f.productId, [f]);
  }

  const months = lastMonths(now, PASSPORT_MONTHS);
  const actions = new Map<string, number>(months.map((m) => [m, 0]));
  const bump = (d: Date, n = 1) => {
    const k = monthKey(d);
    if (actions.has(k)) actions.set(k, (actions.get(k) ?? 0) + n);
  };

  let plastic = 0;
  let refill = 0;
  let co2 = 0;
  let co2Known = false;
  const greenOrders = new Map<string, Date>();
  for (const it of input.items) {
    const qty = pos(it.netQty);
    if (qty === 0) continue;
    const facts = factsForVariation(factsByProduct.get(it.productId) ?? [], it.variationId);
    if (facts.length === 0) continue;
    greenOrders.set(it.orderId, it.at);
    for (const f of facts) {
      if (f.kind === 'PLASTIC_AVOIDED') plastic += pos(f.valueGrams) * qty;
      if (f.kind === 'REFILL_PACK') refill += qty;
      if (typeof f.co2Grams === 'number' && f.co2Grams > 0) {
        co2Known = true;
        co2 += f.co2Grams * qty;
      }
    }
  }
  for (const at of greenOrders.values()) bump(at);

  let wasteGrams = 0;
  let wasteUnits = 0;
  for (const w of input.waste) {
    bump(w.at);
    for (const l of w.lines) {
      const q = pos(l.receivedQty);
      if (pos(l.gramsPerUnit) > 0) wasteGrams += q * pos(l.gramsPerUnit);
      else wasteUnits += q;
    }
  }

  let planted = 0;
  for (const t of input.trees) {
    if (t.planted) planted += 1;
    bump(t.at);
  }

  return {
    firstOrderAt: input.firstDeliveredAt ? input.firstDeliveredAt.toISOString() : null,
    plasticAvoidedGrams: plastic,
    refillPacks: refill,
    wasteReturned: { requests: input.waste.length, grams: wasteGrams, unitsWithoutWeight: wasteUnits },
    trees: { pledged: input.trees.length, planted },
    co2Grams: co2Known ? co2 : null,
    monthly: months.map((m) => ({ month: m, actions: actions.get(m) ?? 0 })),
    stamps: [
      { id: 'first_order', reached: input.firstDeliveredAt !== null },
      { id: 'plastic_1kg', reached: plastic >= 1000 },
      { id: 'refill_5', reached: refill >= 5 },
      { id: 'waste_3', reached: input.waste.length >= 3 },
      { id: 'tree_1', reached: input.trees.length >= 1 },
    ],
  };
}
