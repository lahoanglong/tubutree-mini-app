import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CTV_NOTIFICATION } from '../../src/modules/affiliate/ctv-notification-codes';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { QUEUE_NOTIFICATIONS } from '../../src/jobs/queues';
import { createOrder, createUser, warmPool } from './helpers';

/**
 * C-029: CTV nhận thông báo khi có hoa hồng mới / được duyệt / lệnh rút đã chi. Chạy trên Postgres
 * thật với NotificationsService thật (render mẫu, ghi notification_logs) để kiểm: mốc approvedAt khớp
 * đúng lượt cron, gộp theo CTV, không báo hoa hồng đã duyệt từ trước, nội dung hiển thị tiếng Việt.
 */
describe('AffiliateService thông báo CTV (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  const TEMPLATES = [
    { id: 'nt-ctv-commission-new', code: CTV_NOTIFICATION.NEW, bodyTemplate: 'Có đơn mới từ link của bạn! Hoa hồng dự kiến {{amount}}.' },
    { id: 'nt-ctv-commission-approved', code: CTV_NOTIFICATION.APPROVED, bodyTemplate: '{{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt.' },
    { id: 'nt-ctv-payout-paid', code: CTV_NOTIFICATION.PAYOUT_PAID, bodyTemplate: 'Lệnh rút {{amount}} đã được chuyển khoản{{ref}}.' },
  ];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        CoinsService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        NotificationsService,
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn().mockResolvedValue(true) } },
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: { add: jest.fn() } },
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    for (const t of TEMPLATES) {
      await prisma.notificationTemplate.upsert({
        where: { id: t.id },
        update: { code: t.code, channel: 'INAPP', bodyTemplate: t.bodyTemplate },
        create: { ...t, channel: 'INAPP' },
      });
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const logsFor = (userId: string, code: string) =>
    prisma.notificationLog.findMany({ where: { userId, templateCode: code, channel: 'INAPP' } });
  const bodyOf = (log: { payload: unknown }) => (log.payload as { body: string }).body;

  async function lockedCommission(ctvId: string, amount: number) {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: buyer.id, status: 'DELIVERED', referrerUserId: ctvId, total: amount * 10, subtotal: amount * 10,
    });
    return prisma.commission.create({
      data: {
        affiliateUserId: ctvId, orderId: order.id, orderTotal: order.total, commissionableTotal: order.total,
        rate: 10, amount, status: 'LOCKED', lockedAt: new Date(Date.now() - 40 * 864e5),
      },
    });
  }

  it('cron duyệt: mỗi CTV một tin gộp (số khoản + tổng), không tính khoản đã duyệt từ trước', async () => {
    const a = await createUser(prisma, { role: 'AFFILIATE' });
    const b = await createUser(prisma, { role: 'AFFILIATE' });
    await lockedCommission(a.id, 10_000);
    await lockedCommission(a.id, 5_000);
    await lockedCommission(b.id, 7_000);
    // Khoản đã APPROVED từ hôm qua của A: không được cộng vào tin của lượt này.
    const oldOrder = await createOrder(prisma, { userId: b.id, status: 'DELIVERED', referrerUserId: a.id });
    await prisma.commission.create({
      data: {
        affiliateUserId: a.id, orderId: oldOrder.id, orderTotal: 100_000, commissionableTotal: 100_000, rate: 10,
        amount: 99_000, status: 'APPROVED', lockedAt: new Date(Date.now() - 60 * 864e5),
        approvedAt: new Date(Date.now() - 864e5),
      },
    });

    await affiliate.approveDueCommissions();

    const la = await logsFor(a.id, CTV_NOTIFICATION.APPROVED);
    expect(la).toHaveLength(1);
    expect(bodyOf(la[0]!)).toBe('2 khoản hoa hồng (tổng 15.000đ) đã được duyệt.');
    const lb = await logsFor(b.id, CTV_NOTIFICATION.APPROVED);
    expect(lb).toHaveLength(1);
    expect(bodyOf(lb[0]!)).toBe('1 khoản hoa hồng (tổng 7.000đ) đã được duyệt.');

    // Chạy lại: không còn gì để duyệt thì không báo thêm lần nữa.
    await affiliate.approveDueCommissions();
    expect(await logsFor(a.id, CTV_NOTIFICATION.APPROVED)).toHaveLength(1);
  });

  it('đơn mới từ link CTV: báo hoa hồng dự kiến, payload không có mã đơn của khách', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, referrerUserId: ctv.id, total: 250_000, subtotal: 250_000 });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id, orderId: order.id, orderTotal: 250_000, commissionableTotal: 250_000, rate: 10,
        amount: 25_000, status: 'PENDING',
      },
    });

    await affiliate.notifyCommissionCreated(order.id);

    const logs = await logsFor(ctv.id, CTV_NOTIFICATION.NEW);
    expect(logs).toHaveLength(1);
    expect(bodyOf(logs[0]!)).toBe('Có đơn mới từ link của bạn! Hoa hồng dự kiến 25.000đ.');
    expect(JSON.stringify(logs[0]!.payload)).not.toContain('order_code');
    expect(JSON.stringify(logs[0]!.payload)).not.toContain(order.code);
  });

  it('đơn CTV tự lên hộ khách: không báo', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const order = await createOrder(prisma, {
      userId: ctv.id, referrerUserId: ctv.id, placedForCustomer: true, total: 100_000, subtotal: 100_000,
    });
    await prisma.commission.create({
      data: {
        affiliateUserId: ctv.id, orderId: order.id, orderTotal: 100_000, commissionableTotal: 100_000, rate: 10,
        amount: 10_000, status: 'PENDING',
      },
    });
    await affiliate.notifyCommissionCreated(order.id);
    expect(await logsFor(ctv.id, CTV_NOTIFICATION.NEW)).toHaveLength(0);
  });

  it('admin xác nhận đã chuyển khoản: báo CTV số tiền thực nhận kèm mã giao dịch', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const payout = await prisma.payout.create({
      data: { userId: ctv.id, amount: 480_000, fee: 3_000, method: 'BANK', status: 'APPROVED' },
    });
    const admin = await createUser(prisma, { role: 'ADMIN' });

    await affiliate.markPayoutPaid(admin.id, payout.id, { bankRef: 'FT2610' });

    const logs = await logsFor(ctv.id, CTV_NOTIFICATION.PAYOUT_PAID);
    expect(logs).toHaveLength(1);
    expect(bodyOf(logs[0]!)).toBe('Lệnh rút 480.000đ đã được chuyển khoản (mã giao dịch FT2610).');
    const row = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(row.status).toBe('PAID');
  });
});
