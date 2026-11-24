import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createDealer, createOrder, pinConfig, pinDealerOrderRulesOff, randCode, summarize, warmPool } from './helpers';

/**
 * w31-02 trên Postgres THẬT:
 *  - Sổ công nợ (w23-03 #5): 200 dòng gần nhất và tổng sổ đọc chung một snapshot REPEATABLE READ, nên một khoản commit đúng giữa hai câu đọc
 *    không làm `balance` lệch khỏi `entries`. Ca đối chứng chạy cùng trình tự ở READ COMMITTED để chứng minh móc chèn giữa hai câu thật sự chạy.
 *  - "Đặt lại đơn tháng trước": gộp đơn đã nhận của tháng trước, kiểm trước hạn mức; nhiều lần bấm đồng thời (khác khoá) không vượt hạn mức,
 *    bấm đúp cùng khoá chỉ tạo một đơn.
 */

// Tên sản phẩm chỉ chữ cái, không có `x`: chữ số trong tên làm sản phẩm bị đọc là gói nhiều món ở spec catalog dùng chung DB.
const LETTERS = 'abcdefghijklmnopqrstuvwyz';
const letters = (n = 8) => Array.from(randomBytes(n), (b) => LETTERS[b % LETTERS.length]).join('');

type LedgerTx = { dealerCreditLedger: { findMany: (a: unknown) => Promise<unknown>; aggregate: (a: unknown) => Promise<unknown> } };

describe('w31-02: snapshot sổ công nợ và đặt lại đơn tháng trước (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let dealer: DealerService;
  let restoreRules: () => Promise<void>;
  let variationId: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        DealerService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    restoreRules = await pinDealerOrderRulesOff(prisma);
    dealer = moduleRef.get(DealerService);

    const tag = letters();
    const product = await prisma.product.create({
      data: {
        pancakeId: `it-p-${tag}`,
        brand: 'IT Brand',
        slug: `it-sp-${tag}`,
        name: `SP IT ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        thumbnail: `https://img.test/${tag}.jpg`,
      },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: 100_000 },
    });
    variationId = v.id;
  });

  afterAll(async () => {
    await restoreRules?.();
    await moduleRef?.close();
  });

  const tierWithLimit = async (creditLimit: number) => {
    const id = `it-tier-${randCode(6)}`;
    await prisma.dealerTier.create({ data: { id, name: 'IT', minOrderVolume: 0, discountRules: { default: 0.2 }, creditLimit } });
    return id;
  };
  const ledgerSum = async (userId: string) => (await prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } }))._sum.delta ?? 0;

  /**
   * Chạy `fn` với `$transaction` được móc: ngay sau khi câu `findMany` của sổ công nợ trong transaction trả về, `between` chạy và COMMIT trên
   * một kết nối khác (autocommit) trước khi câu kế tiếp chạy.
   */
  async function withCommitBetweenReads<T>(between: () => Promise<unknown>, fn: () => Promise<T>): Promise<T> {
    const real = prisma.$transaction.bind(prisma) as (cb: (tx: unknown) => Promise<unknown>, opts?: unknown) => Promise<unknown>;
    const spy = jest.spyOn(prisma, '$transaction').mockImplementation(((cb: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
      real(
        (tx) =>
          cb(
            new Proxy(tx as LedgerTx, {
              get(target, prop, recv) {
                if (prop !== 'dealerCreditLedger') return Reflect.get(target, prop, recv);
                const model = target.dealerCreditLedger;
                return {
                  findMany: async (a: unknown) => {
                    const rows = await model.findMany(a);
                    await between();
                    return rows;
                  },
                  aggregate: (a: unknown) => model.aggregate(a),
                };
              },
            }),
          ),
        opts,
      )) as never);
    try {
      return await fn();
    } finally {
      spy.mockRestore();
    }
  }

  it('khoản ghi commit đúng giữa hai câu đọc: balance vẫn bằng tổng các dòng trả về (cùng snapshot), lần đọc sau mới thấy khoản đó', async () => {
    const d = await createDealer(prisma);
    for (const delta of [400_000, -100_000, 250_000]) {
      await prisma.dealerCreditLedger.create({ data: { userId: d.id, delta, refType: 'ORDER', refId: `it-${randCode(8)}`, note: 'IT' } });
    }
    const insertPayment = () =>
      prisma.dealerCreditLedger.create({ data: { userId: d.id, delta: -50_000, refType: 'PAYMENT', refId: `it-mid-${randCode(8)}`, note: 'Ghi giữa hai câu đọc' } });

    const ledger = await withCommitBetweenReads(insertPayment, () => dealer.creditLedger(d.id));
    const sumEntries = ledger.entries.reduce((s, e) => s + e.delta, 0);
    console.log('[w31-02] snapshot entries=%d sum=%d balance=%d', ledger.entries.length, sumEntries, ledger.balance);
    expect(ledger.entries).toHaveLength(3);
    expect(ledger.balance).toBe(sumEntries);
    expect(ledger.balance).toBe(550_000);

    const after = await dealer.creditLedger(d.id);
    expect(after.entries).toHaveLength(4);
    expect(after.balance).toBe(500_000);
  });

  it('đối chứng READ COMMITTED: cùng trình tự hai câu đọc thì tổng sổ thấy khoản vừa commit còn danh sách thì không (lỗi cũ của #5)', async () => {
    const d = await createDealer(prisma);
    await prisma.dealerCreditLedger.create({ data: { userId: d.id, delta: 300_000, refType: 'ORDER', refId: `it-${randCode(8)}`, note: 'IT' } });
    const insertPayment = () =>
      prisma.dealerCreditLedger.create({ data: { userId: d.id, delta: -50_000, refType: 'PAYMENT', refId: `it-mid-${randCode(8)}`, note: 'Ghi giữa hai câu đọc' } });

    const skewed = await withCommitBetweenReads(insertPayment, () =>
      prisma.$transaction(async (tx) => {
        const entries = await tx.dealerCreditLedger.findMany({ where: { userId: d.id }, orderBy: { createdAt: 'desc' }, take: 200 });
        const agg = await tx.dealerCreditLedger.aggregate({ where: { userId: d.id }, _sum: { delta: true } });
        return { balance: agg._sum.delta ?? 0, entries };
      }),
    );
    expect(skewed.entries.reduce((s, e) => s + e.delta, 0)).toBe(300_000);
    expect(skewed.balance).toBe(250_000);
  });

  /** Đại lý có bậc hạn mức `limit` và một đơn đã giao ngày 15/10/2026 giờ VN: `quantity` × 80.000đ (giá lẻ 100.000đ, chiết khấu 20%). */
  const dealerWithOctoberOrder = async (limit: number, quantity: number) => {
    const d = await createDealer(prisma, { metadata: { dealerTierId: await tierWithLimit(limit) } });
    await createOrder(prisma, {
      userId: d.id,
      type: 'DEALER',
      status: 'DELIVERED',
      paymentMethod: 'BANK_TRANSFER',
      createdAt: new Date('2026-10-15T03:00:00Z'),
      total: quantity * 80_000,
      items: {
        create: [
          { variationId, productName: 'SP IT', productSlug: 'sp-it', variationName: 'Mặc định', unitPrice: 100_000, quantity, total: quantity * 100_000, paidTotal: quantity * 80_000 },
        ],
      },
    });
    return d;
  };
  const NOW = new Date('2026-11-24T05:00:00Z');

  it('xem trước rồi đặt: một đơn CREDIT đúng dòng, đúng tổng, sổ công nợ ghi đúng số; dấu cũ sau khi giá đổi nhận 409', async () => {
    const d = await dealerWithOctoberOrder(10_000_000, 3);
    const preview = await dealer.lastMonthReorder(d.id, NOW);
    expect(preview).toMatchObject({ month: '10/2026', goodsTotal: 240_000, total: 240_000, block: null, credit: { limit: 10_000_000, debt: 0, available: 10_000_000, after: 9_760_000 } });
    expect(preview.lines).toEqual([expect.objectContaining({ variationId, quantity: 3, unitPrice: 80_000 })]);

    const order = await dealer.placeLastMonthReorder(d.id, preview.quote, `it-key-${randCode(8)}`, NOW);
    expect(order).toMatchObject({ status: 'CONFIRMED', total: 240_000 });
    expect(order.items.map((it) => [it.variationId, it.quantity])).toEqual([[variationId, 3]]);
    expect(await ledgerSum(d.id)).toBe(240_000);

    await prisma.variation.update({ where: { id: variationId }, data: { retailPrice: 110_000 } });
    try {
      await expect(dealer.placeLastMonthReorder(d.id, preview.quote, `it-key-${randCode(8)}`, NOW)).rejects.toBeInstanceOf(ConflictException);
      expect(await prisma.order.count({ where: { userId: d.id, type: 'DEALER', createdAt: { gte: new Date('2026-11-01T00:00:00Z') } } })).toBe(1);
    } finally {
      await prisma.variation.update({ where: { id: variationId }, data: { retailPrice: 100_000 } });
    }
  });

  it('hạn mức 400.000đ, đơn tháng trước 240.000đ: 6 lần bấm đồng thời khác khoá → đúng một đơn, nợ ≤ hạn mức, mọi lỗi là chặn vượt hạn mức hoặc 503', async () => {
    const d = await dealerWithOctoberOrder(400_000, 3);
    const { quote } = await dealer.lastMonthReorder(d.id, NOW);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => dealer.placeLastMonthReorder(d.id, quote, `it-key-${randCode(8)}`, NOW)));
    const s = summarize(results);
    const unexpected = s.rejected.filter(
      (r) =>
        !(r.reason instanceof ServiceUnavailableException) &&
        !(r.reason instanceof BadRequestException && /hạn mức công nợ/i.test(r.reason.message)),
    );
    const debt = await ledgerSum(d.id);
    console.log('[w31-02] concurrent reorder fulfilled=%d rejected=%d debt=%d errors=%j', s.fulfilled.length, s.rejected.length, debt, s.errors);
    expect(unexpected).toEqual([]);
    expect(s.fulfilled).toHaveLength(1);
    expect(debt).toBe(240_000);
    expect(debt).toBeLessThanOrEqual(400_000);
  });

  it('bấm đúp cùng Idempotency-Key (4 lần đồng thời), hạn mức chỉ đủ một đơn: một đơn, nợ ghi một lần, không lần nào bị báo vượt hạn mức', async () => {
    const d = await dealerWithOctoberOrder(300_000, 2);
    const { quote } = await dealer.lastMonthReorder(d.id, NOW);
    const key = `it-key-${randCode(8)}`;
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => dealer.placeLastMonthReorder(d.id, quote, key, NOW)));
    const s = summarize(results);
    const unexpected = s.rejected.filter((r) => !(r.reason instanceof ServiceUnavailableException));
    console.log('[w31-02] same-key fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, s.errors);
    expect(unexpected).toEqual([]);
    expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(new Set(s.fulfilled.map((r) => r.value.code)).size).toBe(1);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await ledgerSum(d.id)).toBe(160_000);
    // Bấm lại sau đó (mạng báo lỗi lần trước): trả lại đúng đơn đó dù bản xem mới đã tính cả khoản nợ vừa ghi.
    await expect(dealer.placeLastMonthReorder(d.id, quote, key, NOW)).resolves.toMatchObject({ code: s.fulfilled[0]!.value.code });
  });

  it('giá đổi đúng lúc sau khi dấu đã khớp, trước khi placeOrder đọc giá: 409 với tổng mới, không tạo đơn, không ghi nợ', async () => {
    const d = await dealerWithOctoberOrder(10_000_000, 3);
    const { quote } = await dealer.lastMonthReorder(d.id, NOW);
    const original = dealer.lastMonthReorder.bind(dealer);
    const spy = jest.spyOn(dealer, 'lastMonthReorder').mockImplementation(async (...args: Parameters<DealerService['lastMonthReorder']>) => {
      const preview = await original(...args);
      await prisma.variation.update({ where: { id: variationId }, data: { retailPrice: 110_000 } });
      return preview;
    });
    try {
      const err = await dealer.placeLastMonthReorder(d.id, quote, `it-key-${randCode(8)}`, NOW).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({ code: 'DEALER_REORDER_CHANGED' });
      expect((err as ConflictException).message).toContain(`tổng mới là ${(3 * 88_000).toLocaleString('vi-VN')}đ`);
      expect(await prisma.order.count({ where: { userId: d.id, createdAt: { gte: new Date('2026-11-01T00:00:00Z') } } })).toBe(0);
      expect(await ledgerSum(d.id)).toBe(0);
    } finally {
      spy.mockRestore();
      await prisma.variation.update({ where: { id: variationId }, data: { retailPrice: 100_000 } });
    }
  });

  it('có phí giao (tiền hàng dưới ngưỡng miễn phí): tổng bản xem trước = tổng đơn tạo ra = khoản nợ ghi sổ', async () => {
    const config = moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> };
    const restores = [
      await pinConfig(prisma, 'dealer.free_ship_threshold_vnd', 5_000_000),
      await pinConfig(prisma, 'dealer.shipping_fee_below_threshold_vnd', 30_000),
    ];
    config.cache.clear();
    try {
      const d = await dealerWithOctoberOrder(10_000_000, 3);
      const preview = await dealer.lastMonthReorder(d.id, NOW);
      expect(preview).toMatchObject({ goodsTotal: 240_000, shippingFee: 30_000, total: 270_000, block: null, credit: { after: 9_730_000 } });
      const order = await dealer.placeLastMonthReorder(d.id, preview.quote, `it-key-${randCode(8)}`, NOW);
      expect(order).toMatchObject({ total: 270_000, shippingFee: 30_000 });
      expect(await ledgerSum(d.id)).toBe(270_000);
    } finally {
      for (const restore of restores.reverse()) await restore();
      config.cache.clear();
    }
  });
});
