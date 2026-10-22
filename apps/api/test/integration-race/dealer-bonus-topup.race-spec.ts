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
 * Q8 (D11-03): trả bù thưởng quý cho đơn chốt muộn, trong 60 ngày sau ngày cuối quý. Trên Postgres thật:
 * chạy song song không bù hai lần, và bù chạy cùng lúc với thu hồi (trả/huỷ đơn) thì tổng thưởng còn giữ luôn bằng
 * bonus(doanh số đã chốt). Mỗi ca dùng một quý riêng trong quá khứ xa (các spec khác dùng 2024–2025) vì bước bù quét
 * mọi đại lý trong DB.
 */
const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];

type TopUpResult = { toppedUp: number; quarters: string[] };

describe('Trả bù thưởng quý cho đơn chốt muộn (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let reversal: OrderReversalService;
  const topUp = (now: Date) => (dealer as unknown as { topUpQuarterlyBonuses(n: Date): Promise<TopUpResult> }).topUpQuarterlyBonuses(now);

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
    await setConfig(prisma, 'dealer.bonus_topup_window_days', 60);
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

  /**
   * Đơn được chốt SAU lần trả thưởng, vào lúc `at` (giờ mô phỏng, nằm trong cửa sổ trả bù): lên DELIVERED + dòng lịch sử
   * PACKED. Bước bù cắt doanh số ở cuối cửa sổ nên chốt bằng giờ thật (2026) sẽ bị coi là quá hạn.
   */
  async function settleAt(orderId: string, at: Date) {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'DELIVERED', deliveredAt: at } });
    await prisma.orderStatusHistory.create({ data: { orderId, fromStatus: 'CONFIRMED', toStatus: 'PACKED', actorType: 'SYSTEM', createdAt: at } });
  }

  /** payoutQuarterlyBonuses ghi createdAt bằng giờ thật; kéo về giờ mô phỏng để so với giờ chốt đơn trong cùng thời gian giả. */
  async function payoutAt(at: Date) {
    await dealer.payoutQuarterlyBonuses(at);
    await prisma.dealerCreditLedger.updateMany({ where: { refType: 'QUARTER_BONUS', createdAt: { gt: new Date('2026-01-01') } }, data: { createdAt: at } });
  }

  function returnOrder(orderId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
      if (flipped.count === 0) throw new Error(`flip thua ${orderId}`);
      await reversal.reverseFinancials(tx, order);
    });
  }

  const ledgerOf = (userId: string, quarter: string) =>
    prisma.dealerCreditLedger.findMany({
      where: { userId, refType: { startsWith: 'QUARTER_BONUS' }, refId: { startsWith: quarter } },
      orderBy: { createdAt: 'asc' },
    });
  const heldOf = async (userId: string, quarter: string) => -(await ledgerOf(userId, quarter)).reduce((s, r) => s + r.delta, 0);

  it('đơn B chốt sau ngày 10 → bù đúng phần chênh; 4 lượt chạy song song chỉ bù một lần; chạy lại không bù thêm', async () => {
    const QUARTER = 'Q1/2023';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2023-02-10T03:00:00Z'), 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2023-03-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2023-04-12T03:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);

    await settleAt(b.id, new Date('2023-04-15T03:00:00Z'));

    const results = await Promise.all([1, 2, 3, 4].map(() => topUp(new Date('2023-04-20T03:00:00Z'))));
    expect(results.reduce((s, r) => s + r.toppedUp, 0)).toBeGreaterThanOrEqual(1);
    const rows = await ledgerOf(d.id, QUARTER);
    const topups = rows.filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({ delta: -4_800_000, refId: 'Q1/2023:topup:1' });
    expect(topups[0]!.note).toContain('Trả bù thưởng quý Q1/2023');
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);

    await topUp(new Date('2023-04-21T03:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);
  });

  it('bù chạy cùng lúc với trả đơn A (đã tính từ lần đầu) và đơn B (chốt muộn): tổng thưởng giữ luôn bằng bonus(doanh số còn lại)', async () => {
    const QUARTER = 'Q2/2023';
    const d = await createUser(prisma, { role: 'DEALER' });
    const a = await dealerOrder(d.id, 120_000_000, new Date('2023-05-10T03:00:00Z'), 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2023-06-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2023-07-12T03:00:00Z'));
    await settleAt(b.id, new Date('2023-07-15T03:00:00Z'));

    await Promise.all([topUp(new Date('2023-07-20T03:00:00Z')), returnOrder(a.id), topUp(new Date('2023-07-20T03:00:00Z'))]);
    // Chạy thêm một lượt để bắt trường hợp lượt bù chạy trước lần trả A rồi thấy số dư đổi.
    await topUp(new Date('2023-07-21T03:00:00Z'));

    // Còn lại đơn B 90tr → 2% = 1,8tr.
    expect(await heldOf(d.id, QUARTER)).toBe(1_800_000);
  });

  it('bù rồi trả chính đơn chốt muộn → thu hồi đúng khoản đã bù, không thu thêm của đơn khác', async () => {
    const QUARTER = 'Q3/2023';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2023-08-10T03:00:00Z'), 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2023-09-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2023-10-12T03:00:00Z'));
    await settleAt(b.id, new Date('2023-10-15T03:00:00Z'));
    await topUp(new Date('2023-10-20T03:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);

    await sleep(20);
    await returnOrder(b.id);
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);
  });

  it('quá 60 ngày sau ngày cuối quý → không bù; còn trong cửa sổ thì bù', async () => {
    const QUARTER = 'Q4/2022';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2022-11-10T03:00:00Z'), 'DELIVERED', true);
    const b = await dealerOrder(d.id, 90_000_000, new Date('2022-12-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2023-01-12T03:00:00Z'));
    await settleAt(b.id, new Date('2023-01-15T03:00:00Z'));

    await topUp(new Date('2023-03-05T03:00:00Z')); // 64 ngày sau 31/12
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);

    await topUp(new Date('2023-02-28T03:00:00Z')); // 59 ngày sau 31/12 — còn trong cửa sổ
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);
  });

  it('admin đổi bậc thưởng sau ngày 10 + đơn chốt muộn, 4 lượt song song: chỉ bù phần biên của đơn muộn theo bản chụp bậc lúc trả, một lần', async () => {
    const QUARTER = 'Q1/2022';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2022-02-10T03:00:00Z'), 'DELIVERED', true);
    const b = await dealerOrder(d.id, 30_000_000, new Date('2022-03-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2022-04-12T03:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);

    const newTiers = [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 5 }];
    // setConfig ghi thẳng DB, bỏ qua cache 60 giây của SystemConfigService (set() mới xoá cache) nên phải xoá tay.
    const dropTiersCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.delete('dealer.quarterly_bonus_tiers');
    await setConfig(prisma, 'dealer.quarterly_bonus_tiers', newTiers);
    dropTiersCache();
    try {
      // Chưa có đơn chốt muộn: đổi bậc một mình không sinh khoản bù.
      await topUp(new Date('2022-04-18T03:00:00Z'));
      expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);

      await settleAt(b.id, new Date('2022-04-19T03:00:00Z'));
      await Promise.all([1, 2, 3, 4].map(() => topUp(new Date('2022-04-20T03:00:00Z'))));
      const topups = (await ledgerOf(d.id, QUARTER)).filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
      expect(topups).toHaveLength(1);
      // Bản chụp 2/3/4%: bonus(150tr) = 4,5tr, bonus(120tr) = 3,6tr → biên 0,9tr (bảng mới 3/5% sẽ cho 1,5tr).
      expect(topups[0]).toMatchObject({ delta: -900_000 });
    } finally {
      await setConfig(prisma, 'dealer.quarterly_bonus_tiers', TIERS);
      dropTiersCache();
    }
  });

  it('lượt quét thêm sau hạn: dòng bù có createdAt = hạn cửa sổ → đơn chốt sau hạn không bị thu hồi oan, đơn được tính vẫn bị thu 4,8tr', async () => {
    const QUARTER = 'Q1/2021';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2021-02-10T03:00:00Z'), 'DELIVERED', true);
    const late = await dealerOrder(d.id, 90_000_000, new Date('2021-03-28T03:00:00Z'), 'CONFIRMED', true);
    const afterExpiry = await dealerOrder(d.id, 500_000_000, new Date('2021-03-29T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2021-04-12T03:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);

    // Hạn cửa sổ = 00:00 31/5 giờ VN = 30/5 17:00Z. Đơn late chốt 06:00 ngày 30/5 giờ VN; đơn afterExpiry chốt 01:00 ngày 31/5.
    await settleAt(late.id, new Date('2021-05-29T23:00:00Z'));
    await settleAt(afterExpiry.id, new Date('2021-05-30T18:00:00Z'));

    await Promise.all([1, 2, 3, 4].map(() => topUp(new Date('2021-05-30T22:00:00Z')))); // 05:00 ngày 31/5 giờ VN
    const topups = (await ledgerOf(d.id, QUARTER)).filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({ delta: -4_800_000 });
    expect(topups[0]!.createdAt).toEqual(new Date('2021-05-30T17:00:00Z'));
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);

    await sleep(20);
    await returnOrder(afterExpiry.id);
    expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);
    await returnOrder(late.id);
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);
  });

  const dropTiersCache = () => (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.delete('dealer.quarterly_bonus_tiers');
  const payout = (now: Date) => dealer.payoutQuarterlyBonuses(now);
  const snapshotsOf = (quarter: string) => prisma.dealerQuarterBonusTier.findMany({ where: { quarter } });

  it('hai lượt payout và hai lượt bù song song cho cùng quý: đúng một bản chụp, thưởng trả đúng một lần', async () => {
    const QUARTER = 'Q2/2022';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2022-05-10T03:00:00Z'), 'DELIVERED', true);

    await Promise.all([payout(new Date('2022-07-12T03:00:00Z')), payout(new Date('2022-07-12T03:00:00Z')), topUp(new Date('2022-07-20T03:00:00Z')), topUp(new Date('2022-07-20T03:00:00Z'))]);

    const snaps = await snapshotsOf(QUARTER);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.tiers).toEqual(TIERS);
    const rows = (await ledgerOf(d.id, QUARTER)).filter((r) => r.refType !== 'QUARTER_BONUS_ADJ');
    expect(rows).toHaveLength(1);
    expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);
  });

  it('đổi bậc sau ngày 10: bù song song và thu hồi đều theo bản chụp 2/3/4%, không theo bảng mới', async () => {
    const QUARTER = 'Q3/2022';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2022-08-10T03:00:00Z'), 'DELIVERED', true);
    const late = await dealerOrder(d.id, 90_000_000, new Date('2022-09-28T03:00:00Z'), 'CONFIRMED', true);
    await payoutAt(new Date('2022-10-12T03:00:00Z'));
    expect((await snapshotsOf(QUARTER))[0]!.tiers).toEqual(TIERS);

    const newTiers = [{ min: 50_000_000, pct: 3 }, { min: 100_000_000, pct: 5 }, { min: 200_000_000, pct: 6 }];
    await setConfig(prisma, 'dealer.quarterly_bonus_tiers', newTiers);
    dropTiersCache();
    try {
      await settleAt(late.id, new Date('2022-10-15T03:00:00Z'));
      await Promise.all([1, 2, 3, 4].map(() => topUp(new Date('2022-10-20T03:00:00Z'))));
      const topups = (await ledgerOf(d.id, QUARTER)).filter((r) => r.refType === 'QUARTER_BONUS_TOPUP');
      expect(topups).toHaveLength(1);
      expect(topups[0]).toMatchObject({ delta: -4_800_000 });
      expect(await heldOf(d.id, QUARTER)).toBe(8_400_000);

      await sleep(20);
      await returnOrder(late.id);
      expect(await heldOf(d.id, QUARTER)).toBe(3_600_000);
      expect(await snapshotsOf(QUARTER)).toHaveLength(1);
    } finally {
      await setConfig(prisma, 'dealer.quarterly_bonus_tiers', TIERS);
      dropTiersCache();
    }
  });

  it('ngày 10 không chạy: 4 lượt bù song song trả muộn đúng một lần và chụp đúng một bản bậc', async () => {
    const QUARTER = 'Q4/2023';
    const d = await createUser(prisma, { role: 'DEALER' });
    await dealerOrder(d.id, 120_000_000, new Date('2023-11-10T03:00:00Z'), 'DELIVERED', true);

    await Promise.all([1, 2, 3, 4].map(() => topUp(new Date('2024-01-12T03:00:00Z'))));

    const snaps = await snapshotsOf(QUARTER);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.tiers).toEqual(TIERS);
    const rows = await ledgerOf(d.id, QUARTER);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ refType: 'QUARTER_BONUS', delta: -3_600_000 });
  });
});
