import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CTV_NOTIFICATION } from '../../src/modules/affiliate/ctv-notification-codes';
import { AFFILIATE_AUTO_WALLET_TRANSFER_KEY } from '../../src/modules/affiliate/affiliate-auto-transfer-config';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { ZnsClient } from '../../src/modules/integrations/zns/zns.client';
import { QUEUE_NOTIFICATIONS } from '../../src/jobs/queues';
import { createOrder, createUser, setConfig, summarize, warmPool } from './helpers';

/**
 * Hoa hồng đã duyệt tự vào Ví Tubu: chạy trên Postgres thật. Cùng một đường requestPayout với nút "Chuyển vào Ví", nên kiểm
 * (1) cùng khấu trừ TNCN và bút toán Ví như bấm tay, (2) cron chạy lại / hai cron / cron cùng bấm tay chỉ cộng MỘT lần,
 * (3) cờ tắt hoặc thiếu MST thì để nguyên cho nút bấm tay. Assert chỉ trên CTV do ca tự tạo (cron quét cả DB dùng chung).
 */
describe('Hoa hồng đã duyệt tự vào Ví (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let config: SystemConfigService;
  const MST = '079201001234';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        NotificationsService,
        { provide: ZnsClient, useValue: { sendTemplate: jest.fn().mockResolvedValue({ ok: true }) } },
        { provide: getQueueToken(QUEUE_NOTIFICATIONS), useValue: { add: jest.fn() } },
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    config = moduleRef.get(SystemConfigService);
    for (const t of [
      { id: 'nt-ctv-wallet-credited', code: CTV_NOTIFICATION.AUTO_WALLET, body: 'Đã cộng {{amount}} hoa hồng vào Ví Tubu{{tax_note}}.' },
      { id: 'nt-ctv-wallet-tax-only', code: CTV_NOTIFICATION.AUTO_WALLET_TAX_ONLY, body: 'Đã xử lý {{amount}}: khấu trừ thuế {{tax}}, chưa có tiền vào Ví.' },
      { id: 'nt-ctv-commission-approved', code: CTV_NOTIFICATION.APPROVED, body: '{{count}} khoản hoa hồng (tổng {{amount}}) đã được duyệt.' },
    ]) {
      await prisma.notificationTemplate.upsert({
        where: { id: t.id },
        update: { code: t.code, channel: 'INAPP', bodyTemplate: t.body },
        create: { id: t.id, code: t.code, channel: 'INAPP', bodyTemplate: t.body },
      });
    }
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 5_000_000);
    await setFlag(true);
  });

  afterAll(async () => {
    await setFlag(true);
    await moduleRef?.close();
  });

  // SystemConfigService cache 60s: ghi DB rồi xoá cache để ca sau thấy giá trị mới.
  async function setFlag(value: boolean) {
    await setConfig(prisma, AFFILIATE_AUTO_WALLET_TRANSFER_KEY, value);
    (config as unknown as { cache: Map<string, unknown> }).cache.clear();
  }

  async function commissionFor(affiliateUserId: string, amount: number, status: 'APPROVED' | 'LOCKED' = 'APPROVED') {
    const buyer = await createUser(prisma);
    const order = await createOrder(prisma, { userId: buyer.id, status: 'DELIVERED', referrerUserId: affiliateUserId, total: amount * 10 });
    return prisma.commission.create({
      data: {
        affiliateUserId,
        orderId: order.id,
        orderTotal: order.total,
        commissionableTotal: order.total,
        rate: 10,
        amount,
        status,
        lockedAt: new Date(Date.now() - 40 * 864e5),
        ...(status === 'APPROVED' ? { approvedAt: new Date() } : {}),
      },
    });
  }

  const ctv = (extra: Parameters<typeof createUser>[1] = {}) => createUser(prisma, { role: 'AFFILIATE', ...extra });

  async function state(userId: string) {
    const [u, ledger, payouts, commissions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true } }),
      prisma.walletTransaction.findMany({ where: { userId, type: 'COMMISSION_PAYOUT' } }),
      prisma.payout.findMany({ where: { userId } }),
      prisma.commission.findMany({ where: { affiliateUserId: userId } }),
    ]);
    return { balance: u.walletBalance, ledger, payouts, commissions };
  }

  it('cron cộng toàn bộ hoa hồng khả dụng của mỗi CTV vào Ví: một bút toán, một payout, commission PAID, một thông báo', async () => {
    const a = await ctv();
    const b = await ctv();
    await commissionFor(a.id, 40_000);
    await commissionFor(a.id, 60_000);
    await commissionFor(b.id, 25_000);

    const credited = await affiliate.autoTransferApprovedToWallet();
    expect(credited.has(a.id) && credited.has(b.id)).toBe(true);

    const sa = await state(a.id);
    expect(sa.balance).toBe(100_000);
    expect(sa.ledger).toHaveLength(1);
    expect(sa.payouts).toHaveLength(1);
    expect(sa.payouts[0]).toMatchObject({ method: 'WALLET_BALANCE', status: 'PAID', amount: 100_000, grossAmount: 100_000, taxWithheld: 0 });
    expect(sa.payouts[0]!.idempotencyKey).toMatch(/^auto-wallet:/);
    expect(sa.commissions.every((c) => c.status === 'PAID')).toBe(true);
    expect((await state(b.id)).balance).toBe(25_000);

    const logs = await prisma.notificationLog.findMany({ where: { userId: a.id, templateCode: CTV_NOTIFICATION.AUTO_WALLET } });
    expect(logs).toHaveLength(1);
    expect((logs[0]!.payload as { body: string }).body).toBe('Đã cộng 100.000đ hoa hồng vào Ví Tubu.');
  });

  it('chạy lại sau khi đã chuyển: không cộng thêm, không báo thêm', async () => {
    const a = await ctv();
    await commissionFor(a.id, 50_000);
    await affiliate.autoTransferApprovedToWallet();
    await affiliate.autoTransferApprovedToWallet();
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(a.id);
    expect(s.balance).toBe(50_000);
    expect(s.ledger).toHaveLength(1);
    expect(s.payouts).toHaveLength(1);
    expect(await prisma.notificationLog.count({ where: { userId: a.id, templateCode: CTV_NOTIFICATION.AUTO_WALLET } })).toBe(1);
  });

  it('khấu trừ TNCN giống hệt bấm tay: cùng số thuế, cùng tiền vào Ví, cùng mô tả bút toán', async () => {
    const auto = await ctv({ personalTaxId: MST });
    const manual = await ctv({ personalTaxId: MST });
    await commissionFor(manual.id, 6_000_000);
    await affiliate.requestPayout(manual.id, 6_000_000, 'WALLET_BALANCE');
    await commissionFor(auto.id, 6_000_000);
    await affiliate.autoTransferApprovedToWallet();

    const [sa, sm] = await Promise.all([state(auto.id), state(manual.id)]);
    expect(sa.payouts[0]).toMatchObject({ grossAmount: 6_000_000, taxWithheld: 600_000, amount: 5_400_000, taxId: MST });
    expect(sm.payouts[0]).toMatchObject({ grossAmount: 6_000_000, taxWithheld: 600_000, amount: 5_400_000, taxId: MST });
    expect(sa.balance).toBe(5_400_000);
    expect(sm.balance).toBe(5_400_000);
    expect(sa.ledger[0]!.reason).toBe(sm.ledger[0]!.reason);
    const log = await prisma.notificationLog.findFirstOrThrow({ where: { userId: auto.id, templateCode: CTV_NOTIFICATION.AUTO_WALLET } });
    expect((log.payload as { body: string }).body).toBe('Đã cộng 5.400.000đ hoa hồng vào Ví Tubu (đã khấu trừ thuế TNCN 600.000đ).');
  });

  it('thuế cộng dồn theo tháng như tay: hai lượt cron trong tháng, lượt 2 vượt ngưỡng thì truy thu', async () => {
    const u = await ctv({ personalTaxId: MST });
    await commissionFor(u.id, 3_000_000);
    await affiliate.autoTransferApprovedToWallet();
    await commissionFor(u.id, 3_000_000);
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(u.id);
    const gross = s.payouts.reduce((x, p) => x + (p.grossAmount ?? 0), 0);
    const tax = s.payouts.reduce((x, p) => x + p.taxWithheld, 0);
    expect(gross).toBe(6_000_000);
    expect(tax).toBe(600_000);
    expect(s.balance).toBe(5_400_000);
  });

  it('thiếu MST khi bị khấu trừ: không tự chuyển, hoa hồng giữ APPROVED cho nút bấm tay; có MST thì bấm tay chuyển được', async () => {
    const u = await ctv();
    await commissionFor(u.id, 6_000_000);
    const credited = await affiliate.autoTransferApprovedToWallet();
    expect(credited.has(u.id)).toBe(false);
    let s = await state(u.id);
    expect(s.balance).toBe(0);
    expect(s.payouts).toHaveLength(0);
    expect(s.commissions.every((c) => c.status === 'APPROVED')).toBe(true);

    await affiliate.requestPayout(u.id, 6_000_000, 'WALLET_BALANCE', undefined, undefined, MST);
    s = await state(u.id);
    expect(s.balance).toBe(5_400_000);
  });

  it('cờ tắt: cron không chuyển gì (hoa hồng giữ APPROVED, bấm tay vẫn chuyển được); bật lại thì cron chuyển nốt', async () => {
    const u = await ctv();
    await commissionFor(u.id, 30_000);
    await setFlag(false);
    try {
      expect((await affiliate.autoTransferApprovedToWallet()).size).toBe(0);
      const s = await state(u.id);
      expect(s.balance).toBe(0);
      expect(s.commissions[0]!.status).toBe('APPROVED');
    } finally {
      await setFlag(true);
    }
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(u.id);
    expect(s.balance).toBe(30_000);
  });

  it('hai cron chạy đồng thời trên cùng CTV: chỉ cộng một lần', async () => {
    const u = await ctv();
    await commissionFor(u.id, 70_000);
    await commissionFor(u.id, 30_000);
    const results = await Promise.allSettled([
      affiliate.autoTransferApprovedToWallet(),
      affiliate.autoTransferApprovedToWallet(),
      affiliate.autoTransferApprovedToWallet(),
    ]);
    expect(summarize(results).rejected).toHaveLength(0);
    const s = await state(u.id);
    expect(s.balance).toBe(100_000);
    expect(s.ledger).toHaveLength(1);
    expect(s.payouts).toHaveLength(1);
  });

  it('cron và CTV bấm tay đồng thời (nhiều vòng): luôn đúng một lần cộng Ví, tổng đúng số hoa hồng', async () => {
    for (let round = 0; round < 6; round++) {
      const u = await ctv();
      await commissionFor(u.id, 40_000);
      await commissionFor(u.id, 12_345);
      const [cron, manual] = await Promise.allSettled([
        affiliate.autoTransferApprovedToWallet(),
        affiliate.requestPayout(u.id, 52_345, 'WALLET_BALANCE', undefined, `manual-${u.id}`),
      ]);
      expect(cron.status).toBe('fulfilled');
      // Bên thua bị từ chối sạch (đã xử lý), không được lỗi lạ.
      if (manual.status === 'rejected') expect(String((manual.reason as Error).message)).toMatch(/đã được xử lý|không có hoa hồng khả dụng/i);
      const s = await state(u.id);
      expect(s.balance).toBe(52_345);
      expect(s.ledger).toHaveLength(1);
      expect(s.payouts).toHaveLength(1);
      expect(s.commissions.every((c) => c.status === 'PAID')).toBe(true);
    }
  });

  it('nhiều CTV cùng lúc với nhiều cron chồng nhau: mỗi người đúng một lần cộng, đúng số tiền', async () => {
    const users = await Promise.all(Array.from({ length: 5 }, () => ctv()));
    for (const [i, u] of users.entries()) await commissionFor(u.id, 10_000 * (i + 1));
    await Promise.all([affiliate.autoTransferApprovedToWallet(), affiliate.autoTransferApprovedToWallet()]);
    for (const [i, u] of users.entries()) {
      const s = await state(u.id);
      expect(s.balance).toBe(10_000 * (i + 1));
      expect(s.ledger).toHaveLength(1);
    }
  });

  it('approveDueCommissions: khoản LOCKED đủ hạn thành APPROVED rồi vào Ví ngay trong cùng lượt; không còn tin "đã duyệt"', async () => {
    const u = await ctv();
    await commissionFor(u.id, 80_000, 'LOCKED');
    await affiliate.approveDueCommissions();
    const s = await state(u.id);
    expect(s.commissions[0]!.status).toBe('PAID');
    expect(s.balance).toBe(80_000);
    expect(await prisma.notificationLog.count({ where: { userId: u.id, templateCode: CTV_NOTIFICATION.AUTO_WALLET } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { userId: u.id, templateCode: CTV_NOTIFICATION.APPROVED } })).toBe(0);
  });

  it('approveDueCommissions khi CTV thiếu MST: vẫn nhận tin "đã duyệt" dặn tự chuyển, tiền chưa vào Ví', async () => {
    const u = await ctv();
    await commissionFor(u.id, 6_000_000, 'LOCKED');
    await affiliate.approveDueCommissions();
    const s = await state(u.id);
    expect(s.commissions[0]!.status).toBe('APPROVED');
    expect(s.balance).toBe(0);
    expect(await prisma.notificationLog.count({ where: { userId: u.id, templateCode: CTV_NOTIFICATION.APPROVED } })).toBe(1);
    expect(await prisma.notificationLog.count({ where: { userId: u.id, templateCode: CTV_NOTIFICATION.AUTO_WALLET } })).toBe(0);
    // Không để dòng APPROVED treo trong DB dùng chung: các ca/spec sau quét cả DB.
    await prisma.commission.updateMany({ where: { affiliateUserId: u.id }, data: { status: 'PAID', paidAt: new Date() } });
  });

  it('hoa hồng đang trong lệnh rút NH cũ (payoutBatchId) không bị tự chuyển', async () => {
    const u = await ctv();
    const c = await commissionFor(u.id, 90_000);
    const batch = await prisma.payout.create({ data: { userId: u.id, method: 'BANK', amount: 90_000, fee: 0, status: 'REQUESTED' } });
    await prisma.commission.update({ where: { id: c.id }, data: { payoutBatchId: batch.id } });
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(u.id);
    expect(s.balance).toBe(0);
    expect(s.commissions[0]!.status).toBe('APPROVED');
  });

  it('CTV bị khoá: cron không tự chuyển (commission giữ APPROVED, Ví 0); mở khoá thì cron chuyển', async () => {
    const blocked = await ctv({ isBlocked: true });
    const normal = await ctv();
    await commissionFor(blocked.id, 80_000);
    await commissionFor(normal.id, 80_000);
    await affiliate.autoTransferApprovedToWallet();
    const sb = await state(blocked.id);
    expect(sb.balance).toBe(0);
    expect(sb.payouts).toHaveLength(0);
    expect(sb.commissions[0]!.status).toBe('APPROVED');
    expect((await state(normal.id)).balance).toBe(80_000);
    await prisma.user.update({ where: { id: blocked.id }, data: { isBlocked: false } });
    await affiliate.autoTransferApprovedToWallet();
    expect((await state(blocked.id)).balance).toBe(80_000);
  });

  it('thuế truy thu ăn hết số tiền lần này: payout tạo, commission PAID, Ví +0, CTV nhận tin "đã khấu trừ" (không nhận tin dặn bấm tay)', async () => {
    const u = await ctv({ personalTaxId: MST });
    await commissionFor(u.id, 4_900_000);
    await affiliate.autoTransferApprovedToWallet();
    expect((await state(u.id)).balance).toBe(4_900_000);
    await commissionFor(u.id, 100_000);
    await affiliate.autoTransferApprovedToWallet();
    const s = await state(u.id);
    expect(s.balance).toBe(4_900_000);
    expect(s.commissions.every((c) => c.status === 'PAID')).toBe(true);
    expect(s.payouts.map((p) => [p.grossAmount, p.taxWithheld, p.amount]).sort()).toEqual([[100_000, 100_000, 0], [4_900_000, 0, 4_900_000]]);
    const logs = await prisma.notificationLog.findMany({ where: { userId: u.id } });
    expect(logs.filter((l) => l.templateCode === CTV_NOTIFICATION.AUTO_WALLET_TAX_ONLY)).toHaveLength(1);
    expect(logs.some((l) => l.templateCode === CTV_NOTIFICATION.APPROVED)).toBe(false);
  });
});
