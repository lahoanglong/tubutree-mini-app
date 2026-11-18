import { WASTE_CAP_STATUSES } from '../waste.constants';
import { WASTE_SEED_ITEMS } from '../waste-seed-data';
import {
  RETURN_PACKAGING_MAX_ORDERS,
  RETURN_PACKAGING_NUDGE_KEY,
  buildReturnPackaging,
  isOwnDeliveredTubuOrder,
  returnPackagingSince,
  returnableUnits,
  sameDeliveryPlace,
  type ReturnPackagingItem,
  type ReturnPackagingOrder,
} from './waste-return-packaging';
import { WasteReturnPackagingService } from './waste-return-packaging.service';

const NOW = new Date('2026-11-18T10:00:00+07:00');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const PLACE = { street: '12 Nguyễn Trãi', ward: 'Phường Bến Thành', wardCode: '79_760_26734' };

const order = (over: Partial<ReturnPackagingOrder> = {}): ReturnPackagingOrder => ({
  code: 'TT1',
  type: 'RETAIL',
  status: 'DELIVERED',
  fulfiller: 'TUBU',
  source: 'checkout',
  placedForCustomer: false,
  deliveredAt: ago(3),
  shippingAddress: { ...PLACE, recipient: 'Lan', phone: '0901234567' },
  items: [],
  ...over,
});

const seedItem = (code: string): ReturnPackagingItem => {
  const s = WASTE_SEED_ITEMS.find((i) => i.code === code)!;
  return { ...s, status: s.status };
};
const ITEMS = new Map(['CARTON', 'TUBU_BOTTLE'].map((c) => [c, seedItem(c)]));

describe('returnPackagingSince', () => {
  it('chưa gửi rác lần nào → mốc là 60 ngày trước', () => {
    expect(returnPackagingSince(NOW, null)).toEqual(ago(60));
  });
  it('lần gửi gần nhất trong 60 ngày → mốc là lần gửi đó; cũ hơn 60 ngày → vẫn 60 ngày', () => {
    expect(returnPackagingSince(NOW, ago(5))).toEqual(ago(5));
    expect(returnPackagingSince(NOW, ago(90))).toEqual(ago(60));
  });
});

describe('isOwnDeliveredTubuOrder', () => {
  const since = ago(60);
  it('đơn bán lẻ Tubu giao, khách tự nhận, giao sau mốc → có', () => {
    expect(isOwnDeliveredTubuOrder(order(), since)).toBe(true);
  });
  it.each([
    ['chưa giao', { status: 'SHIPPING' }],
    ['đã trả hàng', { status: 'RETURNED' }],
    ['đơn đại lý', { type: 'DEALER' }],
    ['gian hàng tự giao', { fulfiller: 'MERCHANT' }],
    ['CTV lên hộ khách', { placedForCustomer: true }],
    ['nguồn ctv_assisted', { source: 'ctv_assisted' }],
    ['nguồn dealer', { source: 'dealer' }],
    ['thiếu mốc giao', { deliveredAt: null }],
    ['giao trước mốc', { deliveredAt: ago(61) }],
  ] as const)('%s → không', (_, over) => {
    expect(isOwnDeliveredTubuOrder(order(over as Partial<ReturnPackagingOrder>), since)).toBe(false);
  });
  it('giao đúng lúc mốc (gửi rác cùng lúc) → không: bao bì coi như đã đi cùng lần gửi', () => {
    expect(isOwnDeliveredTubuOrder(order({ deliveredAt: ago(5) }), ago(5))).toBe(false);
  });
});

describe('sameDeliveryPlace', () => {
  it('cùng số nhà/đường bất kể dấu, hoa thường, khoảng trắng, cùng mã phường → có', () => {
    expect(sameDeliveryPlace({ ...PLACE, street: '  12  nguyen trai ' }, PLACE)).toBe(true);
  });
  it('khác mã phường → không, dù tên giống', () => {
    expect(sameDeliveryPlace({ ...PLACE, wardCode: '79_760_99999' }, PLACE)).toBe(false);
  });
  it('ảnh chụp cũ không có mã phường → so tên phường đã gấp dấu', () => {
    expect(sameDeliveryPlace({ street: PLACE.street, ward: 'phuong ben thanh' }, PLACE)).toBe(true);
    expect(sameDeliveryPlace({ street: PLACE.street, ward: 'Phường Đa Kao' }, PLACE)).toBe(false);
  });
  it('khác đường, thiếu đường hay ảnh chụp hỏng → không', () => {
    expect(sameDeliveryPlace({ ...PLACE, street: '14 Nguyễn Trãi' }, PLACE)).toBe(false);
    expect(sameDeliveryPlace({ ...PLACE, street: '' }, { ...PLACE, street: '' })).toBe(false);
    expect(sameDeliveryPlace(null, PLACE)).toBe(false);
    expect(sameDeliveryPlace('12 Nguyễn Trãi', PLACE)).toBe(false);
  });
});

describe('returnableUnits', () => {
  const items = [
    { variationId: 'v1', productId: 'p1', quantity: 2 },
    { variationId: 'v2', productId: 'p2', quantity: 3 },
    { variationId: 'v3', productId: 'p2', quantity: 4 },
    { variationId: 'v4', productId: null, quantity: 9 },
  ];
  it('nhãn cấp sản phẩm tính mọi phân loại; nhãn cấp phân loại chỉ tính đúng phân loại đó', () => {
    expect(returnableUnits(items, [{ productId: 'p1', variationId: null }])).toBe(2);
    expect(returnableUnits(items, [{ productId: 'p2', variationId: 'v3' }])).toBe(4);
    expect(returnableUnits(items, [{ productId: 'p1', variationId: null }, { productId: 'p2', variationId: null }])).toBe(9);
  });
  it('không nhãn nào, hay dòng mất sản phẩm → 0', () => {
    expect(returnableUnits(items, [])).toBe(0);
  });
});

describe('buildReturnPackaging', () => {
  const bottles = (qty: number) => [{ variationId: 'v1', productId: 'p1', quantity: qty }];
  const facts = [{ productId: 'p1', variationId: null }];

  it('một thùng carton mỗi đơn, một vỏ mỗi món có nhãn; điểm theo công thức nhóm', () => {
    const out = buildReturnPackaging([order({ code: 'TT2', items: bottles(2) }), order({ code: 'TT1' })], facts, ITEMS, 3000);
    expect(out).toEqual({
      orderCodes: ['TT2', 'TT1'],
      lines: [
        { itemId: 'wi-carton', code: 'CARTON', name: 'Thùng carton cũ', unitLabel: 'thùng', qty: 2, unitsPerPoint: 1, pointsPerGroup: 1000 },
        { itemId: 'wi-tubu-bottle', code: 'TUBU_BOTTLE', name: 'Vỏ chai, hộp Tubu Tree', unitLabel: 'vỏ', qty: 2, unitsPerPoint: 1, pointsPerGroup: 2000 },
      ],
      estimatedPoints: 6000,
      minPoints: 3000,
    });
  });

  it('không có món nhãn "Trả vỏ đổi điểm" → chỉ dòng thùng carton', () => {
    const out = buildReturnPackaging([order()], facts, ITEMS, 3000);
    expect(out?.lines.map((l) => [l.code, l.qty])).toEqual([['CARTON', 1]]);
    expect(out?.estimatedPoints).toBe(1000);
  });

  it('số lượng kẹp theo trần tháng của vỏ Tubu (20) và trần ngày của thùng (10)', () => {
    const orders = Array.from({ length: 12 }, (_, i) => order({ code: `TT${i}`, items: bottles(3) }));
    const out = buildReturnPackaging(orders, facts, ITEMS, 3000);
    expect(out?.lines.map((l) => [l.code, l.qty])).toEqual([['CARTON', 10], ['TUBU_BOTTLE', 20]]);
  });

  it('món tắt, món nguy hại hay thiếu trong danh mục → bỏ dòng; không còn dòng nào → null', () => {
    const hidden = new Map(ITEMS);
    hidden.set('CARTON', { ...seedItem('CARTON'), status: 'HIDDEN' });
    expect(buildReturnPackaging([order({ items: bottles(1) })], facts, hidden, 3000)?.lines.map((l) => l.code)).toEqual(['TUBU_BOTTLE']);
    expect(buildReturnPackaging([order()], facts, hidden, 3000)).toBeNull();
    expect(buildReturnPackaging([order()], facts, new Map([['CARTON', { ...seedItem('CARTON'), hazardous: true }]]), 3000)).toBeNull();
    expect(buildReturnPackaging([order()], facts, new Map(), 3000)).toBeNull();
  });

  it('không có đơn → null', () => {
    expect(buildReturnPackaging([], facts, ITEMS, 3000)).toBeNull();
  });
});

describe('WasteReturnPackagingService', () => {
  const dbOrder = (over: Record<string, unknown> = {}) => ({
    code: 'TT1',
    type: 'RETAIL',
    status: 'DELIVERED',
    fulfiller: 'TUBU',
    source: 'checkout',
    placedForCustomer: false,
    deliveredAt: ago(3),
    shippingAddress: { ...PLACE },
    items: [{ variationId: 'v1', quantity: 2 }],
    ...over,
  });

  function build(opts: { flag?: unknown; orders?: unknown[]; order?: unknown; lastReturnAt?: Date | null } = {}) {
    const prisma = {
      order: {
        findFirst: jest.fn().mockResolvedValue(opts.order ?? null),
        findMany: jest.fn().mockResolvedValue(opts.orders ?? []),
      },
      wasteRequest: { findFirst: jest.fn().mockResolvedValue(opts.lastReturnAt ? { createdAt: opts.lastReturnAt } : null) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', productId: 'p1' }, { id: 'v2', productId: 'p2' }]) },
      productEcoFact: { findMany: jest.fn().mockResolvedValue([{ productId: 'p1', variationId: null }]) },
      wasteItem: { findMany: jest.fn().mockResolvedValue([...ITEMS.values()]) },
    };
    const systemConfig = { get: jest.fn(async (key: string, fallback: unknown) => (key === RETURN_PACKAGING_NUDGE_KEY ? (opts.flag ?? true) : fallback)) };
    const wasteConfig = { snapshot: jest.fn().mockResolvedValue({ pickupMinPoints: 3000 }) };
    const svc = new WasteReturnPackagingService(prisma as never, systemConfig as never, wasteConfig as never);
    return { svc, prisma };
  }

  it('cờ tắt (hay giá trị không phải true) → null, không đọc đơn nào', async () => {
    for (const flag of [false, 'true', 1]) {
      const { svc, prisma } = build({ flag, order: dbOrder(), orders: [dbOrder()] });
      await expect(svc.forOrder('u1', 'TT1', NOW)).resolves.toBeNull();
      await expect(svc.forAddress('u1', PLACE, NOW)).resolves.toBeNull();
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    }
  });

  describe('forOrder', () => {
    it('đơn của chính khách đã giao → bao bì của đơn đó; chỉ tìm đơn theo mã và đúng khách', async () => {
      const { svc, prisma } = build({ order: dbOrder() });
      const out = await svc.forOrder('u1', 'TT1', NOW);
      expect(prisma.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'TT1', userId: 'u1' } }));
      expect(out).toMatchObject({ orderCodes: ['TT1'], estimatedPoints: 5000, minPoints: 3000 });
      expect(out?.lines.map((l) => [l.code, l.qty])).toEqual([['CARTON', 1], ['TUBU_BOTTLE', 2]]);
    });

    it('lần gửi rác gần nhất chỉ đếm phiếu còn hiệu lực (WASTE_CAP_STATUSES)', async () => {
      const { svc, prisma } = build({ order: dbOrder() });
      await svc.forOrder('u1', 'TT1', NOW);
      expect(prisma.wasteRequest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1', status: { in: [...WASTE_CAP_STATUSES] } } }));
    });

    it('đơn lạ, chưa giao, hay giao trước lần gửi rác gần nhất → null', async () => {
      await expect(build({ order: null }).svc.forOrder('u1', 'TT404', NOW)).resolves.toBeNull();
      await expect(build({ order: dbOrder({ status: 'SHIPPING' }) }).svc.forOrder('u1', 'TT1', NOW)).resolves.toBeNull();
      await expect(build({ order: dbOrder({ deliveredAt: ago(10) }), lastReturnAt: ago(2) }).svc.forOrder('u1', 'TT1', NOW)).resolves.toBeNull();
    });

    it('giao sau lần gửi rác gần nhất → vẫn gợi ý', async () => {
      await expect(build({ order: dbOrder({ deliveredAt: ago(1) }), lastReturnAt: ago(2) }).svc.forOrder('u1', 'TT1', NOW)).resolves.not.toBeNull();
    });
  });

  describe('forAddress', () => {
    it('chỉ gộp đơn giao tới đúng địa chỉ, tối đa 5 đơn mới nhất; truy vấn lọc đơn Tubu bán lẻ đã giao sau mốc', async () => {
      const orders = [
        dbOrder({ code: 'TT-OTHER', shippingAddress: { ...PLACE, street: '99 Lê Lợi' } }),
        ...Array.from({ length: 6 }, (_, i) => dbOrder({ code: `TT${i}`, items: [{ variationId: 'v2', quantity: 1 }] })),
      ];
      const { svc, prisma } = build({ orders, lastReturnAt: ago(20) });
      const out = await svc.forAddress('u1', PLACE, NOW);
      expect(out?.orderCodes).toEqual(['TT0', 'TT1', 'TT2', 'TT3', 'TT4']);
      expect(out?.orderCodes).toHaveLength(RETURN_PACKAGING_MAX_ORDERS);
      expect(out?.lines.map((l) => [l.code, l.qty])).toEqual([['CARTON', 5]]);
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', status: 'DELIVERED', type: 'RETAIL', fulfiller: 'TUBU', placedForCustomer: false, deliveredAt: { gt: ago(20) } },
          orderBy: [{ deliveredAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('đơn CTV hỗ trợ bị bỏ dù cùng địa chỉ; không còn đơn nào → null, không đọc danh mục', async () => {
      const { svc, prisma } = build({ orders: [dbOrder({ source: 'ctv_assisted' })] });
      await expect(svc.forAddress('u1', PLACE, NOW)).resolves.toBeNull();
      expect(prisma.wasteItem.findMany).not.toHaveBeenCalled();
    });
  });
});
