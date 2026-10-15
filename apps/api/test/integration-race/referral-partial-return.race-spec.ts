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
    await setConfig(prisma, 'returns.window_days', 30);
    await setConfig(prisma, 'referral.referrer_reward_points', REWARD);
    await setConfig(prisma, 'referral.window_days', 30);
    await setConfig(prisma, 'referral.min_order_amount', 100_000);
    await setConfig(prisma, 'referral.milestones_points', []);
    admin = await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
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

  it('(n) duyệt trả 2/3 đơn đầu song song với cấp thưởng → luôn thu đúng 66, thứ tự nào cũng vậy', async () => {
    for (let round = 0; round < 4; round++) {
      const { referrer, referee, a } = await unrewarded();
      const req = await returns.request(referee.id, a.code, {
        reasonCode: 'OTHER',
        reason: 'Không còn nhu cầu dùng nữa',
        items: [{ orderItemId: a.item.id, quantity: 2 }],
      });
      const jobs = [() => returns.review(admin.id, req.id, { approve: true }), () => rewards.grantReferralOrderReward(referee.id)];
      if (round % 2) jobs.reverse();
      const s = summarize(await Promise.allSettled(jobs.map((j) => j())));
      expect(s.errors).toEqual([]);
      const r = await revocations(referrer.id);
      expect(r.partial.map((p) => p.delta)).toEqual([-66]);
      expect(r.total).toBe(66);
      expect(await balanceOf(referrer.id)).toBe(REWARD - 66);
    }
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
