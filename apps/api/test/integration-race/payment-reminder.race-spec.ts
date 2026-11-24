import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import {
  ORDER_PAYMENT_REMINDER_TEMPLATE,
  PENDING_PAYMENT_TTL_KEY,
  PendingPaymentExpiryCron,
  paymentReminderDedupeKey,
} from '../../src/modules/orders/pending-payment-expiry.cron';
import { createOrder, createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const HOUR = 3_600_000;

/**
 * Nhắc chuyển khoản ~2 giờ trước hạn tự huỷ trên Postgres thật, NotificationsService thật (khoá advisory theo dedupeKey `pay_remind:<mã>`):
 * nhiều lượt quét chồng nhau hay chạy lại mỗi 15 phút vẫn chỉ để lại MỘT tin mỗi đơn. Dùng năm 2034 để cửa sổ nhắc không gặp đơn của spec khác.
 */
describe('Nhắc chuyển khoản trước hạn tự huỷ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let cron: PendingPaymentExpiryCron;
  let createdTemplate = false;
  let restoreTtl: () => Promise<void>;
  const created = { userIds: [] as string[] };
  // Hạn tự huỷ 24 giờ: đơn tạo lúc T hết hạn lúc T + 24h; lượt chạy lúc NOW nhắc đơn tạo trong (NOW − 24h, NOW − 22h].
  const NOW = new Date('2034-03-02T03:00:00Z');

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule], providers: [SystemConfigService] }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    restoreTtl = await pinConfig(prisma, PENDING_PAYMENT_TTL_KEY, 24);
    if (!(await prisma.notificationTemplate.findUnique({ where: { code: ORDER_PAYMENT_REMINDER_TEMPLATE } }))) {
      await prisma.notificationTemplate.create({
        data: {
          id: 'nt-order-payment-reminder',
          code: ORDER_PAYMENT_REMINDER_TEMPLATE,
          channel: 'INAPP',
          bodyTemplate: 'Đơn {{order_code}} sẽ tự huỷ lúc {{deadline}} nếu Tubu chưa nhận {{amount}}.',
        },
      });
      createdTemplate = true;
    }
    const notifications = new NotificationsService(prisma, {} as never, { recordBestEffort: jest.fn() } as never);
    cron = new PendingPaymentExpiryCron(prisma, moduleRef.get(SystemConfigService), { setStatus: jest.fn() } as unknown as OrderStatusService, notifications);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.notificationLog.deleteMany({ where: { userId: { in: created.userIds } } });
      await deleteItData(prisma, created);
      if (createdTemplate) await prisma.notificationTemplate.delete({ where: { code: ORDER_PAYMENT_REMINDER_TEMPLATE } });
      await restoreTtl?.();
    }
    await moduleRef?.close();
  });

  async function pendingOrder(createdAt: Date, extra: Record<string, unknown> = {}) {
    const u = await createUser(prisma);
    created.userIds.push(u.id);
    const o = await createOrder(prisma, {
      userId: u.id,
      createdAt,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 259_000,
      ...extra,
    });
    return { u, o };
  }

  const notices = (userId: string) =>
    prisma.notificationLog.findMany({ where: { userId, templateCode: ORDER_PAYMENT_REMINDER_TEMPLATE, channel: 'INAPP' }, select: { payload: true } });

  it('4 lượt quét chồng nhau rồi chạy lại: mỗi đơn đến hạn nhắc đúng MỘT tin, khoá pay_remind:<mã>, có mã đơn, số tiền và giờ huỷ', async () => {
    const due = await pendingOrder(new Date(NOW.getTime() - 23 * HOUR));
    const results = await Promise.all(Array.from({ length: 4 }, () => cron.remindBeforeExpiry(NOW)));
    expect(results.reduce((s, n) => s + n, 0)).toBeGreaterThanOrEqual(1);
    // Lượt sau (đơn vẫn trong cửa sổ): đơn đã nhắc bị bỏ trước khi gửi nên lượt không đếm lại.
    expect(await cron.remindBeforeExpiry(new Date(NOW.getTime() + 15 * 60_000))).toBe(0);
    const got = await notices(due.u.id);
    expect(got).toHaveLength(1);
    const payload = got[0]!.payload as { dedupeKey: string; data: Record<string, string>; body: string };
    expect(payload.dedupeKey).toBe(paymentReminderDedupeKey(due.o.code));
    expect(payload.data.order_code).toBe(due.o.code);
    // Tạo 04:00Z 01/03 → hạn 04:00Z 02/03 = 11:00 giờ VN.
    expect(payload.data.deadline).toBe('11:00 02/03/2034');
    expect(payload.body).toContain(due.o.code);
  });

  it('MSS đang giữ hoặc đã gửi order.created: không nhắc; MSS báo hỏng, chưa có sự kiện, hay chỉ có sự kiện loại khác: nhắc đúng một tin', async () => {
    const createdAt = new Date(NOW.getTime() - 23 * HOUR);
    const withEvent = async (eventType: string | null, status: string) => {
      const c = await pendingOrder(createdAt);
      if (eventType) {
        await prisma.mssOrderEventOutbox.create({
          data: {
            eventId: `it-remind-${randCode(12)}`,
            orderId: c.o.id,
            orderCode: c.o.code,
            eventType,
            sequence: 1,
            occurredAt: createdAt,
            body: '{}',
            bodySha256: 'it',
            status,
            expiresAt: new Date(createdAt.getTime() + 6 * HOUR),
          },
        });
      }
      return c;
    };
    const skipped = await Promise.all(['PENDING', 'SENDING', 'DELIVERED', 'RESULT_SENT'].map((s) => withEvent('order.created', s)));
    const reminded = await Promise.all([
      withEvent('order.created', 'RESULT_FAILED'),
      withEvent(null, ''),
      withEvent('order.payment_confirmed', 'RESULT_SENT'),
    ]);
    await cron.remindBeforeExpiry(NOW);
    for (const c of skipped) expect(await notices(c.u.id)).toHaveLength(0);
    for (const c of reminded) expect(await notices(c.u.id)).toHaveLength(1);

    // Dòng còn PENDING ở lượt trước rồi MSS báo hỏng (RESULT_FAILED): lượt sau nhắc nốt đơn đó, đơn đã nhắc không nhận thêm.
    await prisma.mssOrderEventOutbox.updateMany({ where: { orderId: skipped[0]!.o.id }, data: { status: 'RESULT_FAILED' } });
    await cron.remindBeforeExpiry(new Date(NOW.getTime() + 10 * 60_000));
    expect(await notices(skipped[0]!.u.id)).toHaveLength(1);
    for (const c of reminded) expect(await notices(c.u.id)).toHaveLength(1);
  });

  it('không nhắc: đơn còn xa hạn, đã quá hạn, đã trả, COD, đơn khách vãng lai, đơn có dấu Pancake đã trả', async () => {
    const cases = await Promise.all([
      pendingOrder(new Date(NOW.getTime() - 10 * HOUR)),
      pendingOrder(new Date(NOW.getTime() - 25 * HOUR)),
      pendingOrder(new Date(NOW.getTime() - 23 * HOUR), { paymentStatus: 'PAID' }),
      pendingOrder(new Date(NOW.getTime() - 23 * HOUR), { paymentMethod: 'COD' }),
      pendingOrder(new Date(NOW.getTime() - 23 * HOUR), { guestTokenHash: `it-guest-${Date.now()}` }),
      pendingOrder(new Date(NOW.getTime() - 23 * HOUR), { pancakePaidReported: 259_000 }),
    ]);
    await cron.remindBeforeExpiry(NOW);
    for (const c of cases) expect(await notices(c.u.id)).toHaveLength(0);
  });
});
