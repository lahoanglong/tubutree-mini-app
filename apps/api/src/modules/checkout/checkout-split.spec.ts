import { computeReturnShares, storedLinePaid } from '../orders/refund-allocation';
import {
  allocateGroupAmounts,
  allocateLineAmounts,
  allocateProRata,
  allocationError,
  pointsRedeemBase,
  fulfillerOf,
  groupByFulfiller,
  paymentMethodBlockReason,
  publicFulfiller,
  unavailableLineMessage,
  type LineFulfiller,
  type SplitLine,
} from './checkout-split';

const TUBU: LineFulfiller = { kind: 'TUBU', storefrontId: null, name: 'Tubu Tree', ownerUserId: null };
const SHOP_A: LineFulfiller = { kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A', ownerUserId: 'u-a' };
const SHOP_B: LineFulfiller = { kind: 'MERCHANT', storefrontId: 'sf-b', name: 'Shop B', ownerUserId: 'u-b' };

const line = (variationId: string, total: number, fulfiller: LineFulfiller, isFlash = false): SplitLine => ({
  variationId,
  total,
  isFlash,
  fulfiller,
});

describe('fulfillerOf', () => {
  it('hàng Tubu có mã Pancake → TUBU; hàng đối tác tự giao → gian hàng của nó', () => {
    expect(fulfillerOf({ pancakeId: 'pv1', product: { fulfilment: 'TUBU', storefrontId: null } }).kind).toBe('TUBU');
    expect(
      fulfillerOf({
        pancakeId: null,
        product: {
          fulfilment: 'MERCHANT',
          storefrontId: 'sf-a',
          storefront: { title: 'Shop A', ownerUserId: 'u-a', type: 'MERCHANT', ordersPausedAt: null, owner: { role: 'DEALER', isBlocked: false } },
        },
      }),
    ).toEqual(SHOP_A);
  });

  it('"Tubu giao hộ" (sản phẩm đối tác, fulfilment TUBU, biến thể có mã Pancake) → kho Tubu giao', () => {
    expect(fulfillerOf({ pancakeId: 'pv9', product: { fulfilment: 'TUBU', storefrontId: 'sf-a' } }).kind).toBe('TUBU');
  });

  it('hàng tự giao trên gian hàng không phải gian hàng đối tác (CTV, gian hàng của admin) → UNAVAILABLE: chủ gian hàng không có màn xử lý đơn', () => {
    for (const type of ['CTV', 'BRAND']) {
      expect(
        fulfillerOf({
          pancakeId: null,
          product: { fulfilment: 'MERCHANT', storefrontId: 'sf-c', storefront: { title: 'Shop C', ownerUserId: 'u-c', type, ordersPausedAt: null, owner: { role: 'DEALER', isBlocked: false } } },
        }).kind,
      ).toBe('UNAVAILABLE');
    }
    expect(fulfillerOf({ pancakeId: null, product: { fulfilment: 'MERCHANT', storefrontId: 'sf-c', storefront: null } }).kind).toBe(
      'UNAVAILABLE',
    );
  });

  const merchantLine = (store: Record<string, unknown>) => ({
    pancakeId: null,
    product: {
      fulfilment: 'MERCHANT',
      storefrontId: 'sf-a',
      storefront: { title: 'Shop A', ownerUserId: 'u-a', type: 'MERCHANT', ordersPausedAt: null, owner: { role: 'DEALER', isBlocked: false }, ...store },
    },
  });

  it('R2-MERCHANT-3: chủ gian hàng bị hạ quyền (không còn vào được Cổng người bán) hoặc bị khoá → UNAVAILABLE kèm lý do, không nhận đơn tự giao', () => {
    for (const owner of [{ role: 'CUSTOMER', isBlocked: false }, { role: 'STAFF', isBlocked: false }, { role: 'DEALER', isBlocked: true }, null]) {
      expect(fulfillerOf(merchantLine({ owner }))).toEqual({
        kind: 'UNAVAILABLE',
        storefrontId: null,
        name: 'Shop A',
        ownerUserId: null,
        reason: 'STORE_CLOSED',
      });
    }
    for (const role of ['DEALER', 'AFFILIATE', 'ADMIN']) {
      expect(fulfillerOf(merchantLine({ owner: { role, isBlocked: false } })).kind).toBe('MERCHANT');
    }
  });

  it('R2-MERCHANT-13: gian hàng đang tạm nghỉ → UNAVAILABLE lý do STORE_PAUSED', () => {
    expect(fulfillerOf(merchantLine({ ordersPausedAt: new Date() }))).toMatchObject({
      kind: 'UNAVAILABLE',
      name: 'Shop A',
      reason: 'STORE_PAUSED',
    });
  });

  it('không có đường giao (hàng Tubu thiếu mã, mã giả MCH_, hàng đối tác mất gian hàng) → UNAVAILABLE', () => {
    expect(fulfillerOf({ pancakeId: null, product: { fulfilment: 'TUBU', storefrontId: null } }).kind).toBe('UNAVAILABLE');
    expect(fulfillerOf({ pancakeId: 'MCH_1_x_VAR', product: { fulfilment: 'TUBU', storefrontId: 'sf' } }).kind).toBe('UNAVAILABLE');
    expect(fulfillerOf({ pancakeId: null, product: { fulfilment: 'MERCHANT', storefrontId: null } }).kind).toBe('UNAVAILABLE');
  });
});

describe('groupByFulfiller', () => {
  it('kiện Tubu đứng đầu, gian hàng theo thứ tự trong giỏ', () => {
    const groups = groupByFulfiller([line('a1', 1, SHOP_A), line('t1', 1, TUBU), line('b1', 1, SHOP_B), line('a2', 1, SHOP_A)]);
    expect(groups.map((g) => g.key)).toEqual(['TUBU', 'MERCHANT:sf-a', 'MERCHANT:sf-b']);
    expect(groups[1]!.lines.map((l) => l.variationId)).toEqual(['a1', 'a2']);
  });
});

describe('allocateProRata', () => {
  it('tổng luôn đúng từng đồng, chia theo tỉ lệ', () => {
    expect(allocateProRata(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProRata(10_000, [300_000, 100_000])).toEqual([7_500, 2_500]);
    expect(allocateProRata(7, [0, 0])).toEqual([7, 0]);
    expect(allocateProRata(0, [5, 5])).toEqual([0, 0]);
    for (const total of [1, 99, 12_345, 1_000_001]) {
      const parts = allocateProRata(total, [3, 7, 11, 0, 2]);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(total);
    }
  });
});

describe('allocateGroupAmounts', () => {
  it('một kiện: giữ nguyên mọi khoản của cả lần đặt (đơn chỉ hàng Tubu không đổi)', () => {
    const [g] = allocateGroupAmounts([{ lines: [line('t1', 300_000, TUBU), line('t2', 50_000, TUBU, true)] }], {
      comboPerLine: { t1: 10_000 },
      comboTotal: 10_000,
      couponDiscount: 20_000,
      tierDiscount: 13_500,
      pointsDiscount: 30_000,
      pointsUsed: 30,
      pointsUsedConverted: 5,
    });
    expect(g).toEqual({
      subtotal: 350_000,
      comboDiscount: 10_000,
      couponDiscount: 20_000,
      tierDiscount: 13_500,
      pointsDiscount: 30_000,
      pointsUsed: 30,
      pointsUsedConverted: 5,
      discount: 73_500,
      goodsAfterAll: 276_500,
      // t1: 300.000 − combo 10.000 − mã 20.000 − hạng 13.500 − điểm 25.106; t2 (flash): 50.000 − điểm 4.894.
      linePaid: [231_394, 45_106],
      linePoints: [25_106, 4_894],
    });
  });

  it('nhiều kiện: mỗi khoản chia theo nền của bước đó, tổng các kiện khớp cả lần đặt', () => {
    const groups = [
      { lines: [line('t1', 200_000, TUBU), line('tf', 40_000, TUBU, true)] },
      { lines: [line('a1', 100_000, SHOP_A)] },
      { lines: [line('b1', 33_333, SHOP_B)] },
    ];
    const t = {
      comboPerLine: { a1: 5_000 },
      comboTotal: 5_000,
      couponDiscount: 32_777,
      tierDiscount: 9_999,
      pointsDiscount: 50_000,
      pointsUsed: 50,
      pointsUsedConverted: 7,
    };
    const out = allocateGroupAmounts(groups, t);
    const sum = (k: Exclude<keyof (typeof out)[number], 'linePaid' | 'linePoints'>) => out.reduce((s, g) => s + g[k], 0);
    expect(sum('comboDiscount')).toBe(5_000);
    expect(sum('couponDiscount')).toBe(32_777);
    expect(sum('tierDiscount')).toBe(9_999);
    expect(sum('pointsDiscount')).toBe(50_000);
    expect(sum('pointsUsed')).toBe(50);
    expect(sum('pointsUsedConverted')).toBe(7);
    expect(sum('goodsAfterAll')).toBe(373_333 - 5_000 - 32_777 - 9_999 - 50_000);
    expect(out[1]!.comboDiscount).toBe(5_000);
    expect(out[0]!.comboDiscount).toBe(0);
    for (const g of out) {
      expect(g.pointsUsedConverted).toBeLessThanOrEqual(g.pointsUsed);
      expect(g.goodsAfterAll).toBe(g.subtotal - g.discount);
      expect(g.linePaid.reduce((s, v) => s + v, 0)).toBe(g.goodsAfterAll);
    }
  });

  it('hàng flash không nhận phần mã/hạng nhưng vẫn nhận phần Điểm Xanh', () => {
    const out = allocateGroupAmounts(
      [{ lines: [line('tf', 100_000, TUBU, true)] }, { lines: [line('a1', 100_000, SHOP_A)] }],
      { comboPerLine: {}, comboTotal: 0, couponDiscount: 10_000, tierDiscount: 4_500, pointsDiscount: 20_000, pointsUsed: 20, pointsUsedConverted: 0 },
    );
    expect(out[0]!.couponDiscount).toBe(0);
    expect(out[0]!.tierDiscount).toBe(0);
    expect(out[1]!.couponDiscount).toBe(10_000);
    expect(out[0]!.pointsDiscount + out[1]!.pointsDiscount).toBe(20_000);
    expect(out[0]!.pointsDiscount).toBeGreaterThan(out[1]!.pointsDiscount);
  });
});

describe('allocateLineAmounts — mỗi khoản giảm chỉ rơi vào dòng được hưởng (Q8 review M1)', () => {
  const scoped = (variationId: string, productId: string, total: number, fulfiller: LineFulfiller, isFlash = false): SplitLine => ({
    variationId,
    productId,
    total,
    isFlash,
    fulfiller,
  });
  const none = { comboPerLine: {}, comboTotal: 0, couponDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0 };

  it('(a) mã 50.000 chỉ cho sản phẩm T: dòng hàng giao hộ C không gánh đồng nào (trước: C 83.333)', () => {
    const lines = [scoped('vT', 'pT', 200_000, TUBU), scoped('vC', 'pC', 100_000, TUBU)];
    const out = allocateLineAmounts(lines, { ...none, couponDiscount: 50_000, couponProductIds: ['pT'] });
    expect(out.map((l) => [l.coupon, l.paid])).toEqual([
      [50_000, 150_000],
      [0, 100_000],
    ]);
  });

  it('(b) mã 20% chỉ trên hàng không flash: hàng flash C giữ đủ 100.000 (trước: 86.667)', () => {
    const lines = [scoped('vT', 'pT', 200_000, TUBU), scoped('vC', 'pC', 100_000, TUBU, true)];
    const out = allocateLineAmounts(lines, { ...none, couponDiscount: 40_000 });
    expect(out.map((l) => l.paid)).toEqual([160_000, 100_000]);
  });

  it('(c) mã 50.000 cho sản phẩm Tubu P: kiện gian hàng tự giao không bị trừ (trước: 16.667 → đơn gian hàng 113.333)', () => {
    const groups = [{ lines: [scoped('vP', 'pP', 200_000, TUBU)] }, { lines: [scoped('vM', 'pM', 100_000, SHOP_A)] }];
    const [tubu, shop] = allocateGroupAmounts(groups, { ...none, couponDiscount: 50_000, couponProductIds: ['pP'] });
    expect(tubu).toMatchObject({ couponDiscount: 50_000, goodsAfterAll: 150_000, linePaid: [150_000] });
    expect(shop).toMatchObject({ couponDiscount: 0, discount: 0, goodsAfterAll: 100_000, linePaid: [100_000] });
  });

  it('combo về đúng dòng; mã trên dòng khớp sau combo; hạng trên hàng không flash; Điểm Xanh trên hàng Tubu (cả flash); tổng khớp cả lần đặt', () => {
    const lines = [
      scoped('v1', 'p1', 200_000, TUBU),
      scoped('v2', 'p2', 100_000, SHOP_A),
      scoped('vf', 'pf', 50_000, TUBU, true),
    ];
    const out = allocateLineAmounts(lines, {
      comboPerLine: { v2: 10_000 },
      comboTotal: 10_000,
      couponDiscount: 30_000,
      couponProductIds: ['p2'],
      tierDiscount: 12_000,
      pointsDiscount: 20_000,
      pointsUsed: 20,
      pointsUsedConverted: 0,
    });
    expect(out.map((l) => [l.combo, l.coupon])).toEqual([
      [0, 0],
      [10_000, 30_000],
      [0, 0],
    ]);
    // hạng 12.000 chia theo phần còn lại không flash: 200.000 và 60.000.
    expect(out.map((l) => l.tier)).toEqual([9_231, 2_769, 0]);
    expect(out[1]!.points).toBe(0);
    expect(out[2]!.points).toBeGreaterThan(0);
    expect(out.reduce((s, l) => s + l.points, 0)).toBe(20_000);
    expect(out.reduce((s, l) => s + l.paid, 0)).toBe(350_000 - 10_000 - 30_000 - 12_000 - 20_000);
    for (const l of out) expect(l.paid).toBe(l.total - l.combo - l.coupon - l.tier - l.points);
  });
});

describe('Điểm Xanh không trả cho hàng của gian hàng đối tác (Q8 S7)', () => {
  const none = { comboPerLine: {}, comboTotal: 0, couponDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0 };
  const partner = (variationId: string, total: number, fulfiller: LineFulfiller = TUBU, isFlash = false): SplitLine => ({
    ...line(variationId, total, fulfiller, isFlash),
    partnerOwned: true,
  });

  it('nền Điểm Xanh = hàng Tubu sau combo, mã, hạng (cộng hàng Tubu giờ vàng); hàng giao hộ, hàng tự giao, hàng đối tác giờ vàng không tính', () => {
    const lines = [
      line('t', 200_000, TUBU),
      line('tf', 50_000, TUBU, true),
      partner('c', 100_000),
      partner('cf', 80_000, TUBU, true),
      line('m', 60_000, SHOP_A),
    ];
    // mã 36.000 chia theo nền không flash: t 200.000, c 100.000, m 60.000 → t 20.000; hạng 3% trên phần còn lại → t 5.400.
    expect(pointsRedeemBase(groupByFulfiller(lines), { ...none, couponDiscount: 36_000, tierDiscount: 9_720 })).toBe(200_000 - 20_000 - 5_400 + 50_000);
    expect(pointsRedeemBase(groupByFulfiller([partner('c', 100_000), line('m', 60_000, SHOP_A)]), none)).toBe(0);
  });

  it('dòng hàng giao hộ của gian hàng (cùng kiện Tubu) không nhận đồng Điểm Xanh nào', () => {
    const out = allocateLineAmounts([line('t', 100_000, TUBU), partner('c', 100_000)], {
      ...none,
      pointsDiscount: 60_000,
      pointsUsed: 60,
    });
    expect(out.map((l) => [l.points, l.paid])).toEqual([
      [60_000, 40_000],
      [0, 100_000],
    ]);
  });

  it('nhiều kiện: điểm chỉ vào kiện Tubu và chỉ vào dòng hàng Tubu; kiện gian hàng tự giao không có điểm; mỗi dòng trả về phần điểm của nó', () => {
    const groups = [{ lines: [line('t', 100_000, TUBU), partner('c', 100_000)] }, { lines: [line('m', 100_000, SHOP_A)] }];
    const [tubu, shop] = allocateGroupAmounts(groups, { ...none, pointsDiscount: 30_000, pointsUsed: 30, pointsUsedConverted: 10 });
    expect(tubu).toMatchObject({ pointsDiscount: 30_000, pointsUsed: 30, pointsUsedConverted: 10, linePaid: [70_000, 100_000], linePoints: [30_000, 0] });
    expect(shop).toMatchObject({ pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0, linePaid: [100_000], linePoints: [0] });
  });

  it('giỏ không có hàng đối tác: nền Điểm Xanh đúng bằng nền cũ (sau combo, mã, hạng + hàng giờ vàng)', () => {
    const rand = rng(7);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let n = 0; n < 1_000; n += 1) {
      const lines = Array.from({ length: int(1, 5) }, (_, k) => ({ ...line(`v${k}`, int(1, 30) * int(1_000, 99_999), TUBU, rand() < 0.3), productId: `p${k}` }));
      const nonFlash = lines.filter((l) => !l.isFlash);
      const comboPerLine: Record<string, number> = {};
      for (const l of nonFlash) if (rand() < 0.4) comboPerLine[l.variationId] = Math.floor((l.total * int(1, 30)) / 100);
      const comboTotal = Object.values(comboPerLine).reduce((s, x) => s + x, 0);
      const afterCombo = nonFlash.reduce((s, l) => s + l.total, 0) - comboTotal;
      const couponDiscount = rand() < 0.6 ? Math.min(afterCombo, int(0, 60_000)) : 0;
      const tierDiscount = Math.floor((afterCombo - couponDiscount) * 0.05);
      const flash = lines.filter((l) => l.isFlash).reduce((s, l) => s + l.total, 0);
      expect(pointsRedeemBase(groupByFulfiller(lines), { ...none, comboPerLine, comboTotal, couponDiscount, tierDiscount })).toBe(
        afterCombo - couponDiscount - tierDiscount + flash,
      );
    }
  });
});

/**
 * Bản sao NGUYÊN VĂN allocateGroupAmounts trước nhánh Q8 (uat/integration @056430e5) — làm thước đo: giỏ không có hàng
 * đối tác (một kiện Tubu) phải ra đúng từng đồng như code cũ.
 */
function preQ8GroupAmounts(
  groups: { lines: SplitLine[] }[],
  t: { comboPerLine: Record<string, number>; comboTotal: number; couponDiscount: number; tierDiscount: number; pointsDiscount: number; pointsUsed: number; pointsUsedConverted: number },
) {
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

/** PRNG cố định (mulberry32) để ca ngẫu nhiên lặp lại được. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('hồi quy: giỏ không có hàng đối tác ra đúng số như trước nhánh Q8', () => {
  it('2.000 giỏ Tubu ngẫu nhiên (combo, mã chung/gắn sản phẩm, hạng, Điểm Xanh hai lô, hàng flash): số từng kiện khớp từng đồng', () => {
    const rand = rng(20261014);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    for (let n = 0; n < 2_000; n += 1) {
      const lines = Array.from({ length: int(1, 6) }, (_, k) => ({
        ...line(`v${k}`, int(1, 40) * int(1_000, 199_999), TUBU, rand() < 0.25),
        productId: `p${k}`,
      }));
      const nonFlash = lines.filter((l) => !l.isFlash);
      const comboPerLine: Record<string, number> = {};
      for (const l of nonFlash) if (rand() < 0.4) comboPerLine[l.variationId] = Math.floor((l.total * int(1, 30)) / 100);
      const comboTotal = Object.values(comboPerLine).reduce((s, x) => s + x, 0);
      const afterCombo = nonFlash.reduce((s, l) => s + l.total - (comboPerLine[l.variationId] ?? 0), 0);
      const scoped = rand() < 0.3 && nonFlash.length > 0 ? [nonFlash[int(0, nonFlash.length - 1)]!.productId!] : null;
      const couponBase = scoped
        ? nonFlash.filter((l) => scoped.includes(l.productId!)).reduce((s, l) => s + l.total - (comboPerLine[l.variationId] ?? 0), 0)
        : afterCombo;
      const couponDiscount = rand() < 0.6 ? Math.min(couponBase, int(0, 80_000)) : 0;
      const tierDiscount = Math.floor((afterCombo - couponDiscount) * [0, 0.02, 0.03, 0.05][int(0, 3)]!);
      const flashTotal = lines.filter((l) => l.isFlash).reduce((s, l) => s + l.total, 0);
      const redeem = afterCombo - couponDiscount - tierDiscount + flashTotal;
      const pointsUsed = rand() < 0.6 ? Math.floor(Math.min(redeem, int(0, 400_000)) / 1_000) : 0;
      const t = {
        comboPerLine,
        comboTotal,
        couponDiscount,
        couponProductIds: scoped,
        tierDiscount,
        pointsDiscount: pointsUsed * 1_000,
        pointsUsed,
        pointsUsedConverted: int(0, pointsUsed),
      };
      const groups = groupByFulfiller(lines);
      const [now] = allocateGroupAmounts(groups, t);
      const [before] = preQ8GroupAmounts(groups, t);
      const { linePaid, linePoints, ...amounts } = now!;
      expect(amounts).toEqual(before);
      expect(linePoints.reduce((s, x) => s + x, 0)).toBe(before!.pointsDiscount);
      expect(linePaid.reduce((s, x) => s + x, 0)).toBe(before!.goodsAfterAll);
    }
  });
});

describe('trần Điểm Xanh và phép chia từng dòng dùng chung một phép chia (Q8 review vòng 3 M1)', () => {
  const none = { comboPerLine: {}, comboTotal: 0, couponDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0 };
  const own = (variationId: string, total: number, fulfiller: LineFulfiller, partnerOwned = false): SplitLine => ({
    ...line(variationId, total, fulfiller),
    productId: `p-${variationId}`,
    partnerOwned,
  });

  it('T 26.315 (Tubu) + C 60.000 (giao hộ) + M 35.000 (tự giao), hạng 6.065: trần 25.000đ đúng bằng phần T còn lại, T trả hết bằng điểm, C giữ 57.000', () => {
    const groups = groupByFulfiller([own('T', 26_315, TUBU), own('C', 60_000, TUBU, true), own('M', 35_000, SHOP_A, true)]);
    const t0 = { ...none, tierDiscount: 6_065 };
    expect(pointsRedeemBase(groups, t0)).toBe(25_000);
    const out = allocateGroupAmounts(groups, { ...t0, pointsDiscount: 25_000, pointsUsed: 25, pointsUsedConverted: 25 });
    expect(out[0]).toMatchObject({ subtotal: 86_315, tierDiscount: 4_315, pointsDiscount: 25_000, goodsAfterAll: 57_000, linePaid: [0, 57_000], linePoints: [25_000, 0] });
    expect(out[1]).toMatchObject({ subtotal: 35_000, tierDiscount: 1_750, pointsDiscount: 0, goodsAfterAll: 33_250, linePaid: [33_250], linePoints: [0] });
    expect(allocationError(out)).toBeNull();
  });

  it('M 33.333 (tự giao, vào giỏ trước) + T 99.999 (Tubu), hạng 6.666: trần theo đúng thứ tự kiện (T trước) là 94.999đ, đơn Tubu không giảm quá tiền hàng', () => {
    const groups = groupByFulfiller([own('M', 33_333, SHOP_A, true), own('T', 99_999, TUBU)]);
    const t0 = { ...none, tierDiscount: 6_666 };
    expect(pointsRedeemBase(groups, t0)).toBe(94_999);
    const out = allocateGroupAmounts(groups, { ...t0, pointsDiscount: 94_000, pointsUsed: 94, pointsUsedConverted: 94 });
    expect(out[0]).toMatchObject({ subtotal: 99_999, tierDiscount: 5_000, discount: 99_000, goodsAfterAll: 999, linePaid: [999] });
    expect(out[1]).toMatchObject({ subtotal: 33_333, tierDiscount: 1_666, discount: 1_666, goodsAfterAll: 31_667 });
    expect(allocationError(out)).toBeNull();
  });

  it('lưới an toàn: dòng âm, giảm quá tiền hàng, tiền các dòng lệch tiền hàng của kiện → báo lỗi (checkout ném lỗi, không tạo đơn)', () => {
    const ok = { subtotal: 100, comboDiscount: 0, couponDiscount: 0, tierDiscount: 0, pointsDiscount: 0, pointsUsed: 0, pointsUsedConverted: 0, discount: 0, goodsAfterAll: 100, linePaid: [60, 40], linePoints: [0, 0] };
    expect(allocationError([ok])).toBeNull();
    expect(allocationError([ok, { ...ok, discount: 101, pointsDiscount: 101, goodsAfterAll: 0, linePaid: [-1, 0], linePoints: [101, 0] }])).toMatch(/kiện 2/);
    expect(allocationError([{ ...ok, linePaid: [-1, 101] }])).toMatch(/âm/);
    expect(allocationError([{ ...ok, discount: 120, goodsAfterAll: 0, linePaid: [0, 0] }])).toMatch(/vượt tiền hàng/);
    expect(allocationError([{ ...ok, linePaid: [60, 39] }])).toMatch(/không khớp/);
  });

  it('5.000 giỏ ngẫu nhiên (hàng Tubu, giao hộ, tự giao; flash; combo; mã chung/gắn sản phẩm; hạng; điểm đúng trần; số lượng > 1): không dòng âm, tiền và điểm khớp từng đồng, trả hết hoàn đúng tiền đã trả, hàng đối tác không nhận điểm', () => {
    const rand = rng(20261015);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
    let atCap = 0;
    let tubuOnly = 0;
    for (let n = 0; n < 5_000; n += 1) {
      const mixed = rand() < 0.6;
      const qty = new Map<string, number>();
      const lines: SplitLine[] = Array.from({ length: int(1, 6) }, (_, k) => {
        const unit = pick([int(1, 9) * 1_000, int(1_000, 500_000), int(10, 99) * 1_111, 33_333, 26_315, 99_000]);
        const q = pick([1, 1, 1, 2, 3, 4, 7]);
        qty.set(`v${k}`, q);
        const r = rand();
        const fulfiller = mixed && r < 0.3 ? pick([SHOP_A, SHOP_B]) : TUBU;
        return { variationId: `v${k}`, productId: `p${int(0, 4)}`, total: unit * q, isFlash: rand() < 0.2, fulfiller, partnerOwned: fulfiller !== TUBU || (mixed && r < 0.55) };
      });
      const partner = (l: SplitLine) => l.partnerOwned === true;
      const nonFlash = lines.filter((l) => !l.isFlash);
      const comboPerLine: Record<string, number> = {};
      const comboPct = rand() < 0.3 ? pick([5, 10, 12, 30]) : 0;
      for (const l of nonFlash) if (comboPct > 0 && !partner(l) && rand() < 0.6) comboPerLine[l.variationId] = Math.floor((l.total * comboPct) / 100);
      const comboTotal = sum(Object.values(comboPerLine));
      const afterCombo = (l: SplitLine) => l.total - (comboPerLine[l.variationId] ?? 0);
      const goodsAfterCombo = sum(nonFlash.map(afterCombo));
      let couponDiscount = 0;
      let couponProductIds: string[] | null = null;
      if (rand() < 0.6 && goodsAfterCombo > 0) {
        const scoped = rand() < 0.4 ? [pick(['p0', 'p1', 'p2', 'p3', 'p4'])] : null;
        const base = scoped ? sum(nonFlash.filter((l) => scoped.includes(l.productId!)).map(afterCombo)) : goodsAfterCombo;
        if (base > 0) {
          couponProductIds = scoped;
          couponDiscount = rand() < 0.5 ? Math.floor((base * pick([5, 10, 20, 50, 100])) / 100) : Math.min(base, pick([5_000, 20_000, 50_000, 1_000_000]));
        }
      }
      const tierDiscount = Math.floor((goodsAfterCombo - couponDiscount) * pick([0, 0, 0.03, 0.05, 0.1]));
      const groups = groupByFulfiller(lines);
      const t0 = { ...none, comboPerLine, comboTotal, couponDiscount, couponProductIds, tierDiscount };
      const base = pointsRedeemBase(groups, t0);
      const cap = Math.floor(base / 1_000);
      const pointsUsed = rand() < 0.6 ? cap : int(0, cap);
      if (pointsUsed === cap && cap > 0) atCap += 1;
      const t = { ...t0, pointsDiscount: pointsUsed * 1_000, pointsUsed, pointsUsedConverted: int(0, pointsUsed) };
      const out = allocateGroupAmounts(groups, t);
      const ctx = () => JSON.stringify({ n, lines, t });

      expect(allocationError(out)).toBeNull();
      expect(sum(out.map((g) => g.discount))).toBe(comboTotal + couponDiscount + tierDiscount + t.pointsDiscount);
      expect(sum(out.flatMap((g) => g.linePoints))).toBe(t.pointsDiscount);
      expect(sum(out.map((g) => g.pointsUsed))).toBe(pointsUsed);
      expect(sum(out.map((g) => g.pointsUsedConverted))).toBe(t.pointsUsedConverted);
      groups.forEach((g, i) => {
        const a = out[i]!;
        expect(a.discount).toBeLessThanOrEqual(a.subtotal);
        expect(sum(a.linePaid)).toBe(a.subtotal - a.discount);
        g.lines.forEach((l, k) => {
          if (a.linePaid[k]! < 0) throw new Error(`dòng âm: ${ctx()}`);
          if (partner(l)) expect(a.linePoints[k]).toBe(0);
          if (l.isFlash) expect(a.linePaid[k]).toBe(l.total - a.linePoints[k]!);
        });
        if (!mixed) {
          tubuOnly += 1;
          const { linePaid: _p, linePoints: _q, ...amounts } = a;
          expect(amounts).toEqual(preQ8GroupAmounts(groups, t)[i]);
        }

        const shippingFee = g.fulfiller.kind === 'MERCHANT' ? pick([0, 30_000]) : a.subtotal >= 200_000 ? 0 : 19_000;
        const order = {
          total: a.goodsAfterAll + shippingFee,
          shippingFee,
          pointsUsed: a.pointsUsed,
          pointsUsedConverted: a.pointsUsedConverted,
          pointsEarned: Math.floor(a.goodsAfterAll / 10_000),
          items: g.lines.map((l, k) => ({
            id: l.variationId,
            total: afterCombo(l),
            quantity: qty.get(l.variationId)!,
            paidTotal: a.linePaid[k]!,
            pointsDiscount: a.linePoints[k]!,
          })),
        };
        expect(storedLinePaid(a.goodsAfterAll, order.items)).toEqual(a.linePaid);
        const before = new Map<string, number>();
        let money = 0;
        let shipping = 0;
        let pointsBack = 0;
        for (;;) {
          const left = order.items.filter((it) => (before.get(it.id) ?? 0) < it.quantity);
          const req = new Map<string, number>();
          for (const it of left) if (rand() < 0.5 || left.length === 1) req.set(it.id, int(1, it.quantity - (before.get(it.id) ?? 0)));
          if (req.size === 0) continue;
          const sh = computeReturnShares(order, before, req, { shopFault: rand() < 0.2, priorShipping: shipping });
          const partnerOnly = [...req.keys()].every((id) => partner(g.lines.find((l) => l.variationId === id)!));
          if (partnerOnly) expect(sh.pointsUsedBack).toBe(0);
          for (const ln of sh.lines) expect(ln.refundAmount).toBeGreaterThanOrEqual(0);
          if (sh.isFull) {
            expect(sh.goods + sh.shipping).toBe(order.total - money);
            expect(sh.pointsUsedBack).toBe(order.pointsUsed - pointsBack);
            break;
          }
          money += sh.goods + sh.shipping;
          shipping += sh.shipping;
          pointsBack += sh.pointsUsedBack;
          expect(money).toBeLessThanOrEqual(order.total);
          expect(pointsBack).toBeLessThanOrEqual(order.pointsUsed);
          for (const [id, q] of req) before.set(id, (before.get(id) ?? 0) + q);
        }
      });
    }
    expect(atCap).toBeGreaterThan(1_000);
    expect(tubuOnly).toBeGreaterThan(1_500);
  });
});

describe('paymentMethodBlockReason', () => {
  it('chỉ hàng Tubu: mọi phương thức', () => {
    expect(paymentMethodBlockReason([{ fulfiller: TUBU }], 'BANK_TRANSFER')).toBeNull();
  });
  it('hàng đối tác tự giao hoặc lần đặt bị tách: chỉ COD/Ví', () => {
    expect(paymentMethodBlockReason([{ fulfiller: SHOP_A }], 'COD')).toBeNull();
    expect(paymentMethodBlockReason([{ fulfiller: SHOP_A }], 'WALLET')).toBeNull();
    expect(paymentMethodBlockReason([{ fulfiller: SHOP_A }], 'BANK_TRANSFER')).toContain('đối tác tự giao');
    expect(paymentMethodBlockReason([{ fulfiller: TUBU }, { fulfiller: SHOP_A }], 'BANK_TRANSFER')).toContain('nhiều nơi giao');
    expect(paymentMethodBlockReason([{ fulfiller: TUBU }, { fulfiller: SHOP_A }], 'ZALOPAY')).not.toBeNull();
  });
});

describe('unavailableLineMessage / publicFulfiller', () => {
  it('nói rõ gian hàng tạm nghỉ hay đã ngừng bán, không nói chung chung "đang cập nhật"', () => {
    const base = { kind: 'UNAVAILABLE' as const, storefrontId: null, ownerUserId: null };
    expect(unavailableLineMessage('Nến thơm', { ...base, name: 'Shop B', reason: 'STORE_PAUSED' })).toBe(
      'Shop B đang tạm nghỉ, chưa nhận đơn "Nến thơm". Vui lòng bỏ sản phẩm này khỏi đơn hoặc đặt lại sau.',
    );
    expect(unavailableLineMessage('Nến thơm', { ...base, name: 'Shop B', reason: 'STORE_CLOSED' })).toContain('đã ngừng bán');
    expect(unavailableLineMessage('Nến thơm', { ...base, name: '' })).toContain('đang được cập nhật thông tin giao hàng');
  });

  it('publicFulfiller bỏ ownerUserId', () => {
    expect(publicFulfiller(SHOP_A)).toEqual({ kind: 'MERCHANT', storefrontId: 'sf-a', name: 'Shop A' });
  });
});
