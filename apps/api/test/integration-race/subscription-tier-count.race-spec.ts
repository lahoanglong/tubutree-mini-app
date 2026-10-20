import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { WalletLedgerService } from '../../src/modules/wallet/wallet-ledger.service';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

/**
 * Q10 (UAT 2026-10-20, D11-04): bậc giảm giá định kỳ chỉ đếm gói ACTIVE đã ra đơn hoặc có kỳ kế trong 35 ngày.
 * Kiểm bằng Postgres thật để chắc mệnh đề OR của Prisma chạy đúng, không chỉ bản giả trong spec đơn vị.
 */
const DAY = 86_400_000;
const TIERS = [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }];

describe('Bậc giảm định kỳ chỉ đếm gói thật (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let subs: SubscriptionsService;
  let restore: () => Promise<void>;
  const userIds: string[] = [];
  const productIds: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        SubscriptionsService,
        WalletLedgerService,
        { provide: PricingService, useValue: {} },
        { provide: LoyaltyService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    subs = moduleRef.get(SubscriptionsService);
    restore = await pinConfig(prisma, 'subscribe.discount_tiers', TIERS);
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds, productIds });
    await restore?.();
    await moduleRef?.close();
  });

  async function makeSub(userId: string, over: { nextRunAt: Date; lastOrderId?: string | null; status?: string }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-sp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    productIds.push(product.id);
    const variation = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'M', attributes: {}, retailPrice: 100_000, affiliateRate: 10, stock: 50 },
    });
    const address = await prisma.address.create({
      data: {
        userId, recipient: 'IT', phone: '0900000000', province: 'Ha Noi', district: '', ward: 'P', street: '1 Duong IT',
        provinceCode: '84_VN01', districtCode: '', wardCode: '00001',
      },
    });
    return prisma.subscription.create({
      data: {
        userId,
        variationId: variation.id,
        addressId: address.id,
        intervalWeeks: 4,
        nextRunAt: over.nextRunAt,
        lastOrderId: over.lastOrderId ?? null,
        status: over.status ?? 'ACTIVE',
      },
    });
  }

  it('4 gói hẹn +200 ngày chưa ra đơn: chỉ bậc thấp nhất (gói đang tạo đơn tự đếm)', async () => {
    const u = await createUser(prisma);
    userIds.push(u.id);
    const created = [];
    for (let i = 0; i < 4; i++) created.push(await makeSub(u.id, { nextRunAt: new Date(Date.now() + 200 * DAY) }));
    await expect(subs.effectiveDiscountPct(u.id, undefined, { selfId: created[0].id })).resolves.toBe(0.12);
    await expect(subs.effectiveDiscountPct(u.id, undefined, { floorCount: 1 })).resolves.toBe(0.12);
    await expect(subs.effectiveDiscountPct(u.id)).resolves.toBe(0);
  });

  it('1 gói đã ra đơn + 1 gói kỳ kế +20 ngày + gói +200 ngày: đếm 2; thêm gói kỳ +30 ngày thành 3 → 14%', async () => {
    const u = await createUser(prisma);
    userIds.push(u.id);
    await makeSub(u.id, { nextRunAt: new Date(Date.now() + 200 * DAY), lastOrderId: `it-order-${randCode(6)}` });
    await makeSub(u.id, { nextRunAt: new Date(Date.now() + 20 * DAY) });
    await makeSub(u.id, { nextRunAt: new Date(Date.now() + 200 * DAY) });
    await expect(subs.effectiveDiscountPct(u.id)).resolves.toBe(0.12);
    await makeSub(u.id, { nextRunAt: new Date(Date.now() + 30 * DAY) });
    await expect(subs.effectiveDiscountPct(u.id)).resolves.toBe(0.14);
  });

  it('gói PAUSED đã ra đơn và gói ACTIVE quá hạn: PAUSED không đếm, quá hạn đếm', async () => {
    const u = await createUser(prisma);
    userIds.push(u.id);
    await makeSub(u.id, { nextRunAt: new Date(Date.now() + 10 * DAY), lastOrderId: `it-order-${randCode(6)}`, status: 'PAUSED' });
    await makeSub(u.id, { nextRunAt: new Date(Date.now() - DAY) });
    await expect(subs.effectiveDiscountPct(u.id)).resolves.toBe(0.12);
  });
});
