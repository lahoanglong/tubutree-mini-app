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
import { createOrder, createUser, setConfig, sleep, summarize, warmPool } from './helpers';

/**
 * Thưởng doanh số quý đại lý trên Postgres THẬT: trả thưởng (payoutQuarterlyBonuses) và thu hồi
 * phần biên khi đơn bị trả (OrderReversalService.reverseFinancials → clawbackQuarterBonusForOrder)
 * chạy đồng thời. Chỉ stub thông báo / Pancake / flash-sale / coupon (không dùng tới).
 *
 * Mỗi test dùng 1 QUÝ RIÊNG trong quá khứ (payoutQuarterlyBonuses quét MỌI đại lý trong DB; đại lý
 * của file khác chỉ có đơn ở quý hiện tại nên thưởng 0 và bị bỏ qua).
 */
const TIERS = [
  { min: 50_000_000, pct: 2 },
  { min: 100_000_000, pct: 3 },
  { min: 200_000_000, pct: 4 },
];

describe('Dealer quarterly bonus clawback / payout race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let reversal: OrderReversalService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        OrderReversalService,
        { provide: NotificationsService, useValue: { notify } },
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
    // Config PHẢI có trước lần get() đầu (SystemConfigService cache 60s).
    await setConfig(prisma, 'dealer.quarterly_bonus_tiers', TIERS);
  });

  afterAll(async () => {
    // Để các lần kiểm tra "đã commit chưa" của notifyBonusAdjustedAfterCommit (1s) chạy xong trước khi đóng pool.
    await sleep(1500);
    await moduleRef?.close();
  });

  // Chỉ khôi phục spy clawback — KHÔNG restoreAllMocks (sẽ xoá luôn implementation của `notify`).
  let clawSpy: jest.SpyInstance | undefined;
  afterEach(() => {
    clawSpy?.mockRestore();
    clawSpy = undefined;
  });

  /** Đơn đại lý đã giao trong quý cần test. credit=true → "Ghi công nợ" (UNPAID + dòng ledger ORDER). */
  async function dealerOrder(userId: string, total: number, createdAt: Date, credit: boolean) {
    const o = await createOrder(prisma, {
      userId,
      type: 'DEALER',
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: credit ? 'UNPAID' : 'PAID',
      total,
      subtotal: total,
      createdAt,
      deliveredAt: createdAt,
    });
    if (credit) {
      await prisma.dealerCreditLedger.create({
        data: { userId, delta: total, refType: 'ORDER', refId: o.id, note: `Đơn ${o.code}` },
      });
    }
    return o;
  }

  /** Duyệt trả hàng như AdminService.reviewReturn: đọc đơn trong tx → lật DELIVERED→RETURNED → reverseFinancials. */
  function returnOrder(orderId: string) {
    return prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      const flipped = await tx.order.updateMany({ where: { id: orderId, status: 'DELIVERED' }, data: { status: 'RETURNED' } });
      if (flipped.count === 0) throw new Error(`flip thua ${orderId}`);
      await reversal.reverseFinancials(tx, order);
    });
  }

  /** Thưởng còn giữ của quý = -(QUARTER_BONUS + Σ QUARTER_BONUS_ADJ). */
  async function ledgerOf(userId: string, quarter: string) {
    const [bonus, adj] = await Promise.all([
      prisma.dealerCreditLedger.findMany({ where: { userId, refType: 'QUARTER_BONUS', refId: quarter } }),
      prisma.dealerCreditLedger.findMany({ where: { userId, refType: 'QUARTER_BONUS_ADJ', refId: { startsWith: `${quarter}:` } } }),
    ]);
    const held = -(bonus.reduce((s, r) => s + r.delta, 0) + adj.reduce((s, r) => s + r.delta, 0));
    return { bonus, adj, held };
  }

  /** Cho N lần gọi clawback đầu tiên chờ nhau (tất cả tx đã lật trạng thái, CHƯA commit) rồi mới chạy thật. */
  function gateClawbacks(n: number) {
    const original = dealer.clawbackQuarterBonusForOrder.bind(dealer);
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    clawSpy = jest.spyOn(dealer, 'clawbackQuarterBonusForOrder').mockImplementation(async (...args) => {
      if (++arrived === n) release();
      await gate;
      return original(...args);
    });
  }

  it('(f) 2 reversals ĐỒNG THỜI cùng quý (đơn ghi công nợ) → tổng thu hồi đúng bonus(V) − bonus(V − a − b), không trùng', async () => {
    const QUARTER = 'Q4/2025';
    const IN_Q = new Date('2025-11-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    const a = await dealerOrder(d.id, 30_000_000, IN_Q, true);
    const b = await dealerOrder(d.id, 30_000_000, IN_Q, true);
    await dealerOrder(d.id, 60_000_000, IN_Q, true);

    // Ngày 15/01/2026 → trả thưởng Q4/2025: 120tr × 3% = 3.6tr.
    await dealer.payoutQuarterlyBonuses(new Date('2026-01-15T03:00:00Z'));
    const paid = await ledgerOf(d.id, QUARTER);
    expect(paid.bonus.map((r) => r.delta)).toEqual([-3_600_000]);

    // Cả 2 tx đều đã lật đơn của mình (chưa commit) trước khi BẤT KỲ bên nào tính thu hồi.
    gateClawbacks(2);
    const results = await Promise.allSettled([returnOrder(a.id), returnOrder(b.id)]);
    const s = summarize(results);
    const after = await ledgerOf(d.id, QUARTER);

    // eslint-disable-next-line no-console
    console.log('[f] fulfilled=%d rejected=%d adj=%j held=%d errors=%j', s.fulfilled.length, s.rejected.length, after.adj.map((r) => [r.refId, r.delta]), after.held, s.errors);

    expect(s.rejected).toHaveLength(0);
    expect(after.adj).toHaveLength(2);
    expect(new Set(after.adj.map((r) => r.refId))).toEqual(new Set([`${QUARTER}:${a.id}`, `${QUARTER}:${b.id}`]));
    // Phần biên telescoping: 120→90 thu 1.8tr, 90→60 thu 0.6tr (thứ tự nào cũng vậy vì a = b).
    expect(after.adj.map((r) => r.delta).sort((x, y) => x - y)).toEqual([600_000, 1_800_000]);
    expect(after.held).toBe(1_200_000); // = 60tr × 2%
    const orders = await prisma.order.findMany({ where: { id: { in: [a.id, b.id] } }, select: { status: true } });
    expect(orders.every((o) => o.status === 'RETURNED')).toBe(true);
    // Công nợ đơn được đảo đúng 1 lần mỗi đơn.
    expect(await prisma.dealerCreditLedger.count({ where: { userId: d.id, refType: 'ORDER_CANCEL' } })).toBe(2);

    // Báo đại lý chỉ SAU commit, đúng 1 lần mỗi khoản thu hồi.
    await sleep(1500);
    const adjusted = notify.mock.calls.filter((c) => c[0] === d.id && c[1] === 'DEALER_BONUS_ADJUSTED');
    expect(adjusted).toHaveLength(2);
  });

  it("(f') 2 reversals đồng thời, đơn TRẢ TRƯỚC đã PAID (hoàn ví) → cùng tổng thu hồi đúng", async () => {
    const QUARTER = 'Q3/2025';
    const IN_Q = new Date('2025-08-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    const a = await dealerOrder(d.id, 30_000_000, IN_Q, false);
    const b = await dealerOrder(d.id, 30_000_000, IN_Q, false);
    await dealerOrder(d.id, 60_000_000, IN_Q, false);

    await dealer.payoutQuarterlyBonuses(new Date('2025-10-15T03:00:00Z'));
    expect((await ledgerOf(d.id, QUARTER)).bonus.map((r) => r.delta)).toEqual([-3_600_000]);

    // Không dùng rào chắn: 2 lần hoàn ví cùng cập nhật dòng users của đại lý nên đã tự xếp hàng ở khoá dòng.
    const results = await Promise.allSettled([returnOrder(a.id), returnOrder(b.id)]);
    const s = summarize(results);
    const after = await ledgerOf(d.id, QUARTER);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: d.id } });

    // eslint-disable-next-line no-console
    console.log("[f'] fulfilled=%d adj=%j held=%d wallet=%d errors=%j", s.fulfilled.length, after.adj.map((r) => r.delta), after.held, user.walletBalance, s.errors);

    expect(s.rejected).toHaveLength(0);
    expect(after.adj.map((r) => r.delta).sort((x, y) => x - y)).toEqual([600_000, 1_800_000]);
    expect(after.held).toBe(1_200_000);
    expect(user.walletBalance).toBe(60_000_000); // hoàn đúng 2 đơn, mỗi đơn 1 lần
  });

  it('(g) payout CHẠY ĐỒNG THỜI với trả hàng → thưởng còn giữ luôn = bonus(doanh số không gồm đơn trả)', async () => {
    const QUARTER = 'Q2/2025';
    const IN_Q = new Date('2025-05-10T03:00:00Z');
    const K = 4;
    const dealers = [] as { id: string; x: string }[];
    for (let i = 0; i < K; i++) {
      const d = await createUser(prisma, { role: 'DEALER' });
      const x = await dealerOrder(d.id, 30_000_000, IN_Q, true);
      await dealerOrder(d.id, 90_000_000, IN_Q, true);
      dealers.push({ id: d.id, x: x.id });
    }
    // 2 đại lý đầu: ép đúng khe nguy hiểm — payout đang giữ transaction của đại lý (đã khoá, SẮP đọc
    // doanh số còn gồm X vì lần trả chưa commit) thì lần trả hàng mới được đi tiếp tới bước thu hồi.
    // Không có khoá chung: lần trả đọc "chưa có dòng thưởng" rồi commit, payout ghi 3.6tr → giữ thưởng
    // trên đơn đã trả. Có khoá: lần trả phải chờ payout commit rồi thu hồi phần biên 1.8tr.
    // 2 đại lý sau: lần trả được thả ngay, tranh khoá tự nhiên với payout.
    const forced = new Set(dealers.slice(0, 2).map((d) => d.id));
    const gates = new Map<string, { open: () => void; opened: Promise<void> }>();
    for (const d of dealers) {
      let open!: () => void;
      const opened = new Promise<void>((r) => (open = r));
      gates.set(d.id, { open, opened });
    }

    const original = dealer.clawbackQuarterBonusForOrder.bind(dealer);
    clawSpy = jest.spyOn(dealer, 'clawbackQuarterBonusForOrder').mockImplementation(async (...args) => {
      await gates.get(args[1].userId)!.opened;
      return original(...args);
    });
    // Chen ĐÚNG khe nguy hiểm của đại lý "forced": payout (đang trong transaction của đại lý) vừa đọc
    // xong doanh số — còn gồm X vì lần trả chưa commit — và CHƯA ghi thưởng. Lúc đó mới thả lần trả
    // đi tiếp tới thu hồi, rồi đợi 200ms trước khi payout ghi. dealerVolume là private: spy qua instance;
    // lượt của clawback có tham số excludeOrderId (thứ 5) nên phân biệt được với payout.
    const d0 = dealer as unknown as {
      dealerVolume: (userId: string, start: Date, end: Date, db?: unknown, excludeOrderId?: string) => Promise<unknown>;
    };
    const originalVolume = d0.dealerVolume.bind(dealer);
    let payoutLocks = 0;
    const volumeSpy = jest.spyOn(d0, 'dealerVolume').mockImplementation(async (userId, start, end, db, excludeOrderId) => {
      const v = await originalVolume(userId, start, end, db, excludeOrderId);
      if (forced.has(userId) && !excludeOrderId) {
        payoutLocks += 1;
        gates.get(userId)!.open();
        await sleep(200);
      }
      return v;
    });

    try {
      const reversals = dealers.map((d) => returnOrder(d.x));
      await sleep(150); // các tx trả hàng đã lật đơn X và đứng chờ ở cổng
      for (const d of dealers) if (!forced.has(d.id)) gates.get(d.id)!.open();
      const payout = dealer.payoutQuarterlyBonuses(new Date('2025-07-15T03:00:00Z'));
      const all: Promise<unknown>[] = [...reversals, payout];
      const results = await Promise.allSettled(all);
      const s = summarize(results);

      const states = [];
      for (const d of dealers) states.push({ forced: forced.has(d.id), ...(await ledgerOf(d.id, QUARTER)) });

      // eslint-disable-next-line no-console
      console.log(
        '[g] fulfilled=%d rejected=%d forcedPayoutFirst=%d perDealer=%j errors=%j',
        s.fulfilled.length,
        s.rejected.length,
        payoutLocks,
        states.map((st) => ({ forced: st.forced, bonus: st.bonus.map((r) => r.delta), adj: st.adj.map((r) => r.delta), held: st.held })),
        s.errors,
      );

      expect(s.rejected).toHaveLength(0);
      expect(payoutLocks).toBe(2);
      for (const st of states) {
        expect(st.bonus).toHaveLength(1); // trả thưởng đúng 1 lần
        expect(st.held).toBe(1_800_000); // 90tr × 2% — dù payout chạy trước hay sau lần trả hàng
        const shape = [st.bonus[0]!.delta, ...st.adj.map((r) => r.delta)];
        if (st.forced) {
          // Payout thắng khoá, đọc doanh số còn gồm X (lần trả chưa commit) → 3.6tr; lần trả chờ rồi thu 1.8tr.
          expect(shape).toEqual([-3_600_000, 1_800_000]);
        } else {
          // Hoặc payout trước (−3.6tr, thu hồi +1.8tr) hoặc trả hàng trước (−1.8tr, không thu hồi).
          expect([JSON.stringify([-3_600_000, 1_800_000]), JSON.stringify([-1_800_000])]).toContain(JSON.stringify(shape));
        }
      }
    } finally {
      volumeSpy.mockRestore();
    }
  });

  it('(h) trả hàng lặp lại / gọi thu hồi lần 2 cho cùng đơn → không thu hồi thêm', async () => {
    const QUARTER = 'Q1/2025';
    const IN_Q = new Date('2025-02-10T03:00:00Z');
    const d = await createUser(prisma, { role: 'DEALER' });
    const a = await dealerOrder(d.id, 30_000_000, IN_Q, true);
    await dealerOrder(d.id, 90_000_000, IN_Q, true);
    await dealer.payoutQuarterlyBonuses(new Date('2025-04-15T03:00:00Z'));
    await returnOrder(a.id);
    const snapshot = await prisma.order.findUniqueOrThrow({ where: { id: a.id } });

    // Gọi lại với ảnh chụp "trước khi trả" (DELIVERED) — 5 lần song song: unique refId chặn trùng.
    const again = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) =>
          dealer.clawbackQuarterBonusForOrder(tx, { ...snapshot, status: 'DELIVERED' }, { paidBeforeReversal: false }),
        ),
      ),
    );
    const s = summarize(again);
    const after = await ledgerOf(d.id, QUARTER);

    // eslint-disable-next-line no-console
    console.log('[h] fulfilled=%d clawed=%j adj=%j errors=%j', s.fulfilled.length, s.fulfilled.map((f) => f.value.clawedBack), after.adj.map((r) => r.delta), s.errors);

    expect(s.rejected).toHaveLength(0);
    expect(s.fulfilled.every((f) => f.value.clawedBack === 0)).toBe(true);
    expect(after.adj.map((r) => r.delta)).toEqual([1_800_000]);
    expect(after.held).toBe(1_800_000);
  });
});
