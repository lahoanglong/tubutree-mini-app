import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AccountDeletionService, ANONYMIZED_NAME } from '../../src/modules/users/account-deletion.service';
import { UsersService } from '../../src/modules/users/users.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { applyWalletDelta } from '../../src/modules/wallet/wallet-ledger.service';
import { createOrder, createUser, randCode, setConfig, sleep, warmPool } from './helpers';

/**
 * Xoá tài khoản khi Ví còn tiền: khách đồng ý bỏ đúng số dư đã thấy; lúc xử lý Ví bị trừ về 0 bằng một dòng ADJUST trong cùng giao dịch
 * ẩn danh. Số dư đổi giữa lúc đồng ý và lúc xử lý (chuyển hoa hồng vào Ví, trả đơn bằng Ví) thì không được xoá và không trừ lệch.
 */
describe('Xoá tài khoản khi Ví còn tiền (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let deletion: AccountDeletionService;
  let users: UsersService;
  let affiliate: AffiliateService;
  let admin: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        AccountDeletionService,
        SystemConfigService,
        AnalyticsEventsService,
        RewardPointsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    deletion = moduleRef.get(AccountDeletionService);
    affiliate = moduleRef.get(AffiliateService);
    users = new UsersService(prisma);
    admin = await createUser(prisma, { role: 'ADMIN' });
    await setConfig(prisma, 'affiliate.pit_withhold_pct', 0.1);
    await setConfig(prisma, 'affiliate.pit_withhold_threshold', 5_000_000);
  });

  const requestUserIds: string[] = [];
  afterAll(async () => {
    // Yêu cầu PENDING còn sót chiếm 100 dòng đầu của danh sách admin, làm các spec khác không thấy yêu cầu của mình.
    await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: requestUserIds } } });
    await moduleRef?.close();
  });

  async function walletUser(balance: number) {
    const u = await createUser(prisma, { fullName: 'Nguyễn Văn Thật' });
    requestUserIds.push(u.id);
    if (balance > 0) {
      await prisma.$transaction((tx) =>
        applyWalletDelta(tx, { userId: u.id, delta: balance, type: 'ADJUST', refType: 'IT', refId: `seed-${randCode(8)}`, reason: 'nạp thử' }),
      );
    }
    return u;
  }

  async function ledger(userId: string) {
    const [user, rows] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
      prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { user, rows, sum: rows.reduce((s, r) => s + r.delta, 0) };
  }

  async function approvedCommission(affiliateUserId: string, amount: number) {
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
        status: 'APPROVED',
        lockedAt: new Date(Date.now() - 30 * 864e5),
        approvedAt: new Date(),
      },
    });
  }

  const consentFor = (n: number) => ({ accepted: true, acknowledgedWalletBalance: n });

  it('đồng ý đúng số dư: yêu cầu lưu số tiền và thời điểm; xử lý trừ Ví về 0 bằng một dòng ADJUST có lý do, ghi sổ việc admin, rồi ẩn danh', async () => {
    const u = await walletUser(42_000);
    await users.requestAccountDeletion(u.id, undefined, consentFor(42_000));
    const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    expect(req.walletForfeitAmount).toBe(42_000);
    expect(req.walletForfeitConsentAt).toBeInstanceOf(Date);

    const listed = (await deletion.list('PENDING')).find((r) => r.id === req.id);
    expect(listed?.walletForfeitAmount).toBe(42_000);
    expect(listed?.blockers).toEqual([]);

    await deletion.process(req.id, admin.id);

    const l = await ledger(u.id);
    expect(l.user.walletBalance).toBe(0);
    expect(l.user.fullName).toBe(ANONYMIZED_NAME);
    expect(l.sum).toBe(0);
    const adjust = l.rows.filter((r) => r.type === 'ADJUST' && r.refType === 'ACCOUNT_DELETION');
    expect(adjust).toHaveLength(1);
    expect(adjust[0]).toMatchObject({ delta: -42_000, refId: req.id, balanceAfter: 0 });
    expect(adjust[0]!.reason).toContain('đã đồng ý bỏ số dư Ví 42.000đ');
    const events = await prisma.userAdminEvent.findMany({ where: { userId: u.id, kind: 'WALLET_FORFEIT' } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromValue: '42000', toValue: '0', actorId: admin.id });
  });

  it('số khách thấy khác số dư hiện tại hoặc chưa tick → lỗi, không tạo yêu cầu; bản cũ chỉ gửi lý do thì vẫn tạo yêu cầu nhưng không ghi đồng ý', async () => {
    const u = await walletUser(30_000);
    const stale = await users.requestAccountDeletion(u.id, undefined, consentFor(20_000)).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(BadRequestException);
    expect((stale as BadRequestException).getResponse()).toMatchObject({ code: 'WALLET_FORFEIT_CONSENT', walletBalance: 30_000 });
    const unticked = await users.requestAccountDeletion(u.id, undefined, { accepted: false, acknowledgedWalletBalance: 30_000 }).catch((e: unknown) => e);
    expect(unticked).toBeInstanceOf(BadRequestException);
    expect((unticked as BadRequestException).getResponse()).toMatchObject({ code: 'WALLET_FORFEIT_CONSENT' });
    expect(await prisma.accountDeletionRequest.count({ where: { userId: u.id } })).toBe(0);

    await users.requestAccountDeletion(u.id, 'bản cũ');
    const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    expect(req.walletForfeitConsentAt).toBeNull();
    expect(req.walletForfeitAmount).toBeNull();
    await expect(deletion.process(req.id, admin.id)).rejects.toThrow(/Ví Tubu còn 30\.000đ mà khách chưa đồng ý bỏ số dư/);
  });

  it('yêu cầu cũ chưa có đồng ý mà Ví còn tiền: xử lý bị chặn; khách đồng ý lại trên chính yêu cầu đó thì xử lý được', async () => {
    const u = await walletUser(15_000);
    const req = await prisma.accountDeletionRequest.create({ data: { userId: u.id } });
    await expect(deletion.process(req.id, admin.id)).rejects.toThrow(/chưa đồng ý bỏ số dư/);
    expect((await ledger(u.id)).user.walletBalance).toBe(15_000);

    const again = await users.requestAccountDeletion(u.id, undefined, consentFor(15_000));
    expect(again.alreadyRequested).toBe(true);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: u.id } })).toBe(1);
    await deletion.process(req.id, admin.id);
    expect((await ledger(u.id)).user.walletBalance).toBe(0);
  });

  it('Ví tăng sau khi khách đồng ý: xử lý bị chặn, không trừ; Ví âm vẫn chặn dù có đồng ý', async () => {
    const u = await walletUser(20_000);
    await users.requestAccountDeletion(u.id, undefined, consentFor(20_000));
    await prisma.$transaction((tx) => applyWalletDelta(tx, { userId: u.id, delta: 5_000, type: 'ADJUST', refType: 'IT', refId: `up-${randCode(8)}`, reason: 'cộng thêm' }));
    const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    await expect(deletion.process(req.id, admin.id)).rejects.toThrow(/đã đổi từ 20\.000đ.*thành 25\.000đ/);
    expect((await ledger(u.id)).user.walletBalance).toBe(25_000);

    const neg = await createUser(prisma);
    requestUserIds.push(neg.id);
    await prisma.user.update({ where: { id: neg.id }, data: { walletBalance: -3_000 } });
    const negReq = await prisma.accountDeletionRequest.create({ data: { userId: neg.id, walletForfeitAmount: 3_000, walletForfeitConsentAt: new Date() } });
    await expect(deletion.process(negReq.id, admin.id)).rejects.toThrow(/đang âm 3\.000đ/);
  });

  it('hoa hồng đã duyệt chưa chuyển: câu chặn nhắc chuyển hoa hồng vào Ví trước', async () => {
    const u = await walletUser(0);
    await approvedCommission(u.id, 700_000);
    const req = await prisma.accountDeletionRequest.create({ data: { userId: u.id } });
    await expect(deletion.process(req.id, admin.id)).rejects.toThrow(/chưa chuyển vào Ví Tubu, khách cần chuyển hoa hồng vào Ví trước/);
  });

  it('đơn đã giao còn trong hạn đổi/trả: xử lý bị chặn, câu chặn có ngày hết hạn sớm nhất; quá hạn thì xử lý được', async () => {
    await setConfig(prisma, 'returns.window_days', 7);
    const u = await walletUser(0);
    const order = await createOrder(prisma, { userId: u.id, status: 'DELIVERED' });
    const deliveredAt = new Date(Date.now() - 2 * 864e5);
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt } });
    const req = await prisma.accountDeletionRequest.create({ data: { userId: u.id } });
    const expiry = new Date(deliveredAt.getTime() + 7 * 864e5 + 7 * 3600e3);
    const label = [expiry.getUTCDate(), expiry.getUTCMonth() + 1, expiry.getUTCFullYear()]
      .map((n, i) => String(n).padStart(i === 2 ? 4 : 2, '0'))
      .join('/');
    await expect(deletion.process(req.id, admin.id)).rejects.toThrow(new RegExp(`còn 1 đơn đã giao còn trong hạn đổi/trả \\(7 ngày\\), sớm nhất hết hạn ngày ${label}`));
    await prisma.order.update({ where: { id: order.id }, data: { deliveredAt: new Date(Date.now() - 9 * 864e5) } });
    const done = await deletion.process(req.id, admin.id);
    expect(done.alreadyProcessed).toBe(false);
  });

  it('hai admin cùng bấm xử lý một yêu cầu: Ví chỉ bị trừ một lần', async () => {
    const u = await walletUser(60_000);
    await users.requestAccountDeletion(u.id, undefined, consentFor(60_000));
    const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
    const [a, b] = await Promise.all([deletion.process(req.id, admin.id), deletion.process(req.id, admin.id)]);
    expect([a.alreadyProcessed, b.alreadyProcessed].sort()).toEqual([false, true]);
    const l = await ledger(u.id);
    expect(l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION')).toHaveLength(1);
    expect(l.user.walletBalance).toBe(0);
    expect(l.sum).toBe(0);
  });

  describe.each([0, 5, 25])('xử lý chạy cùng lúc với thay đổi Ví (bên kia chạy sau %dms)', (delayMs) => {
    it('chuyển hoa hồng vào Ví: không xoá khi số dư đã đổi, Ví khớp sổ, không trừ hai lần', async () => {
      const u = await walletUser(40_000);
      await users.requestAccountDeletion(u.id, undefined, consentFor(40_000));
      const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });
      await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: '079201001234' } });
      await approvedCommission(u.id, 300_000);

      const [proc, transfer] = await Promise.allSettled([
        deletion.process(req.id, admin.id),
        sleep(delayMs).then(() => affiliate.requestPayout(u.id, 300_000, 'WALLET_BALANCE')),
      ]);

      const l = await ledger(u.id);
      expect(l.user.walletBalance).toBe(l.sum);
      const forfeits = l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION');
      // Còn hoa hồng APPROVED chưa chuyển nên xử lý luôn bị chặn trước khi trừ Ví; chuyển xong thì số dư đã đổi nên vẫn bị chặn.
      expect(proc.status).toBe('rejected');
      expect(forfeits).toHaveLength(0);
      expect(l.user.fullName).not.toBe(ANONYMIZED_NAME);
      expect(l.user.walletBalance).toBe(transfer.status === 'fulfilled' ? 340_000 : 40_000);
    });

    it('khoản cộng vào Ví chen vào (không dính chặn nào khác): trừ đúng số khách đồng ý hoặc bị chặn vì số dư đã đổi, không bao giờ trừ số khác', async () => {
      const u = await walletUser(40_000);
      await users.requestAccountDeletion(u.id, undefined, consentFor(40_000));
      const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });

      const [proc] = await Promise.allSettled([
        deletion.process(req.id, admin.id),
        sleep(delayMs).then(() =>
          prisma.$transaction((tx) => applyWalletDelta(tx, { userId: u.id, delta: 7_000, type: 'ADJUST', refType: 'IT', refId: `in-${randCode(8)}`, reason: 'cộng chen' })),
        ),
      ]);

      const l = await ledger(u.id);
      expect(l.user.walletBalance).toBe(l.sum);
      const forfeits = l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION');
      if (proc.status === 'fulfilled') {
        expect(forfeits.map((r) => r.delta)).toEqual([-40_000]);
        expect(l.user.walletBalance).toBe(7_000);
      } else {
        expect(forfeits).toHaveLength(0);
        expect(l.user.walletBalance).toBe(47_000);
        expect(l.user.fullName).not.toBe(ANONYMIZED_NAME);
      }
    });

    it('đơn trả bằng Ví: hoặc Ví đã về 0 và đơn không tạo được, hoặc đơn trả xong và việc xoá bị chặn; không trừ lệch', async () => {
      const u = await walletUser(50_000);
      await users.requestAccountDeletion(u.id, undefined, consentFor(50_000));
      const req = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: u.id } });

      const [proc, pay] = await Promise.allSettled([
        deletion.process(req.id, admin.id),
        sleep(delayMs).then(() =>
          prisma.$transaction(async (tx) => {
            const order = await createOrder(tx as unknown as PrismaService, { userId: u.id, total: 20_000, paymentMethod: 'WALLET', paymentStatus: 'PAID' });
            await applyWalletDelta(tx, { userId: u.id, delta: -20_000, type: 'ORDER_PAY', refType: 'ORDER', refId: order.id, reason: 'Trả đơn bằng Ví' });
          }),
        ),
      ]);

      const l = await ledger(u.id);
      expect(l.user.walletBalance).toBe(l.sum);
      expect(l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION').length).toBeLessThanOrEqual(1);
      if (proc.status === 'fulfilled') {
        // Xoá xong trước: đã trừ đúng 50.000đ đồng ý, đơn trả Ví bị từ chối vì Ví 0.
        expect(l.user.fullName).toBe(ANONYMIZED_NAME);
        expect(l.user.walletBalance).toBe(0);
        expect(pay.status).toBe('rejected');
        expect(l.rows.filter((r) => r.type === 'ORDER_PAY')).toHaveLength(0);
        expect(l.rows.find((r) => r.refType === 'ACCOUNT_DELETION')?.delta).toBe(-50_000);
      } else {
        // Đơn trả trước: số dư 30.000đ khác 50.000đ đã đồng ý (hoặc còn đơn đang xử lý) nên không xoá, không trừ.
        expect(pay.status).toBe('fulfilled');
        expect(l.user.fullName).not.toBe(ANONYMIZED_NAME);
        expect(l.user.walletBalance).toBe(30_000);
        expect(l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION')).toHaveLength(0);
      }
    });

    it('gửi/đồng ý yêu cầu xoá chạy cùng lúc với chuyển hoa hồng vào Ví: số tiền đã lưu luôn là một số dư có thật, xử lý sau đó không xoá khi đã lệch', async () => {
      const u = await walletUser(10_000);
      await prisma.user.update({ where: { id: u.id }, data: { personalTaxId: '079201001234' } });
      await approvedCommission(u.id, 200_000);

      const [reqRes, transfer] = await Promise.allSettled([
        users.requestAccountDeletion(u.id, undefined, consentFor(10_000)),
        sleep(delayMs).then(() => affiliate.requestPayout(u.id, 200_000, 'WALLET_BALANCE')),
      ]);
      expect(transfer.status).toBe('fulfilled');
      const rows = await prisma.accountDeletionRequest.findMany({ where: { userId: u.id } });
      const l = await ledger(u.id);
      expect(l.user.walletBalance).toBe(210_000);
      if (reqRes.status === 'fulfilled') {
        // Yêu cầu vào trước lần chuyển: lưu 10.000đ (số dư lúc đó); xử lý sau phải bị chặn vì Ví đã 210.000đ.
        expect(rows).toHaveLength(1);
        expect(rows[0]!.walletForfeitAmount).toBe(10_000);
        await expect(deletion.process(rows[0]!.id, admin.id)).rejects.toThrow(/đã đổi từ 10\.000đ.*thành 210\.000đ/);
      } else {
        // Chuyển vào trước: số khách thấy (10.000đ) đã cũ, bị từ chối kèm số mới, không tạo yêu cầu.
        expect(rows).toHaveLength(0);
        expect((reqRes.reason as BadRequestException).getResponse()).toMatchObject({ code: 'WALLET_FORFEIT_CONSENT', walletBalance: 210_000 });
      }
      expect(l.rows.filter((r) => r.refType === 'ACCOUNT_DELETION')).toHaveLength(0);
    });
  });

  describe('migration 20261025140000_pit_threshold_5m', () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261025140000_pit_threshold_5m/migration.sql'), 'utf8');
    const OLD_DESC = 'Tổng hoa hồng rút trong tháng (giờ VN) từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)';
    const NEW_DESC = 'Tổng hoa hồng chuyển vào Ví trong tháng (giờ VN) từ số tiền này trở lên thì khấu trừ thuế TNCN (đồng)';
    const KEY = 'affiliate.pit_withhold_threshold';

    async function run() {
      for (const stmt of sql.replace(/^\s*--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean)) await prisma.$executeRawUnsafe(stmt);
    }
    async function row() {
      return prisma.systemConfig.findUniqueOrThrow({ where: { key: KEY } });
    }
    afterAll(async () => {
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 5_000_000, description: NEW_DESC } });
    });

    it('2.000.000 → 5.000.000 và sửa mô tả chữ "rút"; chạy lại không đổi gì thêm', async () => {
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 2_000_000, description: OLD_DESC } });
      await run();
      expect(await row()).toMatchObject({ value: 5_000_000, description: NEW_DESC });
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 7_000_000 } });
      await run();
      expect((await row()).value).toBe(7_000_000);
    });

    it('chỉ ghi một dòng lịch sử khi UPDATE thật sự đổi số; chạy lại hoặc admin đã đặt số khác thì không ghi thêm', async () => {
      const count = () => prisma.systemConfigHistory.count({ where: { key: KEY, changedBy: 'migration:pit_threshold_5m' } });
      await prisma.systemConfigHistory.deleteMany({ where: { key: KEY, changedBy: 'migration:pit_threshold_5m' } });
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 2_000_000 } });
      await run();
      expect(await count()).toBe(1);
      await run();
      expect(await count()).toBe(1);
      await prisma.systemConfigHistory.deleteMany({ where: { key: KEY, changedBy: 'migration:pit_threshold_5m' } });
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 5_000_000 } });
      await run();
      expect(await count()).toBe(0);
    });

    it('admin đã đặt số khác thì giữ nguyên số; mô tả admin tự sửa không bị đè', async () => {
      await prisma.systemConfig.update({ where: { key: KEY }, data: { value: 3_000_000, description: 'Mô tả của admin' } });
      await run();
      expect(await row()).toMatchObject({ value: 3_000_000, description: 'Mô tả của admin' });
    });
  });
});
