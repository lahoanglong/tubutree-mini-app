import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, setConfig, sleep, warmPool } from './helpers';

/**
 * D11-02: thu hồi thưởng quý chỉ tính trên doanh số mà lần trả thưởng ĐÃ thấy. Đơn chốt (đóng gói + có tiền) SAU lần trả
 * thưởng chưa từng góp vào khoản thưởng, nên trả/huỷ nó không được kéo theo thưởng của đơn khác. Mỗi ca dùng một quý riêng
 * trong quá khứ (payoutQuarterlyBonuses quét mọi đại lý trong DB).
 */
const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];

describe('Thu hồi thưởng quý với đơn chốt muộn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let reversal: OrderReversalService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        OrderReversalService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    dealer = moduleRef.get(DealerService);
    reversal = moduleRef.get(OrderReversalService);
    await setConfig(prisma, 'dealer.quarterly_bonus_tiers', TIERS);
  });

  afterAll(async () => {
    await sleep(1500);
    await moduleRef?.close();
  });

  const dealerOrder = (userId: string, total: number, createdAt: Date, status: 'DELIVERED' | 'CONFIRMED', paid: boolean) =>
    createOrder(prisma, {
      userId,
      type: 'DEALER',
      status,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: paid ? 'PAID' : 'UNPAID',
      paidAt: paid ? createdAt : null,
      total,
      subtotal: total,
      createdAt,
      deliveredAt: status === 'DELIVERED' ? createdAt : null,
    });

  /** Đơn được kế toán/kho chốt SAU lần trả thưởng: lên DELIVERED, có dòng lịch sử và paidAt = bây giờ. */
  async function settleNow(orderId: string, opts: { markPaid: boolean }) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'DELIVERED', deliveredAt: new Date(), ...(opts.markPaid ? { paymentStatus: 'PAID', paidAt: new Date() } : {}) },
    });
    await prisma.orderStatusHistory.create({
      data: { orderId, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'SYSTEM' },
    });
  }

  function returnOrder(orderId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
      if (flipped.count === 0) throw new Error(`flip thua ${orderId}`);
      await reversal.reverseFinancials(tx, order);
    });
  }

  async function adjOf(userId: string, quarter: string) {
    const adj = await prisma.dealerCreditLedger.findMany({ where: { userId, refType: 'QUARTER_BONUS_ADJ', refId: { startsWith: `${quarter}:` } } });
    return adj.map((r) => r.delta);
  }

  it('đơn B (đã PAID, còn CONFIRMED lúc trả thưởng) lên PACKED sau đó rồi bị trả → không thu hồi thưởng của đơn A', async () => {
    const QUARTER = 'Q1/2025';
    const IN_Q = new Date('2025-02-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, IN_Q, 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2025-03-28T03:00:00Z'), 'CONFIRMED', true);

    await dealer.payoutQuarterlyBonuses(new Date('2025-04-15T03:00:00Z'));
    const bonus = await prisma.dealerCreditLedger.findMany({ where: { userId: d.id, refType: 'QUARTER_BONUS', refId: QUARTER } });
    expect(bonus.map((r) => r.delta)).toEqual([-3_600_000]);

    await sleep(20);
    await settleNow(b.id, { markPaid: false });
    await returnOrder(b.id);

    expect(await adjOf(d.id, QUARTER)).toEqual([]);
  });

  it('đơn chuyển khoản đã giao nhưng kế toán chỉ xác nhận tiền sau lần trả thưởng, rồi bị trả → không thu hồi', async () => {
    const QUARTER = 'Q4/2024';
    const IN_Q = new Date('2024-11-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, IN_Q, 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2024-12-28T03:00:00Z'), 'DELIVERED', false);

    await dealer.payoutQuarterlyBonuses(new Date('2025-01-15T03:00:00Z'));
    expect((await prisma.dealerCreditLedger.findMany({ where: { userId: d.id, refType: 'QUARTER_BONUS', refId: QUARTER } })).map((r) => r.delta)).toEqual([-3_600_000]);

    await sleep(20);
    await prisma.order.update({ where: { id: b.id }, data: { paymentStatus: 'PAID', paidAt: new Date() } });
    await returnOrder(b.id);

    expect(await adjOf(d.id, QUARTER)).toEqual([]);
  });

  it('A + A2 đã tính (5.4tr), C chốt muộn; trả A2 → thu 1.8tr theo doanh số lúc trả thưởng, không phải 3.9tr', async () => {
    const QUARTER = 'Q3/2024';
    const IN_Q = new Date('2024-08-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, IN_Q, 'DELIVERED', true);
    const a2 = await dealerOrder(d.id, 60_000_000, IN_Q, 'DELIVERED', true);
    const c = await dealerOrder(d.id, 30_000_000, new Date('2024-09-25T03:00:00Z'), 'CONFIRMED', true);

    await dealer.payoutQuarterlyBonuses(new Date('2024-10-15T03:00:00Z'));
    expect((await prisma.dealerCreditLedger.findMany({ where: { userId: d.id, refType: 'QUARTER_BONUS', refId: QUARTER } })).map((r) => r.delta)).toEqual([-5_400_000]);

    await sleep(20);
    await settleNow(c.id, { markPaid: false });
    await returnOrder(a2.id);

    expect(await adjOf(d.id, QUARTER)).toEqual([1_800_000]);
    // Gọi lại cho cùng đơn (đã RETURNED) không thu thêm.
    const again = await prisma.$transaction((tx) =>
      dealer.clawbackQuarterBonusForOrder(tx, { ...a2, status: 'DELIVERED', paymentStatus: 'PAID' }, { paidBeforeReversal: true }),
    );
    expect(again.clawedBack).toBe(0);
    expect(await adjOf(d.id, QUARTER)).toEqual([1_800_000]);
  });
});
