import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

const REWARD = 5000;
const DAY = 864e5;

/**
 * Q-05 (C-003): một chương trình giới thiệu duy nhất. Người mời (users.referredById) nhận
 * coins.referrer_reward khi người được mời có đơn THỨ 2 giao thành công trong referral.window_days
 * ngày kể từ đơn đầu; bị trả hàng thì thu hồi. Không còn voucher REFER/REFERRED 50k+50k.
 * Chạy trên Postgres thật: OrderStatusService + AffiliateService + CoinsService thật.
 */
describe('Thưởng giới thiệu theo đơn thứ 2 (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        CoinsService,
        AnalyticsEventsService,
        AffiliateService,
        OrderReversalService,
        OrderStatusService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    affiliate = moduleRef.get(AffiliateService);
    await setConfig(prisma, 'coins.referrer_reward', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'coins.referral_milestones', []);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function pair(referrerRole: 'CUSTOMER' | 'AFFILIATE' = 'CUSTOMER') {
    const referrer = await createUser(prisma, { role: referrerRole, coinsBalance: 0 });
    const referee = await createUser(prisma, { referredById: referrer.id, coinsBalance: 0 });
    return { referrer, referee };
  }

  /** Đơn đang SHIPPING, `daysAgo` ngày trước; giao bằng setStatus để chạy đúng side-effect DELIVERED. */
  async function shippingOrder(userId: string, daysAgo: number, referrerUserId?: string) {
    return createOrder(prisma, {
      userId,
      status: 'SHIPPING',
      total: 250_000,
      subtotal: 250_000,
      referrerUserId: referrerUserId ?? null,
      createdAt: new Date(Date.now() - daysAgo * DAY),
    });
  }

  async function coinsOf(userId: string) {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { coinsBalance: true } });
    const sum = await prisma.coinTransaction.aggregate({ where: { userId }, _sum: { delta: true } });
    return { balance: u.coinsBalance, ledger: sum._sum.delta ?? 0 };
  }

  async function referralCoupons(referrerId: string, refereeId: string) {
    return prisma.coupon.count({
      where: { code: { in: [`REFER-${referrerId}-${refereeId}`.toUpperCase(), `REFERRED-${refereeId}`.toUpperCase()] } },
    });
  }

  it('(a) đơn đầu giao xong: không voucher REFER/REFERRED, chưa thưởng xu', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');

    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await coinsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(b) đơn thứ 2 trong 30 ngày giao xong → người mời +reward đúng 1 lần, người được mời không thêm xu', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 20);
    const o2 = await shippingOrder(referee.id, 2);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');

    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    expect(await coinsOf(referee.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);

    // Đơn thứ 3 giao sau đó không thưởng thêm.
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });

  it('(c) 2 đơn "thứ 2" giao song song + 5 lần gọi thưởng song song → người mời chỉ +reward 1 lần', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 10);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    const o2 = await shippingOrder(referee.id, 3);
    const o3 = await shippingOrder(referee.id, 2);

    const results = await Promise.allSettled([
      orderStatus.setStatus(o2.id, 'DELIVERED'),
      orderStatus.setStatus(o3.id, 'DELIVERED'),
      ...Array.from({ length: 5 }, () => affiliate.grantReferralReward(o2.id)),
    ]);
    const s = summarize(results);
    expect(s.errors).toEqual([]);

    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
    const grants = await prisma.coinTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
    expect(grants).toBe(1);
  });

  it('(d) đơn thứ 2 ngoài cửa sổ 30 ngày → không thưởng', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 45);
    const o2 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(e) người mời là CTV → chỉ hưởng hoa hồng, không xu giới thiệu', async () => {
    const { referrer, referee } = await pair('AFFILIATE');
    const o1 = await shippingOrder(referee.id, 5, referrer.id);
    const o2 = await shippingOrder(referee.id, 1, referrer.id);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    expect(await referralCoupons(referrer.id, referee.id)).toBe(0);
  });

  it('(f) đơn thứ 2 bị trả hàng → thu hồi đủ xu; trả lại lần nữa không trừ thêm', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await coinsOf(referrer.id)).balance).toBe(REWARD);

    await orderStatus.setStatus(o2.id, 'RETURNED');
    await orderStatus.setStatus(o2.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });

    // Đã thu hồi thì không thưởng lại (tránh vòng giao/trả để cày xu).
    const o3 = await shippingOrder(referee.id, 1);
    await orderStatus.setStatus(o3.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(g) đơn ĐẦU bị trả hàng sau khi đã thưởng → cũng thu hồi', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect((await coinsOf(referrer.id)).balance).toBe(REWARD);
    await orderStatus.setStatus(o1.id, 'RETURNED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
  });

  it('(h) người mời đã tiêu bớt xu → thu hồi phần còn lại, số dư không âm, ghi cờ nợ cho admin', async () => {
    const { referrer, referee } = await pair();
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    await moduleRef.get(CoinsService).spendCoins(referrer.id, 3000, 'GAME_BUY_SEEDS', 'GAME');

    await orderStatus.setStatus(o2.id, 'RETURNED');
    const c = await coinsOf(referrer.id);
    expect(c).toEqual({ balance: 0, ledger: 0 });
    const debt = await prisma.coinTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL_DEBT' } });
    expect(debt).toHaveLength(1);
    expect(debt[0]!.delta).toBe(0);
    expect(debt[0]!.reason).toBe(`REFERRAL_ORDER2_DEBT:${referee.id}:3000`);
  });

  it('(i) thưởng và trả đơn đầu chạy song song → kết cục luôn là người mời không giữ xu', async () => {
    for (let i = 0; i < 5; i += 1) {
      const { referrer, referee } = await pair();
      const o1 = await createOrder(prisma, {
        userId: referee.id, status: 'DELIVERED', createdAt: new Date(Date.now() - 9 * DAY), deliveredAt: new Date(),
      });
      const o2 = await createOrder(prisma, {
        userId: referee.id, status: 'DELIVERED', createdAt: new Date(Date.now() - 4 * DAY), deliveredAt: new Date(),
      });
      const results = await Promise.allSettled([
        affiliate.grantReferralReward(o2.id),
        orderStatus.setStatus(o1.id, 'RETURNED'),
      ]);
      expect(summarize(results).errors).toEqual([]);
      const grants = await prisma.coinTransaction.count({ where: { userId: referrer.id, delta: { gt: 0 } } });
      console.log('[i] vòng %d: thưởng trước rồi thu hồi=%s', i, grants === 1);
      expect(await coinsOf(referrer.id)).toEqual({ balance: 0, ledger: 0 });
    }
  });

  it('(j) người được mời đã có xu giới thiệu kiểu cũ (cashback) → không thưởng lần 2', async () => {
    const { referrer, referee } = await pair();
    await moduleRef.get(CoinsService).grantCoins(referrer.id, REWARD, `REFERRAL_CASHBACK:${referee.id}`, 'REFERRAL', referee.id);
    const o1 = await shippingOrder(referee.id, 9);
    const o2 = await shippingOrder(referee.id, 4);
    await orderStatus.setStatus(o1.id, 'DELIVERED');
    await orderStatus.setStatus(o2.id, 'DELIVERED');
    expect(await coinsOf(referrer.id)).toEqual({ balance: REWARD, ledger: REWARD });
  });
});
