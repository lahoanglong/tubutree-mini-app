import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { CoinsService } from '../../src/modules/wallet/coins.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { applyWalletDelta } from '../../src/modules/wallet/wallet-ledger.service';
import { findWalletLedgerDrift } from '../../src/modules/wallet/wallet-reconcile';
import { CashbackService } from '../../src/modules/cashback/cashback.service';
import { CashbackProviderRegistry } from '../../src/modules/cashback/providers/cashback-provider.registry';
import { createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * C-060 yêu cầu 4+5: rút tiền, hoàn lệnh rút, đổi xu và cashback chạy SONG SONG trên cùng một ví
 * → số dư == tổng sổ (hàm đối soát không báo lệch), không âm, mỗi tham chiếu đúng một dòng; sao kê
 * phân trang trả đủ đúng các dòng đó. Đồng thời chứng minh hàm đối soát bắt được ghi ví bỏ qua sổ.
 */
describe('Đối soát + sao kê Ví Tubu (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let wallet: WalletService;
  let affiliate: AffiliateService;
  let cashback: CashbackService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        AffiliateService,
        CoinsService,
        WalletService,
        CashbackService,
        { provide: PricingService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: CashbackProviderRegistry, useValue: { all: () => [] } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    wallet = moduleRef.get(WalletService);
    affiliate = moduleRef.get(AffiliateService);
    cashback = moduleRef.get(CashbackService);

    await setConfig(prisma, 'wallet.withdraw_min', 100_000);
    await setConfig(prisma, 'wallet.withdraw_fee', 3_000);
    await setConfig(prisma, 'wallet.xu_convert_multiplier', 1.2);
    await setConfig(prisma, 'cashback.hold_days', 30);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function newWallet(opening: number, extra: Parameters<typeof createUser>[1] = {}) {
    const user = await createUser(prisma, extra);
    if (opening !== 0) {
      await prisma.$transaction((tx) =>
        applyWalletDelta(tx, { userId: user.id, delta: opening, type: 'OPENING', refType: 'OPENING', refId: 'OPENING' }),
      );
    }
    return user;
  }

  it('rút + hoàn lệnh rút ×2 + đổi xu + cashback song song → đối soát không lệch, không âm, mỗi tham chiếu 1 dòng, sao kê đủ dòng', async () => {
    const u = await newWallet(300_000, { cashbackPending: 35_000 });
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const first = await wallet.withdraw(u.id, 150_000, { bank: 'VCB' }, `wd-${randCode(8)}`);
    const cb = await prisma.cashbackTransaction.create({
      data: {
        userId: u.id,
        provider: 'it-reconcile',
        merchantOrderId: `mo-${randCode(10)}`,
        orderAmount: 700_000,
        commission: 70_000,
        userReward: 35_000,
        status: 'CONFIRMED',
        postbackPayload: {},
        confirmedAt: new Date(Date.now() - 40 * 864e5),
      },
    });

    // Còn 150k trên ví, tối đa 335k sau hoàn 150k + cashback 35k, trong khi lệnh trừ cộng lại 420k;
    // hoàn/cashback có thể vào trước hoặc sau các lệnh trừ, nên số
    // lệnh trừ thành công phụ thuộc thứ tự — điều bất biến là sổ luôn khớp và không âm.
    await Promise.allSettled([
      affiliate.rejectPayout(admin.id, first.payoutId, 'Sai STK'),
      affiliate.rejectPayout(admin.id, first.payoutId, 'Sai STK'),
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.withdraw(u.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`),
      wallet.convertToXu(u.id, 60_000, `cv-${randCode(8)}`),
      wallet.convertToXu(u.id, 60_000, `cv-${randCode(8)}`),
      cashback.settleConfirmed(),
      cashback.settleConfirmed(),
    ]);

    const report = await findWalletLedgerDrift(prisma, { userIds: [u.id] });
    expect(report.affectedCount).toBe(0);

    const { walletBalance } = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { walletBalance: true } });
    expect(walletBalance).toBeGreaterThanOrEqual(0);
    const rows = await prisma.walletTransaction.findMany({ where: { userId: u.id } });
    expect(rows.reduce((s, r) => s + r.delta, 0)).toBe(walletBalance);
    expect(rows.every((r) => r.balanceAfter >= 0)).toBe(true);

    const refunds = rows.filter((r) => r.type === 'WITHDRAW_REFUND');
    expect(refunds).toEqual([expect.objectContaining({ delta: 150_000, refId: first.payoutId })]);
    expect(rows.filter((r) => r.type === 'CASHBACK')).toEqual([expect.objectContaining({ delta: 35_000, refId: cb.id })]);
    const keys = rows.map((r) => `${r.type}:${r.refId}`);
    expect(new Set(keys).size).toBe(keys.length);

    // Mỗi lệnh rút thành công có đúng 1 payout WALLET và đúng 1 dòng WITHDRAW, không thừa không thiếu.
    const payouts = await prisma.payout.findMany({ where: { userId: u.id }, select: { id: true } });
    const withdrawRefs = rows.filter((r) => r.type === 'WITHDRAW').map((r) => r.refId);
    expect(withdrawRefs.sort()).toEqual(payouts.map((p) => p.id).sort());

    // Sao kê 2 trang (limit 3) phủ đúng toàn bộ sổ, mới nhất trước, không trùng.
    const p1 = await wallet.getTransactions(u.id, 1, 3);
    const rest = await Promise.all(
      Array.from({ length: Math.ceil(p1.meta.total / 3) - 1 }, (_, i) => wallet.getTransactions(u.id, i + 2, 3)),
    );
    const listed = [p1, ...rest].flatMap((p) => p.data);
    expect(p1.meta.total).toBe(rows.length);
    expect(listed.map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
    const times = listed.map((r) => new Date(r.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('đối soát bắt được số dư ví bị ghi bỏ qua sổ; ví khớp sổ không bị báo', async () => {
    const ok = await newWallet(80_000);
    await wallet.withdraw(ok.id, 100_000, { bank: 'VCB' }, `wd-${randCode(8)}`).catch(() => undefined);
    const tampered = await newWallet(50_000);
    await prisma.$executeRaw`UPDATE "users" SET "walletBalance" = "walletBalance" + 7000 WHERE "id" = ${tampered.id}`;
    const noLedger = await createUser(prisma, { walletBalance: 12_000 });

    const report = await findWalletLedgerDrift(prisma, { userIds: [ok.id, tampered.id, noLedger.id] });
    expect(report.drifts).toEqual([
      { userId: noLedger.id, walletBalance: 12_000, ledgerSum: 0, drift: 12_000, entries: 0 },
      { userId: tampered.id, walletBalance: 57_000, ledgerSum: 50_000, drift: 7_000, entries: 1 },
    ]);
    expect(report.totalDrift).toBe(19_000);
  });
});
