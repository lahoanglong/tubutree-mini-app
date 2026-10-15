import { Test, type TestingModule } from '@nestjs/testing';
import type { PointsLot } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { applyPointsDelta } from '../../src/modules/loyalty/points-ledger';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { partialReturnTotals } from '../../src/modules/orders/return-ledger';
import { WALLET_DESTINATION } from '../../src/modules/orders/refund-destination';
import { countReferralSuccesses, milestoneGrantReason } from '../../src/modules/wallet/referral-reward';
import { createOrder, createUser, randCode, sleep, summarize, warmPool, setConfig } from './helpers';

/** Thưởng 100 điểm để thấy rõ phần làm tròn; sổ xu cũ: 5.000 xu = 5 điểm lô quy đổi. */
const REWARD = 100;
const LEGACY_REWARD_XU = 5000;
const UNIT = 50_000;
const MILESTONE = 20;

/**
 * T1 (chốt 2026-10-15): trả MỘT PHẦN một trong hai đơn đã dùng để thưởng giới thiệu thì thu hồi thưởng của người mời THEO
 * TỶ LỆ tiền hàng đã trả của đơn đó, luỹ kế, làm tròn xuống; tổng hai đơn không quá thưởng; lần trả cả đơn sau đó chỉ thu
 * phần còn lại; mốc thưởng thêm và số lượt giới thiệu chỉ đổi khi thu hồi hoàn toàn. Chạy qua OrderReturnsService +
 * OrderReversalService thật trên Postgres.
 */
describe('Thu hồi thưởng giới thiệu theo tỷ lệ khi trả một phần (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let returns: OrderReturnsService;
  let reversal: OrderReversalService;
  let rewards: RewardPointsService;
  let admin: { id: string };
  const CONFIG_KEYS = [
    'returns.window_days',
    'referral.referrer_reward_points',
    'referral.window_days',
    'referral.min_order_amount',
    'referral.milestones_points',
  ];
  let savedConfig: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrderReturnsService,
        RewardPointsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    returns = moduleRef.get(OrderReturnsService);
    reversal = moduleRef.get(OrderReversalService);
    rewards = moduleRef.get(RewardPointsService);
    // DB race dùng chung giữa các spec: nhớ giá trị cũ để trả lại ở afterAll (loyalty.race dựa vào hạn đổi/trả mặc định 7 ngày).
    savedConfig = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } } });
    await setConfig(prisma, 'returns.window_days', 7);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 100_000);
    await setConfig(prisma, 'referral.milestones_points', []);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.systemConfig.deleteMany({ where: { key: { in: CONFIG_KEYS.filter((k) => !savedConfig.some((c) => c.key === k)) } } });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-t1-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: UNIT },
    });
    return prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: UNIT, stock: 100 },
    });
  }

  /** Đơn COD đã giao `qty` × 50.000, không ship, tiền thực trả từng dòng đã lưu. */
  async function deliveredOrder(userId: string, qty: number, createdAt: Date) {
    const v = await variation();
    const total = qty * UNIT;
    const order = await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: total,
      shippingFee: 0,
      total,
      createdAt,
      deliveredAt: new Date(),
      items: {
        create: [{ variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: qty, total, paidTotal: total }],
      },
    });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    return { ...order, item };
  }

  type Ord = Awaited<ReturnType<typeof deliveredOrder>>;

  /**
   * Người mời đã nhận thưởng REFERRAL_ORDER2 cho người được mời với đơn đầu A (qtyA đơn vị) và đơn thứ hai B (qtyB).
   * `ledger: 'COIN'` dựng như thưởng trước gộp: dòng xu + đúng phần migration B quy đổi sang lô CONVERTED.
   */
  async function rewarded(opts: { qtyA?: number; qtyB?: number; ledger?: 'POINTS' | 'COIN' } = {}) {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const a = await deliveredOrder(referee.id, opts.qtyA ?? 3, new Date(Date.now() - 10 * 864e5));
    const b = await deliveredOrder(referee.id, opts.qtyB ?? 3, new Date(Date.now() - 5 * 864e5));
    const reason = `REFERRAL_ORDER2:${referee.id}`;
    const refId = `${a.id}:${b.id}`;
    if (opts.ledger === 'COIN') {
      await prisma.coinTransaction.create({ data: { userId: referrer.id, delta: LEGACY_REWARD_XU, reason, refType: 'REFERRAL', refId } });
      const points = Math.ceil(LEGACY_REWARD_XU / 1000);
      await prisma.coinTransaction.create({
        data: { userId: referrer.id, delta: -LEGACY_REWARD_XU, reason: `XU_TO_POINTS:${points}`, refType: 'XU_MIGRATION', refId: referrer.id },
      });
      await prisma.pointsTransaction.create({
        data: { userId: referrer.id, delta: points, reason: `XU_TO_POINTS:${LEGACY_REWARD_XU}`, refType: 'XU_MIGRATION', refId: referrer.id, lot: 'CONVERTED' },
      });
      await prisma.user.update({ where: { id: referrer.id }, data: { pointsConvertedBalance: { increment: points } } });
    } else {
      await prisma.$transaction((tx) =>
        applyPointsDelta(tx, { userId: referrer.id, delta: REWARD, lot: 'STANDARD', reason, refType: 'REFERRAL', refId }),
      );
    }
    return { referrer, referee, a, b };
  }

  /** Khách xin trả `qty` đơn vị của đơn, admin duyệt. Trả về id yêu cầu. */
  async function returnUnits(refereeId: string, order: Ord, qty: number) {
    const req = await returns.request(refereeId, order.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: order.item.id, quantity: qty }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    return req.id;
  }

  /** Dòng thu hồi thưởng (cả hai kiểu) và dòng ghi nợ của người mời. */
  async function revocations(referrerId: string) {
    const rows = (
      await prisma.pointsTransaction.findMany({
        where: { userId: referrerId, refType: { in: ['REFERRAL', 'REFERRAL_DEBT'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { reason: true, delta: true, refType: true, refId: true, lot: true },
      })
    ).filter((r) => r.reason.startsWith('REFERRAL_ORDER2_'));
    const partial = rows.filter((r) => r.refType === 'REFERRAL' && r.reason.startsWith('REFERRAL_ORDER2_PARTIAL_REVOKE:'));
    const full = rows.filter((r) => r.refType === 'REFERRAL' && r.reason.startsWith('REFERRAL_ORDER2_REVOKE:'));
    const debts = rows.filter((r) => r.refType === 'REFERRAL_DEBT');
    const debt = debts.reduce((s, r) => s + Number(r.reason.slice(r.reason.lastIndexOf(':') + 1)), 0);
    const taken = -[...partial, ...full].reduce((s, r) => s + r.delta, 0);
    return { rows, partial, full, debts, taken, debt, total: taken + debt };
  }

  async function balanceOf(userId: string, lot: PointsLot = 'STANDARD') {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true, pointsConvertedBalance: true } });
    const sum = await prisma.pointsTransaction.aggregate({ where: { userId, lot }, _sum: { delta: true } });
    const balance = lot === 'CONVERTED' ? u.pointsConvertedBalance : u.pointsBalance;
    expect(balance).toBe(sum._sum.delta ?? 0);
    expect(balance).toBeGreaterThanOrEqual(0);
    return balance;
  }

  const successes = (referrerId: string) => prisma.$transaction((tx) => countReferralSuccesses(tx, referrerId));

  it('(a) trả 1/3 đơn thứ hai → thu hồi floor(100 × 1/3) = 33, lượt giới thiệu không đổi', async () => {
    const { referrer, referee, b } = await rewarded();
    const reqId = await returnUnits(referee.id, b, 1);
    const r = await revocations(referrer.id);
    expect(r.partial).toEqual([
      expect.objectContaining({ reason: `REFERRAL_ORDER2_PARTIAL_REVOKE:${referee.id}:${reqId}`, delta: -33, refId: b.id, lot: 'STANDARD' }),
    ]);
    expect(r.full).toHaveLength(0);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 33);
    expect(await successes(referrer.id)).toBe(1);
  });

  it('(b) hai lần trả 1/6 luỹ kế → 16 rồi 17 (mục tiêu luỹ kế 33), không trôi làm tròn', async () => {
    const { referrer, referee, b } = await rewarded({ qtyB: 6 });
    await returnUnits(referee.id, b, 1);
    await returnUnits(referee.id, b, 1);
    const r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta)).toEqual([-16, -17]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 33);
  });

  it('(c) trả 2/3 đơn đầu → thu hồi 66 (refId = đơn đầu)', async () => {
    const { referrer, referee, a } = await rewarded();
    await returnUnits(referee.id, a, 2);
    const r = await revocations(referrer.id);
    expect(r.partial).toEqual([expect.objectContaining({ delta: -66, refId: a.id })]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
  });

  /** Mốc thưởng thêm 1 lượt = 20 điểm đang giữ (đời 0). */
  async function milestoneHeld(referrerId: string) {
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, {
        userId: referrerId,
        delta: MILESTONE,
        lot: 'STANDARD',
        reason: milestoneGrantReason(referrerId, 1, 0),
        refType: 'REFERRAL',
        refId: referrerId,
      }),
    );
  }

  const milestoneRevokes = (referrerId: string) =>
    prisma.pointsTransaction.findMany({
      where: { userId: referrerId, refType: 'REFERRAL', reason: { startsWith: `REFERRAL_MILESTONE_REVOKE:${referrerId}:` } },
      select: { reason: true, delta: true },
    });

  it('(d) trả 2/3 cả hai đơn → 66 + 34 = thưởng: thu hồi HOÀN TOÀN nên giảm lượt và thu mốc; trả nốt cả đơn không ghi trùng', async () => {
    const { referrer, referee, a, b } = await rewarded();
    await milestoneHeld(referrer.id);
    await returnUnits(referee.id, a, 2);
    expect(await successes(referrer.id)).toBe(1);
    await returnUnits(referee.id, b, 2);
    let r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta)).toEqual([-66, -34]);
    expect(r.full).toEqual([expect.objectContaining({ reason: `REFERRAL_ORDER2_REVOKE:${referee.id}`, delta: 0, refId: b.id })]);
    expect(r.total).toBe(REWARD);
    expect(await successes(referrer.id)).toBe(0);
    expect(await milestoneRevokes(referrer.id)).toEqual([{ reason: `REFERRAL_MILESTONE_REVOKE:${referrer.id}:1#0`, delta: -MILESTONE }]);
    expect(await balanceOf(referrer.id)).toBe(0);

    await returnUnits(referee.id, b, 1);
    r = await revocations(referrer.id);
    expect(r.full).toHaveLength(1);
    expect(r.total).toBe(REWARD);
    expect(await successes(referrer.id)).toBe(0);
    expect(await milestoneRevokes(referrer.id)).toHaveLength(1);
  });

  it('(k) đơn có dòng quà 0đ: trả hết dòng có tiền (chưa phải cả đơn) → thu đủ thưởng, giảm lượt, thu mốc; trả nốt dòng quà không thu thêm', async () => {
    const { referrer, referee } = await rewarded();
    const first = await deliveredOrder(referee.id, 2, new Date(Date.now() - 20 * 864e5));
    const v = await variation();
    const gift = await variation();
    const second = await createOrder(prisma, {
      userId: referee.id,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 3 * UNIT,
      shippingFee: 0,
      total: 3 * UNIT,
      createdAt: new Date(Date.now() - 15 * 864e5),
      deliveredAt: new Date(),
      items: {
        create: [
          { variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 3, total: 3 * UNIT, paidTotal: 3 * UNIT },
          { variationId: gift.id, productName: 'Quà tặng', variationName: 'Túi', unitPrice: 0, quantity: 1, total: 0, paidTotal: 0 },
        ],
      },
    });
    // Người được mời thứ hai của cùng người mời, thưởng bằng cặp (first, second).
    const other = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    await prisma.order.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { userId: other.id } });
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, {
        userId: referrer.id,
        delta: REWARD,
        lot: 'STANDARD',
        reason: `REFERRAL_ORDER2:${other.id}`,
        refType: 'REFERRAL',
        refId: `${first.id}:${second.id}`,
      }),
    );
    await prisma.$transaction((tx) =>
      applyPointsDelta(tx, { userId: referrer.id, delta: MILESTONE, lot: 'STANDARD', reason: milestoneGrantReason(referrer.id, 2, 0), refType: 'REFERRAL', refId: referrer.id }),
    );
    expect(await successes(referrer.id)).toBe(2);
    const items = await prisma.orderItem.findMany({ where: { orderId: second.id } });
    const paidLine = items.find((i) => i.total > 0)!;
    const giftLine = items.find((i) => i.total === 0)!;

    const req = await returns.request(other.id, second.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: paidLine.id, quantity: 3 }],
    });
    await returns.review(admin.id, req.id, { approve: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('DELIVERED');
    const fullRows = async () =>
      prisma.pointsTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL', reason: `REFERRAL_ORDER2_REVOKE:${other.id}` } });
    const partialRows = () =>
      prisma.pointsTransaction.findMany({ where: { userId: referrer.id, refType: 'REFERRAL', reason: { startsWith: `REFERRAL_ORDER2_PARTIAL_REVOKE:${other.id}:` } } });
    expect((await partialRows()).map((p) => p.delta)).toEqual([-REWARD]);
    expect((await fullRows()).map((p) => p.delta)).toEqual([0]);
    expect(await successes(referrer.id)).toBe(1);
    expect((await milestoneRevokes(referrer.id)).map((m) => m.reason)).toEqual([`REFERRAL_MILESTONE_REVOKE:${referrer.id}:2#0`]);

    const rest = await returns.request(other.id, second.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: giftLine.id, quantity: 1 }],
    });
    await returns.review(admin.id, rest.id, { approve: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('RETURNED');
    expect((await fullRows()).map((p) => p.delta)).toEqual([0]);
    expect((await partialRows()).map((p) => p.delta)).toEqual([-REWARD]);
    expect(await successes(referrer.id)).toBe(1);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(e) trả 1/3 rồi trả nốt cả đơn → lần cả đơn chỉ thu 67, tổng = thưởng', async () => {
    const { referrer, referee, b } = await rewarded();
    await returnUnits(referee.id, b, 1);
    await returnUnits(referee.id, b, 2);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('RETURNED');
    const r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta)).toEqual([-33]);
    expect(r.full.map((p) => p.delta)).toEqual([-67]);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
    expect(await successes(referrer.id)).toBe(0);
  });

  it('(e2) trả cả đơn đầu trước, trả một phần đơn thứ hai sau → không thu thêm', async () => {
    const { referrer, referee, a, b } = await rewarded();
    await returnUnits(referee.id, a, 3);
    await returnUnits(referee.id, b, 1);
    const r = await revocations(referrer.id);
    expect(r.full.map((p) => p.delta)).toEqual([-REWARD]);
    expect(r.partial).toHaveLength(0);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
  });

  it('(f) chạy lại cùng yêu cầu trả (cùng requestId) không trừ lần hai', async () => {
    const { referrer, referee, b } = await rewarded();
    const reqId = await returnUnits(referee.id, b, 1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: b.id }, include: { items: true } });
    const replay = () =>
      prisma.$transaction(async (tx) => {
        const prior = await partialReturnTotals(tx, order.id, reqId);
        return reversal.reversePartialReturn(tx, order, {
          requestId: reqId,
          shares: {
            isFull: false,
            goods: 0,
            shipping: 0,
            pointsUsedBack: 0,
            convertedBack: 0,
            pointsEarnedBack: 0,
            ratioBefore: 0,
            ratioAfter: 0,
            lines: [{ orderItemId: b.item.id, quantity: 1, refundAmount: 0 }],
          },
          destination: WALLET_DESTINATION,
          prior,
          standardPointsExpiresAt: null,
        });
      });
    await replay();
    await replay();
    const r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta)).toEqual([-33]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 33);
  });

  it('(g) người mời đã tiêu gần hết điểm → trừ tới 0, phần thiếu ghi REFERRAL_DEBT; trả nốt ghi nợ phần còn lại', async () => {
    const { referrer, referee, b } = await rewarded();
    await prisma.$transaction((tx) => applyPointsDelta(tx, { userId: referrer.id, delta: -90, lot: 'STANDARD', reason: 'GAME_SPIN_COST:it', refType: 'TEST' }));
    const reqId = await returnUnits(referee.id, b, 1);
    let r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta)).toEqual([-10]);
    expect(r.debts).toEqual([
      expect.objectContaining({ reason: `REFERRAL_ORDER2_PARTIAL_DEBT:${referee.id}:${reqId}:23`, delta: 0, refId: b.id }),
    ]);
    expect(await balanceOf(referrer.id)).toBe(0);

    await returnUnits(referee.id, b, 2);
    r = await revocations(referrer.id);
    expect(r.full.map((p) => p.delta)).toEqual([0]);
    expect(r.debts.map((d) => d.reason)).toContain(`REFERRAL_ORDER2_DEBT:${referee.id}:67`);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
  });

  it('(h) đơn không thuộc lần thưởng nào → không thu hồi gì', async () => {
    const { referrer, referee } = await rewarded();
    const c = await deliveredOrder(referee.id, 3, new Date());
    await returnUnits(referee.id, c, 1);
    const r = await revocations(referrer.id);
    expect(r.rows).toHaveLength(0);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(h2) yêu cầu bị từ chối → không thu hồi', async () => {
    const { referrer, referee, b } = await rewarded();
    const req = await returns.request(referee.id, b.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: b.item.id, quantity: 1 }],
    });
    await returns.review(admin.id, req.id, { approve: false, note: 'Hàng đã bóc tem' });
    expect((await revocations(referrer.id)).rows).toHaveLength(0);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
  });

  it('(i) thưởng cấp bằng xu cũ: quy ra điểm ceil(xu/1000) rồi làm tròn xuống theo điểm, trừ lô CONVERTED; tổng = 5', async () => {
    const { referrer, referee, b } = await rewarded({ ledger: 'COIN' });
    await returnUnits(referee.id, b, 1); // floor(5 × 1/3) = 1
    await returnUnits(referee.id, b, 1); // floor(5 × 2/3) = 3 luỹ kế → 2
    let r = await revocations(referrer.id);
    expect(r.partial.map((p) => [p.delta, p.lot])).toEqual([
      [-1, 'CONVERTED'],
      [-2, 'CONVERTED'],
    ]);
    expect(await balanceOf(referrer.id, 'CONVERTED')).toBe(2);
    await returnUnits(referee.id, b, 1);
    r = await revocations(referrer.id);
    expect(r.full.map((p) => [p.delta, p.lot])).toEqual([[-2, 'CONVERTED']]);
    expect(r.total).toBe(5);
    expect(await balanceOf(referrer.id, 'CONVERTED')).toBe(0);
  });

  it('(j) duyệt song song trả 2/3 cả hai đơn → tổng thu hồi đúng bằng thưởng, không hơn', async () => {
    const { referrer, referee, a, b } = await rewarded();
    const reqs = await Promise.all(
      [a, b].map((o) =>
        returns.request(referee.id, o.code, {
          reasonCode: 'OTHER',
          reason: 'Không còn nhu cầu dùng nữa',
          items: [{ orderItemId: o.item.id, quantity: 2 }],
        }),
      ),
    );
    const results = await Promise.allSettled(reqs.map((q) => returns.review(admin.id, q.id, { approve: true })));
    const s = summarize(results);
    expect(s.errors).toEqual([]);
    const r = await revocations(referrer.id);
    expect(r.partial.map((p) => p.delta).sort((x, y) => x - y)).toEqual([-66, -34]);
    expect(r.full.map((p) => p.delta)).toEqual([0]);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
    expect(await successes(referrer.id)).toBe(0);
  });

  /** Người được mời có hai đơn đã giao (A 10 ngày trước, B 5 ngày trước), CHƯA nhận thưởng. */
  async function unrewarded(existingReferrer?: { id: string }) {
    const referrer = existingReferrer ?? (await createUser(prisma, { role: 'CUSTOMER' }));
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const a = await deliveredOrder(referee.id, 3, new Date(Date.now() - 10 * 864e5));
    const b = await deliveredOrder(referee.id, 3, new Date(Date.now() - 5 * 864e5));
    return { referrer, referee, a, b };
  }

  it('(l) trả 2/3 đơn đầu TRƯỚC khi cấp thưởng → lúc cấp thu ngay 66; cấp lại không thu lần hai', async () => {
    const { referrer, referee, a } = await unrewarded();
    await returnUnits(referee.id, a, 2);
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    let r = await revocations(referrer.id);
    expect(r.partial).toEqual([
      expect.objectContaining({ reason: `REFERRAL_ORDER2_PARTIAL_REVOKE:${referee.id}:GRANT-${a.id}`, delta: -66, refId: a.id }),
    ]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
    expect(await successes(referrer.id)).toBe(1);

    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(false);
    r = await revocations(referrer.id);
    expect(r.partial).toHaveLength(1);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);

    // Trả nốt đơn đầu sau khi cấp: chỉ thu phần còn lại.
    await returnUnits(referee.id, a, 1);
    r = await revocations(referrer.id);
    expect(r.full.map((p) => p.delta)).toEqual([-34]);
    expect(r.total).toBe(REWARD);
  });

  it('(m) trả 2/3 cả hai đơn trước khi cấp → lúc cấp thu 66 + 34, không quá thưởng, thu hồi hoàn toàn', async () => {
    const { referrer, referee, a, b } = await unrewarded();
    await returnUnits(referee.id, a, 2);
    await returnUnits(referee.id, b, 2);
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    const r = await revocations(referrer.id);
    expect(r.partial.map((p) => [p.refId, p.delta])).toEqual([
      [a.id, -66],
      [b.id, -34],
    ]);
    expect(r.full.map((p) => p.delta)).toEqual([0]);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
    expect(await successes(referrer.id)).toBe(0);
  });

  /** Tx thứ ba giữ khoá dòng users của người được mời cho tới khi `release()`; các tx duyệt/cấp xếp hàng chờ nó. */
  async function holdReferee(refereeId: string) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const held = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const done = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${refereeId} FOR NO KEY UPDATE`;
        [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS "pid"`;
        locked();
        await gate;
      },
      { timeout: 30_000 },
    );
    await held;
    return { release, done, pid };
  }

  /**
   * Chờ tới khi có `n` phiên đứng chờ (trực tiếp hoặc xếp hàng sau phiên đang chờ) khoá do tx `holderPid` giữ — tức tx
   * duyệt/cấp đã tới chỗ cần dòng người được mời. Chỉ đếm cây chờ của tx giữ khoá, không đếm phiên chờ khoá của spec khác
   * chạy song song trên cùng DB. Phiên chờ thứ hai thường bị chặn bởi phiên chờ thứ nhất (khoá tuple), nên đi đệ quy.
   */
  async function waitLockWaiters(holderPid: number, n: number) {
    for (let i = 0; i < 200; i++) {
      const [row] = await prisma.$queryRaw<{ n: number }[]>`
        WITH RECURSIVE "w" AS (
          SELECT "pid" FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids("pid"))
          UNION
          SELECT a."pid" FROM pg_stat_activity a JOIN "w" ON "w"."pid" = ANY(pg_blocking_pids(a."pid"))
        )
        SELECT count(*)::int AS "n" FROM "w"`;
      if ((row?.n ?? 0) >= n) return;
      await sleep(25);
    }
    throw new Error(`Không thấy ${n} phiên chờ khoá`);
  }

  async function forcedOrder(first: 'APPROVE' | 'GRANT') {
    const { referrer, referee, a } = await unrewarded();
    const req = await returns.request(referee.id, a.code, {
      reasonCode: 'OTHER',
      reason: 'Không còn nhu cầu dùng nữa',
      items: [{ orderItemId: a.item.id, quantity: 2 }],
    });
    const approve = () => returns.review(admin.id, req.id, { approve: true });
    const grant = () => rewards.grantReferralOrderReward(referee.id);
    const lock = await holdReferee(referee.id);
    const p1 = (first === 'APPROVE' ? approve : grant)();
    await waitLockWaiters(lock.pid, 1);
    const p2 = (first === 'APPROVE' ? grant : approve)();
    await waitLockWaiters(lock.pid, 2);
    lock.release();
    await lock.done;
    const s = summarize(await Promise.allSettled([p1, p2]));
    expect(s.errors).toEqual([]);
    return { referrer, referee, a, reqId: req.id };
  }

  it('(n1) thứ tự ép: tx duyệt trả lấy khoá người được mời và commit TRƯỚC, tx cấp đọc yêu cầu đã duyệt SAU → lúc cấp thu 66', async () => {
    const { referrer, referee, a } = await forcedOrder('APPROVE');
    const r = await revocations(referrer.id);
    expect(r.partial).toEqual([
      expect.objectContaining({ reason: `REFERRAL_ORDER2_PARTIAL_REVOKE:${referee.id}:GRANT-${a.id}`, delta: -66 }),
    ]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
  });

  it('(n2) thứ tự ép: tx cấp lấy khoá và commit TRƯỚC (chưa thấy yêu cầu đang duyệt), tx duyệt thấy thưởng SAU → lúc duyệt thu 66', async () => {
    const { referrer, referee, reqId } = await forcedOrder('GRANT');
    const r = await revocations(referrer.id);
    expect(r.partial).toEqual([expect.objectContaining({ reason: `REFERRAL_ORDER2_PARTIAL_REVOKE:${referee.id}:${reqId}`, delta: -66 })]);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
  });

  /** Đơn COD đã giao: 3 × 50.000 có tiền + 1 quà 0đ. Trả hết dòng có tiền thì đơn vẫn DELIVERED (còn dòng quà). */
  async function giftOrder(userId: string, createdAt: Date) {
    const v = await variation();
    const gift = await variation();
    const order = await createOrder(prisma, {
      userId,
      status: 'DELIVERED',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      subtotal: 3 * UNIT,
      shippingFee: 0,
      total: 3 * UNIT,
      createdAt,
      deliveredAt: new Date(),
      items: {
        create: [
          { variationId: v.id, productName: 'Nước giặt', variationName: 'Chai', unitPrice: UNIT, quantity: 3, total: 3 * UNIT, paidTotal: 3 * UNIT },
          { variationId: gift.id, productName: 'Quà tặng', variationName: 'Túi', unitPrice: 0, quantity: 1, total: 0, paidTotal: 0 },
        ],
      },
    });
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    return { ...order, paid: items.find((i) => i.total > 0)!, gift: items.find((i) => i.total === 0)! };
  }

  async function returnLines(refereeId: string, code: string, items: { orderItemId: string; quantity: number }[]) {
    const req = await returns.request(refereeId, code, { reasonCode: 'OTHER', reason: 'Không còn nhu cầu dùng nữa', items });
    await returns.review(admin.id, req.id, { approve: true });
  }

  /** A trả theo `returnA`, rồi B giao (chưa đủ cặp nếu A bị loại), rồi C giao → cấp cho cặp (B, C). */
  async function excludedFirstOrder(returnA: (refereeId: string, a: Awaited<ReturnType<typeof giftOrder>>) => Promise<void>) {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const a = await giftOrder(referee.id, new Date(Date.now() - 20 * 864e5));
    await returnA(referee.id, a);
    const b = await deliveredOrder(referee.id, 3, new Date(Date.now() - 10 * 864e5));
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(false);
    const c = await deliveredOrder(referee.id, 3, new Date(Date.now() - 5 * 864e5));
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { userId: referrer.id, reason: `REFERRAL_ORDER2:${referee.id}` } });
    expect(grant.refId).toBe(`${b.id}:${c.id}`);
    const r = await revocations(referrer.id);
    expect(r.rows).toHaveLength(0);
    expect(await balanceOf(referrer.id)).toBe(REWARD);
    expect(await successes(referrer.id)).toBe(1);
    return a;
  }

  it('(p) đơn đầu đã trả hết dòng có tiền (còn quà 0đ, vẫn DELIVERED) bị loại khỏi cặp: B một mình chưa cấp, C giao → cặp (B, C), giữ đủ thưởng', async () => {
    const a = await excludedFirstOrder((refereeId, o) => returnLines(refereeId, o.code, [{ orderItemId: o.paid.id, quantity: 3 }]));
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('DELIVERED');
  });

  it('(p2) cùng kịch bản nhưng đơn đầu bị trả CẢ đơn (RETURNED) → kết quả giống hệt (p)', async () => {
    const a = await excludedFirstOrder((refereeId, o) =>
      returnLines(refereeId, o.code, [
        { orderItemId: o.paid.id, quantity: 3 },
        { orderItemId: o.gift.id, quantity: 1 },
      ]),
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('RETURNED');
  });

  it('(p3) đơn đầu chỉ trả 2/3 phần có tiền (chưa hết) → vẫn được chọn vào cặp, lúc cấp thu theo tỷ lệ 66', async () => {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const a = await giftOrder(referee.id, new Date(Date.now() - 20 * 864e5));
    await returnLines(referee.id, a.code, [{ orderItemId: a.paid.id, quantity: 2 }]);
    const b = await deliveredOrder(referee.id, 3, new Date(Date.now() - 10 * 864e5));
    expect(await rewards.grantReferralOrderReward(referee.id)).toBe(true);
    const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { userId: referrer.id, reason: `REFERRAL_ORDER2:${referee.id}` } });
    expect(grant.refId).toBe(`${a.id}:${b.id}`);
    const r = await revocations(referrer.id);
    expect(r.partial).toEqual([expect.objectContaining({ refId: a.id, delta: -66 })]);
    expect(r.full).toHaveLength(0);
    expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
  });

  type FindManyLog = { model: 'order' | 'returnRequest'; args: { where?: { userId?: string }; take?: number }; rows: number };

  /** Chạy `fn` với mọi tx interactive của prisma bị bọc để ghi lại từng order.findMany / returnRequest.findMany (args + số dòng). */
  async function withFindManyLog<T>(fn: () => Promise<T>): Promise<{ result: T; log: FindManyLog[] }> {
    const log: FindManyLog[] = [];
    const wrapDelegate = (model: FindManyLog['model'], delegate: object) =>
      new Proxy(delegate, {
        get(target, prop) {
          const v = Reflect.get(target, prop) as unknown;
          if (prop === 'findMany') {
            return async (args: FindManyLog['args']) => {
              const rows = await (v as (a: unknown) => Promise<unknown[]>).call(target, args);
              log.push({ model, args, rows: rows.length });
              return rows;
            };
          }
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    const wrapTx = (tx: object) =>
      new Proxy(tx, {
        get(target, prop) {
          const v = Reflect.get(target, prop) as unknown;
          if (prop === 'order' || prop === 'returnRequest') return wrapDelegate(prop, v as object);
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    const original = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((arg: unknown, opts?: unknown) =>
      typeof arg === 'function'
        ? original((tx: object) => (arg as (t: object) => unknown)(wrapTx(tx)), opts)
        : original(arg, opts)) as never);
    try {
      return { result: await fn(), log };
    } finally {
      spy.mockRestore();
    }
  }

  const candidateReads = (log: FindManyLog[], refereeId: string) => log.filter((l) => l.model === 'order' && l.args.where?.userId === refereeId);

  it('(q) 23 đơn đầu đã trả hết phần có tiền, 2 đơn kế là cặp, còn 10 đơn mới hơn → đúng cặp, đọc ứng viên theo trang có chặn trên', async () => {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const base = Date.now() - 200 * 864e5;
    for (let i = 0; i < 23; i++) {
      const o = await giftOrder(referee.id, new Date(base + i * 864e5));
      await returnLines(referee.id, o.code, [{ orderItemId: o.paid.id, quantity: 3 }]);
    }
    const first = await deliveredOrder(referee.id, 3, new Date(Date.now() - 40 * 864e5));
    const second = await deliveredOrder(referee.id, 3, new Date(Date.now() - 35 * 864e5));
    for (let i = 0; i < 10; i++) await deliveredOrder(referee.id, 3, new Date(Date.now() - (20 - i) * 864e5));

    const { result, log } = await withFindManyLog(() => rewards.grantReferralOrderReward(referee.id));
    expect(result).toBe(true);
    const grant = await prisma.pointsTransaction.findFirstOrThrow({ where: { userId: referrer.id, reason: `REFERRAL_ORDER2:${referee.id}` } });
    expect(grant.refId).toBe(`${first.id}:${second.id}`);
    expect(await balanceOf(referrer.id)).toBe(REWARD);

    const reads = candidateReads(log, referee.id);
    expect(reads.map((r) => r.args.take)).toEqual([10, 10, 10]);
    expect(reads.reduce((s, r) => s + r.rows, 0)).toBe(30);
    // Không đọc yêu cầu trả của các đơn ngoài 3 trang đã duyệt (35 đơn đủ điều kiện, chỉ 30 được xét).
    const reqRows = log.filter((l) => l.model === 'returnRequest').reduce((s, r) => s + r.rows, 0);
    expect(reqRows).toBeLessThanOrEqual(23);
  });

  it('(q2) 25 đơn đủ điều kiện nhưng hai đơn đầu cách nhau quá referral.window_days → không cấp, chỉ đọc một trang ứng viên', async () => {
    const referrer = await createUser(prisma, { role: 'CUSTOMER' });
    const referee = await createUser(prisma, { role: 'CUSTOMER', referredById: referrer.id });
    const base = Date.now() - 26 * 40 * 864e5;
    for (let i = 0; i < 25; i++) await deliveredOrder(referee.id, 3, new Date(base + i * 40 * 864e5));

    const { result, log } = await withFindManyLog(() => rewards.grantReferralOrderReward(referee.id));
    expect(result).toBe(false);
    const reads = candidateReads(log, referee.id);
    expect(reads.map((r) => [r.args.take, r.rows])).toEqual([[10, 10]]);
    expect(await balanceOf(referrer.id)).toBe(0);
  });

  it('(o) cấp thưởng song song cho hai người được mời của cùng người mời, một người đã trả một phần trước → không deadlock, cả hai được cấp', async () => {
    for (let round = 0; round < 3; round++) {
      const referrer = await createUser(prisma, { role: 'CUSTOMER' });
      const r1 = await unrewarded(referrer);
      const r2 = await unrewarded(referrer);
      await returnUnits(r1.referee.id, r1.a, 2);

      // Ép xen kẽ: tx cấp R1 ghi xong dòng thưởng (đang giữ khoá cập nhật dòng users người mời) rồi chờ tx cấp R2 vào tới
      // grant() và chèn dòng sổ của người mời (KEY SHARE qua khoá ngoại); sau đó R1 mới thu hồi theo tỷ lệ (cần khoá người mời).
      let r2Entered!: () => void;
      const r2In = new Promise<void>((resolve) => (r2Entered = resolve));
      const original = rewards.grant.bind(rewards);
      const spy = jest.spyOn(rewards, 'grant').mockImplementation(async (...args: Parameters<RewardPointsService['grant']>) => {
        if (args[2] === `REFERRAL_ORDER2:${r2.referee.id}`) {
          r2Entered();
          return original(...args);
        }
        const res = await original(...args);
        await Promise.race([r2In.then(() => sleep(300)), sleep(1500)]);
        return res;
      });
      try {
        const results = await Promise.allSettled([
          rewards.grantReferralOrderReward(r1.referee.id),
          sleep(50).then(() => rewards.grantReferralOrderReward(r2.referee.id)),
        ]);
        const s = summarize(results);
        expect(s.errors).toEqual([]);
        expect(s.fulfilled.map((f) => f.value)).toEqual([true, true]);
      } finally {
        spy.mockRestore();
      }
      const r = await revocations(referrer.id);
      expect(r.partial.map((p) => [p.refId, p.delta])).toEqual([[r1.a.id, -66]]);
      expect(await balanceOf(referrer.id)).toBe(2 * REWARD - 66);
      expect(await successes(referrer.id)).toBe(2);
    }
  });

  it('(j2) song song: trả cả đơn đầu + trả một phần đơn thứ hai → không deadlock, tổng thu hồi đúng bằng thưởng', async () => {
    const { referrer, referee, a, b } = await rewarded();
    const reqs = await Promise.all(
      [
        [a, 3],
        [b, 1],
      ].map(([o, qty]) =>
        returns.request(referee.id, (o as Ord).code, {
          reasonCode: 'OTHER',
          reason: 'Không còn nhu cầu dùng nữa',
          items: [{ orderItemId: (o as Ord).item.id, quantity: qty as number }],
        }),
      ),
    );
    const s = summarize(await Promise.allSettled(reqs.map((q) => returns.review(admin.id, q.id, { approve: true }))));
    expect(s.errors).toEqual([]);
    const r = await revocations(referrer.id);
    expect(r.full).toHaveLength(1);
    expect(r.total).toBe(REWARD);
    expect(await balanceOf(referrer.id)).toBe(0);
    expect(await successes(referrer.id)).toBe(0);
  });
});
