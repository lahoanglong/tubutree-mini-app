import 'reflect-metadata';
import { AffiliateService } from './affiliate.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { CoinsService } from '../wallet/coins.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
// Ship mặc định 0 cho test (override bằng mockResolvedValue trong test lên-đơn-hộ).
const pricing = { calcShippingFee: jest.fn().mockResolvedValue(0) } as unknown as PricingService;
// Không dùng ở đa số test (chỉ placeOrderForCustomer gọi) — no-op mặc định.
const pancakeOrder = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
// Chỉ claimMilestone dùng (affiliate-tier.spec.ts) — no-op ở đây.
const coins = { grantCoins: jest.fn().mockResolvedValue(undefined) } as unknown as CoinsService;

function prismaWith(order: unknown, variations: unknown[], createSpy = jest.fn()) {
  return {
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
    commission: { create: createSpy },
  } as unknown as PrismaService;
}

describe('AffiliateService.createCommissionForOrder', () => {
  it('bỏ qua khi tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false)', async () => {
    const create = jest.fn();
    const prisma = prismaWith({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false, items: [] }, [], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });

  it('CTV lên đơn hộ (referrer === buyer NHƯNG placedForCustomer=true) → VẪN tạo hoa hồng', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'ctv', // CTV vừa là người đặt (userId) vừa là người hưởng (referrerUserId)
      referrerUserId: 'ctv',
      placedForCustomer: true,
      total: 200000,
      items: [{ variationId: 'v1', total: 200000 }],
    };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 10 }], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(20000); // 10% * 200k
    expect(data.affiliateUserId).toBe('ctv');
    expect(data.status).toBe('PENDING');
  });

  it('tính hoa hồng theo rate từng SKU (floor mỗi dòng) — referrer ≠ buyer không đổi', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'buyer',
      referrerUserId: 'ctv',
      total: 300000,
      items: [
        { variationId: 'v1', total: 200000 },
        { variationId: 'v2', total: 100000 },
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'v1', affiliateRate: 10 }, // 10% * 200k = 20000
      { id: 'v2', affiliateRate: 5 }, // 5% * 100k = 5000
    ], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(25000);
    expect(data.affiliateUserId).toBe('ctv');
    expect(data.status).toBe('PENDING');
  });

  it('không tạo commission khi tổng rate = 0', async () => {
    const create = jest.fn();
    const order = { id: 'o1', userId: 'b', referrerUserId: 'ctv', total: 100000, items: [{ variationId: 'v1', total: 100000 }] };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 0 }], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });

  it('sản phẩm bị affiliateBlocked → KHÔNG tính hoa hồng cho dòng đó dù rate > 0 (chặn gian lận qua link chia sẻ trước khi bị chặn)', async () => {
    const create = jest.fn();
    const order = {
      id: 'o1',
      userId: 'buyer',
      referrerUserId: 'ctv',
      total: 300000,
      items: [
        { variationId: 'v1', total: 200000 }, // bị chặn
        { variationId: 'v2', total: 100000 }, // bình thường
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'v1', affiliateRate: 10, product: { affiliateBlocked: true } },
      { id: 'v2', affiliateRate: 5, product: { affiliateBlocked: false } },
    ], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    // Chỉ v2 (5% * 100k = 5000) được tính, v1 bị loại hoàn toàn dù rate=10%.
    expect(create.mock.calls[0][0].data.amount).toBe(5000);
  });

  it('commissionableTotal = chỉ các dòng hưởng hoa hồng (loại hàng bị chặn, hàng rate 0 và phí ship) — nền doanh số mốc/bậc', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'buyer',
      referrerUserId: 'ctv',
      // 79tr hàng bị chặn + 1tr hàng thường + 500k hàng rate 0 + 30k ship.
      total: 80_530_000,
      shippingFee: 30_000,
      items: [
        { variationId: 'blocked', total: 79_000_000 },
        { variationId: 'ok', total: 1_000_000 },
        { variationId: 'zero', total: 500_000 },
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'blocked', affiliateRate: 10, product: { affiliateBlocked: true } },
      { id: 'ok', affiliateRate: 5, product: { affiliateBlocked: false } },
      { id: 'zero', affiliateRate: 0, product: { affiliateBlocked: false } },
    ], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).createCommissionForOrder('o1');
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(50_000);
    // Trước đây mốc/bậc cộng orderTotal (80,53tr) → 1 món nhỏ + 79tr hàng bị chặn mở khoá mốc 80tr.
    expect(data.commissionableTotal).toBe(1_000_000);
    expect(data.orderTotal).toBe(80_530_000); // giữ nguyên để tra cứu/đối soát
  });
});

describe('AffiliateService.reverseCommissionsForOrder (guard đối xứng cho lên-đơn-hộ)', () => {
  function makePrisma(order: unknown) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      commission: { updateMany },
    } as unknown as PrismaService;
    return { prisma, updateMany };
  }

  it('đơn thường (referrer ≠ buyer) → VẪN đảo hoa hồng (không đổi)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'buyer', referrerUserId: 'ctv', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1', status: { in: ['PENDING', 'LOCKED'] } } }),
    );
  });

  it('CTV lên đơn hộ (referrer === buyer, placedForCustomer=true) → đảo hoa hồng', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false) → KHÔNG đảo (không có hoa hồng)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).reverseCommissionsForOrder('o1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → KHÔNG đảo', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).reverseCommissionsForOrder('o1');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.placeOrderForCustomer (CTV lên đơn hộ — MONEY-CRITICAL)', () => {
  const CUSTOMER = {
    recipient: 'Khách A',
    phone: '0900000000',
    province: 'Hà Nội',
    district: '',
    ward: 'Phường 1',
    street: 'Số 1',
    provinceCode: '84_VN01',
    districtCode: '',
    wardCode: '84_VN0101',
  };

  function build(
    opts: {
      variations?: Array<{ id: string; isActive?: boolean; salePrice?: number | null; retailPrice?: number; name?: string; product?: { name: string } }>;
      stockCount?: number;
      executeRaw?: jest.Mock;
      role?: string;
      storefront?: { slug: string } | null;
      shippingFee?: number;
    } = {},
  ) {
    const variations =
      opts.variations ?? [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'Mặc định', product: { name: 'Trà thảo mộc' } }];
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    // Giữ chỗ tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — trả SỐ DÒNG bị sửa.
    const executeRaw = opts.executeRaw ?? jest.fn().mockResolvedValue(opts.stockCount ?? 1);
    const commissionCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ctv', role: opts.role ?? 'AFFILIATE' }) },
      variation: { findMany: jest.fn().mockResolvedValue(variations) },
      $executeRaw: executeRaw,
      storefront: { findFirst: jest.fn().mockResolvedValue(opts.storefront === undefined ? { slug: 'ctv-shop' } : opts.storefront) },
      order: {
        create: orderCreate,
        findUnique: jest.fn().mockResolvedValue(null), // generateOrderCode: code chưa tồn tại
        findUniqueOrThrow: jest
          .fn()
          // 1) createCommissionForOrder đọc order + items; 2) trả đơn cuối cùng
          .mockResolvedValue({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 100000, items: [], code: 'TUBU1' }),
      },
      commission: { create: commissionCreate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    const pricingLocal = { calcShippingFee: jest.fn().mockResolvedValue(opts.shippingFee ?? 0) } as unknown as PricingService;
    const pancakeOrderLocal = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
    const svc = new AffiliateService(prisma, config, pricingLocal, pancakeOrderLocal, coins);
    return { svc, prisma, orderCreate, executeRaw, commissionCreate, pricingLocal, pancakeOrderLocal };
  }

  const DTO = (over: Record<string, unknown> = {}) => ({
    items: [{ variationId: 'v1', quantity: 2 }],
    customer: CUSTOMER,
    paymentMethod: 'COD' as const,
    ...over,
  });

  it('COD → đơn CONFIRMED, userId==referrerUserId==ctv, placedForCustomer=true', async () => {
    const { svc, orderCreate } = build({ shippingFee: 19000 });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.status).toBe('CONFIRMED');
    expect(data.userId).toBe('ctv');
    expect(data.referrerUserId).toBe('ctv');
    expect(data.placedForCustomer).toBe(true);
    expect(data.paymentStatus).toBe('UNPAID');
    // goods = 100000 * 2 = 200000; ship 19000 → total 219000
    expect(data.subtotal).toBe(200000);
    expect(data.shippingFee).toBe(19000);
    expect(data.total).toBe(219000);
    expect(data.discount).toBe(0);
    expect(data.items.create[0]).toMatchObject({ variationId: 'v1', unitPrice: 100000, quantity: 2, total: 200000 });
  });

  it('BANK_TRANSFER → đơn PENDING_PAYMENT', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO({ paymentMethod: 'BANK_TRANSFER' }) as never);
    expect(orderCreate.mock.calls[0][0].data.status).toBe('PENDING_PAYMENT');
  });

  it('dùng salePrice khi có (ưu tiên salePrice ?? retailPrice)', async () => {
    const { svc, orderCreate } = build({
      variations: [{ id: 'v1', isActive: true, salePrice: 80000, retailPrice: 100000, name: 'X', product: { name: 'P' } }],
    });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.items.create[0].unitPrice).toBe(80000);
    expect(data.subtotal).toBe(160000);
  });

  it('trừ stock ATOMIC từng line (where gte) trước khi tạo đơn', async () => {
    const { svc, executeRaw, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    // Tham số câu UPDATE giữ chỗ: (số lượng, số lượng, variationId, số lượng).
    expect(executeRaw.mock.calls[0]!.slice(1)).toEqual([2, 2, 'v1', 2]);
    expect(orderCreate).toHaveBeenCalled();
  });

  it('stock không đủ (count=0) → BadRequest, KHÔNG tạo đơn (rollback)', async () => {
    const { svc, orderCreate } = build({ stockCount: 0 });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow('không đủ tồn kho');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('tạo hoa hồng cho CTV sau khi đặt đơn (createCommissionForOrder)', async () => {
    const { svc, commissionCreate, prisma } = build();
    // order fetch trong createCommissionForOrder: đơn CTV placedForCustomer + 1 item có rate.
    (prisma.order.findUniqueOrThrow as jest.Mock)
      .mockResolvedValueOnce({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 200000, items: [{ variationId: 'v1', total: 200000 }] })
      .mockResolvedValueOnce({ id: 'o1', code: 'TUBU1', total: 200000, items: [] });
    (prisma.variation.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P' } },
    ]).mockResolvedValueOnce([{ id: 'v1', affiliateRate: 10 }]);
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(commissionCreate).toHaveBeenCalledTimes(1);
    expect(commissionCreate.mock.calls[0][0].data.affiliateUserId).toBe('ctv');
  });

  it('không có item → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.placeOrderForCustomer('ctv', DTO({ items: [] }) as never)).rejects.toThrow();
  });

  it('variation ngừng bán (isActive=false) → BadRequest', async () => {
    const { svc } = build({
      variations: [{ id: 'v1', isActive: false, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P' } }],
    });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
  });

  it('người dùng không phải CTV/ADMIN → BadRequest (chống tự-giao-dịch)', async () => {
    const { svc, orderCreate } = build({ role: 'CUSTOMER' });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('xếp hàng đẩy đơn sang Pancake sau khi tạo (đơn hộ phải vào pipeline giao vận như đơn thường)', async () => {
    const { svc, pancakeOrderLocal } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(pancakeOrderLocal.enqueuePush).toHaveBeenCalledWith('o1');
  });

  it('Pancake lỗi/chưa cấu hình → KHÔNG chặn đơn CTV đã tạo (non-fatal, mirror checkout)', async () => {
    const { svc, orderCreate, pancakeOrderLocal } = build();
    (pancakeOrderLocal.enqueuePush as jest.Mock).mockRejectedValue(new Error('Pancake down'));
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).resolves.toBeDefined();
    expect(orderCreate).toHaveBeenCalled();
  });

  it('gắn storefrontSlug của CTV để attribution; null nếu chưa có gian hàng', async () => {
    const withStore = build({ storefront: { slug: 'ctv-shop' } });
    await withStore.svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(withStore.orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('ctv-shop');

    const noStore = build({ storefront: null });
    await noStore.svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(noStore.orderCreate.mock.calls[0][0].data.storefrontSlug).toBeNull();
  });

  it('idempotency-key double-tap/retry → trả lại đơn đã tạo trước đó, KHÔNG trừ kho/tạo đơn/commission lần 2', async () => {
    const { svc, prisma, orderCreate, executeRaw, commissionCreate } = build();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-existing', userId: 'ctv' });
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'o-existing', items: [] });
    const r = (await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-1')) as { id: string };
    expect(r.id).toBe('o-existing');
    expect(orderCreate).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(commissionCreate).not.toHaveBeenCalled();
  });

  it('idempotency-key mới (chưa có đơn nào) → tạo đơn bình thường + ghi idempotencyKey', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-2');
    expect(orderCreate.mock.calls[0][0].data.idempotencyKey).toBe('idem-2');
  });
});

describe('AffiliateService.dashboard (doanh số tháng = doanh số ĐÃ CHỐT, mốc theo giờ VN)', () => {
  // 2026-09-30 18:00 UTC = 01:00 ngày 1/10 giờ VN.
  const NOW = new Date('2026-09-30T18:00:00.000Z');

  function build() {
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 0, commissionableTotal: 0 } });
    const prisma = {
      commission: { aggregate: commissionAggregate },
      affiliateLink: { aggregate: jest.fn().mockResolvedValue({ _sum: { clicks: 0, conversions: 0 } }) },
    } as unknown as PrismaService;
    return { svc: new AffiliateService(prisma, config, pricing, pancakeOrder, coins), commissionAggregate };
  }

  it('monthRevenue chỉ cộng commissionableTotal của commission APPROVED/PAID chốt trong tháng VN (không PENDING/LOCKED còn huỷ/trả được)', async () => {
    const { svc, commissionAggregate } = build();
    await svc.dashboard('u1', NOW);
    const call = commissionAggregate.mock.calls.find((c) => c[0]?._sum?.commissionableTotal);
    expect(call).toBeTruthy();
    expect(call![0].where).toEqual({
      affiliateUserId: 'u1',
      status: { in: ['APPROVED', 'PAID'] },
      approvedAt: { gte: new Date('2026-09-30T17:00:00.000Z'), lt: new Date('2026-10-31T17:00:00.000Z') },
    });
  });

  it('dashboard.tier.bonusPct = 0 (tương thích miniapp cũ render "Bonus +X%") — không hứa khoản không trả', async () => {
    const { svc } = build();
    const d = await svc.dashboard('u1', NOW);
    expect(d.tier.bonusPct).toBe(0);
  });

  it('hoa hồng hôm nay/tháng này tính từ 00:00 giờ VN (không theo TZ máy chủ UTC)', async () => {
    const { svc, commissionAggregate } = build();
    await svc.dashboard('u1', NOW);
    const sinces = commissionAggregate.mock.calls
      .map((c) => c[0]?.where?.createdAt?.gte as Date | undefined)
      .filter(Boolean)
      .map((d) => d!.toISOString());
    // 00:00 1/10 VN = 17:00 30/9 UTC — vừa là đầu ngày vừa là đầu tháng.
    expect(sinces).toEqual(['2026-09-30T17:00:00.000Z', '2026-09-30T17:00:00.000Z']);
  });
});

describe('AffiliateService.monthlyTier (Build Spec §6.8.2)', () => {
  // monthlyTier là private (ngưỡng dùng chung với mốc thưởng — ctv-milestones.ts) — gọi qua
  // cast để kiểm tra ranh giới bậc.
  const tier = (revenue: number) =>
    (new AffiliateService({} as unknown as PrismaService, config, pricing, pancakeOrder, coins) as unknown as {
      monthlyTier(r: number): {
        name: string;
        nextName: string | null;
        nextThreshold: number | null;
        toNext: number;
      };
    }).monthlyTier(revenue);

  it('doanh số 0 → Tân binh, next là Đồng tại 3tr', () => {
    const t = tier(0);
    expect(t.name).toBe('Tân binh');
    expect(t.nextName).toBe('Đồng');
    expect(t.nextThreshold).toBe(3_000_000);
    expect(t.toNext).toBe(3_000_000);
  });

  it('KHÔNG trả bonusPct: chưa có luồng nào trả "+X% hoa hồng" theo bậc → không hứa trên UI', () => {
    for (const r of [0, 3_000_000, 10_000_000, 30_000_000, 80_000_000]) {
      expect(tier(r)).not.toHaveProperty('bonusPct');
    }
  });

  it('đúng tại ngưỡng (inclusive): 3tr → Đồng, 10tr → Bạc, 80tr → Kim Cương', () => {
    expect(tier(3_000_000).name).toBe('Đồng');
    expect(tier(10_000_000).name).toBe('Bạc');
    expect(tier(30_000_000).name).toBe('Vàng');
    expect(tier(80_000_000).name).toBe('Kim Cương');
  });

  it('ngay dưới ngưỡng vẫn ở bậc thấp hơn', async () => {
    expect((await tier(2_999_999)).name).toBe('Tân binh');
    expect((await tier(9_999_999)).name).toBe('Đồng');
  });

  it('toNext = phần còn thiếu để lên bậc kế', async () => {
    const t = await tier(5_000_000); // Đồng, cần lên Bạc (10tr)
    expect(t.name).toBe('Đồng');
    expect(t.toNext).toBe(5_000_000);
  });

  it('bậc cao nhất (Kim Cương) không còn next', async () => {
    const t = await tier(120_000_000);
    expect(t.name).toBe('Kim Cương');
    expect(t.nextName).toBeNull();
    expect(t.nextThreshold).toBeNull();
    expect(t.toNext).toBe(0);
  });
});

describe('AffiliateService.getPublicTier', () => {
  it('trả tên + icon theo doanh số ĐÃ CHỐT tháng VN (cùng định nghĩa bậc CTV tự thấy), KHÔNG lộ số tiền', async () => {
    const agg = jest.fn().mockResolvedValue({ _sum: { commissionableTotal: 15_000_000 } });
    const prisma = { commission: { aggregate: agg } } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const t = await svc.getPublicTier('u1', new Date('2026-09-30T18:00:00.000Z')); // 01:00 1/10 giờ VN
    expect(t).toEqual({ name: 'Bạc', emoji: '🌳' });
    expect(Object.keys(t)).toEqual(['name', 'emoji']);
    const where = agg.mock.calls[0]?.[0].where;
    expect(where.status).toEqual({ in: ['APPROVED', 'PAID'] });
    expect(where.approvedAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
  });

  it('chưa có hoa hồng nào → Tân binh', async () => {
    const agg = jest.fn().mockResolvedValue({ _sum: { commissionableTotal: null } });
    const prisma = { commission: { aggregate: agg } } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const t = await svc.getPublicTier('u1');
    expect(t.name).toBe('Tân binh');
  });
});

describe('AffiliateService.approveDueCommissions (chỉ chốt đơn KHÔNG còn yêu cầu đổi/trả chờ duyệt)', () => {
  it('đơn đang có ReturnRequest REQUESTED → không chuyển APPROVED (để reverseCommissionsForOrder còn đảo được)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([{ orderId: 'o-return' }]) },
      commission: { updateMany },
    } as unknown as PrismaService;
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).approveDueCommissions();
    expect((prisma as unknown as { returnRequest: { findMany: jest.Mock } }).returnRequest.findMany).toHaveBeenCalledWith({
      where: { status: 'REQUESTED' },
      select: { orderId: true },
    });
    const where = updateMany.mock.calls[0][0].where;
    expect(where.status).toBe('LOCKED');
    expect(where.orderId).toEqual({ notIn: ['o-return'] });
  });

  // Duyệt trả hàng lật đơn DELIVERED → RETURNED trong 1 tx, còn reverseCommissionsForOrder chạy SAU
  // (ngoài tx). Cron chạy đúng khe đó: ReturnRequest đã APPROVED (không còn REQUESTED) nhưng hoa
  // hồng vẫn LOCKED → bị chốt APPROVED (không-đảo-được) cho một đơn đã trả hàng.
  it('chỉ chốt hoa hồng của đơn còn DELIVERED (đơn vừa lật RETURNED/CANCELLED chờ đảo thì bỏ qua)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { updateMany },
    } as unknown as PrismaService;
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).approveDueCommissions();
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ status: 'LOCKED', order: { status: 'DELIVERED' } });
  });

  it('không có yêu cầu đổi/trả treo → không thêm điều kiện orderId', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { updateMany },
    } as unknown as PrismaService;
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).approveDueCommissions();
    expect(updateMany.mock.calls[0][0].where.orderId).toBeUndefined();
  });

  it('cửa sổ đổi/trả dài hơn hold_days → chờ hết cửa sổ mới chốt (khách còn gửi trả được thì chưa APPROVED)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { updateMany },
    } as unknown as PrismaService;
    // Admin cấu hình hold 5 ngày nhưng cho đổi/trả 10 ngày.
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        (k === 'affiliate.hold_days' ? 5 : k === 'returns.window_days' ? 10 : fb) as T,
    } as unknown as SystemConfigService;
    const before = Date.now();
    await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins).approveDueCommissions();
    const lte = (updateMany.mock.calls[0][0].where.lockedAt as { lte: Date }).lte.getTime();
    // threshold = now - 10 ngày (không phải now - 5 ngày).
    expect(before - lte).toBeGreaterThanOrEqual(10 * 864e5 - 1000);
    expect(before - lte).toBeLessThan(10 * 864e5 + 60_000);
  });
});

describe('AffiliateService.getMilestones holdDays hiển thị = số ngày giữ THỰC (max hold_days, cửa sổ đổi/trả)', () => {
  it('hold 5 + đổi/trả 10 → holdDays=10 (UI nói đúng số ngày phải chờ chốt)', async () => {
    const prisma = {
      commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { commissionableTotal: 0 } }) },
      ctvMilestoneClaim: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        (k === 'affiliate.hold_days' ? 5 : k === 'returns.window_days' ? 10 : fb) as T,
    } as unknown as SystemConfigService;
    const res = await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins).getMilestones('u1');
    expect(res.holdDays).toBe(10);
  });
});

describe('AffiliateService.requestPayout (money safety)', () => {
  function makePrisma(opts: { available?: number; rows?: { id: string; amount: number }[]; markCount?: number }) {
    const rows = opts.rows ?? [{ id: 'c1', amount: 100_000 }];
    const userUpdate = jest.fn().mockResolvedValue({});
    const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
    const updateMany = jest.fn().mockResolvedValue({ count: opts.markCount ?? rows.length });
    const prisma = {
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.available ?? 100_000 } }),
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany,
      },
      user: { update: userUpdate },
      payout: { create: payoutCreate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    return { prisma, userUpdate, payoutCreate, updateMany };
  }

  it('số dư khả dụng = 0 → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 0 });
    await expect(new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 0, 'WALLET_BALANCE')).rejects.toThrow(
      'khả dụng',
    );
  });

  it('amount vượt khả dụng → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 200_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('không đủ');
  });

  it('WALLET_BALANCE → quy đổi 1:1 (KHÔNG nhân hệ số) theo TỔNG THỰC các row APPROVED + mark PAID (P0 A5-07 fix)', async () => {
    const { prisma, userUpdate, payoutCreate } = makePrisma({
      available: 100_000,
      rows: [
        { id: 'c1', amount: 60_000 },
        { id: 'c2', amount: 40_000 },
      ],
    });
    // amount PHẢI === available (rút toàn bộ, xem Bug 2 fix) — request đúng 100k.
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 100_000, 'WALLET_BALANCE');
    // P0 A5-07: walletBalance là tiền VND rút được 1:1 ra ngân hàng thật (wallet.service.ts:withdraw)
    // — nhân hệ số ở đường này tương đương in tiền thật (1tr hoa hồng → 1,497tr rút được trước khi
    // vá). credited PHẢI đúng bằng total, không hơn không kém.
    expect(r.credited).toBe(100_000);
    expect(userUpdate.mock.calls[0][0].data.walletBalance).toEqual({ increment: 100_000 });
    expect(payoutCreate.mock.calls[0][0].data.status).toBe('PAID');
    // Không còn quảng cáo hệ số nhân (đã bỏ) trong thông báo cho CTV.
    expect(r.note).not.toContain('×');
  });

  it('WALLET_BALANCE: SystemConfig affiliate.tubu_wallet_multiplier còn seed giá trị >1 (dữ liệu cũ) → KHÔNG được đọc/áp dụng ở đường tiền thật này nữa (P0 A5-07)', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, rows: [{ id: 'c1', amount: 100_000 }] });
    const cfgWithStaleMultiplier = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.tubu_wallet_multiplier' ? ((5 as unknown) as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const r = await new AffiliateService(prisma, cfgWithStaleMultiplier, pricing, pancakeOrder, coins).requestPayout(
      'u1',
      100_000,
      'WALLET_BALANCE',
    );
    expect(r.credited).toBe(100_000); // KHÔNG phải 500_000 dù config (nếu còn ai đọc) sẽ trả 5
    expect(userUpdate.mock.calls[0][0].data.walletBalance).toEqual({ increment: 100_000 });
  });

  it('2 lệnh requestPayout(WALLET_BALANCE) đồng thời cho CÙNG bộ commission → chỉ cộng ví ĐÚNG 1 LẦN, đúng 1:1 (race an toàn, P0 A5-07)', async () => {
    const commissionRows: Array<{ id: string; amount: number; status: string; payoutBatchId: string | null }> = [
      { id: 'c1', amount: 60_000, status: 'APPROVED', payoutBatchId: null },
      { id: 'c2', amount: 40_000, status: 'APPROVED', payoutBatchId: null },
    ];
    let wallet = 0;
    let payoutSeq = 0;
    const prisma = {
      commission: {
        aggregate: jest.fn(async () => ({
          _sum: {
            amount: commissionRows
              .filter((r) => r.status === 'APPROVED' && r.payoutBatchId === null)
              .reduce((s, r) => s + r.amount, 0),
          },
        })),
        findMany: jest.fn(async () =>
          commissionRows
            .filter((r) => r.status === 'APPROVED' && r.payoutBatchId === null)
            .map((r) => ({ id: r.id, amount: r.amount })),
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: { in: string[] }; status: string; payoutBatchId: null };
            data: { status: string; paidAt: Date };
          }) => {
            let count = 0;
            for (const row of commissionRows) {
              if (
                where.id.in.includes(row.id) &&
                row.status === where.status &&
                row.payoutBatchId === where.payoutBatchId
              ) {
                row.status = data.status;
                count++;
              }
            }
            return { count };
          },
        ),
      },
      user: {
        update: jest.fn(async ({ data }: { data: { walletBalance: { increment: number } } }) => {
          wallet += data.walletBalance.increment;
          return {};
        }),
      },
      payout: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: `payout-${++payoutSeq}`, ...data })),
      },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const results = await Promise.allSettled([
      svc.requestPayout('u1', 100_000, 'WALLET_BALANCE'),
      svc.requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // KHÔNG phải 200_000 (double-credit) và KHÔNG phải 150_000 (nếu hệ số nhân lọt vào).
    expect(wallet).toBe(100_000);
  });

  it('amount KHÁC available (rút một phần) → BadRequest rõ ràng, KHÔNG âm thầm rút hết (Bug 2 fix)', async () => {
    const { prisma, userUpdate, payoutCreate } = makePrisma({ available: 100_000 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 60_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('không hỗ trợ rút một phần');
    expect(userUpdate).not.toHaveBeenCalled();
    expect(payoutCreate).not.toHaveBeenCalled();
  });

  it('WALLET_BALANCE: 1 phần row bị đổi giữa đọc và ghi (marked.count !== rows.length) → Conflict, KHÔNG credit ví (Bug 4 fix)', async () => {
    const { prisma, userUpdate } = makePrisma({
      available: 100_000,
      rows: [
        { id: 'c1', amount: 60_000 },
        { id: 'c2', amount: 40_000 },
      ],
      markCount: 1, // chỉ 1/2 row thực sự được đánh dấu PAID
    });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('thay đổi');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('WALLET_BALANCE double-spend: updateMany count=0 → BadRequest, KHÔNG credit ví', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, markCount: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('đã được xử lý');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('BANK dưới mức tối thiểu → BadRequest (available === amount, chỉ available nhỏ)', async () => {
    // amount PHẢI === available (rút toàn bộ, Bug 2 fix) — set available=10k để test riêng
    // ngưỡng minWithdraw, không lẫn với check "không hỗ trợ rút một phần".
    const { prisma } = makePrisma({ available: 10_000, rows: [{ id: 'c1', amount: 10_000 }] });
    await expect(new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 10_000, 'BANK', {})).rejects.toThrow(
      'tối thiểu',
    );
  });

  it('BANK hợp lệ → payout.amount = TỔNG THỰC + mark PAID + gán batch', async () => {
    const { prisma, payoutCreate, updateMany } = makePrisma({
      available: 100_000,
      rows: [{ id: 'c1', amount: 100_000 }],
    });
    // amount PHẢI === available (rút toàn bộ, xem Bug 2 fix) — request đúng 100k.
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 100_000, 'BANK', { bank: 'VCB' });
    expect(r.status).toBe('REQUESTED');
    expect(payoutCreate.mock.calls[0][0].data.amount).toBe(100_000);
    expect(updateMany.mock.calls[0][0].data.payoutBatchId).toBe('payout-1');
    expect(updateMany.mock.calls[0][0].data.status).toBe('PAID');
  });

  it('BANK: 1 phần row bị đổi giữa đọc và ghi (marked.count !== rows.length) → Conflict, KHÔNG trả payout REQUESTED (Bug 4 fix)', async () => {
    const { prisma } = makePrisma({
      available: 100_000,
      rows: [
        { id: 'c1', amount: 60_000 },
        { id: 'c2', amount: 40_000 },
      ],
      markCount: 1,
    });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).requestPayout('u1', 100_000, 'BANK', {}),
    ).rejects.toThrow('thay đổi');
  });
});

describe('AffiliateService.grantReferralReward (refer-reward 1 lần, cộng dồn hoa hồng)', () => {
  function makePrisma(order: unknown, existingCoupon: unknown = null) {
    const couponCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      coupon: { findUnique: jest.fn().mockResolvedValue(existingCoupon), create: couponCreate },
    } as unknown as PrismaService;
    return { prisma, couponCreate };
  }

  it('đơn ≥200k có người giới thiệu → thưởng voucher 50k cho CẢ hai (§6.14.5)', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 250000 });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).grantReferralReward('o1');
    expect(couponCreate).toHaveBeenCalledTimes(2);
    const data = couponCreate.mock.calls.map((c) => c[0].data);
    const codes = data.map((d) => d.code);
    expect(codes).toContain('REFER-REFERRER-REFEREE'); // người mời (cặp)
    expect(codes).toContain('REFERRED-REFEREE'); // người được mời (welcome)
    expect(data.every((d) => d.value === 50000)).toBe(true); // cả hai 50k
    expect(data.every((d) => d.minOrder === 200000)).toBe(true); // áp đơn ≥200k
    expect(data.map((d) => d.scopeMeta.userId)).toEqual(expect.arrayContaining(['referrer', 'referee']));
  });

  it('đơn < 200k → KHÔNG thưởng (chưa đạt ngưỡng §6.14.5)', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 150000 });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('tự giới thiệu (referrer === buyer) → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', total: 250000 });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, total: 250000 });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('voucher đã tồn tại (đã thưởng cặp này) → không cấp lại (idempotent)', async () => {
    const { prisma, couponCreate } = makePrisma(
      { id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 250000 },
      { id: 'existing' },
    );
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });
});

describe('AffiliateService analytics', () => {
  it('storefrontAnalytics gom theo gian hàng của tôi', async () => {
    const orderAggregate = jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { total: 900000 } });
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 72000 } });
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh', title: 'Cửa hàng Linh' }]) },
      order: { aggregate: orderAggregate },
      commission: { aggregate: commissionAggregate },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const r = await svc.storefrontAnalytics('u1');
    expect(r.storefronts[0]).toMatchObject({ slug: 'linh', orders: 3, revenue: 900000, commission: 72000 });
    // Hardening: WHERE phải scope đúng theo slug + referrer (chống đếm chéo người dùng).
    expect(orderAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storefrontSlug: 'linh', referrerUserId: 'u1' }) }),
    );
    expect(commissionAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ affiliateUserId: 'u1', order: { storefrontSlug: 'linh' } }),
      }),
    );
  });

  it('productCommissionBreakdown nhóm theo sản phẩm', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', order: { id: 'o1', items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Xà phòng', variationId: 'v2', total: 50000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' }, { id: 'v2', affiliateRate: '8' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.commission).toBe(10000); // floor(100000*10/100)
    expect(dau?.orders).toBe(1);
    expect(r.find((x) => x.productName === 'Xà phòng')?.commission).toBe(4000);
  });

  it('productCommissionBreakdown: 1 đơn có 2 item CÙNG sản phẩm → orders=1, hoa hồng cộng dồn', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', order: { id: 'o1', items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Dầu gội', variationId: 'v1', total: 60000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.orders).toBe(1); // 2 item cùng đơn → 1 đơn
    expect(dau?.commission).toBe(16000); // floor(100000*10/100) + floor(60000*10/100)
  });
});

describe('AffiliateService.recordTouch / getActiveTouch (attribution 3 ngày)', () => {
  const NOW = new Date('2026-06-27T00:00:00Z');
  function makePrisma(over: any = {}) {
    return {
      user: { findUnique: jest.fn() },
      referralTouch: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
      ...over,
    } as unknown as PrismaService;
  }

  it('recordTouch: resolve referralCode → upsert với expiresAt = now + 3 ngày', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).recordTouch('buyer1', { referralCode: 'LINH', storefrontSlug: 'LINH', kind: 'ctv' }, NOW);
    const call = (prisma as any).referralTouch.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'buyer1' });
    expect(call.create.referrerUserId).toBe('ctv1');
    expect(call.create.expiresAt.getTime()).toBe(NOW.getTime() + 3 * 86400000);
  });

  it('recordTouch: bỏ qua nếu không có referralCode', async () => {
    const prisma = makePrisma();
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).recordTouch('buyer1', {}, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua tự giới thiệu (code trỏ chính mình)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'buyer1' });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).recordTouch('buyer1', { referralCode: 'SELF' }, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua code không tồn tại', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue(null);
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).recordTouch('buyer1', { referralCode: 'NOPE' }, NOW);
    expect(r.ok).toBe(false);
  });

  it('getActiveTouch: trả touch khi còn hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv', expiresAt: new Date(NOW.getTime() + 1000) });
    const t = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).getActiveTouch('buyer1', NOW);
    expect(t).toEqual({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv' });
  });

  it('getActiveTouch: null khi hết hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: null, kind: 'ctv', expiresAt: new Date(NOW.getTime() - 1000) });
    const t = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).getActiveTouch('buyer1', NOW);
    expect(t).toBeNull();
  });

  // P0 A5-01: gian hàng CTV mở TRONG ZALO dùng slug (storefront.service.ts sinh = referralCode.toLowerCase())
  // làm luôn referralCode cho attribution (storefront-view.tsx/app.tsx miniapp KHÔNG hoa hoá lại).
  // User.referralCode luôn lưu chữ HOA (auth.service.ts). So khớp CHÍNH XÁC trước đây luôn trượt
  // (Postgres phân biệt hoa/thường) → referrer luôn null → CTV bán qua gian hàng trong Zalo không
  // bao giờ được ghi hoa hồng.
  it('recordTouch: referralCode chữ THƯỜNG (slug gian hàng CTV mở trong Zalo) phải được chuẩn hoá hoa TRƯỚC khi so khớp (P0 A5-01)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1' });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).recordTouch(
      'buyer1',
      { referralCode: 'linh', storefrontSlug: 'linh', kind: 'ctv' },
      NOW,
    );
    expect(r.ok).toBe(true);
    // Lookup PHẢI dùng mã đã hoa hoá — gửi thẳng 'linh' sẽ luôn trượt trên Postgres thật (referralCode
    // lưu 'LINH', so khớp phân biệt hoa/thường), dù mock ở trên không tự mô phỏng việc đó.
    expect((prisma as any).user.findUnique).toHaveBeenCalledWith({ where: { referralCode: 'LINH' }, select: { id: true } });
    const call = (prisma as any).referralTouch.upsert.mock.calls[0][0];
    expect(call.create.referrerUserId).toBe('ctv1');
    // storefrontSlug giữ NGUYÊN chữ thường — quy ước của slug khác với referralCode, không đổi ở đây.
    expect(call.create.storefrontSlug).toBe('linh');
  });

  it('P0 A5-01 — tái hiện: khách mở gian hàng CTV trong Zalo (slug/referralCode chữ THƯỜNG) → "chạm" giới thiệu được ghi nhận đúng CTV, còn hạn cho checkout dùng làm fallback (trước đây referrer luôn null)', async () => {
    let stored: { referrerUserId: string; storefrontSlug: string | null; kind: string; expiresAt: Date } | null = null;
    const prisma = {
      // Mô phỏng ĐÚNG hành vi Postgres thật: User.referralCode lưu 'LINH' (chữ hoa), so khớp
      // phân biệt hoa/thường — chỉ khớp khi lookup ĐÃ được chuẩn hoá hoa TRƯỚC khi gọi tới đây.
      user: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { referralCode: string } }) =>
            Promise.resolve(where.referralCode === 'LINH' ? { id: 'ctv1' } : null),
          ),
      },
      referralTouch: {
        upsert: jest.fn().mockImplementation(({ create }: { create: typeof stored }) => {
          stored = create;
          return Promise.resolve(create);
        }),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(stored)),
      },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);

    // 1) Khách mở gian hàng CTV trong Zalo: FE gửi referralCode = slug gian hàng (chữ THƯỜNG), y hệt
    //    storefront-view.tsx (referralCode: sf.slug) + app.tsx (recordReferralTouch) thật.
    const touchResult = await svc.recordTouch('buyer1', { referralCode: 'linh', storefrontSlug: 'linh', kind: 'ctv' }, NOW);
    expect(touchResult.ok).toBe(true);

    // 2) Vài phút sau, checkout mất phiên storefront-context → fallback đọc "chạm" còn hạn (3 ngày)
    //    — phải thấy ĐÚNG referrerUserId (không phải null như trước khi vá).
    const touch = await svc.getActiveTouch('buyer1', new Date(NOW.getTime() + 60_000));
    expect(touch?.referrerUserId).toBe('ctv1');
    expect(touch?.storefrontSlug).toBe('linh');
  });
});

// P0 A5-08 = A6-05: Payout BANK tạo REQUESTED (wallet.service.ts:withdraw hoặc
// affiliate.service.ts:requestPayout nhánh BANK) nhưng trước đây KHÔNG có endpoint/màn admin nào
// để xem/duyệt/từ chối/đánh dấu đã trả — tiền bị trừ khỏi số dư CTV rồi "biến mất" khỏi mọi hàng
// đợi xử lý được. Thêm listPayouts/approvePayout/rejectPayout/markPayoutPaid, atomic updateMany
// (status-guard), không bao giờ check-then-write.
describe('AffiliateService admin payout queue (P0 A5-08=A6-05)', () => {
  function makePrisma(
    payout: Record<string, unknown>,
    opts: { linkedCommissions?: Array<{ id: string }> } = {},
  ) {
    const payoutUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const payoutFindUniqueOrThrow = jest.fn().mockResolvedValue(payout);
    const commissionFindMany = jest.fn().mockResolvedValue(opts.linkedCommissions ?? []);
    const commissionUpdateMany = jest.fn().mockResolvedValue({ count: opts.linkedCommissions?.length ?? 0 });
    const userUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      payout: {
        updateMany: payoutUpdateMany,
        findUniqueOrThrow: payoutFindUniqueOrThrow,
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      commission: { findMany: commissionFindMany, updateMany: commissionUpdateMany },
      user: { update: userUpdate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (arg: unknown) =>
        typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
      );
    return { prisma, payoutUpdateMany, payoutFindUniqueOrThrow, commissionFindMany, commissionUpdateMany, userUpdate };
  }

  it('listPayouts: trạng thái không hợp lệ → BadRequest', async () => {
    const prisma = {} as unknown as PrismaService;
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).listPayouts('BOGUS', 1, 20),
    ).rejects.toThrow();
  });

  it('approvePayout: REQUESTED → APPROVED (atomic updateMany theo status-guard)', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).approvePayout('admin1', 'p1', 'ok');
    expect(payoutUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin1', adminNote: 'ok' }),
    });
  });

  it('approvePayout: đã bị xử lý bởi người khác (count=0) → BadRequest, không check-then-write', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).approvePayout('admin1', 'p1'),
    ).rejects.toThrow('tải lại');
  });

  it('rejectPayout: thiếu lý do → BadRequest, KHÔNG đổi trạng thái/hoàn tiền', async () => {
    const { prisma, payoutUpdateMany, userUpdate } = makePrisma({ id: 'p1' });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).rejectPayout('admin1', 'p1', '   '),
    ).rejects.toThrow('lý do');
    expect(payoutUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejectPayout: Payout từ wallet.service.ts:withdraw() (KHÔNG có commission gắn payoutBatchId) → hoàn GROSS (amount+fee, KHÔNG phải net) vào walletBalance, KHÔNG đụng commission', async () => {
    const { prisma, userUpdate, commissionUpdateMany } = makePrisma(
      { id: 'p1', userId: 'u1', amount: 97_000, fee: 3_000, method: 'BANK' },
      { linkedCommissions: [] },
    );
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).rejectPayout('admin1', 'p1', 'Sai STK');
    // gross = net (97k) + fee (3k) = đúng số đã bị trừ khỏi walletBalance lúc withdraw().
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { walletBalance: { increment: 100_000 } } });
    expect(commissionUpdateMany).not.toHaveBeenCalled();
  });

  it('rejectPayout: Payout từ affiliate.service.ts:requestPayout() nhánh BANK (CÓ commission gắn payoutBatchId) → trả commission về APPROVED (rút lại được), KHÔNG đụng walletBalance', async () => {
    const { prisma, userUpdate, commissionUpdateMany } = makePrisma(
      { id: 'p1', userId: 'u1', amount: 100_000, fee: 0, method: 'BANK' },
      { linkedCommissions: [{ id: 'c1' }, { id: 'c2' }] },
    );
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).rejectPayout('admin1', 'p1', 'Sai STK');
    expect(commissionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] }, payoutBatchId: 'p1', status: 'PAID' },
      data: { status: 'APPROVED', payoutBatchId: null, paidAt: null },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejectPayout: đã bị xử lý bởi người khác (count=0) → BadRequest, KHÔNG hoàn tiền/đổi commission', async () => {
    const { prisma, userUpdate, commissionUpdateMany, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).rejectPayout('admin1', 'p1', 'lý do'),
    ).rejects.toThrow();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(commissionUpdateMany).not.toHaveBeenCalled();
  });

  it('2 lệnh reject đồng thời cho CÙNG payout (nguồn wallet.withdraw, không commission gắn batch) → chỉ hoàn ví ĐÚNG 1 LẦN', async () => {
    let payoutRow: Record<string, unknown> = { id: 'p1', userId: 'u1', amount: 97_000, fee: 3_000, method: 'BANK', status: 'REQUESTED' };
    let wallet = 0;
    const prisma = {
      payout: {
        updateMany: jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
          if (payoutRow.id === where.id && payoutRow.status === where.status) {
            payoutRow = { ...payoutRow, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        }),
        findUniqueOrThrow: jest.fn(async () => payoutRow),
      },
      commission: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn() },
      user: {
        update: jest.fn(async ({ data }: { data: { walletBalance: { increment: number } } }) => {
          wallet += data.walletBalance.increment;
          return {};
        }),
      },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins);
    const results = await Promise.allSettled([
      svc.rejectPayout('admin1', 'p1', 'lý do A'),
      svc.rejectPayout('admin2', 'p1', 'lý do B'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(wallet).toBe(100_000); // hoàn ĐÚNG 1 lần (100k), không phải 200k
  });

  it('markPayoutPaid: APPROVED → PAID, ghi bankRef + paidBy (atomic updateMany theo status-guard)', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins).markPayoutPaid('admin1', 'p1', {
      bankRef: 'FT26270001',
    });
    expect(payoutUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'APPROVED' },
      data: expect.objectContaining({ status: 'PAID', paidBy: 'admin1', bankRef: 'FT26270001' }),
    });
  });

  it('markPayoutPaid: đã bị xử lý bởi người khác (count=0) → BadRequest', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins).markPayoutPaid('admin1', 'p1', {}),
    ).rejects.toThrow('tải lại');
  });
});
