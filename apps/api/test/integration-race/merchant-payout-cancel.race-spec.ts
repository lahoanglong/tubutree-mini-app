import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { MerchantFulfilmentService } from '../../src/modules/merchant/merchant-fulfilment.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * R4-PARTNER-4/5 trên Postgres THẬT: huỷ phiếu đối soát giữ dấu vết (ghi chú lúc lập không bị đè, lý do + người huỷ + ảnh chụp
 * dòng), báo gian hàng đúng một lần, không xoá lặng lẽ; huỷ đua với đánh dấu đã chuyển / huỷ lần hai / lập phiếu lại không
 * làm mất hay nhân đôi tiền.
 */
describe('Huỷ phiếu đối soát giữ dấu vết và báo gian hàng (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let settlement: MerchantFulfilmentService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        MerchantFulfilmentService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    await setConfig(prisma, 'merchant.settlement_hold_days', 7);
    await setConfig(prisma, 'merchant.commission_pct', 0.15);
    await setConfig(prisma, 'merchant.negative_payout_due_days', 7);
    await setConfig(prisma, 'merchant.consignment_settle_from', '2000-01-01T00:00:00Z');
    settlement = moduleRef.get(MerchantFulfilmentService);
  });

  beforeEach(() => notify.mockClear());

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function shop() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itpc-${tag}`, title: `Gian hàng ${tag}`, ownerUserId: owner.id, commissionPct: 0.1 },
    });
    const product = await prisma.product.create({
      data: {
        storefrontId: store.id,
        fulfilment: 'TUBU',
        brand: 'IT',
        slug: `itpc-p-${tag}`,
        name: `Sản phẩm ${tag}`,
        description: 'IT',
        basePrice: 100_000,
        variations: { create: { sku: `ITPC-${tag}`, pancakeId: `itpc-${tag}`, name: 'Hũ', attributes: {}, retailPrice: 100_000, stock: 40 } },
      },
      include: { variations: true },
    });
    await prisma.merchantPancakeLink.create({
      data: { storefrontId: store.id, productId: product.id, variationId: product.variations[0]!.id, linkedAt: ago(60) },
    });
    return { owner, store, v: product.variations[0]! };
  }

  /** Hai đơn kho Tubu giao hộ (một đơn hai món) đủ hạn đối soát. */
  async function delivered(s: Awaited<ReturnType<typeof shop>>, quantity = 1) {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    return createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      fulfiller: 'TUBU',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      subtotal: 100_000 * quantity,
      total: 100_000 * quantity,
      deliveredAt: ago(10),
      createdAt: ago(12),
      items: {
        create: { variationId: s.v.id, productName: 'Mật ong', variationName: 'Hũ', unitPrice: 100_000, quantity, total: 100_000 * quantity },
      },
    });
  }

  /** Đơn tự giao COD: phí sàn đơn COD gian hàng đã thu tiền → phiếu âm. */
  async function codSelfShip(s: Awaited<ReturnType<typeof shop>>) {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    return createOrder(prisma, {
      userId: buyer.id,
      status: 'DELIVERED',
      deliveredAt: ago(10),
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: s.store.id,
      merchantCommissionPct: 0.1,
      paymentMethod: 'COD',
      paymentStatus: 'PAID',
      subtotal: 100_000,
      total: 100_000,
      items: { create: { variationId: s.v.id, productName: 'Hũ tự giao', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 } },
    });
  }

  it('huỷ phiếu: ghi chú lúc lập giữ nguyên, lý do + người huỷ + ảnh chụp dòng được lưu, đơn quay lại bảng kê, gian hàng được báo', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    const o1 = await delivered(s, 2);
    const o2 = await delivered(s);
    const payout = await settlement.createPayout(admin.id, s.store.id, 'Kỳ đầu tháng 10');
    expect(payout.lines).toHaveLength(2);
    expect(notify).toHaveBeenLastCalledWith(s.owner.id, 'MERCHANT_PAYOUT_CREATED', { amount: payout.amount.toLocaleString('vi-VN'), count: '2' });
    notify.mockClear();

    const cancelled = await settlement.cancelPayout(admin.id, payout.id, 'Sai tài khoản nhận, lập lại sau khi gian hàng sửa');

    const row = await prisma.merchantPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(row).toMatchObject({
      status: 'CANCELLED',
      note: 'Kỳ đầu tháng 10',
      cancelledBy: admin.id,
      cancelReason: 'Sai tài khoản nhận, lập lại sau khi gian hàng sửa',
      amount: payout.amount,
    });
    expect(row.cancelledAt).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain('Huỷ bởi');
    expect(await prisma.merchantPayoutLine.count({ where: { payoutId: payout.id } })).toBe(0);
    expect(row.cancelSnapshot).toMatchObject({ lineCount: 2, orderCount: 2 });

    // Màn hình vẫn thấy phiếu đã huỷ gồm những khoản nào.
    expect(cancelled.lines.map((l) => l.orderCode).sort()).toEqual([o1.code, o2.code].sort());
    expect(cancelled.lines.reduce((sum, l) => sum + l.netAmount, 0)).toBe(payout.amount);
    const mine = await settlement.myStatement(s.owner.id);
    const shown = mine.payouts.find((p) => p.id === payout.id)!;
    expect(shown).toMatchObject({ status: 'CANCELLED', cancelReason: 'Sai tài khoản nhận, lập lại sau khi gian hàng sửa', cancelledLineCount: 2 });
    expect(shown.lines).toHaveLength(2);
    expect(JSON.stringify(shown)).not.toContain(admin.id);
    expect(shown).not.toHaveProperty('cancelledBy');
    expect(shown).not.toHaveProperty('createdBy');
    expect(shown.lines.find((l) => l.orderCode === o1.code)!.item).toMatchObject({ productName: 'Mật ong', quantity: 2 });

    // Các đơn quay lại bảng kê.
    expect((await settlement.statementFor(s.store.id)).lines.map((l) => l.orderId).sort()).toEqual([o1.id, o2.id].sort());

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(s.owner.id, 'MERCHANT_PAYOUT_CANCELLED', {
      amount: payout.amount.toLocaleString('vi-VN'),
      created: expect.stringMatching(/^\d{1,2}\/\d{1,2}\/\d{4}$/),
      reason: 'Sai tài khoản nhận, lập lại sau khi gian hàng sửa',
    });
  });

  it('huỷ rồi lập lại: dòng vào phiếu mới đúng một lần, ảnh chụp phiếu huỷ còn nguyên, tổng tiền không nhân đôi', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    await delivered(s);
    await delivered(s);
    const first = await settlement.createPayout(admin.id, s.store.id);
    await settlement.cancelPayout(admin.id, first.id, 'Lập thử');
    const second = await settlement.createPayout(admin.id, s.store.id);
    expect(second.amount).toBe(first.amount);
    expect(second.lines).toHaveLength(2);
    const [cancelled, live] = await Promise.all([
      prisma.merchantPayout.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.merchantPayoutLine.count({ where: { payout: { storefrontId: s.store.id, status: { not: 'CANCELLED' } } } }),
    ]);
    expect(live).toBe(2);
    expect(cancelled.cancelSnapshot).toMatchObject({ lineCount: 2 });
    await expect(settlement.createPayout(admin.id, s.store.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('phiếu âm: báo gian hàng nộp lại Tubu kèm hạn và nội dung chuyển khoản; huỷ báo "chưa cần nộp", không in số âm', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    await codSelfShip(s);
    const payout = await settlement.createPayout(admin.id, s.store.id);
    expect(payout.amount).toBeLessThan(0);
    expect(notify).toHaveBeenLastCalledWith(s.owner.id, 'MERCHANT_PAYOUT_CREATED_TO_TUBU', {
      amount: (-payout.amount).toLocaleString('vi-VN'),
      count: '1',
      due_date: expect.stringMatching(/^\d{1,2}\/\d{1,2}\/\d{4}$/),
      memo: `TUBU DS ${payout.id.slice(-8).toUpperCase()}`,
    });
    notify.mockClear();
    await settlement.cancelPayout(admin.id, payout.id, 'Lập nhầm kỳ');
    expect(notify).toHaveBeenCalledWith(s.owner.id, 'MERCHANT_PAYOUT_CANCELLED_TO_TUBU', {
      amount: (-payout.amount).toLocaleString('vi-VN'),
      created: expect.any(String),
      reason: 'Lập nhầm kỳ',
    });
  });

  it('hai admin cùng huỷ một phiếu: một lần thành công, một lần 409; gian hàng chỉ nhận một thông báo huỷ', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    for (let round = 0; round < 4; round++) {
      notify.mockClear();
      const s = await shop();
      await delivered(s);
      const payout = await settlement.createPayout(admin.id, s.store.id);
      notify.mockClear();
      const raced = summarize(
        await Promise.allSettled([
          settlement.cancelPayout('admin-a', payout.id, 'Lý do A'),
          settlement.cancelPayout('admin-b', payout.id, 'Lý do B'),
          settlement.cancelPayout('admin-c', payout.id, 'Lý do C'),
        ]),
      );
      expect(raced.fulfilled).toHaveLength(1);
      expect(raced.rejected.every((r) => r.reason instanceof ConflictException)).toBe(true);
      const row = await prisma.merchantPayout.findUniqueOrThrow({ where: { id: payout.id } });
      expect(row.status).toBe('CANCELLED');
      expect(['admin-a', 'admin-b', 'admin-c']).toContain(row.cancelledBy);
      expect(row.cancelReason).toBe(`Lý do ${row.cancelledBy!.slice(-1).toUpperCase()}`);
      expect(row.cancelSnapshot).toMatchObject({ lineCount: 1 });
      expect(notify.mock.calls.filter((c) => c[1] === 'MERCHANT_PAYOUT_CANCELLED')).toHaveLength(1);
    }
  });

  it('huỷ đua với đánh dấu đã chuyển: đúng một bên thắng; thắng huỷ thì không có thông báo đã chuyển, thắng chuyển thì dòng còn nguyên', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    for (let round = 0; round < 6; round++) {
      const s = await shop();
      await delivered(s);
      await delivered(s);
      const payout = await settlement.createPayout(admin.id, s.store.id);
      notify.mockClear();
      const raced = summarize(
        await Promise.allSettled(
          round % 2 === 0
            ? [settlement.cancelPayout(admin.id, payout.id, 'Huỷ vì sai số'), settlement.markPayoutPaid(admin.id, payout.id, `FT${round}`)]
            : [settlement.markPayoutPaid(admin.id, payout.id, `FT${round}`), settlement.cancelPayout(admin.id, payout.id, 'Huỷ vì sai số')],
        ),
      );
      expect(raced.fulfilled).toHaveLength(1);
      expect(raced.rejected).toHaveLength(1);
      const row = await prisma.merchantPayout.findUniqueOrThrow({ where: { id: payout.id } });
      const lineCount = await prisma.merchantPayoutLine.count({ where: { payoutId: payout.id } });
      const sent = notify.mock.calls.map((c) => c[1]);
      if (row.status === 'PAID') {
        expect(lineCount).toBe(2);
        expect(row.cancelledAt).toBeNull();
        expect(row.cancelReason).toBeNull();
        expect(sent).toEqual(['MERCHANT_PAYOUT_PAID']);
      } else {
        expect(row.status).toBe('CANCELLED');
        expect(lineCount).toBe(0);
        expect(row.cancelSnapshot).toMatchObject({ lineCount: 2 });
        expect(row.paidAt).toBeNull();
        expect(sent).toEqual(['MERCHANT_PAYOUT_CANCELLED']);
      }
    }
  });

  it('huỷ phiếu đã chuyển hoặc không tồn tại → 409; thiếu lý do → 400 và phiếu giữ nguyên', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    await delivered(s);
    const payout = await settlement.createPayout(admin.id, s.store.id);
    await expect(settlement.cancelPayout(admin.id, payout.id, '   ')).rejects.toBeInstanceOf(BadRequestException);
    expect((await prisma.merchantPayout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe('PENDING');
    expect(await prisma.merchantPayoutLine.count({ where: { payoutId: payout.id } })).toBe(1);
    await settlement.markPayoutPaid(admin.id, payout.id, 'FT-OK');
    await expect(settlement.cancelPayout(admin.id, payout.id, 'Muộn rồi')).rejects.toBeInstanceOf(ConflictException);
    await expect(settlement.cancelPayout(admin.id, 'khong-co', 'Muộn rồi')).rejects.toBeInstanceOf(ConflictException);
    expect(await prisma.merchantPayoutLine.count({ where: { payoutId: payout.id } })).toBe(1);
  });

  it('phiếu huỷ trước khi có cột mới (ghi chú "Huỷ bởi <id>", chưa có ảnh chụp) vẫn đọc được, không lỗi', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    const old = await prisma.merchantPayout.create({
      data: { storefrontId: s.store.id, amount: 50_000, status: 'CANCELLED', createdBy: admin.id, note: null },
    });
    const mine = await settlement.myStatement(s.owner.id);
    expect(mine.payouts.find((p) => p.id === old.id)).toMatchObject({ status: 'CANCELLED', lines: [], cancelledLineCount: null });
    const list = await settlement.listPayouts(s.store.id);
    expect(list.data.find((p) => p.id === old.id)).toMatchObject({ status: 'CANCELLED', lines: [] });
  });

  it('gian hàng có từ 10 phiếu huỷ kiểu cũ (cancelledAt NULL sau backfill) vẫn thấy phiếu vừa bị huỷ', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const s = await shop();
    const legacy = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        prisma.merchantPayout.create({
          data: { storefrontId: s.store.id, amount: 10_000 + i, status: 'CANCELLED', createdBy: admin.id, cancelledBy: admin.id, createdAt: ago(40 + i) },
        }),
      ),
    );
    await delivered(s);
    const payout = await settlement.createPayout(admin.id, s.store.id);
    await settlement.cancelPayout(admin.id, payout.id, 'Sai số tài khoản');

    const mine = await settlement.myStatement(s.owner.id);
    const cancelled = mine.payouts.filter((p) => p.status === 'CANCELLED');
    expect(cancelled.find((p) => p.id === payout.id)).toMatchObject({ cancelReason: 'Sai số tài khoản', cancelledLineCount: 1 });
    expect(cancelled).toHaveLength(10);
    // Phiếu cũ không có mốc huỷ thì xếp theo ngày lập, mới trước.
    const shownLegacy = cancelled.filter((p) => p.id !== payout.id).map((p) => p.id);
    expect(shownLegacy).toEqual(legacy.slice(0, 9).map((p) => p.id));
  });
});
