import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService, SETTLE_VISIBILITY_MARGIN_MS } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, setConfig, sleep, warmPool } from './helpers';

/**
 * Mốc chốt đơn (dòng lịch sử PACKED) được ghi TRƯỚC khi transaction chốt đơn commit. Lượt trả thưởng chạy đúng lúc đó
 * (READ COMMITTED) không thấy đơn; nếu dòng thưởng mang giờ chạy thì về sau đơn bị coi là "đã tính": trả bù bỏ sót, huỷ đơn
 * thì thu hồi khoản thưởng chưa từng trả. Ca dưới giữ transaction chốt đơn mở suốt lượt trả thưởng rồi mới commit.
 *
 * Thời gian mô phỏng như các spec thưởng khác: lượt trả chạy ở `PAYOUT_AT` (tham số `now`) và mốc chốt ghi trong transaction là
 * PAYOUT_AT − 30 giây, tức đơn đang chốt dở ngay trước giờ chạy. Quý Q2/2020 riêng cho file này (bước trả/bù quét mọi đại lý).
 * Đơn có phí ship 19.000đ: thưởng tính trên tiền hàng.
 */
const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];
const FEE = 19_000;

describe('Trả thưởng quý khi đơn đang chốt dở chưa commit (real Postgres)', () => {
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

  /** Đơn trả trước đã PAID lúc đặt; `goods` tiền hàng + phí ship. */
  const dealerOrder = (userId: string, goods: number, createdAt: Date, status: 'DELIVERED' | 'CONFIRMED') =>
    createOrder(prisma, {
      userId,
      type: 'DEALER',
      status,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'PAID',
      paidAt: createdAt,
      subtotal: goods,
      shippingFee: FEE,
      total: goods + FEE,
      createdAt,
      deliveredAt: status === 'DELIVERED' ? createdAt : null,
    });

  function returnOrder(orderId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
      if (flipped.count === 0) throw new Error(`flip thua ${orderId}`);
      await reversal.reverseFinancials(tx, order);
    });
  }

  const rowsOf = (userId: string, quarter: string) =>
    prisma.dealerCreditLedger.findMany({
      where: {
        userId,
        OR: [
          { refType: 'QUARTER_BONUS', refId: quarter },
          { refType: 'QUARTER_BONUS_TOPUP', refId: { startsWith: `${quarter}:topup:` } },
          { refType: 'QUARTER_BONUS_ADJ', refId: { startsWith: `${quarter}:` } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

  it('payout chạy khi transaction chốt đơn chưa commit: trả bù sau đó trả phần chênh của đơn, huỷ đơn đó không bị thu hồi', async () => {
    const QUARTER = 'Q2/2020';
    const PAYOUT_AT = new Date('2020-07-12T03:00:00Z');
    const SETTLE_STAMP = new Date(PAYOUT_AT.getTime() - 30_000);
    // Đại lý X: đơn chốt dở rồi được trả bù. Đại lý Y: đơn chốt dở rồi bị trả hàng trước lượt bù.
    const x = await createUser(prisma, { role: 'DEALER' });
    const y = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(x.id, 120_000_000, new Date('2020-05-10T03:00:00Z'), 'DELIVERED');
    await dealerOrder(y.id, 120_000_000, new Date('2020-05-10T03:00:00Z'), 'DELIVERED');
    const x2 = await dealerOrder(x.id, 90_000_000, new Date('2020-06-28T03:00:00Z'), 'CONFIRMED');
    const y2 = await dealerOrder(y.id, 90_000_000, new Date('2020-06-28T03:00:00Z'), 'CONFIRMED');

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let written!: () => void;
    const settledInTx = new Promise<void>((r) => (written = r));
    let committed = false;
    const settle = prisma
      .$transaction(
        async (tx) => {
          for (const id of [x2.id, y2.id]) {
            await tx.order.update({ where: { id }, data: { status: 'PACKED' } });
            await tx.orderStatusHistory.create({
              data: { orderId: id, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'SYSTEM', createdAt: SETTLE_STAMP },
            });
          }
          written();
          await gate;
        },
        { timeout: 30_000 },
      )
      .then(() => {
        committed = true;
      });

    await settledInTx;
    const payout = await dealer.payoutQuarterlyBonuses(PAYOUT_AT);
    expect(committed).toBe(false); // lượt trả thưởng chạy trọn trong lúc transaction chốt đơn còn mở
    release();
    await settle;
    expect(payout.quarter).toBe(QUARTER);

    // Lượt trả chỉ thấy đơn 120tr tiền hàng (3%, không cộng phí ship) và ghi mốc = giờ chạy − biên, sớm hơn mốc chốt của đơn dở.
    const seenBy = new Date(PAYOUT_AT.getTime() - SETTLE_VISIBILITY_MARGIN_MS);
    for (const d of [x, y]) {
      const rows = await rowsOf(d.id, QUARTER);
      expect(rows.map((r) => [r.refType, r.delta, r.createdAt.toISOString()])).toEqual([['QUARTER_BONUS', -3_600_000, seenBy.toISOString()]]);
    }

    // (2) Đơn của Y lên giao rồi bị trả trước lượt bù: thưởng đã trả không tính trên đơn này nên không thu hồi.
    await prisma.order.update({ where: { id: y2.id }, data: { status: 'DELIVERED', deliveredAt: new Date('2020-07-13T03:00:00Z') } });
    await returnOrder(y2.id);

    // (1) Lượt bù hằng ngày trả phần chênh do đơn của X: bonus(210tr) − bonus(120tr) = 8,4tr − 3,6tr.
    const topUpNow = new Date('2020-07-20T03:00:00Z');
    await dealer.topUpQuarterlyBonuses(topUpNow);

    const xRows = await rowsOf(x.id, QUARTER);
    expect(xRows.map((r) => [r.refType, r.delta])).toEqual([
      ['QUARTER_BONUS', -3_600_000],
      ['QUARTER_BONUS_TOPUP', -4_800_000],
    ]);
    expect(xRows[1]!.createdAt).toEqual(new Date(topUpNow.getTime() - SETTLE_VISIBILITY_MARGIN_MS));

    const yRows = await rowsOf(y.id, QUARTER);
    expect(yRows.map((r) => [r.refType, r.delta])).toEqual([['QUARTER_BONUS', -3_600_000]]);
  });
});
