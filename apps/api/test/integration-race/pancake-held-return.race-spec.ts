import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { OrderReturnsService } from '../../src/modules/orders/order-returns.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import * as attention from '../../src/modules/integrations/pancake/pancake-attention';
import {
  ATTENTION_COD_RETURN_UNVERIFIED,
  ATTENTION_PARTIAL_RETURN_HELD,
  ATTENTION_PARTIAL_RETURN_SETTLED,
} from '../../src/modules/integrations/pancake/pancake-attention';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * Pancake "Hoàn một phần" (15) khi Tubu không có yêu cầu trả, rồi "Đã hoàn" (5): đơn vẫn sang RETURNED, điểm/hoa hồng/kho đảo như cũ, nhưng
 * TIỀN không tự hoàn (nhân viên có thể đã hoàn tay): khoản UNVERIFIED chờ Kế toán, mọi phương thức. Trên Postgres THẬT.
 */
describe('Pancake 15 rồi 5 không có yêu cầu trả: tiền chờ Kế toán (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let refunds: CustomerRefundsService;
  let returns: OrderReturnsService;
  let processor: { onStatusUpdated(data: Record<string, unknown>): Promise<void> };
  const alert = jest.fn().mockResolvedValue(undefined);
  const notify = jest.fn().mockResolvedValue(true);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        CustomerRefundsService,
        OrderReturnsService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            alertPaidCommissionOfReversedOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify, notifySafe: notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orderStatus = moduleRef.get(OrderStatusService);
    refunds = moduleRef.get(CustomerRefundsService);
    returns = moduleRef.get(OrderReturnsService);
    (orderStatus as unknown as { pancakeHooks: unknown }).pancakeHooks = {
      afterLocalCancel: jest.fn().mockResolvedValue(undefined),
      precheckCancel: jest.fn().mockResolvedValue({ kind: 'NONE' }),
    };
    processor = new PancakeProcessor(prisma, moduleRef.get(NotificationsService), orderStatus, { alert } as never) as unknown as typeof processor;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    alert.mockClear();
    notify.mockClear();
    jest.restoreAllMocks();
  });

  const walletOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } })).walletBalance;
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const rowsOf = (orderId: string) => prisma.orderCustomerRefund.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  const PARTIAL = { status: 15 };
  const RETURNED = { status: 5 };

  async function deliveredOrder(paymentMethod: 'BANK_TRANSFER' | 'WALLET' | 'COD', total = 300_000, extra: Record<string, unknown> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'DELIVERED',
      paymentMethod,
      paymentStatus: paymentMethod === 'COD' ? 'UNPAID' : 'PAID',
      total,
      subtotal: total,
      pancakeOrderId: `pk-held-${randCode(8)}`,
      ...extra,
    });
    return { user, order, event: (e: { status: number }) => ({ id: order.pancakeOrderId, ...e }) };
  }

  it('đơn chuyển khoản PAID 300.000đ: 15 rồi 5 → RETURNED, Ví không đổi, paymentStatus còn PAID, một khoản UNVERIFIED đủ tiền, ô có dòng chờ Kế toán, ADMIN được báo một lần', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER');

    await processor.onStatusUpdated(event(PARTIAL));
    await processor.onStatusUpdated(event(RETURNED));

    const after = await orderOf(order.id);
    expect(after.status).toBe('RETURNED');
    expect(after.paymentStatus).toBe('PAID');
    expect(after.pancakeAttention).toBe(ATTENTION_PARTIAL_RETURN_HELD);
    expect(await walletOf(user.id)).toBe(0);
    const rows = await rowsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'RETURN', refKey: 'pancake-partial-return-held', status: 'UNVERIFIED', method: 'MANUAL_TRANSFER', amount: 300_000, userId: user.id });
    expect(alert.mock.calls.filter(([, reason]) => reason === ATTENTION_PARTIAL_RETURN_HELD)).toHaveLength(1);
    // Khách chỉ được báo đơn đã hoàn trả, không được nói "đã hoàn tiền" trước khi Kế toán xác nhận.
    const data = notify.mock.calls.map((c) => c[2] as Record<string, string>).find((d) => d.order_code === order.code)!;
    expect(data.refund_note).toContain('đối soát');
    expect(data.refund_note).not.toContain('Đã hoàn');
  });

  it('đơn COD: 15 rồi 5 → Ví không đổi, khoản COD chờ Kế toán đủ tiền, ô có cả dòng COD và dòng mới', async () => {
    const { user, order, event } = await deliveredOrder('COD');

    await processor.onStatusUpdated(event(PARTIAL));
    await processor.onStatusUpdated(event(RETURNED));

    const after = await orderOf(order.id);
    expect(after.status).toBe('RETURNED');
    expect(after.pancakeAttention).toBe(`${ATTENTION_COD_RETURN_UNVERIFIED} | ${ATTENTION_PARTIAL_RETURN_HELD}`);
    expect(await walletOf(user.id)).toBe(0);
    const rows = await rowsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ refKey: 'cod-return-unverified', status: 'UNVERIFIED', amount: 300_000 });
  });

  it('lời 15 bị nhân viên bấm "Đã xử lý" xoá khỏi ô: dấu vết trong lịch sử đơn vẫn giữ tiền lại khi 5 tới', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
    await processor.onStatusUpdated(event(PARTIAL));
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'PANCAKE', note: { startsWith: attention.PANCAKE_PARTIAL_RETURN_MANUAL_NOTE } } })).toBe(1);
    await processor.onStatusUpdated(event(PARTIAL));
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'PANCAKE', note: { startsWith: attention.PANCAKE_PARTIAL_RETURN_MANUAL_NOTE } } })).toBe(1);
    await prisma.order.update({ where: { id: order.id }, data: { pancakeAttention: null, pancakeAttentionAt: null } });

    await processor.onStatusUpdated(event(RETURNED));

    expect((await orderOf(order.id)).paymentStatus).toBe('PAID');
    expect(await walletOf(user.id)).toBe(0);
    expect((await rowsOf(order.id)).map((r) => r.status)).toEqual(['UNVERIFIED']);
  });

  it('đơn ghi trước khi có dấu vết (chỉ có lời 15 trong ô): 5 vẫn giữ tiền lại', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER', 300_000, {
      pancakeAttention: 'Pancake báo HOÀN MỘT PHẦN. Kiểm tra hàng nhận lại rồi hoàn tiền/điểm cho phần bị trả bằng tay.',
      pancakeAttentionAt: new Date(),
    });

    await processor.onStatusUpdated(event(RETURNED));

    expect(await walletOf(user.id)).toBe(0);
    expect((await orderOf(order.id)).pancakeAttention).toBe(ATTENTION_PARTIAL_RETURN_HELD);
    expect(await rowsOf(order.id)).toHaveLength(1);
  });

  it('không có 15 trước đó: 5 tự hoàn đủ vào Ví như cũ (đơn chuyển khoản PAID → REFUNDED)', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER');

    await processor.onStatusUpdated(event(RETURNED));

    expect((await orderOf(order.id)).paymentStatus).toBe('REFUNDED');
    expect(await walletOf(user.id)).toBe(300_000);
    expect((await rowsOf(order.id)).every((r) => r.status !== 'UNVERIFIED')).toBe(true);
  });

  it('Tubu CÓ yêu cầu trả đã duyệt: luồng ACK/chặn cũ giữ nguyên — không dấu vết "hoàn tay", 5 bị chặn, không khoản chờ Kế toán', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
    await prisma.returnRequest.create({ data: { orderId: order.id, userId: user.id, reason: 'hỏng', status: 'APPROVED', refundAmount: 100_000 } });

    await processor.onStatusUpdated(event(PARTIAL));
    await processor.onStatusUpdated(event(RETURNED));

    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, note: { startsWith: attention.PANCAKE_PARTIAL_RETURN_MANUAL_NOTE } } })).toBe(0);
    expect((await orderOf(order.id)).status).toBe('DELIVERED');
    expect(await rowsOf(order.id)).toHaveLength(0);
  });

  describe('chạy lại không hoàn hai lần', () => {
    it('5 gửi lại, job thử lại và cron resyncReversalEffects 3 lần: vẫn MỘT khoản, Ví 0, ô không đổi, không báo thêm', async () => {
      const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const cell = (await orderOf(order.id)).pancakeAttention;
      const alerts = alert.mock.calls.length;

      await processor.onStatusUpdated(event(RETURNED));
      await processor.onStatusUpdated(event(RETURNED));
      for (let i = 0; i < 3; i += 1) {
        await prisma.order.update({ where: { id: order.id }, data: { reversalEffectsAt: null } });
        await orderStatus.resyncReversalEffects(order.id);
      }

      expect(await rowsOf(order.id)).toHaveLength(1);
      expect(await walletOf(user.id)).toBe(0);
      const after = await orderOf(order.id);
      expect(after.pancakeAttention).toBe(cell);
      expect(after.paymentStatus).toBe('PAID');
      expect(alert.mock.calls).toHaveLength(alerts);
    });

    it('hai webhook 5 song song: một khoản, Ví 0', async () => {
      const { user, order, event } = await deliveredOrder('WALLET');
      await processor.onStatusUpdated(event(PARTIAL));

      const s = summarize(await Promise.allSettled([processor.onStatusUpdated(event(RETURNED)), processor.onStatusUpdated(event(RETURNED))]));

      expect(s.fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(await rowsOf(order.id)).toHaveLength(1);
      expect(await walletOf(user.id)).toBe(0);
    });

    it('bên thua race không báo ADMIN lần hai: instance đọc đơn trước khi bên kia lật vẫn chỉ có một tin', async () => {
      const { order, event } = await deliveredOrder('BANK_TRANSFER');
      await processor.onStatusUpdated(event(PARTIAL));
      const stale = await orderOf(order.id);
      await processor.onStatusUpdated(event(RETURNED));
      const alertsAfterWinner = alert.mock.calls.length;
      jest.spyOn(prisma.order, 'findFirst').mockResolvedValueOnce(stale);

      await processor.onStatusUpdated(event(RETURNED));

      expect(alert.mock.calls).toHaveLength(alertsAfterWinner);
    });
  });

  describe('Kế toán quyết khoản chờ', () => {
    it('đơn chuyển khoản: xác nhận một phần 200.000đ → khách nhận đúng phần đó khi chọn Ví, phần còn lại DISMISSED, paymentStatus REFUNDED, ô sạch, chạy lại không hoàn thêm', async () => {
      const accountant = await createUser(prisma, { role: 'ADMIN' });
      const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const row = (await rowsOf(order.id))[0]!;

      await refunds.verifyOverpayment(accountant.id, row.id, { amount: 200_000, note: 'Đã hoàn tay 100.000đ' });

      const verified = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
      expect(verified).toMatchObject({ status: 'PENDING', amount: 200_000 });
      const rest = (await rowsOf(order.id)).find((r) => r.refKey === 'pancake-partial-return-held:rest');
      expect(rest).toMatchObject({ status: 'DISMISSED', amount: 100_000 });
      const after = await orderOf(order.id);
      expect(after.paymentStatus).toBe('REFUNDED');
      expect(after.pancakeAttention).toBeNull();
      expect(await walletOf(user.id)).toBe(0);

      await refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' });
      expect(await walletOf(user.id)).toBe(200_000);

      await processor.onStatusUpdated(event(RETURNED));
      await prisma.order.update({ where: { id: order.id }, data: { reversalEffectsAt: null } });
      await orderStatus.resyncReversalEffects(order.id);
      expect(await walletOf(user.id)).toBe(200_000);
      expect(await rowsOf(order.id)).toHaveLength(2);
      await expect(refunds.verifyOverpayment(accountant.id, row.id, {})).rejects.toThrow('không còn chờ đối soát');
    });

    it('đơn trả bằng Ví: xác nhận → hoàn thẳng về Ví đúng số xác nhận (không cho chọn ngân hàng), khoản COMPLETED, một lần duy nhất', async () => {
      const accountant = await createUser(prisma, { role: 'ADMIN' });
      const { user, order, event } = await deliveredOrder('WALLET');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const row = (await rowsOf(order.id))[0]!;

      await refunds.verifyOverpayment(accountant.id, row.id, { amount: 250_000 });

      const done = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
      expect(done).toMatchObject({ status: 'COMPLETED', method: 'WALLET', amount: 250_000 });
      expect(await walletOf(user.id)).toBe(250_000);
      expect((await orderOf(order.id)).paymentStatus).toBe('REFUNDED');
      await expect(refunds.verifyOverpayment(accountant.id, row.id, {})).rejects.toThrow('không còn chờ đối soát');
      expect(await walletOf(user.id)).toBe(250_000);
    });

    it('bỏ qua (nhân viên đã hoàn tay đủ): không khoản PENDING, Ví 0, ô sạch, paymentStatus REFUNDED; chữ lịch sử đơn không nói hãng/COD', async () => {
      const accountant = await createUser(prisma, { role: 'ADMIN' });
      const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const row = (await rowsOf(order.id))[0]!;

      await refunds.dismissOverpayment(accountant.id, row.id, { reason: 'Nhân viên đã chuyển khoản tay đủ 300.000đ' });

      expect(await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'DISMISSED' });
      expect(await walletOf(user.id)).toBe(0);
      const after = await orderOf(order.id);
      expect(after.pancakeAttention).toBeNull();
      expect(after.paymentStatus).toBe('REFUNDED');
      const notes = (await prisma.orderStatusHistory.findMany({ where: { orderId: order.id, actorId: accountant.id } })).map((n) => n.note ?? '');
      expect(notes.join(' ')).not.toMatch(/COD|hãng/);
    });

    it('đơn COD: Kế toán xác nhận gỡ cả dòng COD lẫn dòng chờ Kế toán mới', async () => {
      const accountant = await createUser(prisma, { role: 'ADMIN' });
      const { order, event } = await deliveredOrder('COD');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const row = (await rowsOf(order.id))[0]!;

      await refunds.verifyOverpayment(accountant.id, row.id, { amount: 300_000 });

      expect((await orderOf(order.id)).pancakeAttention).toBeNull();
    });

    it('bất biến: ghi lý do khác không đè dòng chờ Kế toán, nối sau nó; Kế toán quyết xong chỉ gỡ dòng của mình', async () => {
      const accountant = await createUser(prisma, { role: 'ADMIN' });
      const { order, event } = await deliveredOrder('BANK_TRANSFER');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));

      expect(await attention.writePancakeAttention(prisma, order.id, 'Lý do X')).toBe(`${ATTENTION_PARTIAL_RETURN_HELD} | Lý do X`);
      expect(await attention.writePancakeAttention(prisma, order.id, 'Lý do Y', 'Lý do')).toBeNull();
      expect((await orderOf(order.id)).pancakeAttention).toBe(`${ATTENTION_PARTIAL_RETURN_HELD} | Lý do X`);

      const row = (await rowsOf(order.id))[0]!;
      await refunds.dismissOverpayment(accountant.id, row.id, { reason: 'Đã hoàn tay đủ tiền' });
      expect((await orderOf(order.id)).pancakeAttention).toBe('Lý do X');
    });
  });

  it('15 rồi admin lật "Đã trả hàng" bằng tay: đường admin không đổi (hoàn Ví như thường), lời 15 đổi thành cảnh báo đã xử lý cả đơn', async () => {
    const { user, order, event } = await deliveredOrder('BANK_TRANSFER');
    await processor.onStatusUpdated(event(PARTIAL));

    await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });

    const after = await orderOf(order.id);
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(await walletOf(user.id)).toBe(300_000);
    expect(after.pancakeAttention).toBe(ATTENTION_PARTIAL_RETURN_SETTLED);
    expect((await rowsOf(order.id)).every((r) => r.status !== 'UNVERIFIED')).toBe(true);
  });

  describe('P3 cùng vùng mã', () => {
    it('đọc ô ngoài tx bị cũ (15 vừa commit chen giữa): lời trong DB không bị đè khi ghi dòng COD', async () => {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const order = await createOrder(prisma, { userId: user.id, status: 'DELIVERED', paymentMethod: 'COD', paymentStatus: 'UNPAID', total: 300_000, subtotal: 300_000 });
      const stale = await orderOf(order.id);
      await prisma.order.update({ where: { id: order.id }, data: { pancakeAttention: 'Tổng tiền Pancake lệch với Tubu: chen giữa', pancakeAttentionAt: new Date() } });
      jest.spyOn(prisma.order, 'findFirst').mockResolvedValueOnce({ ...stale, items: [] } as never);

      await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'PANCAKE', returnedToSender: true, withholdCodRefund: true });

      expect((await orderOf(order.id)).pancakeAttention).toBe(`Tổng tiền Pancake lệch với Tubu: chen giữa | ${ATTENTION_COD_RETURN_UNVERIFIED}`);
    });

    it('đóng đơn mà đóng việc tồn lỗi: chưa ghi mốc reversalEffectsAt, cron chạy lại thay được lời 15 rồi mới ghi mốc', async () => {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const order = await createOrder(prisma, {
        userId: user.id,
        status: 'CONFIRMED',
        paymentMethod: 'COD',
        total: 0,
        subtotal: 0,
        pancakeAttention: 'Pancake báo HOÀN MỘT PHẦN. Kiểm tra hàng nhận lại rồi hoàn tiền/điểm cho phần bị trả bằng tay.',
        pancakeAttentionAt: new Date(),
      });
      jest.spyOn(attention, 'replaceAttentionReasonsByPrefix').mockRejectedValueOnce(new Error('P2024: hết kết nối trong pool'));

      await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

      expect((await orderOf(order.id)).reversalEffectsAt).toBeNull();
      await expect(orderStatus.resyncReversalEffects(order.id)).resolves.toMatchObject({ outcome: 'DONE' });
      const done = await orderOf(order.id);
      expect(done.pancakeAttention).toBe(ATTENTION_PARTIAL_RETURN_SETTLED);
      expect(done.reversalEffectsAt).not.toBeNull();
    });

    it('cron resyncReversalEffects chạy 3 lần trên đơn đã giữ tiền: ô không đổi, không báo lại', async () => {
      const { order, event } = await deliveredOrder('COD');
      await processor.onStatusUpdated(event(PARTIAL));
      await processor.onStatusUpdated(event(RETURNED));
      const cell = (await orderOf(order.id)).pancakeAttention;
      const alerts = alert.mock.calls.length;

      for (let i = 0; i < 3; i += 1) {
        await prisma.order.update({ where: { id: order.id }, data: { reversalEffectsAt: null } });
        await orderStatus.resyncReversalEffects(order.id);
      }

      expect((await orderOf(order.id)).pancakeAttention).toBe(cell);
      expect(alert.mock.calls).toHaveLength(alerts);
    });

    describe('duyệt trả CẢ ĐƠN (không qua setStatus) khi ô còn lời 15', () => {
      const MANUAL = 'Pancake báo HOÀN MỘT PHẦN. Kiểm tra hàng nhận lại rồi hoàn tiền/điểm cho phần bị trả bằng tay.';

      async function fullReturnOrder(extra: Record<string, unknown>) {
        const admin = await createUser(prisma, { role: 'ADMIN' });
        const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
        const tag = randCode(8);
        const product = await prisma.product.create({
          data: { pancakeId: `it-p-${tag}`, brand: 'IT', slug: `it-held-${tag.toLowerCase()}`, name: `DRIP ${tag}`, description: 'IT', basePrice: 38_000 },
        });
        const v = await prisma.variation.create({
          data: { pancakeId: `it-v-${tag}`, productId: product.id, sku: `IT-${tag}`, name: 'Chai', attributes: {}, retailPrice: 38_000, stock: 10 },
        });
        const order = await createOrder(prisma, {
          userId: user.id,
          status: 'DELIVERED',
          paymentMethod: 'WALLET',
          paymentStatus: 'PAID',
          subtotal: 38_000,
          shippingFee: 0,
          total: 38_000,
          deliveredAt: new Date(),
          items: { create: [{ variationId: v.id, productName: 'DRIP', variationName: 'Chai', unitPrice: 38_000, quantity: 1, total: 38_000 }] },
          ...extra,
        });
        const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
        const req = await returns.request(user.id, order.code, { reasonCode: 'DEFECTIVE', reason: 'Chai bị rò rỉ', items: [{ orderItemId: item.id, quantity: 1 }] });
        return { admin, user, order, req };
      }

      it('đơn có mã Pancake: lời 15 đổi thành cảnh báo đã xử lý cả đơn, lý do khác còn nguyên, lời "tạo phiếu trả" được nối thay vì đè', async () => {
        const { admin, order, req } = await fullReturnOrder({
          pancakeOrderId: `pk-held-${randCode(8)}`,
          pancakeAttention: `${MANUAL} | Lý do khác`,
          pancakeAttentionAt: new Date(),
        });

        await returns.review(admin.id, req.id, { approve: true });

        const after = await orderOf(order.id);
        expect(after.status).toBe('RETURNED');
        expect(after.pancakeAttention).toContain(ATTENTION_PARTIAL_RETURN_SETTLED);
        expect(after.pancakeAttention).toContain('Lý do khác');
        expect(after.pancakeAttention).toContain('Khách trả cả đơn');
        expect(after.pancakeAttention!.split(' | ').some((part) => part.startsWith('Pancake báo HOÀN MỘT PHẦN'))).toBe(false);
      });

      it('đơn không có mã Pancake (flagPancakeReturn thoát sớm): lời 15 vẫn được thay', async () => {
        const { admin, order, req } = await fullReturnOrder({ pancakeAttention: MANUAL, pancakeAttentionAt: new Date() });

        await returns.review(admin.id, req.id, { approve: true });

        expect((await orderOf(order.id)).pancakeAttention).toBe(ATTENTION_PARTIAL_RETURN_SETTLED);
      });
    });

    it('Pancake 4 tới trễ trên đơn đã đóng: không đè lời đã xử lý', async () => {
      const { order, event } = await deliveredOrder('COD');
      await processor.onStatusUpdated(event(PARTIAL));
      await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });
      const cell = (await orderOf(order.id)).pancakeAttention;

      await processor.onStatusUpdated(event({ status: 4 }));
      await processor.onStatusUpdated(event({ status: 7 }));

      expect((await orderOf(order.id)).pancakeAttention).toBe(cell);
    });

    it('lời "Cần xử lý" của đơn CÒN MỞ vẫn ghi được khi đơn đóng chen giữa lúc đọc và lúc ghi thì không (onlyOpenOrder)', async () => {
      const { order, event } = await deliveredOrder('COD');
      const stale = await orderOf(order.id);
      await orderStatus.setStatus(order.id, 'RETURNED', { actorType: 'ADMIN' });
      const cell = (await orderOf(order.id)).pancakeAttention;
      jest.spyOn(prisma.order, 'findFirst').mockResolvedValueOnce(stale);

      await processor.onStatusUpdated(event({ status: 4 }));

      expect((await orderOf(order.id)).pancakeAttention).toBe(cell);
    });
  });
});
