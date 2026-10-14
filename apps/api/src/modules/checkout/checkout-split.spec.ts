import {
  allocateGroupAmounts,
  allocateProRata,
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
    const sum = (k: keyof (typeof out)[number]) => out.reduce((s, g) => s + g[k], 0);
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
