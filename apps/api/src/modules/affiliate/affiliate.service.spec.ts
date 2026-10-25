import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AffiliateService, DEFAULT_PIT_WITHHOLD_THRESHOLD, WALLET_ONLY_MESSAGE } from './affiliate.service';
import { FlashQuotaLineError } from '../flash-sale/flash-sale.service';
import { LOCK_BUSY_MESSAGE } from '../../common/lock-busy';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { RewardPointsService } from '../wallet/reward-points.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';
import type { FlashSaleService } from '../flash-sale/flash-sale.service';
import { applyWalletDelta } from '../wallet/wallet-ledger.service';

// Sổ cái thật (khoá dòng + wallet_transactions) chạy trên Postgres ở
// test/integration-race/wallet-ledger*.race-spec.ts. Ở đây thay bằng đúng tác động số dư của nó
// (increment walletBalance trên tx) để các mock tx sẵn có vẫn đo được tiền vào ví.
jest.mock('../wallet/wallet-ledger.service', () => ({
  applyWalletDelta: jest.fn(
    async (tx: { user: { update: (a: unknown) => Promise<unknown> } }, input: { userId: string; delta: number }) => {
      await tx.user.update({ where: { id: input.userId }, data: { walletBalance: { increment: input.delta } } });
      return { applied: true, balanceAfter: 0, entryId: 'wtx' };
    },
  ),
}));
const ledger = applyWalletDelta as jest.MockedFunction<typeof applyWalletDelta>;

// Ngưỡng thuế đặt tay 2.000.000đ (admin được phép đổi) để các ca cộng dồn dùng số nhỏ; mặc định 5.000.000đ có ca riêng dùng `defaultConfig`.
const config = {
  get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.pit_withhold_threshold' ? 2_000_000 : fb) as T,
} as unknown as SystemConfigService;
const defaultConfig = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
// Ship mặc định 0 cho test (override bằng mockResolvedValue trong test lên-đơn-hộ).
const pricing = { calcShippingFee: jest.fn().mockResolvedValue(0) } as unknown as PricingService;
// Không dùng ở đa số test (chỉ placeOrderForCustomer gọi) — no-op mặc định.
const pancakeOrder = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
// Chỉ claimMilestone dùng (affiliate-tier.spec.ts) — no-op ở đây.
const coins = { grant: jest.fn().mockResolvedValue(true) } as unknown as RewardPointsService;
// Tham số bắt buộc thứ 6 (Task 10) — hầu hết test ở file này KHÔNG đụng recordTouch/
// placeOrderForCustomer nên chỉ cần no-op để type-check; các test thật của
// referral_touched/order_placed tự dựng analytics mock RIÊNG (không dùng chung biến này) để
// không bị số lần gọi của các test khác cộng dồn vào assertion.
const analytics = {
  record: jest.fn().mockResolvedValue(undefined),
  recordBestEffort: jest.fn().mockResolvedValue(undefined),
} as unknown as AnalyticsEventsService;

function prismaWith(order: unknown, variations: unknown[], createSpy = jest.fn(), referrerRole: string | null = 'AFFILIATE') {
  return {
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
    // Vai trò người giới thiệu (chỉ CTV/đại lý hưởng hoa hồng — affiliate.commission_eligible_roles).
    user: { findUnique: jest.fn().mockResolvedValue(referrerRole === null ? null : { role: referrerRole }) },
    // Dòng ký gửi của chính người giới thiệu (consignmentLinkedSql): không có dòng nào trong các ca unit.
    $queryRaw: jest.fn().mockResolvedValue([]),
    commission: { createMany: createSpy },
  } as unknown as PrismaService;
}

describe('AffiliateService.createCommissionForOrder', () => {
  it('bỏ qua khi tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false)', async () => {
    const create = jest.fn();
    const prisma = prismaWith({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false, items: [] }, [], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(50_000);
    // Trước đây mốc/bậc cộng orderTotal (80,53tr) → 1 món nhỏ + 79tr hàng bị chặn mở khoá mốc 80tr.
    expect(data.commissionableTotal).toBe(1_000_000);
    expect(data.orderTotal).toBe(80_530_000); // giữ nguyên để tra cứu/đối soát
  });
});

describe('AffiliateService.createCommissionForOrder — chỉ CTV/đại lý hưởng hoa hồng (affiliate.commission_eligible_roles)', () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: 'o1',
    userId: 'buyer',
    referrerUserId: 'ref',
    placedForCustomer: false,
    total: 200000,
    items: [{ id: 'i1', variationId: 'v1', total: 200000 }],
    ...over,
  });
  const run = async (o: unknown, role: string | null, cfg: SystemConfigService = config) => {
    const create = jest.fn().mockResolvedValue({});
    const prisma = prismaWith(o, [{ id: 'v1', affiliateRate: 10 }], create, role);
    await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    return { create, prisma: prisma as unknown as { user: { findUnique: jest.Mock } } };
  };

  it.each(['AFFILIATE', 'DEALER'])('người giới thiệu %s → có hoa hồng (CTV lên đại lý D3-03 vẫn hưởng)', async (role) => {
    const { create, prisma } = await run(order(), role);
    expect(create).toHaveBeenCalledTimes(1);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'ref' }, select: { role: true } });
  });

  it.each(['CUSTOMER', 'STAFF', 'ADMIN'])('người giới thiệu %s → không có hoa hồng', async (role) => {
    const { create } = await run(order(), role);
    expect(create).not.toHaveBeenCalled();
  });

  it('người giới thiệu không còn tồn tại → không có hoa hồng', async () => {
    const { create } = await run(order(), null);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'STAFF'])('đơn %s lên hộ khách → không có hoa hồng (người lên đơn hộ cũng phải là CTV/đại lý)', async (role) => {
    const { create, prisma } = await run(order({ userId: 'ref', placedForCustomer: true }), role);
    expect(create).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'ref' }, select: { role: true } });
  });

  it.each(['AFFILIATE', 'DEALER'])('đơn %s lên hộ khách → vẫn có hoa hồng như cũ', async (role) => {
    const { create } = await run(order({ userId: 'ref', placedForCustomer: true }), role);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('chủ dự án thêm CUSTOMER vào khoá → khách thường hưởng; giá trị khoá hỏng → về mặc định CTV + đại lý', async () => {
    const cfg = (value: unknown) =>
      ({ get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.commission_eligible_roles' ? value : fb) as T }) as unknown as SystemConfigService;
    expect((await run(order(), 'CUSTOMER', cfg(['AFFILIATE', 'DEALER', 'CUSTOMER']))).create).toHaveBeenCalledTimes(1);
    for (const broken of [[], 'AFFILIATE', ['AFFILIATE', 'CTV'], null]) {
      expect((await run(order(), 'CUSTOMER', cfg(broken))).create).not.toHaveBeenCalled();
      expect((await run(order(), 'DEALER', cfg(broken))).create).toHaveBeenCalledTimes(1);
    }
  });
});

describe('AffiliateService.createCommissionForOrder — lineAmounts cho trả một phần (MONEY-2)', () => {
  it('lineAmounts ghi mọi dòng có mức % > 0 (kể cả hoa hồng làm tròn về 0) và bỏ dòng rate 0 / bị chặn; commissionableTotal cộng đúng các dòng đó', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'buyer',
      referrerUserId: 'ctv',
      total: 1_000_100,
      items: [
        { id: 'a', variationId: 'va', total: 1_000_000 }, // 5% → 50.000
        { id: 'b', variationId: 'vb', total: 50 }, // 1% → 0,5 → 0 nhưng nền 50 vẫn thuộc doanh số
        { id: 'c', variationId: 'vc', total: 50 }, // rate 0
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'va', affiliateRate: 5, product: { affiliateBlocked: false } },
      { id: 'vb', affiliateRate: 1, product: { affiliateBlocked: false } },
      { id: 'vc', affiliateRate: 0, product: { affiliateBlocked: false } },
    ], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(50_000);
    expect(data.commissionableTotal).toBe(1_000_050);
    expect(data.lineAmounts).toEqual({ a: 50_000, b: 0 });
  });
});

describe('AffiliateService.createCommissionForOrder — tính trên giá khách thực trả (SELLER-6)', () => {
  it('mã giảm/điểm/giảm hạng nằm ở Order.discount được phân bổ xuống dòng: 10% của 387.000, không phải của 430.000', async () => {
    const create = jest.fn().mockResolvedValue({});
    // subtotal 430.000, mã XANH10 giảm 43.000, ship 0 → khách trả 387.000.
    const order = {
      id: 'o1', userId: 'buyer', referrerUserId: 'ctv', subtotal: 430000, discount: 43000, shippingFee: 0, total: 387000,
      items: [{ variationId: 'v1', total: 430000 }],
    };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 10 }], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(38700);
    expect(data.commissionableTotal).toBe(387000);
  });

  it('phí ship không tính vào nền; phần giảm chia theo tỉ lệ giá trị dòng', async () => {
    const create = jest.fn().mockResolvedValue({});
    // Hàng 300.000 (200k + 100k), giảm 60.000, ship 20.000 → hàng thực trả 240.000 (hệ số 0,8).
    const order = {
      id: 'o1', userId: 'buyer', referrerUserId: 'ctv', subtotal: 300000, discount: 60000, shippingFee: 20000, total: 260000,
      items: [
        { variationId: 'v1', total: 200000 },
        { variationId: 'v2', total: 100000 },
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'v1', affiliateRate: 10 },
      { id: 'v2', affiliateRate: 5 },
    ], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(16000 + 4000);
    expect(data.commissionableTotal).toBe(240000);
  });

  it('đơn 0đ tiền hàng (điểm/mã phủ hết) → không có hoa hồng', async () => {
    const create = jest.fn();
    const order = {
      id: 'o1', userId: 'buyer', referrerUserId: 'ctv', subtotal: 100000, discount: 100000, shippingFee: 0, total: 0,
      items: [{ variationId: 'v1', total: 100000 }],
    };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 10 }], create);
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.reverseCommissionsForOrder (guard đối xứng cho lên-đơn-hộ)', () => {
  function makePrisma(order: unknown) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      commission: { updateMany, findMany: jest.fn().mockResolvedValue([{ affiliateUserId: 'ctv', amount: 12_000 }]) },
    } as unknown as PrismaService;
    return { prisma, updateMany };
  }

  it('đơn thường (referrer ≠ buyer) → VẪN đảo hoa hồng (không đổi)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'buyer', referrerUserId: 'ctv', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1', status: { in: ['PENDING', 'LOCKED'] } } }),
    );
  });

  it('CTV lên đơn hộ (referrer === buyer, placedForCustomer=true) → đảo hoa hồng', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false) → KHÔNG đảo (không có hoa hồng)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).reverseCommissionsForOrder('o1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → KHÔNG đảo', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).reverseCommissionsForOrder('o1');
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
      variations?: Array<{ id: string; isActive?: boolean; salePrice?: number | null; retailPrice?: number; name?: string; product?: { name: string; isActive?: boolean; approvalStatus?: string } }>;
      stockCount?: number;
      executeRaw?: jest.Mock;
      role?: string;
      ctvPhone?: string | null;
      storefront?: { slug: string } | null;
      shippingFee?: number;
      flash?: { resolveEffective: jest.Mock; consumeQuotas: jest.Mock };
    } = {},
  ) {
    const variations =
      opts.variations ?? [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'Mặc định', product: { name: 'Trà thảo mộc', isActive: true, approvalStatus: 'APPROVED' } }];
    const flash = opts.flash ?? { resolveEffective: jest.fn().mockResolvedValue(new Map()), consumeQuotas: jest.fn() };
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    // Giữ chỗ tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — trả SỐ DÒNG bị sửa.
    const executeRaw = opts.executeRaw ?? jest.fn().mockResolvedValue(opts.stockCount ?? 1);
    const commissionCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'ctv', role: opts.role ?? 'AFFILIATE', phone: opts.ctvPhone === undefined ? '0911111111' : opts.ctvPhone }),
        findUnique: jest.fn().mockResolvedValue({ role: opts.role ?? 'AFFILIATE' }),
      },
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
      commission: { createMany: commissionCreate },
      $queryRaw: jest.fn().mockResolvedValue([]),
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    const pricingLocal = { calcShippingFee: jest.fn().mockResolvedValue(opts.shippingFee ?? 0) } as unknown as PricingService;
    const pancakeOrderLocal = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
    // Mock RIÊNG mỗi lần build() (không dùng biến `analytics` chung ở đầu file) — mỗi test
    // trong describe này gọi placeOrderForCustomer nên tự assert được đúng call/props của
    // CHÍNH nó, không bị số lần gọi của test khác trong cùng describe cộng dồn vào.
    const analyticsLocal = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new AffiliateService(
      prisma,
      config,
      pricingLocal,
      pancakeOrderLocal,
      coins,
      analyticsLocal as unknown as AnalyticsEventsService,
      undefined,
      flash as unknown as FlashSaleService,
    );
    return { svc, prisma, orderCreate, executeRaw, commissionCreate, pricingLocal, pancakeOrderLocal, analyticsLocal, flash };
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

  it('COD quá hạn mức 5.000.000đ/đơn → từ chối, không giữ kho, không tạo đơn; chuyển khoản vẫn đặt được', async () => {
    const big = { variations: [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 2600000, name: 'Bộ lớn', product: { name: 'Bộ lớn', isActive: true, approvalStatus: 'APPROVED' } }] };
    const cod = build(big);
    await expect(cod.svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow(/COD.*5\.000\.000đ.*5\.200\.000đ/);
    expect(cod.executeRaw).not.toHaveBeenCalled();
    expect(cod.orderCreate).not.toHaveBeenCalled();

    const bank = build(big);
    await bank.svc.placeOrderForCustomer('ctv', DTO({ paymentMethod: 'BANK_TRANSFER' }) as never);
    expect(bank.orderCreate).toHaveBeenCalledTimes(1);
  });

  // R5-CHECKOUT-3: form lên đơn hộ khoá COD ngay từ báo giá, cùng trần và cùng câu với lúc tạo đơn.
  describe('trần COD mỗi đơn ở báo giá (R5-CHECKOUT-3)', () => {
    const priced = (retailPrice: number) => ({
      variations: [{ id: 'v1', isActive: true, salePrice: null, retailPrice, name: 'Bộ', product: { name: 'Bộ', isActive: true, approvalStatus: 'APPROVED' } }],
    });

    it('tổng 5.400.000đ: báo giá khoá COD kèm lý do; tạo đơn COD bị từ chối PAYMENT_METHOD_NOT_ALLOWED đúng câu đó, không giữ kho', async () => {
      const { svc, orderCreate, executeRaw } = build({ ...priced(1_800_000) });
      const q = await svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 3 }] });
      expect(q.total).toBe(5_400_000);
      expect(q.blockedPaymentMethods).toEqual({
        COD: 'Thanh toán khi nhận hàng (COD) chỉ nhận đơn tối đa 5.000.000đ, đơn này là 5.400.000đ. Vui lòng chọn chuyển khoản.',
      });
      const err = await svc
        .placeOrderForCustomer('ctv', DTO({ items: [{ variationId: 'v1', quantity: 3 }] }) as never)
        .catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'PAYMENT_METHOD_NOT_ALLOWED',
        message: q.blockedPaymentMethods.COD,
      });
      expect(executeRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('tổng đúng 5.000.000đ (kể cả phí giao): COD dùng được ở báo giá và tạo đơn được', async () => {
      const { svc, orderCreate } = build({ ...priced(2_490_000), shippingFee: 20_000 });
      const q = await svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 2 }] });
      expect(q.total).toBe(5_000_000);
      expect(q.blockedPaymentMethods).toEqual({});
      await svc.placeOrderForCustomer('ctv', DTO() as never);
      expect(orderCreate).toHaveBeenCalledTimes(1);
    });
  });

  it('BANK_TRANSFER → đơn PENDING_PAYMENT', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO({ paymentMethod: 'BANK_TRANSFER' }) as never);
    expect(orderCreate.mock.calls[0][0].data.status).toBe('PENDING_PAYMENT');
  });

  it('dùng salePrice khi có (ưu tiên salePrice ?? retailPrice)', async () => {
    const { svc, orderCreate } = build({
      variations: [{ id: 'v1', isActive: true, salePrice: 80000, retailPrice: 100000, name: 'X', product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } }],
    });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.items.create[0].unitPrice).toBe(80000);
    expect(data.subtotal).toBe(160000);
  });

  describe('R4-CHECKOUT-5: đơn hộ tính giá đúng như khách tự đặt (giờ vàng)', () => {
    const GRANOLA = [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 140000, name: '500g', product: { name: 'Granola', isActive: true, approvalStatus: 'APPROVED' } }];
    const offer = (over: Record<string, unknown> = {}) =>
      new Map([['v1', { flashPrice: 120000, itemId: 'fi1', endAt: new Date(), soldCount: 1, quota: 10, quotaLeft: 9, perUserLeft: 3, allowance: 3, ...over }]]);
    const flashWith = (map: Map<string, unknown>) => ({
      resolveEffective: jest.fn().mockResolvedValue(map),
      consumeQuotas: jest.fn().mockImplementation(async (_tx: unknown, _u: string, lines: unknown[]) => lines.map(() => 'OK')),
    });

    it('đang giờ vàng → đơn tính giá giờ vàng, giữ suất trong tx (theo tài khoản CTV), dòng mang flashSaleItemId', async () => {
      const flash = flashWith(offer());
      const { svc, orderCreate, prisma } = build({ variations: GRANOLA, flash, shippingFee: 19000 });
      await svc.placeOrderForCustomer('ctv', DTO() as never);
      expect(flash.resolveEffective).toHaveBeenCalledWith(['v1'], expect.any(Date), 'ctv');
      const data = orderCreate.mock.calls[0][0].data;
      expect(data.items.create[0]).toMatchObject({ variationId: 'v1', unitPrice: 120000, quantity: 2, total: 240000, flashSaleItemId: 'fi1' });
      expect([data.subtotal, data.total]).toEqual([240000, 259000]);
      expect(flash.consumeQuotas).toHaveBeenCalledTimes(1);
      expect(flash.consumeQuotas).toHaveBeenCalledWith(prisma, 'ctv', [expect.objectContaining({ flashSaleItemId: 'fi1', quantity: 2 })], expect.any(Date));
    });

    it('số lượng vượt suất giờ vàng còn mua được → cả dòng giá thường như giỏ, không giữ suất', async () => {
      const flash = flashWith(offer({ allowance: 1, perUserLeft: 1 }));
      const { svc, orderCreate } = build({ variations: GRANOLA, flash });
      await svc.placeOrderForCustomer('ctv', DTO() as never);
      expect(orderCreate.mock.calls[0][0].data.items.create[0]).toMatchObject({ unitPrice: 140000, total: 280000, flashSaleItemId: null });
      expect(flash.consumeQuotas).not.toHaveBeenCalled();
    });

    it('giá đang bán đã hạ dưới giá giờ vàng → lấy giá thấp hơn (min như giỏ)', async () => {
      const flash = flashWith(offer({ flashPrice: 130000 }));
      const { svc, orderCreate } = build({ variations: [{ ...GRANOLA[0]!, salePrice: 110000 }], flash });
      await svc.placeOrderForCustomer('ctv', DTO() as never);
      expect(orderCreate.mock.calls[0][0].data.items.create[0].unitPrice).toBe(110000);
    });

    it('hết suất giữa lúc tính giá và lúc ghi đơn → không tạo đơn, báo giá giờ vàng vừa đổi bằng tiếng Việt', async () => {
      const flash = flashWith(offer());
      flash.consumeQuotas.mockResolvedValue(['SOLD_OUT']);
      const { svc, orderCreate, commissionCreate } = build({ variations: GRANOLA, flash });
      const err = await svc.placeOrderForCustomer('ctv', DTO() as never).catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PRICE_CHANGED' });
      expect((err as BadRequestException).message).toContain('Granola');
      expect(orderCreate).not.toHaveBeenCalled();
      expect(commissionCreate).not.toHaveBeenCalled();
    });

    it('vượt giới hạn mua (OVER_LIMIT) → giữ nguyên lỗi, không tạo đơn', async () => {
      const flash = flashWith(offer());
      flash.consumeQuotas.mockResolvedValue(['OVER_LIMIT']);
      const { svc, orderCreate } = build({ variations: GRANOLA, flash });
      await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow('Vượt giới hạn mua ưu đãi.');
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('thua tranh khoá khi trừ suất (40P01) → 503 "đang bận" để thử lại, KHÔNG báo hết suất', async () => {
      const flash = flashWith(offer());
      flash.consumeQuotas.mockRejectedValue(
        new FlashQuotaLineError(0, new Error('Raw query failed. Code: `40P01`. Message: `ERROR: deadlock detected`')),
      );
      const { svc, orderCreate } = build({ variations: GRANOLA, flash });
      const err = await svc.placeOrderForCustomer('ctv', DTO() as never).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message).toBe(LOCK_BUSY_MESSAGE);
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('lỗi hạ tầng khác khi trừ suất → báo giá giờ vàng vừa đổi của đúng dòng đó như trước', async () => {
      const flash = flashWith(offer());
      flash.consumeQuotas.mockRejectedValue(new FlashQuotaLineError(0, new Error('connection reset')));
      const { svc } = build({ variations: GRANOLA, flash });
      const err = await svc.placeOrderForCustomer('ctv', DTO() as never).catch((e: BadRequestException) => e);
      expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'PRICE_CHANGED' });
      expect((err as BadRequestException).message).toContain('Granola');
    });

    it('cùng biến thể gửi hai dòng → gộp một dòng, xét suất giờ vàng trên tổng số lượng', async () => {
      const flash = flashWith(offer({ allowance: 3 }));
      const { svc, orderCreate } = build({ variations: GRANOLA, flash });
      await svc.placeOrderForCustomer('ctv', DTO({ items: [{ variationId: 'v1', quantity: 2 }, { variationId: 'v1', quantity: 2 }] }) as never);
      const items = orderCreate.mock.calls[0][0].data.items.create;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ quantity: 4, unitPrice: 140000, flashSaleItemId: null });
    });

    it('báo giá đơn hộ trả đúng giá sẽ tính khi tạo đơn (kèm lý do khi vượt suất), không tạo gì', async () => {
      const flash = flashWith(offer({ allowance: 1, perUserLeft: 1 }));
      const { svc, orderCreate, executeRaw } = build({ variations: GRANOLA, flash, shippingFee: 19000 });
      const q = await svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 1 }] });
      expect(q).toEqual({
        items: [{ variationId: 'v1', unitPrice: 120000, quantity: 1, total: 120000, isFlash: true, flashLimitNotice: null }],
        goods: 120000,
        shippingFee: 19000,
        total: 139000,
        blockedPaymentMethods: {},
      });
      const over = await svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 2 }] });
      expect(over.items[0]).toMatchObject({ unitPrice: 140000, isFlash: false, flashLimitNotice: expect.stringContaining('tối đa 1') });
      expect(orderCreate).not.toHaveBeenCalled();
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it('R7 #6a: giờ vàng hết giữa lúc báo giá và lúc tạo đơn (tổng cao hơn tổng CTV đã báo khách) → TOTAL_CHANGED, không giữ kho, không tạo đơn', async () => {
      const { svc, orderCreate, executeRaw } = build({ variations: GRANOLA, shippingFee: 19000 });
      const err = await svc
        .placeOrderForCustomer('ctv', DTO({ items: [{ variationId: 'v1', quantity: 1 }], expectedTotal: 139000 }) as never)
        .catch((e: BadRequestException) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'TOTAL_CHANGED',
        message: 'Tổng tiền đơn vừa thay đổi từ 139.000đ thành 159.000đ do giá, phí giao hoặc ưu đãi vừa thay đổi. Vui lòng xem lại trước khi đặt.',
      });
      expect(executeRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
    });

    it('R7 #6a: tổng lúc tạo đơn bằng hoặc thấp hơn tổng đã báo → tạo đơn bình thường', async () => {
      for (const expectedTotal of [159000, 200000]) {
        const { svc, orderCreate } = build({ variations: GRANOLA, shippingFee: 19000 });
        await svc.placeOrderForCustomer('ctv', DTO({ items: [{ variationId: 'v1', quantity: 1 }], expectedTotal }) as never);
        expect(orderCreate.mock.calls[0][0].data.total).toBe(159000);
      }
    });

    it('R7 #6b: báo giá có hàng gian hàng đối tác tự giao → NOT_TUBU_FULFILLED như lúc tạo đơn', async () => {
      const { svc, prisma } = build({ variations: GRANOLA });
      const findMany = prisma.variation.findMany as jest.Mock;
      findMany.mockReset();
      findMany.mockResolvedValueOnce(GRANOLA).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'v1' }]);
      await expect(svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 1 }] })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NOT_TUBU_FULFILLED', message: expect.stringContaining('do gian hàng đối tác tự giao') }),
      });
    });

    it('báo giá đơn hộ: chỉ CTV/ADMIN', async () => {
      const { svc } = build({ role: 'CUSTOMER' });
      await expect(svc.quoteOrderForCustomer('ctv', { items: [{ variationId: 'v1', quantity: 1 }] })).rejects.toThrow('Chỉ CTV');
    });
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

  it('tạo hoa hồng cho CTV trong cùng tx với đơn (createCommissionForOrder)', async () => {
    const { svc, commissionCreate, prisma } = build();
    // order fetch trong createCommissionForOrder: đơn CTV placedForCustomer + 1 item có rate.
    (prisma.order.findUniqueOrThrow as jest.Mock)
      .mockResolvedValueOnce({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 200000, items: [{ variationId: 'v1', total: 200000 }] })
      .mockResolvedValueOnce({ id: 'o1', code: 'TUBU1', total: 200000, items: [] });
    (prisma.variation.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } },
    ])
      // kiểm lại SP còn bán trong tx (cart/sellable.ts)
      .mockResolvedValueOnce([{ id: 'v1' }])
      .mockResolvedValueOnce([{ id: 'v1', affiliateRate: 10 }]);
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
      variations: [{ id: 'v1', isActive: false, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P', isActive: true, approvalStatus: 'APPROVED' } }],
    });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
  });

  it('SP cha ngừng bán / chưa duyệt (variation vẫn active) → PRODUCT_DISCONTINUED, không tạo đơn (C-007)', async () => {
    for (const product of [
      { name: 'P', isActive: false, approvalStatus: 'APPROVED' },
      { name: 'P', isActive: true, approvalStatus: 'PENDING_REVIEW' },
      { name: 'P', isActive: true, approvalStatus: 'REJECTED' },
    ]) {
      const { svc, orderCreate } = build({
        variations: [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'X', product }],
      });
      await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toMatchObject({
        response: { code: 'PRODUCT_DISCONTINUED' },
      });
      expect(orderCreate).not.toHaveBeenCalled();
    }
  });

  it('người dùng không phải CTV/ADMIN → BadRequest (chống tự-giao-dịch)', async () => {
    const { svc, orderCreate } = build({ role: 'CUSTOMER' });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  // C-028: SĐT người nhận trùng SĐT tài khoản CTV = CTV tự mua cho mình qua đường "đơn hộ" để
  // ăn hoa hồng (và khi huỷ, đích hoàn theo SĐT cũng trỏ về chính CTV).
  it.each([
    ['cùng dạng 0xxxxxxxxx', '0901234567', '0901234567'],
    ['CTV gõ +84 cho SĐT tài khoản lưu 0x', '0901234567', '+84 90 123 4567'],
    ['tài khoản lưu dạng 84x, CTV gõ 0x', '84901234567', '090.123.4567'],
    ['CTV gõ 84 không có dấu +', '0922222221', '84922222221'],
    ['CTV gõ có dấu gạch', '0922222221', '092-222-2221'],
    ['CTV gõ (+84) có ngoặc', '0922222221', '(+84) 922 222 221'],
  ])('SĐT người nhận trùng SĐT tài khoản CTV (%s) → BadRequest, KHÔNG giữ kho / tạo đơn / hoa hồng', async (_case, ctvPhone, customerPhone) => {
    const { svc, orderCreate, executeRaw, commissionCreate } = build({ ctvPhone });
    await expect(
      svc.placeOrderForCustomer('ctv', DTO({ customer: { ...CUSTOMER, phone: customerPhone } }) as never),
    ).rejects.toThrow('SĐT của chính bạn');
    expect(executeRaw).not.toHaveBeenCalled();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(commissionCreate).not.toHaveBeenCalled();
  });

  it('CTV chưa có SĐT trên tài khoản → vẫn lên đơn hộ bình thường', async () => {
    const { svc, orderCreate } = build({ ctvPhone: null });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(orderCreate).toHaveBeenCalledTimes(1);
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

  it('mã đơn lên hộ có dạng TUBU<yyyymmdd><5 số> như đơn checkout', async () => {
    const { svc, orderCreate, prisma } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const code = orderCreate.mock.calls[0][0].data.code as string;
    expect(code).toMatch(/^TUBU\d{8}\d{5}$/);
    expect(prisma.order.findUnique).toHaveBeenCalledWith({ where: { code } });
  });

  it('đơn trả cho CTV (đặt mới, đặt lại cùng key) không kèm cột nội bộ: mốc thôi tự huỷ, ghi chú vận hành Pancake, cột tìm kiếm', async () => {
    const internal = {
      idempotencyKey: 'idem-9',
      pancakeOrderId: 'pk-1',
      pancakeAttention: 'Đơn CHƯA thanh toán — hệ thống thôi tự huỷ vì đã bàn giao vận chuyển.',
      autoCancelBlockedAt: new Date(),
      recipientSearch: 'khach a so 1',
      endCustomerKey: '0900000000',
    };
    const { svc, prisma } = build();
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({
      id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 100000, items: [], code: 'TUBU1', ...internal,
    });
    const created = await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-9');
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o1', userId: 'ctv' });
    const replayed = await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-9');
    for (const res of [created, replayed]) {
      expect(res).toMatchObject({ id: 'o1', code: 'TUBU1', total: 100000 });
      for (const k of Object.keys(internal)) expect(res).not.toHaveProperty(k);
    }
  });

  it('R5-CHECKOUT-1: lần gửi lại cùng key chồng lên lần đầu, báo hết hàng vì lần đầu vừa giữ kho → trả lại đơn lần đầu đã tạo', async () => {
    const { svc, prisma, orderCreate } = build({ stockCount: 0 });
    (prisma.order.findUnique as jest.Mock)
      .mockResolvedValueOnce(null) // kiểm key đầu hàm: lần đầu chưa commit
      .mockResolvedValueOnce(null) // generateUniqueOrderCode
      .mockResolvedValueOnce({ id: 'o-first', userId: 'ctv' }); // sau lỗi: lần đầu đã commit
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'o-first', code: 'TUBU1', items: [] });
    const r = (await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-race')) as { id: string };
    expect(r.id).toBe('o-first');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('lỗi khi tạo đơn mà key chưa có đơn nào (hoặc là đơn của người khác) → giữ nguyên lỗi', async () => {
    const none = build({ stockCount: 0 });
    await expect(none.svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-x')).rejects.toThrow('không đủ tồn kho');
    const other = build({ stockCount: 0 });
    (other.prisma.order.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'o-other', userId: 'ctv-khac' });
    await expect(other.svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-y')).rejects.toThrow('không đủ tồn kho');
  });

  it('idempotency-key mới (chưa có đơn nào) → tạo đơn bình thường + ghi idempotencyKey', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never, 'idem-2');
    expect(orderCreate.mock.calls[0][0].data.idempotencyKey).toBe('idem-2');
  });

  // Task 10 Step 0: placeOrderForCustomer tạo Order qua nhánh RIÊNG (không đi qua
  // checkout.service.ts) — nếu thiếu 3 cột này + event thì quyết định "tính cho khách nhận hàng
  // qua endCustomerKey" lặng lẽ không có hiệu lực cho loại đơn CTV lên hộ.
  it('order_placed: set 3 cột mới (source/platform/endCustomerKey) + phát event ĐÚNG props (orderId từ đơn VỪA TẠO, không phải lookup khác)', async () => {
    const { svc, orderCreate, analyticsLocal } = build({ shippingFee: 19000 });
    // id KHÁC hẳn id cố định ('o1') mà findUniqueOrThrow của build() trả — chứng minh props.orderId
    // lấy từ `created` (kết quả orderCreate NGAY TRONG tx), không phải từ một lookup nào khác sau đó.
    orderCreate.mockResolvedValueOnce({ id: 'o-created' });
    await svc.placeOrderForCustomer('ctv', DTO({ customer: { ...CUSTOMER, phone: '090-123 4567' } }) as never);

    const data = orderCreate.mock.calls[0][0].data;
    expect(data.source).toBe('ctv_assisted');
    expect(data.platform).toBe('miniapp');
    // Cùng kiểu chuẩn hoá 84→0xxxxxxxxx mà User.phone luôn lưu (common/phone.ts toLocalPhone),
    // KHÔNG PHẢI hash — SĐT không có mã +84 cũng phải qua được (chỉ strip ký tự không phải số ở đây).
    expect(data.endCustomerKey).toBe('0901234567');

    expect(analyticsLocal.record).toHaveBeenCalledTimes(1);
    expect(analyticsLocal.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'order_placed',
        userId: 'ctv',
        platform: 'miniapp',
        storefrontSlug: 'ctv-shop',
        props: expect.objectContaining({
          orderId: 'o-created',
          total: 219000, // goods 200000 (100000*2) + ship 19000
          subtotal: 200000,
          discount: 0,
          shippingFee: 19000,
          itemCount: 1,
          paymentMethod: 'COD',
          orderSource: 'ctv_assisted',
        }),
      }),
    );
  });

  // R5-CHECKOUT-2: SĐT rỗng/rác từng tạo đơn kẹt đẩy Pancake; '922222221' (SĐT của CTV bỏ số 0 đầu) từng lọt chặn SĐT của chính
  // CTV. Bước tạo đơn tự kiểm lại, không chỉ dựa vào DTO.
  it.each(['', '---', 'abc', '922222221', '09111111'])(
    'SĐT người nhận %j không phải SĐT di động VN → BadRequest, KHÔNG giữ kho / tạo đơn / hoa hồng',
    async (phone) => {
      const { svc, orderCreate, executeRaw, commissionCreate } = build({ ctvPhone: '0922222221' });
      await expect(svc.placeOrderForCustomer('ctv', DTO({ customer: { ...CUSTOMER, phone } }) as never)).rejects.toThrow(
        'Số điện thoại người nhận không hợp lệ',
      );
      expect(executeRaw).not.toHaveBeenCalled();
      expect(orderCreate).not.toHaveBeenCalled();
      expect(commissionCreate).not.toHaveBeenCalled();
    },
  );

  it('SĐT người nhận lưu vào đơn (gửi Pancake, khoá gộp khách) ở dạng 0xxxxxxxxx dù CTV gõ +84 có dấu cách', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO({ customer: { ...CUSTOMER, recipient: '  Khách A ', phone: '+84 90 123 4567' } }) as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.shippingAddress).toMatchObject({ recipient: 'Khách A', phone: '0901234567' });
    expect(data.endCustomerKey).toBe('0901234567');
  });

  // P0 (review Task 10): ctv-order-sheet.tsx (FE) nhận CẢ 0xxxxxxxxx lẫn +84xxxxxxxxx cho SĐT
  // người nhận. User.phone luôn lưu dạng 0xxxxxxxxx (zalo.service.ts/loyalty.service.ts). Nếu
  // endCustomerKey chỉ strip ký tự không phải số (không đổi 84→0) thì CTV gõ '+84...' cho ĐÚNG
  // khách đã có tài khoản '0...' sẽ tạo ra 2 endCustomerKey khác nhau cho CÙNG 1 người — hỏng
  // quyết định nghiệp vụ "gộp doanh số theo endCustomerKey".
  it('endCustomerKey: SĐT dạng +84xxxxxxxxx phải chuẩn hoá về CÙNG dạng 0xxxxxxxxx như SĐT gõ kiểu 0xxxxxxxxx (không tách 1 khách thành 2 key)', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO({ customer: { ...CUSTOMER, phone: '+84 90 123 4567' } }) as never);
    expect(orderCreate.mock.calls[0][0].data.endCustomerKey).toBe('0901234567');
  });

  it('order_placed được ghi bằng ĐÚNG object `tx` của $transaction, không phải this.prisma ở ngoài (chứng minh atomic thật — mirror dealer-order-payment.spec.ts)', async () => {
    const txOrderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const txExecuteRaw = jest.fn().mockResolvedValue(1);
    const txMarker = {
      order: {
        create: txOrderCreate,
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 100000, items: [] }),
      },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1' }]) },
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'AFFILIATE' }) },
      $executeRaw: txExecuteRaw,
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ctv', role: 'AFFILIATE' }) },
      variation: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'Mặc định', product: { name: 'Trà thảo mộc', isActive: true, approvalStatus: 'APPROVED' } }]),
      },
      storefront: { findFirst: jest.fn().mockResolvedValue({ slug: 'ctv-shop' }) },
      order: {
        create: jest.fn(), // KHÔNG được gọi trực tiếp trên this.prisma — phải qua tx (txMarker)
        findUnique: jest.fn().mockResolvedValue(null), // generateOrderCode: code chưa tồn tại
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 100000, items: [], code: 'TUBU1' }),
      },
      commission: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(txMarker)),
    } as unknown as PrismaService;
    const pancakeOrderLocal = { enqueuePush: jest.fn().mockResolvedValue(undefined) } as unknown as PancakeOrderService;
    const analyticsLocal = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new AffiliateService(
      prisma,
      config,
      pricing,
      pancakeOrderLocal,
      coins,
      analyticsLocal as unknown as AnalyticsEventsService,
    );

    await svc.placeOrderForCustomer('ctv', DTO() as never);

    expect(txOrderCreate).toHaveBeenCalledTimes(1);
    expect(analyticsLocal.record).toHaveBeenCalledTimes(1);
    expect(analyticsLocal.record.mock.calls[0][0]).toBe(txMarker);
    expect(analyticsLocal.record.mock.calls[0][0]).not.toBe(prisma);
  });
});

describe('AffiliateService.dashboard (doanh số tháng = doanh số ĐÃ CHỐT, mốc theo giờ VN)', () => {
  // 2026-09-30 18:00 UTC = 01:00 ngày 1/10 giờ VN.
  const NOW = new Date('2026-09-30T18:00:00.000Z');

  function build() {
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 0, commissionableTotal: 0 } });
    const commissionCount = jest.fn().mockResolvedValue(0);
    const prisma = {
      commission: { aggregate: commissionAggregate, count: commissionCount },
      affiliateLink: { aggregate: jest.fn().mockResolvedValue({ _sum: { clicks: 0, conversions: 0 } }) },
    } as unknown as PrismaService;
    return { svc: new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics), commissionAggregate, commissionCount };
  }

  // U3-B01: affiliate_links.conversions không chỗ nào tăng, nên "Chuyển đổi" luôn 0 dù CTV có đơn ghi công. Đếm từ bảng
  // hoa hồng: mỗi (đơn, CTV) tối đa một dòng (unique) nên webhook lặp không đếm đôi; đơn huỷ/trả (REJECTED) không tính.
  it('U3-B01: totalConversions = số đơn đã ghi công (hoa hồng khác REJECTED), không phải cột links.conversions', async () => {
    const { svc, commissionCount } = build();
    commissionCount.mockResolvedValue(15);
    const d = await svc.dashboard('u1', NOW);
    expect(commissionCount).toHaveBeenCalledWith({ where: { affiliateUserId: 'u1', status: { not: 'REJECTED' } } });
    expect(d.totalConversions).toBe(15);
  });

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

  it('Q2: withdrawTaxPreview = thuế sẽ bị trừ nếu rút hết ngay, cộng dồn các lệnh rút đã có trong tháng VN; không có gì để rút → 0', async () => {
    const aggregate = jest.fn(async (args: { where: { status?: unknown; payoutBatchId?: unknown } }) =>
      args.where.status === 'APPROVED' && args.where.payoutBatchId === null
        ? { _sum: { amount: 1_500_000, commissionableTotal: 0 } }
        : { _sum: { amount: 0, commissionableTotal: 0 } },
    );
    const payoutAggregate = jest.fn().mockResolvedValue({ _sum: { grossAmount: 1_500_000, taxWithheld: 0 } });
    const prisma = {
      commission: { aggregate, count: jest.fn().mockResolvedValue(0) },
      payout: { aggregate: payoutAggregate },
      affiliateLink: { aggregate: jest.fn().mockResolvedValue({ _sum: { clicks: 0, conversions: 0 } }) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
    const d = await svc.dashboard('u1', NOW);
    expect(d.withdrawTaxPreview).toBe(300_000);
    expect(payoutAggregate.mock.calls[0][0].where.requestedAt).toEqual({
      gte: new Date('2026-09-30T17:00:00.000Z'),
      lt: new Date('2026-10-31T17:00:00.000Z'),
    });
    expect((await build().svc.dashboard('u1', NOW)).withdrawTaxPreview).toBe(0);
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

  // A5-11 (docs/audit-2026-09/05-ctv-dealer-staff.md): "Hoa hồng tháng này/Hôm nay" trước đây cộng
  // CẢ commission đã REJECTED (đơn huỷ/trả) — số lớn nhất màn hình không bao giờ giảm khi đơn bị
  // huỷ. Tiền không thực sự mất (reverseCommissionsForOrder chỉ REJECT commission còn PENDING/
  // LOCKED — chưa bao giờ tới APPROVED/PAID nên chưa từng rút được), đây là lỗi hiển thị/niềm tin.
  it('A5-11: todayCommission/monthCommission loại REJECTED, PENDING/LOCKED/APPROVED/PAID vẫn cộng như cũ', async () => {
    const { svc, commissionAggregate } = build();
    await svc.dashboard('u1', NOW);
    // 2 lệnh gọi đầu (today, month) là sumCommission() — where phải loại REJECTED.
    const sumCalls = commissionAggregate.mock.calls.filter((c) => c[0]?.where?.createdAt);
    expect(sumCalls).toHaveLength(2);
    for (const call of sumCalls) {
      expect(call[0].where.status).toEqual({ not: 'REJECTED' });
    }
  });
});

describe('AffiliateService.monthlyTier (Build Spec §6.8.2)', () => {
  // monthlyTier là private (ngưỡng dùng chung với mốc thưởng — ctv-milestones.ts) — gọi qua
  // cast để kiểm tra ranh giới bậc.
  const tier = (revenue: number) =>
    (new AffiliateService({} as unknown as PrismaService, config, pricing, pancakeOrder, coins, analytics) as unknown as {
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
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
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
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).approveDueCommissions();
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
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).approveDueCommissions();
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ status: 'LOCKED', order: { status: 'DELIVERED' } });
  });

  it('không có yêu cầu đổi/trả treo → không thêm điều kiện orderId', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      returnRequest: { findMany: jest.fn().mockResolvedValue([]) },
      commission: { updateMany },
    } as unknown as PrismaService;
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).approveDueCommissions();
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
    await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics).approveDueCommissions();
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
    const res = await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics).getMilestones('u1');
    expect(res.holdDays).toBe(10);
  });
});

describe('AffiliateService.requestPayout (money safety)', () => {
  function makePrisma(opts: {
    available?: number;
    rows?: { id: string; amount: number }[];
    markCount?: number;
    taxId?: string | null;
    /** Các lệnh rút hoa hồng đã có trong tháng (chưa kể lệnh đang tạo). */
    priorGross?: number;
    priorTax?: number;
    /** Phần thuế giữ dư đã hoàn về Ví của các lệnh đó (Q2b). */
    priorRefunded?: number;
  }) {
    const rows = opts.rows ?? [{ id: 'c1', amount: 100_000 }];
    const payoutAggregate = jest.fn().mockResolvedValue({ _sum: { grossAmount: opts.priorGross ?? null, taxWithheld: opts.priorTax ?? null, taxRefunded: opts.priorRefunded ?? null } });
    const executeRaw = jest.fn().mockResolvedValue(1);
    const userUpdate = jest.fn().mockResolvedValue({});
    const userFindUnique = jest.fn().mockResolvedValue({ personalTaxId: opts.taxId ?? null });
    const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
    const updateMany = jest.fn().mockResolvedValue({ count: opts.markCount ?? rows.length });
    const prisma = {
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.available ?? 100_000 } }),
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany,
      },
      user: { update: userUpdate, findUnique: userFindUnique },
      payout: { create: payoutCreate, aggregate: payoutAggregate },
      $executeRaw: executeRaw,
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    return { prisma, userUpdate, userFindUnique, payoutCreate, updateMany, payoutAggregate, executeRaw };
  }

  it('số dư khả dụng = 0 → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 0 });
    await expect(new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 0, 'WALLET_BALANCE')).rejects.toThrow(
      'khả dụng',
    );
  });

  it('amount vượt khả dụng → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 200_000, 'WALLET_BALANCE'),
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
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 100_000, 'WALLET_BALANCE');
    // P0 A5-07: walletBalance là tiền VND rút được 1:1 ra ngân hàng thật (wallet.service.ts:withdraw)
    // — nhân hệ số ở đường này tương đương in tiền thật (1tr hoa hồng → 1,497tr rút được trước khi
    // vá). credited PHẢI đúng bằng total, không hơn không kém.
    expect(r.credited).toBe(100_000);
    expect(userUpdate.mock.calls[0][0].data.walletBalance).toEqual({ increment: 100_000 });
    expect(payoutCreate.mock.calls[0][0].data.status).toBe('PAID');
    expect(ledger).toHaveBeenLastCalledWith(
      prisma,
      expect.objectContaining({ userId: 'u1', delta: 100_000, type: 'COMMISSION_PAYOUT', refType: 'PAYOUT', refId: 'payout-1' }),
    );
    // Không còn quảng cáo hệ số nhân (đã bỏ) trong thông báo cho CTV.
    expect(r.note).not.toContain('×');
  });

  it('WALLET_BALANCE: SystemConfig affiliate.tubu_wallet_multiplier còn seed giá trị >1 (dữ liệu cũ) → KHÔNG được đọc/áp dụng ở đường tiền thật này nữa (P0 A5-07)', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, rows: [{ id: 'c1', amount: 100_000 }] });
    const cfgWithStaleMultiplier = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.tubu_wallet_multiplier' ? ((5 as unknown) as T) : (fb as T)),
    } as unknown as SystemConfigService;
    const r = await new AffiliateService(prisma, cfgWithStaleMultiplier, pricing, pancakeOrder, coins, analytics).requestPayout(
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
        aggregate: jest.fn(async () => ({ _sum: { grossAmount: null, taxWithheld: null } })),
      },
      $executeRaw: jest.fn(async () => 1),
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));

    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
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
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 60_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('không chuyển một phần');
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
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('thay đổi');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('WALLET_BALANCE double-spend: updateMany count=0 → BadRequest, KHÔNG credit ví', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, markCount: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('đã được xử lý');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it.each(['BANK', 'ZALOPAY'])('%s bị chặn ngay ở service (Zalo 4.5): không tạo lệnh, không khoá hoa hồng, không đọc DB', async (method) => {
    const { prisma, payoutCreate, updateMany, userUpdate } = makePrisma({ available: 100_000, rows: [{ id: 'c1', amount: 100_000 }] });
    const err = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics)
      .requestPayout('u1', 100_000, method, { bank: 'VCB' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe(WALLET_ONLY_MESSAGE);
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // SELLER-11: khấu trừ 10% thuế TNCN khi tổng chuyển trong tháng từ ngưỡng (mặc định 5.000.000đ, NĐ 253/2026/NĐ-CP; ở đây admin đặt 2.000.000đ).
  it('SELLER-11: chuyển từ ngưỡng 2.000.000đ → lưu gross, thuế khấu trừ 10%, amount = thực nhận, MST đã khai', async () => {
    const { prisma, payoutCreate } = makePrisma({ available: 2_500_000, rows: [{ id: 'c1', amount: 2_500_000 }], taxId: '079201001234' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 2_500_000, 'WALLET_BALANCE');
    expect(payoutCreate.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ grossAmount: 2_500_000, taxWithheld: 250_000, amount: 2_250_000, taxId: '079201001234' }),
    );
  });

  it('SELLER-11: lần rút bị khấu trừ mà CTV chưa khai MST/CCCD → 400 PIT_TAX_ID_REQUIRED, không tạo lệnh, không khoá hoa hồng', async () => {
    const { prisma, payoutCreate, updateMany } = makePrisma({ available: 2_500_000, rows: [{ id: 'c1', amount: 2_500_000 }] });
    const err = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics)
      .requestPayout('u1', 2_500_000, 'WALLET_BALANCE')
      .catch((e: BadRequestException) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toEqual(expect.objectContaining({ code: 'PIT_TAX_ID_REQUIRED' }));
    expect(payoutCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('SELLER-11: CTV khai MST/CCCD ngay trong lần rút → lưu vào hồ sơ và chụp vào lệnh rút', async () => {
    const { prisma, payoutCreate, userUpdate } = makePrisma({ available: 2_500_000, rows: [{ id: 'c1', amount: 2_500_000 }] });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout(
      'u1',
      2_500_000,
      'WALLET_BALANCE',
      undefined,
      undefined,
      ' 079201001234 ',
    );
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { personalTaxId: '079201001234' } });
    expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 250_000, taxId: '079201001234' }));
  });

  it('SELLER-11: dưới ngưỡng không bắt khai MST', async () => {
    const { prisma, payoutCreate } = makePrisma({ available: 500_000, rows: [{ id: 'c1', amount: 500_000 }] });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 500_000, 'WALLET_BALANCE');
    expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0 }));
  });

  it('SELLER-11: dưới ngưỡng → không khấu trừ; cấu hình 0% → tắt', async () => {
    const small = makePrisma({ available: 1_999_000, rows: [{ id: 'c1', amount: 1_999_000 }] });
    await new AffiliateService(small.prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 1_999_000, 'WALLET_BALANCE');
    expect(small.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 1_999_000 }));

    const off = { get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.pit_withhold_pct' ? 0 : fb) as T } as unknown as SystemConfigService;
    const big = makePrisma({ available: 5_000_000, rows: [{ id: 'c1', amount: 5_000_000 }] });
    await new AffiliateService(big.prisma, off, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 5_000_000, 'WALLET_BALANCE');
    expect(big.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 5_000_000 }));
  });

  describe('thuế TNCN cộng dồn theo tháng VN (Q2)', () => {
    const MST = '079201001234';
    const run = (method: 'WALLET_BALANCE', total: number, prior: { priorGross?: number; priorTax?: number; priorRefunded?: number }, cfg: SystemConfigService = config) => {
      const m = makePrisma({ available: total, rows: [{ id: 'c1', amount: total }], taxId: MST, ...prior });
      return new AffiliateService(m.prisma, cfg, pricing, pancakeOrder, coins, analytics)
        .requestPayout('u1', total, method)
        .then(() => m);
    };

    it('lần 2 trong tháng 1.500.000đ sau lần 1 1.500.000đ (chưa bị trừ) → trừ 10% trên tổng 3.000.000đ = 300.000đ', async () => {
      const { payoutCreate } = await run('WALLET_BALANCE', 1_500_000, { priorGross: 1_500_000, priorTax: 0 });
      expect(payoutCreate.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ grossAmount: 1_500_000, taxWithheld: 300_000, amount: 1_200_000, taxId: MST }),
      );
    });

    it('đã trừ 300.000đ trên 3.000.000đ, lần này 1.000.000đ → chỉ trừ phần chênh 100.000đ (10% × 4.000.000đ − 300.000đ)', async () => {
      const { payoutCreate } = await run('WALLET_BALANCE', 1_000_000, { priorGross: 3_000_000, priorTax: 300_000 });
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 100_000, amount: 900_000 }));
    });

    it('thuế đã hoàn về Ví không còn là thuế đã giữ → lần rút sau truy thu đúng (tháng 2.500.000đ cần 250.000đ, đang giữ thực 0đ)', async () => {
      // Ví dụ chủ: A 1,5 triệu bị từ chối; B 1 triệu giữ 250k đã hoàn 250k; lần này C 1,5 triệu → tổng 2,5 triệu cần 250k.
      const { payoutCreate } = await run('WALLET_BALANCE', 1_500_000, { priorGross: 1_000_000, priorTax: 250_000, priorRefunded: 250_000 });
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 250_000, amount: 1_250_000 }));
    });

    it('khoản truy thu lớn hơn số tiền lần này → chỉ trừ tối đa bằng lần này, phần còn lại dồn sang lần sau', async () => {
      const { payoutCreate } = await run('WALLET_BALANCE', 100_000, { priorGross: 1_900_000, priorTax: 0 });
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 100_000, amount: 0 }));
      // Lần sau: tổng 2.100.000đ, đã trừ 100.000đ → còn thiếu 110.000đ, lại bị chặn ở 100.000đ của lần đó.
      const next = await run('WALLET_BALANCE', 100_000, { priorGross: 2_000_000, priorTax: 100_000 });
      expect(next.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 100_000, amount: 0 }));
    });

    it('lệnh rút về Ví bị trừ hết (net 0) → vẫn ghi lệnh PAID, không ghi dòng sổ ví 0đ', async () => {
      const { payoutCreate, userUpdate } = await run('WALLET_BALANCE', 100_000, { priorGross: 1_900_000, priorTax: 0 });
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 100_000, amount: 0, status: 'PAID' }));
      expect(userUpdate).not.toHaveBeenCalled();
    });

    it('lệnh rút về Ví bị trừ hết (net 0) → lời nhắn nói rõ toàn bộ số rút bị khấu trừ thuế, không "Đã cộng 0đ"', async () => {
      const m = makePrisma({ available: 100_000, rows: [{ id: 'c1', amount: 100_000 }], taxId: MST, priorGross: 1_900_000, priorTax: 0 });
      const res = await new AffiliateService(m.prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 100_000, 'WALLET_BALANCE');
      expect(res).toEqual(expect.objectContaining({ credited: 0 }));
      expect((res as { note: string }).note).toContain('khấu trừ thuế TNCN');
      expect((res as { note: string }).note).not.toContain('Đã cộng 0đ');
    });

    it('tổng tháng chưa tới ngưỡng → không trừ; đã trừ dư (lệnh trước bị từ chối sau đó) → không trừ âm', async () => {
      const under = await run('WALLET_BALANCE', 1_000_000, { priorGross: 900_000, priorTax: 0 });
      expect(under.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0 }));
      const over = await run('WALLET_BALANCE', 500_000, { priorGross: 1_500_000, priorTax: 300_000 });
      expect(over.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 500_000 }));
    });

    it('hằng số mặc định là 5.000.000đ', () => {
      expect(DEFAULT_PIT_WITHHOLD_THRESHOLD).toBe(5_000_000);
    });

    it('mặc định ngưỡng 5.000.000đ (NĐ 253/2026): 4.999.999đ không bị trừ, 5.000.000đ bị trừ 10%', async () => {
      const under = await run('WALLET_BALANCE', 4_999_999, {}, defaultConfig);
      expect(under.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 4_999_999 }));
      const at = await run('WALLET_BALANCE', 5_000_000, {}, defaultConfig);
      expect(at.payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 500_000, amount: 4_500_000 }));
    });

    it('mặc định 5.000.000đ vẫn cộng dồn theo tháng: lần 3.000.000đ sau lần 2.000.000đ bị trừ 10% trên tổng 5.000.000đ', async () => {
      const { payoutCreate } = await run('WALLET_BALANCE', 3_000_000, { priorGross: 2_000_000, priorTax: 0 }, defaultConfig);
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 500_000, amount: 2_500_000 }));
    });

    it('cấu hình 0% → tắt dù tổng tháng vượt ngưỡng', async () => {
      const off = { get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.pit_withhold_pct' ? 0 : fb) as T } as unknown as SystemConfigService;
      const { payoutCreate } = await run('WALLET_BALANCE', 1_500_000, { priorGross: 1_500_000, priorTax: 0 }, off);
      expect(payoutCreate.mock.calls[0][0].data).toEqual(expect.objectContaining({ taxWithheld: 0 }));
    });

    it('lần 2 bị trừ mà chưa có MST → 400 PIT_TAX_ID_REQUIRED, không tạo lệnh', async () => {
      const m = makePrisma({ available: 1_500_000, rows: [{ id: 'c1', amount: 1_500_000 }], priorGross: 1_500_000, priorTax: 0 });
      const err = await new AffiliateService(m.prisma, config, pricing, pancakeOrder, coins, analytics)
        .requestPayout('u1', 1_500_000, 'WALLET_BALANCE')
        .catch((e: BadRequestException) => e);
      expect((err as BadRequestException).getResponse()).toEqual(expect.objectContaining({ code: 'PIT_TAX_ID_REQUIRED' }));
      expect(m.payoutCreate).not.toHaveBeenCalled();
    });

    it('khoá, khung tháng cộng dồn và requestedAt dùng chung MỘT mốc giờ (không lệch sang tháng khác quanh nửa đêm cuối tháng)', async () => {
      const m = makePrisma({ available: 1_500_000, rows: [{ id: 'c1', amount: 1_500_000 }], taxId: MST, priorGross: 1_500_000, priorTax: 0 });
      const svc = new AffiliateService(m.prisma, config, pricing, pancakeOrder, coins, analytics);
      const lock = jest.spyOn(svc, 'lockPitMonth');
      const tax = jest.spyOn(svc, 'personalIncomeTax');
      await svc.requestPayout('u1', 1_500_000, 'WALLET_BALANCE');
      const lockedAt = lock.mock.calls[0]![2];
      expect(lockedAt).toBeInstanceOf(Date);
      expect(tax.mock.calls[0]![3]).toBe(lockedAt);
      expect(m.payoutCreate.mock.calls[0][0].data.requestedAt).toBe(lockedAt);
    });

    it('tổng tháng chỉ tính lệnh hoa hồng (có grossAmount) chưa bị từ chối, trong tháng VN; khoá user-tháng lấy TRƯỚC khi đọc hoa hồng', async () => {
      jest.useFakeTimers({ now: new Date('2026-10-31T17:30:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'clearImmediate', 'queueMicrotask'] });
      try {
        const m = makePrisma({ available: 1_500_000, rows: [{ id: 'c1', amount: 1_500_000 }], taxId: MST, priorGross: 1_500_000, priorTax: 0 });
        await new AffiliateService(m.prisma, config, pricing, pancakeOrder, coins, analytics).requestPayout('u1', 1_500_000, 'WALLET_BALANCE');
        // 31/10 17:30 UTC = 01/11 00:30 giờ VN → tháng 11.
        const where = m.payoutAggregate.mock.calls[0][0].where;
        expect(where).toEqual({
          userId: 'u1',
          grossAmount: { not: null },
          status: { not: 'REJECTED' },
          requestedAt: { gte: new Date('2026-10-31T17:00:00Z'), lt: new Date('2026-11-30T17:00:00Z') },
        });
        expect(m.executeRaw).toHaveBeenCalledTimes(1);
        const txFindMany = (m.prisma.commission.findMany as jest.Mock).mock.invocationCallOrder[0];
        expect(m.executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(txFindMany!);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('AffiliateService.grantReferralReward (Q-05: không còn voucher REFER, chuyển sang xu đơn thứ 2)', () => {
  function makePrisma(order: unknown) {
    const couponCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      coupon: { findUnique: jest.fn().mockResolvedValue(null), create: couponCreate },
    } as unknown as PrismaService;
    return { prisma, couponCreate };
  }
  function makeCoins() {
    const grantReferralOrderReward = jest.fn().mockResolvedValue(true);
    return { svc: { grantReferralOrderReward } as unknown as RewardPointsService, grantReferralOrderReward };
  }

  it('đơn lẻ giao xong → xét thưởng xu cho người mời của chủ đơn, KHÔNG tạo voucher', async () => {
    const { prisma, couponCreate } = makePrisma({ userId: 'referee', type: 'RETAIL', placedForCustomer: false });
    const c = makeCoins();
    await new AffiliateService(prisma, config, pricing, pancakeOrder, c.svc, analytics).grantReferralReward('o1');
    expect(c.grantReferralOrderReward).toHaveBeenCalledWith('referee');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('đơn CTV lên hộ khách (userId là CTV) → không xét thưởng giới thiệu', async () => {
    const { prisma } = makePrisma({ userId: 'ctv', type: 'RETAIL', placedForCustomer: true });
    const c = makeCoins();
    await new AffiliateService(prisma, config, pricing, pancakeOrder, c.svc, analytics).grantReferralReward('o1');
    expect(c.grantReferralOrderReward).not.toHaveBeenCalled();
  });

  it('đơn đại lý → không xét thưởng giới thiệu', async () => {
    const { prisma } = makePrisma({ userId: 'dealer', type: 'DEALER', placedForCustomer: false });
    const c = makeCoins();
    await new AffiliateService(prisma, config, pricing, pancakeOrder, c.svc, analytics).grantReferralReward('o1');
    expect(c.grantReferralOrderReward).not.toHaveBeenCalled();
  });
});

describe('AffiliateService analytics', () => {
  it('storefrontAnalytics gom theo gian hàng của tôi', async () => {
    const orderAggregate = jest.fn().mockResolvedValue({ _count: { _all: 3 } });
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 72000 } });
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh', title: 'Cửa hàng Linh' }]) },
      order: { aggregate: orderAggregate },
      // Doanh thu gian hàng tính trong DB (500000 + 400000 − 120000); bigint như Postgres SUM trả về.
      $queryRaw: jest.fn().mockResolvedValue([{ slug: 'linh', orders: 3n, revenue: 780000n }]),
      commission: { aggregate: commissionAggregate },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
    const r = await svc.storefrontAnalytics('u1');
    expect(r.storefronts[0]).toMatchObject({ slug: 'linh', orders: 3, revenue: 780000, commission: 72000 });
    // Số đơn lấy từ cùng truy vấn doanh thu (cùng bộ lọc trạng thái), không đếm riêng gồm cả đơn huỷ/trả.
    expect(orderAggregate).not.toHaveBeenCalled();
    expect(commissionAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ affiliateUserId: 'u1', order: { storefrontSlug: 'linh' } }),
      }),
    );
  });

  // P0 A5-11 (cùng họ lỗi với dashboard — commAgg ở đây cộng CẢ commission đã REJECTED, xem
  // AffiliateService.storefrontAnalytics): số "hoa hồng" theo từng gian hàng không giảm khi
  // đơn của gian hàng đó bị huỷ/trả.
  it('storefrontAnalytics: hoa hồng theo gian hàng LOẠI commission đã REJECTED (P0 A5-11)', async () => {
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 72000 } });
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh', title: 'Cửa hàng Linh' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 3 } }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      commission: { aggregate: commissionAggregate },
    } as unknown as PrismaService;
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).storefrontAnalytics('u1');
    expect(commissionAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'REJECTED' } }) }),
    );
  });

  it('productCommissionBreakdown nhóm theo sản phẩm', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', amount: 14000, order: { id: 'o1', total: 150000, shippingFee: 0, items: [
          { id: 'i1', productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { id: 'i2', productName: 'Xà phòng', variationId: 'v2', total: 50000 },
        ] } },
      ]) },
      returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' }, { id: 'v2', affiliateRate: '8' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.commission).toBe(10000); // floor(100000*10/100)
    expect(dau?.orders).toBe(1);
    expect(r.find((x) => x.productName === 'Xà phòng')?.commission).toBe(4000);
  });

  it('productCommissionBreakdown: 1 đơn có 2 item CÙNG sản phẩm → orders=1, hoa hồng cộng dồn', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', amount: 16000, order: { id: 'o1', total: 180000, shippingFee: 20000, items: [
          { id: 'i1', productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { id: 'i2', productName: 'Dầu gội', variationId: 'v1', total: 60000 },
        ] } },
      ]) },
      returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.orders).toBe(1); // 2 item cùng đơn → 1 đơn
    expect(dau?.commission).toBe(16000); // floor(100000*10/100) + floor(60000*10/100)
  });

  it('productCommissionBreakdown khớp số hoa hồng thật: tính trên giá thực trả sau mã/điểm (SELLER-6)', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', amount: 38700, order: { id: 'o1', total: 387000, shippingFee: 0, items: [
          { id: 'i1', productName: 'Fuwa 5L', variationId: 'v1', total: 430000 },
        ] } },
      ]) },
      returnRequestItem: { findMany: jest.fn().mockResolvedValue([]) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', affiliateRate: '10' }]) },
    } as unknown as PrismaService;
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).productCommissionBreakdown('u1');
    expect(r[0]?.commission).toBe(38700);
  });
});

describe('AffiliateService.recordTouch / getActiveTouch (attribution 7 ngày, Q-31)', () => {
  const NOW = new Date('2026-06-27T00:00:00Z');
  function makePrisma(over: any = {}) {
    return {
      user: { findUnique: jest.fn() },
      referralTouch: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
      ...over,
    } as unknown as PrismaService;
  }

  it('recordTouch: resolve referralCode → upsert với expiresAt = now + 7 ngày (mặc định Q-31)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1', role: 'AFFILIATE' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'LINH', storefrontSlug: 'LINH', kind: 'ctv' }, NOW);
    const call = (prisma as any).referralTouch.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'buyer1' });
    expect(call.create.referrerUserId).toBe('ctv1');
    expect(call.create.expiresAt.getTime()).toBe(NOW.getTime() + 7 * 86400000);
  });

  it('recordTouch: đọc affiliate.attribution_days từ config (admin chỉnh được)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1', role: 'AFFILIATE' });
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.attribution_days' ? (10 as unknown as T) : (fb as T)),
    } as unknown as SystemConfigService;
    await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'LINH' }, NOW);
    const call = (prisma as any).referralTouch.upsert.mock.calls[0][0];
    expect(call.create.expiresAt.getTime()).toBe(NOW.getTime() + 10 * 86400000);
  });

  it('recordTouch: ghi thành công → phát referral_touched (best-effort, đúng refCode/storefrontSlug/kind)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1', role: 'AFFILIATE' });
    // Mock RIÊNG (không dùng `analytics` chung ở đầu file) để assert đúng số lần gọi CỦA test này.
    const analyticsLocal = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    await new AffiliateService(
      prisma,
      config,
      pricing,
      pancakeOrder,
      coins,
      analyticsLocal as unknown as AnalyticsEventsService,
    ).recordTouch(
      'buyer1',
      { referralCode: 'LINH', storefrontSlug: 'linh', kind: 'ctv' },
      NOW,
    );
    expect(analyticsLocal.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(analyticsLocal.recordBestEffort).toHaveBeenCalledWith({
      eventName: 'referral_touched',
      userId: 'buyer1',
      platform: 'miniapp',
      refCode: 'LINH',
      storefrontSlug: 'linh',
      props: { kind: 'ctv' },
    });
    // recordBestEffort (không tx) — KHÔNG dùng record() vì recordTouch không chạy trong transaction.
    expect(analyticsLocal.record).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua nếu không có referralCode → KHÔNG phát referral_touched', async () => {
    const prisma = makePrisma();
    const analyticsLocal = {
      record: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
    };
    const r = await new AffiliateService(
      prisma,
      config,
      pricing,
      pancakeOrder,
      coins,
      analyticsLocal as unknown as AnalyticsEventsService,
    ).recordTouch('buyer1', {}, NOW);
    expect(r.ok).toBe(false);
    expect(analyticsLocal.recordBestEffort).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua nếu không có referralCode', async () => {
    const prisma = makePrisma();
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', {}, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua tự giới thiệu (code trỏ chính mình)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'buyer1', role: 'AFFILIATE' });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'SELF' }, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua code không tồn tại', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue(null);
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'NOPE' }, NOW);
    expect(r.ok).toBe(false);
  });

  it.each(['CUSTOMER', 'STAFF', 'ADMIN'])('recordTouch: mã của %s (link chia sẻ của khách thường) → không ghi, không đè chạm CTV đang có', async (role) => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'friend1', role });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'FRIEND1', kind: 'ctv' }, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: mã đại lý (DEALER) → ghi như CTV', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'dealer1', role: 'DEALER' });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch('buyer1', { referralCode: 'DL1' }, NOW);
    expect(r.ok).toBe(true);
    expect((prisma as any).referralTouch.upsert.mock.calls[0][0].create.referrerUserId).toBe('dealer1');
  });

  it('isCommissionEligible: đúng vai trò trong khoá; không có user → false', async () => {
    const findUnique = jest.fn();
    const svc = new AffiliateService(makePrisma({ user: { findUnique } }), config, pricing, pancakeOrder, coins, analytics);
    for (const [role, ok] of [['AFFILIATE', true], ['DEALER', true], ['CUSTOMER', false], ['ADMIN', false], ['STAFF', false]] as const) {
      findUnique.mockResolvedValueOnce({ role, isBlocked: false });
      expect(await svc.isCommissionEligible('x')).toBe(ok);
    }
    findUnique.mockResolvedValueOnce(null);
    expect(await svc.isCommissionEligible('x')).toBe(false);
    expect(findUnique).toHaveBeenLastCalledWith({ where: { id: 'x' }, select: { role: true, isBlocked: true } });
  });

  it('isCommissionEligible: tài khoản bị khoá không còn được ghi công đơn mới dù còn vai trò CTV', async () => {
    const findUnique = jest.fn().mockResolvedValue({ role: 'AFFILIATE', isBlocked: true });
    const svc = new AffiliateService(makePrisma({ user: { findUnique } }), config, pricing, pancakeOrder, coins, analytics);
    expect(await svc.isCommissionEligible('x')).toBe(false);
  });

  it('findEligibleReferrer: người giới thiệu bị khoá → null, không ghi công đơn mới', async () => {
    const findUnique = jest.fn().mockResolvedValue({ id: 'ctv1', role: 'AFFILIATE', isBlocked: true });
    const svc = new AffiliateService(makePrisma({ user: { findUnique } }), config, pricing, pancakeOrder, coins, analytics);
    expect(await svc.findEligibleReferrer('LINH', 'buyer1')).toBeNull();
  });

  it('storefrontVisibility: vai trò hưởng hoa hồng và cờ duyệt cho bộ lọc gian hàng công khai', async () => {
    const svc = new AffiliateService(makePrisma(), config, pricing, pancakeOrder, coins, analytics);
    expect(await svc.storefrontVisibility()).toEqual({ eligibleRoles: ['AFFILIATE', 'DEALER'], requireApproval: true });
  });

  it('findEligibleReferrer: hoa hoá mã; null khi không có / chính người mua / không phải CTV-đại lý', async () => {
    const findUnique = jest.fn();
    const svc = new AffiliateService(makePrisma({ user: { findUnique } }), config, pricing, pancakeOrder, coins, analytics);
    findUnique.mockResolvedValueOnce({ id: 'ctv1', role: 'AFFILIATE', isBlocked: false });
    expect(await svc.findEligibleReferrer('linh', 'buyer1')).toBe('ctv1');
    expect(findUnique).toHaveBeenLastCalledWith({ where: { referralCode: 'LINH' }, select: { id: true, role: true, isBlocked: true } });
    findUnique.mockResolvedValueOnce(null);
    expect(await svc.findEligibleReferrer('NOPE', 'buyer1')).toBeNull();
    findUnique.mockResolvedValueOnce({ id: 'buyer1', role: 'AFFILIATE' });
    expect(await svc.findEligibleReferrer('SELF', 'buyer1')).toBeNull();
    findUnique.mockResolvedValueOnce({ id: 'friend1', role: 'CUSTOMER' });
    expect(await svc.findEligibleReferrer('FRIEND1', 'buyer1')).toBeNull();
  });

  it('getActiveTouch: trả touch khi còn hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv', expiresAt: new Date(NOW.getTime() + 1000) });
    const t = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).getActiveTouch('buyer1', NOW);
    expect(t).toEqual({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv' });
  });

  it('getActiveTouch: null khi hết hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: null, kind: 'ctv', expiresAt: new Date(NOW.getTime() - 1000) });
    const t = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).getActiveTouch('buyer1', NOW);
    expect(t).toBeNull();
  });

  // P0 A5-01: gian hàng CTV mở TRONG ZALO dùng slug (storefront.service.ts sinh = referralCode.toLowerCase())
  // làm luôn referralCode cho attribution (storefront-view.tsx/app.tsx miniapp KHÔNG hoa hoá lại).
  // User.referralCode luôn lưu chữ HOA (auth.service.ts). So khớp CHÍNH XÁC trước đây luôn trượt
  // (Postgres phân biệt hoa/thường) → referrer luôn null → CTV bán qua gian hàng trong Zalo không
  // bao giờ được ghi hoa hồng.
  it('recordTouch: referralCode chữ THƯỜNG (slug gian hàng CTV mở trong Zalo) phải được chuẩn hoá hoa TRƯỚC khi so khớp (P0 A5-01)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1', role: 'AFFILIATE' });
    const r = await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).recordTouch(
      'buyer1',
      { referralCode: 'linh', storefrontSlug: 'linh', kind: 'ctv' },
      NOW,
    );
    expect(r.ok).toBe(true);
    // Lookup PHẢI dùng mã đã hoa hoá — gửi thẳng 'linh' sẽ luôn trượt trên Postgres thật (referralCode
    // lưu 'LINH', so khớp phân biệt hoa/thường), dù mock ở trên không tự mô phỏng việc đó.
    expect((prisma as any).user.findUnique).toHaveBeenCalledWith({ where: { referralCode: 'LINH' }, select: { id: true, role: true, isBlocked: true } });
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
            Promise.resolve(where.referralCode === 'LINH' ? { id: 'ctv1', role: 'AFFILIATE' } : null),
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
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);

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
        findUnique: jest.fn().mockResolvedValue(payout),
        findUniqueOrThrow: payoutFindUniqueOrThrow,
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      commission: { findMany: commissionFindMany, updateMany: commissionUpdateMany },
      user: { update: userUpdate },
      $executeRaw: jest.fn().mockResolvedValue(1),
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
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).listPayouts('BOGUS', 1, 20),
    ).rejects.toThrow();
  });

  it('approvePayout: REQUESTED → APPROVED (atomic updateMany theo status-guard)', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).approvePayout('admin1', 'p1', 'ok');
    expect(payoutUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'REQUESTED' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin1', adminNote: 'ok' }),
    });
  });

  it('approvePayout: đã bị xử lý bởi người khác (count=0) → BadRequest, không check-then-write', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).approvePayout('admin1', 'p1'),
    ).rejects.toThrow('tải lại');
  });

  describe('expectedAmount: chặn duyệt/chi theo số thực nhận cũ khi thuế giữ dư vừa được hoàn vào lệnh', () => {
    const svcOf = (prisma: PrismaService) => new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);

    it('approvePayout: expectedAmount khớp → đưa số vào điều kiện updateMany cùng status-guard và duyệt', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED', amount: 750_000 });
      await svcOf(prisma).approvePayout('admin1', 'p1', undefined, 750_000);
      expect(payoutUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'REQUESTED', amount: 750_000 },
        data: expect.objectContaining({ status: 'APPROVED' }),
      });
    });

    it('approvePayout: lệnh vừa tăng số thực nhận (count=0, vẫn REQUESTED) → 409 nêu số cũ và số mới, không duyệt', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'REQUESTED', amount: 1_000_000 });
      payoutUpdateMany.mockResolvedValue({ count: 0 });
      const err = await svcOf(prisma).approvePayout('admin1', 'p1', undefined, 750_000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/đã đổi từ 750\.000.* thành 1\.000\.000.*tải lại trước khi duyệt/);
    });

    it('approvePayout: có expectedAmount nhưng lệnh đã bị xử lý (không còn REQUESTED) → vẫn báo "tải lại" như cũ, không phải 409 số tiền', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED', amount: 1_000_000 });
      payoutUpdateMany.mockResolvedValue({ count: 0 });
      const err = await svcOf(prisma).approvePayout('admin1', 'p1', undefined, 750_000).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('approvePayout: không gửi expectedAmount → điều kiện updateMany như cũ (tương thích)', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED' });
      await svcOf(prisma).approvePayout('admin1', 'p1', 'ok');
      expect(payoutUpdateMany.mock.calls[0]![0].where).toEqual({ id: 'p1', status: 'REQUESTED' });
    });

    it('approvePayout: expectedAmount null (class-validator @IsOptional cho null lọt qua) → như không gửi, không đưa amount: null vào where', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED' });
      await svcOf(prisma).approvePayout('admin1', 'p1', 'ok', null as unknown as undefined);
      expect(payoutUpdateMany.mock.calls[0]![0].where).toEqual({ id: 'p1', status: 'REQUESTED' });
    });

    it('approvePayout: expectedAmount null và count=0 → báo "tải lại" như cũ, không dò số tiền', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'REQUESTED', amount: 1_000_000 });
      payoutUpdateMany.mockResolvedValue({ count: 0 });
      const err = await svcOf(prisma).approvePayout('admin1', 'p1', undefined, null as unknown as undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('markPayoutPaid: expectedAmount null → như không gửi, không đưa amount: null vào where', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'PAID' });
      await svcOf(prisma).markPayoutPaid('admin1', 'p1', { expectedAmount: null as unknown as undefined });
      expect(payoutUpdateMany.mock.calls[0]![0].where).toEqual({ id: 'p1', status: 'APPROVED' });
    });

    it('markPayoutPaid: expectedAmount null và count=0 → báo "tải lại" như cũ, không dò số tiền', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED', amount: 1_000_000 });
      payoutUpdateMany.mockResolvedValue({ count: 0 });
      const err = await svcOf(prisma).markPayoutPaid('admin1', 'p1', { expectedAmount: null as unknown as undefined }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
    });

    it('markPayoutPaid: expectedAmount khớp → đưa số vào điều kiện updateMany cùng status-guard và chi', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'PAID', amount: 750_000 });
      await svcOf(prisma).markPayoutPaid('admin1', 'p1', { expectedAmount: 750_000 });
      expect(payoutUpdateMany).toHaveBeenCalledWith({
        where: { id: 'p1', status: 'APPROVED', amount: 750_000 },
        data: expect.objectContaining({ status: 'PAID' }),
      });
    });

    it('markPayoutPaid: số thực nhận của lệnh đã đổi (count=0, vẫn APPROVED) → 409, không chi, không đổi hoa hồng', async () => {
      const { prisma, payoutUpdateMany, commissionUpdateMany } = makePrisma({ id: 'p1', status: 'APPROVED', amount: 1_000_000 });
      payoutUpdateMany.mockResolvedValue({ count: 0 });
      const err = await svcOf(prisma).markPayoutPaid('admin1', 'p1', { expectedAmount: 750_000 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as Error).message).toMatch(/đã đổi từ 750\.000.* thành 1\.000\.000.*tải lại trước khi chi/);
      expect(commissionUpdateMany).not.toHaveBeenCalled();
    });

    it('markPayoutPaid: không gửi expectedAmount → điều kiện updateMany như cũ (tương thích)', async () => {
      const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1', status: 'PAID' });
      await svcOf(prisma).markPayoutPaid('admin1', 'p1', {});
      expect(payoutUpdateMany.mock.calls[0]![0].where).toEqual({ id: 'p1', status: 'APPROVED' });
    });
  });

  it('rejectPayout: thiếu lý do → BadRequest, KHÔNG đổi trạng thái/hoàn tiền', async () => {
    const { prisma, payoutUpdateMany, userUpdate } = makePrisma({ id: 'p1' });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).rejectPayout('admin1', 'p1', '   '),
    ).rejects.toThrow('lý do');
    expect(payoutUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejectPayout: Payout từ wallet.service.ts:withdraw() (KHÔNG có commission gắn payoutBatchId) → hoàn GROSS (amount+fee, KHÔNG phải net) vào walletBalance, KHÔNG đụng commission', async () => {
    const { prisma, userUpdate, commissionUpdateMany } = makePrisma(
      { id: 'p1', userId: 'u1', amount: 97_000, fee: 3_000, method: 'BANK', grossAmount: null },
      { linkedCommissions: [] },
    );
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).rejectPayout('admin1', 'p1', 'Sai STK');
    // gross = net (97k) + fee (3k) = đúng số đã bị trừ khỏi walletBalance lúc withdraw().
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { walletBalance: { increment: 100_000 } } });
    expect(ledger).toHaveBeenLastCalledWith(
      prisma,
      expect.objectContaining({ userId: 'u1', delta: 100_000, type: 'WITHDRAW_REFUND', refType: 'PAYOUT', refId: 'p1' }),
    );
    expect(commissionUpdateMany).not.toHaveBeenCalled();
  });

  it('rejectPayout: Payout từ affiliate.service.ts:requestPayout() nhánh BANK (CÓ commission gắn payoutBatchId) → trả commission về APPROVED (rút lại được), KHÔNG đụng walletBalance', async () => {
    const { prisma, userUpdate, commissionUpdateMany } = makePrisma(
      { id: 'p1', userId: 'u1', amount: 100_000, fee: 0, method: 'BANK', grossAmount: 100_000, requestedAt: new Date('2026-10-05T03:00:00Z') },
      { linkedCommissions: [{ id: 'c1' }, { id: 'c2' }] },
    );
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).rejectPayout('admin1', 'p1', 'Sai STK');
    expect(commissionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] }, payoutBatchId: 'p1', status: { in: ['APPROVED', 'PAID'] } },
      data: { status: 'APPROVED', payoutBatchId: null, paidAt: null },
    });
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('rejectPayout: đã bị xử lý bởi người khác (count=0) → BadRequest, KHÔNG hoàn tiền/đổi commission', async () => {
    const { prisma, userUpdate, commissionUpdateMany, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).rejectPayout('admin1', 'p1', 'lý do'),
    ).rejects.toThrow();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(commissionUpdateMany).not.toHaveBeenCalled();
  });

  it('2 lệnh reject đồng thời cho CÙNG payout (nguồn wallet.withdraw, không commission gắn batch) → chỉ hoàn ví ĐÚNG 1 LẦN', async () => {
    let payoutRow: Record<string, unknown> = { id: 'p1', userId: 'u1', amount: 97_000, fee: 3_000, method: 'BANK', status: 'REQUESTED', grossAmount: null };
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
        findUnique: jest.fn(async () => payoutRow),
        findUniqueOrThrow: jest.fn(async () => payoutRow),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
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
    const svc = new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics);
    const results = await Promise.allSettled([
      svc.rejectPayout('admin1', 'p1', 'lý do A'),
      svc.rejectPayout('admin2', 'p1', 'lý do B'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(wallet).toBe(100_000); // hoàn ĐÚNG 1 lần (100k), không phải 200k
  });

  describe('rejectPayout: tự hoàn thuế TNCN giữ dư của các lệnh còn lại trong tháng (Q2b)', () => {
    type Row = {
      id: string;
      userId: string;
      method: string;
      status: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED';
      grossAmount: number | null;
      taxWithheld: number;
      taxRefunded: number;
      amount: number;
      fee: number;
      requestedAt: Date;
    };
    const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, '0')}T03:00:00Z`);
    const row = (id: string, o: Partial<Row>): Row => ({
      id,
      userId: 'u1',
      method: 'BANK',
      status: 'REQUESTED',
      grossAmount: 0,
      taxWithheld: 0,
      taxRefunded: 0,
      amount: 0,
      fee: 0,
      requestedAt: at(5),
      ...o,
    });
    const bank = (id: string, gross: number, tax: number, o: Partial<Row> = {}) =>
      row(id, { grossAmount: gross, taxWithheld: tax, amount: gross - tax, ...o });

    function fixture(rows: Row[], cfg: SystemConfigService = config, linked: { id: string }[] = [{ id: 'c1' }]) {
      const order: string[] = [];
      let wallet = 0;
      const num = (cur: number, v: unknown) =>
        typeof v === 'number' ? v : (v as { increment?: number; decrement?: number }).increment !== undefined ? cur + (v as { increment: number }).increment : cur - (v as { decrement: number }).decrement;
      const apply = (r: Row, data: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(data)) {
          (r as unknown as Record<string, unknown>)[k] = ['taxWithheld', 'taxRefunded', 'amount'].includes(k) ? num((r as unknown as Record<string, number>)[k]!, v) : v;
        }
      };
      const prisma = {
        payout: {
          findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
            order.push('findUnique');
            return rows.find((r) => r.id === where.id) ?? null;
          }),
          findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)),
          updateMany: jest.fn(async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
            order.push('updateMany');
            const r = rows.find((x) => x.id === where.id && (where.status === undefined || x.status === where.status));
            if (!r) return { count: 0 };
            apply(r, data);
            return { count: 1 };
          }),
          update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const r = rows.find((x) => x.id === where.id)!;
            apply(r, data);
            return r;
          }),
          findMany: jest.fn(async ({ where }: { where: { userId: string; requestedAt: { gte: Date; lt: Date } } }) =>
            rows
              .filter((r) => r.userId === where.userId && r.grossAmount !== null && r.status !== 'REJECTED' && r.requestedAt >= where.requestedAt.gte && r.requestedAt < where.requestedAt.lt)
              .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime()),
          ),
        },
        commission: { findMany: jest.fn().mockResolvedValue(linked), updateMany: jest.fn().mockResolvedValue({ count: linked.length }) },
        user: {
          update: jest.fn(async ({ data }: { data: { walletBalance: { increment: number } } }) => {
            wallet += data.walletBalance.increment;
            return {};
          }),
        },
        $executeRaw: jest.fn(async () => {
          order.push('lock');
          return 1;
        }),
      } as unknown as PrismaService;
      (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
      const svc = new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics);
      const find = (id: string) => rows.find((r) => r.id === id)!;
      return { svc, rows, find, order, wallet: () => wallet };
    }
    const pitRefunds = () => ledger.mock.calls.filter((c) => c[1].type === 'PIT_REFUND').map((c) => c[1]);
    beforeEach(() => ledger.mockClear());

    // Ví dụ của chủ: A rút 1.500.000đ (thuế 0), B rút 1.000.000đ cùng tháng bị giữ 250.000đ (10% × 2,5 triệu). Từ chối A: tháng còn 1 triệu.
    const A = () => bank('A', 1_500_000, 0, { requestedAt: at(5) });

    it('lệnh B đã chi / rút về Ví (PAID): từ chối A hoàn 250.000đ vào Ví, ghi taxRefunded, không đổi taxWithheld', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', method: 'WALLET_BALANCE', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.find('A').status).toBe('REJECTED');
      expect(f.wallet()).toBe(250_000);
      expect(f.find('B')).toEqual(expect.objectContaining({ taxRefunded: 250_000, taxWithheld: 250_000, amount: 750_000 }));
      expect(pitRefunds()).toEqual([
        expect.objectContaining({
          userId: 'u1',
          delta: 250_000,
          type: 'PIT_REFUND',
          refType: 'PAYOUT',
          refId: expect.stringContaining('B'),
          reason: expect.stringMatching(/Hoàn thuế TNCN giữ dư tháng 10\/2026 \(lệnh rút ngày 05\/10 bị từ chối\)/),
        }),
      ]);
    });

    it('lệnh B còn "Yêu cầu": giảm taxWithheld về 0 và tăng số thực nhận lên 1.000.000đ ngay trên lệnh, KHÔNG cộng Ví (B còn có thể bị từ chối)', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'REQUESTED', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.find('B')).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 1_000_000, taxRefunded: 0 }));
      expect(f.wallet()).toBe(0);
      expect(pitRefunds()).toHaveLength(0);
    });

    it('lệnh B đã duyệt (APPROVED) cũng hoàn qua Ví vì không thể bị từ chối nữa', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'APPROVED', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(250_000);
      expect(f.find('B')).toEqual(expect.objectContaining({ taxRefunded: 250_000, taxWithheld: 250_000, amount: 750_000 }));
    });

    it('phần dư chia cho lệnh mới nhất trước, mỗi lệnh tối đa số thuế thực giữ của nó; lệnh "Yêu cầu" chỉnh tại chỗ, lệnh đã chi hoàn Ví', async () => {
      // A 1.5M (0) · B 1.0M (thuế 250k, đã chi) · C 1.2M (thuế 120k, còn Yêu cầu). Bỏ A: 2,2 triệu cần 220k, đang giữ 370k → dư 150k.
      const f = fixture([
        A(),
        bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) }),
        bank('C', 1_200_000, 120_000, { status: 'REQUESTED', requestedAt: at(12) }),
      ]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.find('C')).toEqual(expect.objectContaining({ taxWithheld: 0, amount: 1_200_000 }));
      expect(f.find('B')).toEqual(expect.objectContaining({ taxRefunded: 30_000, taxWithheld: 250_000 }));
      expect(f.wallet()).toBe(30_000);
      expect(pitRefunds().map((r) => r.delta)).toEqual([30_000]);
    });

    it('tổng tháng vẫn đủ ngưỡng: chỉ hoàn phần chênh so với luật cộng dồn, không hoàn hết', async () => {
      // A 500k (0) · B 2.0M (thuế 250k, đã chi). Bỏ A: 2,0 triệu cần 200k, đang giữ 250k → hoàn 50k.
      const f = fixture([bank('A', 500_000, 0), bank('B', 2_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(50_000);
      expect(f.find('B').taxRefunded).toBe(50_000);
    });

    it('không có thuế giữ dư (không lệnh nào bị giữ thuế) → không hoàn gì, không ghi sổ ví', async () => {
      const f = fixture([bank('A', 500_000, 0), bank('B', 500_000, 0, { status: 'PAID', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(0);
      expect(pitRefunds()).toHaveLength(0);
    });

    it('thuế đã được hoàn một phần trước đó thì chỉ hoàn phần còn lại (taxWithheld − taxRefunded)', async () => {
      // B giữ 250k, đã hoàn 200k từ lần từ chối trước; bỏ A thì tháng còn 1,0 triệu (cần 0), thực giữ 50k → hoàn đúng 50k.
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', taxRefunded: 200_000, requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(50_000);
      expect(f.find('B').taxRefunded).toBe(250_000);
    });

    it('lệnh bị từ chối trước đó (REJECTED) và lệnh tháng khác không tham gia tính lại', async () => {
      const f = fixture([
        A(),
        bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) }),
        bank('OLD', 3_000_000, 300_000, { status: 'PAID', requestedAt: new Date('2026-09-20T03:00:00Z') }),
        bank('X', 4_000_000, 400_000, { status: 'REJECTED', requestedAt: at(7) }),
      ]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(250_000);
      expect(f.find('OLD').taxRefunded).toBe(0);
      expect(f.find('X').taxRefunded).toBe(0);
    });

    it('cấu hình thuế 0% (tắt khấu trừ): yêu cầu của tháng là 0 nên thuế đã giữ lúc còn bật được hoàn hết', async () => {
      const off = { get: async <T>(k: string, fb?: T): Promise<T> => (k === 'affiliate.pit_withhold_pct' ? 0 : fb) as T } as unknown as SystemConfigService;
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })], off);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(250_000);
    });

    it('từ chối lệnh rút Ví về ngân hàng (grossAmount null) giữ nguyên đường cũ: hoàn gross, không đụng thuế, không lấy khoá tháng', async () => {
      const f = fixture(
        [
          row('W', { grossAmount: null, amount: 97_000, fee: 3_000, requestedAt: at(5) }),
          bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) }),
        ],
        config,
        [],
      );
      await f.svc.rejectPayout('admin1', 'W', 'Sai STK');
      expect(f.wallet()).toBe(100_000);
      expect(ledger).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ type: 'WITHDRAW_REFUND', delta: 100_000 }));
      expect(pitRefunds()).toHaveLength(0);
      expect(f.find('B').taxRefunded).toBe(0);
      expect(f.order).not.toContain('lock');
    });

    it('ví không ghi hoàn (applied=false): throw và KHÔNG tăng taxRefunded, tránh lệnh báo đã hoàn mà Ví không nhận', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })]);
      ledger.mockImplementationOnce(async () => ({ applied: false, balanceAfter: 0, entryId: 'dup' }));
      await expect(f.svc.rejectPayout('admin1', 'A', 'Sai STK')).rejects.toThrow();
      expect(f.find('B').taxRefunded).toBe(0);
    });

    it('ghi sổ Ví trước, tăng taxRefunded sau', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })]);
      let refundedAtLedgerTime: number | undefined;
      ledger.mockImplementationOnce(async () => {
        refundedAtLedgerTime = f.find('B').taxRefunded;
        return { applied: true, balanceAfter: 0, entryId: 'wtx' };
      });
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(refundedAtLedgerTime).toBe(0);
      expect(f.find('B').taxRefunded).toBe(250_000);
    });

    it('khoá tháng (CTV, tháng VN) lấy sau khi đọc userId/requestedAt và TRƯỚC khi đổi trạng thái, cùng thứ tự với requestPayout', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.order.slice(0, 3)).toEqual(['findUnique', 'lock', 'updateMany']);
    });

    it('hoàn đúng một lần: từ chối lại lệnh đã từ chối không hoàn thêm', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'PAID', requestedAt: at(9) })]);
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      await expect(f.svc.rejectPayout('admin2', 'A', 'Sai STK')).rejects.toThrow('tải lại');
      expect(f.wallet()).toBe(250_000);
    });

    it('lệnh "Yêu cầu" vừa được duyệt xen giữa lúc đọc và lúc ghi (updateMany count 0) → chuyển sang hoàn Ví, không mất phần hoàn', async () => {
      const f = fixture([A(), bank('B', 1_000_000, 250_000, { status: 'REQUESTED', requestedAt: at(9) })]);
      const real = (f.svc as unknown as { prisma: { payout: { findMany: jest.Mock } } }).prisma.payout.findMany;
      real.mockImplementationOnce(async () => {
        const snapshot = [{ ...f.find('B') }];
        f.find('B').status = 'APPROVED';
        return snapshot;
      });
      await f.svc.rejectPayout('admin1', 'A', 'Sai STK');
      expect(f.wallet()).toBe(250_000);
      expect(f.find('B')).toEqual(expect.objectContaining({ taxRefunded: 250_000, taxWithheld: 250_000 }));
    });
  });

  it('markPayoutPaid: APPROVED → PAID, ghi bankRef + paidBy (atomic updateMany theo status-guard)', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).markPayoutPaid('admin1', 'p1', {
      bankRef: 'FT26270001',
    });
    expect(payoutUpdateMany).toHaveBeenCalledWith({
      where: { id: 'p1', status: 'APPROVED' },
      data: expect.objectContaining({ status: 'PAID', paidBy: 'admin1', bankRef: 'FT26270001' }),
    });
  });

  it('markPayoutPaid: nhân viên Kế toán không chi lệnh rút của chính mình (D1-05)', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    (prisma.payout as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue({ id: 'p1', userId: 's1' });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).markPayoutPaid('s1', 'p1', {
        bankRef: 'FT1',
        byStaff: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(payoutUpdateMany).not.toHaveBeenCalled();
  });

  it('markPayoutPaid: nhân viên Kế toán chi lệnh rút CTV khác được', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    (prisma.payout as unknown as { findUnique: jest.Mock }).findUnique = jest.fn().mockResolvedValue({ id: 'p1', userId: 'u9' });
    await new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).markPayoutPaid('s1', 'p1', {
      bankRef: 'FT1',
      byStaff: true,
    });
    expect(payoutUpdateMany).toHaveBeenCalled();
  });

  it('markPayoutPaid: đã bị xử lý bởi người khác (count=0) → BadRequest', async () => {
    const { prisma, payoutUpdateMany } = makePrisma({ id: 'p1' });
    payoutUpdateMany.mockResolvedValue({ count: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics).markPayoutPaid('admin1', 'p1', {}),
    ).rejects.toThrow('tải lại');
  });
});

describe('AffiliateService.listLinks (giới hạn, C-100)', () => {
  const svcWith = (findMany: jest.Mock) =>
    new AffiliateService(
      { affiliateLink: { findMany } } as unknown as PrismaService,
      config,
      pricing,
      pancakeOrder,
      coins,
      analytics,
    );

  it('mặc định chỉ lấy 100 liên kết mới nhất, thứ tự ổn định theo (createdAt, id)', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await svcWith(findMany).listLinks('u1');
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  });

  it('take bị kẹp ở 200; cursor được chuyển thành cursor+skip', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await svcWith(findMany).listLinks('u1', { take: 5000, cursor: 'l9' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200, cursor: { id: 'l9' }, skip: 1 }),
    );
  });
});

describe('AffiliateService — báo cáo khấu trừ thuế TNCN (SELLER-11)', () => {
  const paid = (o: Record<string, unknown>) => ({
    id: 'p',
    userId: 'u1',
    method: 'BANK',
    grossAmount: 2_500_000,
    taxWithheld: 250_000,
    taxRefunded: 0,
    amount: 2_250_000,
    taxId: '079201001234',
    paidAt: new Date('2026-10-10T03:00:00Z'),
    user: { fullName: 'Nguyễn An', phone: '0901234567', personalTaxId: '079201001234' },
    ...o,
  });

  function svcWith(rows: unknown[], user: unknown = { fullName: 'Nguyễn An', personalTaxId: '079201001234' }) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = {
      payout: { findMany },
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    } as unknown as PrismaService;
    return { svc: new AffiliateService(prisma, config, pricing, pancakeOrder, coins, analytics), findMany };
  }

  it('báo cáo tháng (giờ VN): chỉ lệnh rút hoa hồng đã chi trong tháng, gộp theo người nhận, MST theo số đã kê khai', async () => {
    const { svc, findMany } = svcWith([
      paid({ id: 'p1' }),
      paid({ id: 'p2', method: 'WALLET_BALANCE', grossAmount: 3_000_000, taxWithheld: 300_000, amount: 2_700_000 }),
      paid({
        id: 'p3',
        userId: 'u2',
        grossAmount: 800_000,
        taxWithheld: 0,
        amount: 800_000,
        taxId: null,
        user: { fullName: 'Trần Bình', phone: null, personalTaxId: null },
      }),
    ]);
    const r = await svc.pitReport('2026-10');
    expect(findMany.mock.calls[0][0].where).toEqual({
      status: 'PAID',
      grossAmount: { not: null },
      paidAt: { gte: new Date('2026-09-30T17:00:00Z'), lt: new Date('2026-10-31T17:00:00Z') },
    });
    expect(r.month).toBe('2026-10');
    expect(r.rows).toEqual([
      expect.objectContaining({ userId: 'u1', fullName: 'Nguyễn An', taxId: '079201001234', payoutCount: 2, grossAmount: 5_500_000, taxWithheld: 550_000, netAmount: 4_950_000 }),
      expect.objectContaining({ userId: 'u2', taxId: null, payoutCount: 1, grossAmount: 800_000, taxWithheld: 0, netAmount: 800_000 }),
    ]);
    expect(r.totals).toEqual({ recipients: 2, withheldRecipients: 1, grossAmount: 6_300_000, taxWithheld: 550_000, netAmount: 5_750_000 });
  });

  it('thuế đã hoàn về Ví (lệnh khác cùng tháng bị từ chối) trừ khỏi thuế đã khấu trừ; thu nhập = thuế thực giữ + thực nhận', async () => {
    const { svc } = svcWith([
      paid({ id: 'p1', grossAmount: 1_000_000, taxWithheld: 250_000, taxRefunded: 250_000, amount: 750_000 }),
      paid({ id: 'p2', grossAmount: 1_000_000, taxWithheld: 100_000, taxRefunded: 30_000, amount: 900_000 }),
    ]);
    const r = await svc.pitReport('2026-10');
    expect(r.rows[0]).toEqual(expect.objectContaining({ grossAmount: 2_000_000, taxWithheld: 70_000, netAmount: 1_930_000 }));
    expect(r.totals).toEqual(expect.objectContaining({ taxWithheld: 70_000, netAmount: 1_930_000, withheldRecipients: 1 }));
  });

  it('bảng kê năm: cùng quy tắc thuế thực giữ = taxWithheld − taxRefunded', async () => {
    const { svc } = svcWith([paid({ id: 'p1', grossAmount: 1_000_000, taxWithheld: 250_000, taxRefunded: 250_000, amount: 750_000 })]);
    const r = await svc.taxStatement('u1', 2026);
    expect(r.items[0]).toEqual(expect.objectContaining({ grossAmount: 1_000_000, taxWithheld: 0, amount: 1_000_000 }));
    expect(r.totals).toEqual({ grossAmount: 1_000_000, taxWithheld: 0, netAmount: 1_000_000 });
  });

  it('listMyPayouts: taxWithheld là thuế thực giữ (đã trừ phần hoàn), kèm taxRefunded để màn hiện "đã hoàn"', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'p1', amount: 750_000, grossAmount: 1_000_000, taxWithheld: 250_000, taxRefunded: 250_000, fee: 0, method: 'BANK', status: 'PAID' },
      { id: 'p2', amount: 1_000_000, grossAmount: 1_000_000, taxWithheld: 0, taxRefunded: 0, fee: 0, method: 'BANK', status: 'REQUESTED' },
    ]);
    const svc = new AffiliateService({ payout: { findMany } } as unknown as PrismaService, config, pricing, pancakeOrder, coins, analytics);
    const rows = await svc.listMyPayouts('u1');
    expect(findMany.mock.calls[0][0].select).toEqual(expect.objectContaining({ taxRefunded: true }));
    expect(rows[0]).toEqual(expect.objectContaining({ id: 'p1', taxWithheld: 0, taxRefunded: 250_000 }));
    expect(rows[1]).toEqual(expect.objectContaining({ id: 'p2', taxWithheld: 0, taxRefunded: 0 }));
  });

  it('tháng sai định dạng → 400', async () => {
    const { svc } = svcWith([]);
    await expect(svc.pitReport('2026-13')).rejects.toThrow(BadRequestException);
  });

  it('bảng kê năm của CTV: từng lần chi có khấu trừ, tổng thu nhập/thuế/thực nhận, MST hiện tại', async () => {
    const { svc, findMany } = svcWith([paid({ id: 'p1' }), paid({ id: 'p2', grossAmount: 900_000, taxWithheld: 0, amount: 900_000, taxId: null })]);
    const r = await svc.taxStatement('u1', 2026);
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      status: 'PAID',
      grossAmount: { not: null },
      paidAt: { gte: new Date('2025-12-31T17:00:00Z'), lt: new Date('2026-12-31T17:00:00Z') },
    });
    expect(r).toEqual(
      expect.objectContaining({
        year: 2026,
        fullName: 'Nguyễn An',
        taxId: '079201001234',
        totals: { grossAmount: 3_400_000, taxWithheld: 250_000, netAmount: 3_150_000 },
      }),
    );
    expect(r.items.map((i) => i.id)).toEqual(['p1', 'p2']);
  });
});

describe('AffiliateService.createCommissionForOrder — mức mặc định affiliate.default_rate_pct', () => {
  const order = {
    id: 'o1',
    userId: 'buyer',
    referrerUserId: 'ctv',
    total: 300000,
    items: [{ id: 'i1', variationId: 'v1', total: 100000 }, { id: 'i2', variationId: 'v2', total: 100000 }, { id: 'i3', variationId: 'v3', total: 100000 }],
  };
  const cfgWith = (pct: unknown) =>
    ({ get: async <T>(k: string, fb?: T) => (k === 'affiliate.default_rate_pct' ? pct : fb) }) as unknown as SystemConfigService;
  const runSpy = async (variations: unknown[], pct: unknown = 8) => {
    const create = jest.fn();
    const prisma = prismaWith(order, variations, create);
    await new AffiliateService(prisma, cfgWith(pct), pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    return create.mock.calls.length ? create.mock.calls[0][0].data : null;
  };

  it('chưa đặt % → 8% mặc định; 0 tường minh vẫn 0; 12 tường minh thắng', async () => {
    const data = await runSpy([
      { id: 'v1', affiliateRate: null, product: { affiliateBlocked: false, storefrontId: null } },
      { id: 'v2', affiliateRate: 0, product: { affiliateBlocked: false, storefrontId: null } },
      { id: 'v3', affiliateRate: 12, product: { affiliateBlocked: false, storefrontId: null } },
    ]);
    expect(data.amount).toBe(8000 + 0 + 12000);
    expect(data.lineAmounts).toEqual({ i1: 8000, i3: 12000 });
  });

  it('bị chặn → 0; hàng đối tác chưa đặt → 0, có đặt → theo mức đó', async () => {
    const data = await runSpy([
      { id: 'v1', affiliateRate: null, product: { affiliateBlocked: true, storefrontId: null } },
      { id: 'v2', affiliateRate: null, product: { affiliateBlocked: false, storefrontId: 'sf1' } },
      { id: 'v3', affiliateRate: 5, product: { affiliateBlocked: false, storefrontId: 'sf1' } },
    ]);
    expect(data.lineAmounts).toEqual({ i3: 5000 });
  });

  it('đại lý (DEALER) hưởng cùng mức mặc định như CTV, không theo bậc giá sỉ', async () => {
    const create = jest.fn();
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: null, product: { affiliateBlocked: false, storefrontId: null } }], create, 'DEALER');
    await new AffiliateService(prisma, cfgWith(8), pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    expect(create.mock.calls[0][0].data.lineAmounts).toEqual({ i1: 8000 });
  });

  it('mặc định không vượt trần max_rate_pct hiện hành (trần hạ sau khi đặt mặc định)', async () => {
    const cfg = { get: async <T>(k: string, fb?: T) => (k === 'affiliate.default_rate_pct' ? 20 : k === 'affiliate.max_rate_pct' ? 10 : fb) } as unknown as SystemConfigService;
    const create = jest.fn();
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: null, product: { affiliateBlocked: false, storefrontId: null } }], create);
    await new AffiliateService(prisma, cfg, pricing, pancakeOrder, coins, analytics).createCommissionForOrder('o1');
    expect(create.mock.calls[0][0].data.lineAmounts).toEqual({ i1: 10000 });
  });

  it('đổi mặc định về 0 → biến thể chưa đặt ra 0đ; giá trị cấu hình hỏng → quay về 8%', async () => {
    const v = [{ id: 'v1', affiliateRate: null, product: { affiliateBlocked: false, storefrontId: null } }];
    expect(await runSpy(v, 0)).toBeNull();
    expect((await runSpy(v, 'abc')).lineAmounts).toEqual({ i1: 8000 });
  });
});
