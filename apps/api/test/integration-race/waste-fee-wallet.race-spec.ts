import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { applyWalletDelta } from '../../src/modules/wallet/wallet-ledger.service';
import { WasteAccessService } from '../../src/modules/waste-exchange/core/waste-access.service';
import { WasteConfigService } from '../../src/modules/waste-exchange/core/waste-config.service';
import { WasteHoldService } from '../../src/modules/waste-exchange/core/waste-hold.service';
import { WasteNotifierService } from '../../src/modules/waste-exchange/core/waste-notifier.service';
import { WasteShipLockService } from '../../src/modules/waste-exchange/core/waste-ship-lock.service';
import { WasteExpiryCron } from '../../src/modules/waste-exchange/pickup/waste-expiry.cron';
import { WasteHomePickupCustomerService } from '../../src/modules/waste-exchange/home-pickup/waste-home-pickup-customer.service';
import { WasteHomePickupService } from '../../src/modules/waste-exchange/home-pickup/waste-home-pickup.service';
import { cleanupWaste, createWarehouse, createWasteItem } from './fixtures/waste-fixtures';
import { createUser, deleteItData, randCode, setConfig, warmPool } from './helpers';

jest.mock('../../src/modules/waste-exchange/core/waste-public-config', () => ({
  computeWastePublicFlags: jest.fn().mockResolvedValue({ enabled: true, dropoff: true, mailin: true, pickup: true }),
}));

/**
 * Race suite Postgres thật cho W178 (§2.5):
 * (a) khách huỷ × webhook mã 2 × cron hết hạn chạy đồng thời trên cùng phiếu đã trả phí Ví:
 *     Ví Tubu được hoàn đúng MỘT lần, Điểm Xanh hoàn đúng MỘT lần, SUM(wallet_transactions.delta) === users.walletBalance,
 *     và ràng buộc waste_fee_split_ck / waste_fee_cash_refund_ck / waste_fee_cod_zero_ck luôn thỏa.
 * (d) tạo phiếu HOME_PICKUP trả Ví × giao dịch đặt đơn trừ Ví đồng thời khi số dư Ví chỉ đủ cho một:
 *     đúng một giao dịch thành công, phiếu thua không bị trừ Điểm Xanh, SUM(wallet_transactions.delta) === users.walletBalance.
 */
describe('W178 home pickup wallet fee races (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let customerSvc: WasteHomePickupCustomerService;
  let lifecycle: WasteHomePickupService;
  let expiryCron: WasteExpiryCron;
  let itemId: string;
  const userIds: string[] = [];
  const reg = { pointIds: [] as string[], itemIds: [] as string[], giftIds: [] as string[], storefrontIds: [] as string[] };
  const savedConfig: { key: string; value: unknown }[] = [];
  const CONFIG_KEYS = ['waste.enabled', 'waste.lane_pickup_enabled', 'waste.pickup_min_points', 'waste.max_open_requests'];

  const gomdonMock = {
    checkAddress: jest.fn().mockResolvedValue({ ok: true }),
    isConfigured: jest.fn().mockResolvedValue(true),
    quoteShopFeeDetailed: jest.fn().mockResolvedValue({ fee: 25_000, estimated: false }),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        PricingService,
        CouponsService,
        LoyaltyExpiryService,
        LoyaltyService,
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined), notifySafe: jest.fn().mockResolvedValue(true) } },
        { provide: GomdonClient, useValue: gomdonMock },
        {
          provide: WasteNotifierService,
          useValue: {
            homePickupClosed: jest.fn().mockResolvedValue(undefined),
            requestExpired: jest.fn().mockResolvedValue(undefined),
            requestExpiring: jest.fn().mockResolvedValue(undefined),
            shipLocked: jest.fn().mockResolvedValue(undefined),
          },
        },
        WasteConfigService,
        WasteAccessService,
        WasteHoldService,
        WasteShipLockService,
        WasteHomePickupService,
        WasteHomePickupCustomerService,
        WasteExpiryCron,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    customerSvc = moduleRef.get(WasteHomePickupCustomerService);
    lifecycle = moduleRef.get(WasteHomePickupService);
    expiryCron = moduleRef.get(WasteExpiryCron);

    for (const ck of ['waste_fee_split_ck', 'waste_fee_cash_refund_ck', 'waste_fee_cod_zero_ck']) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "waste_requests" VALIDATE CONSTRAINT "${ck}"`);
    }

    const existing = await prisma.systemConfig.findMany({ where: { key: { in: CONFIG_KEYS } }, select: { key: true, value: true } });
    savedConfig.push(...existing);
    await setConfig(prisma, 'waste.enabled', true);
    await setConfig(prisma, 'waste.lane_pickup_enabled', true);
    await setConfig(prisma, 'waste.pickup_min_points', 3_000);
    await setConfig(prisma, 'waste.max_open_requests', 5);
    (moduleRef.get(SystemConfigService) as unknown as { cache: Map<string, unknown> }).cache.clear();

    await createWarehouse(prisma);
    const item = await createWasteItem(prisma, { unitsPerPoint: 1, pointsPerGroup: 1_000, dailyCapQty: null, monthlyCapQty: null });
    itemId = item.id;
    reg.itemIds.push(item.id);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
      await cleanupWaste(prisma, reg);
      await deleteItData(prisma, { userIds });
      for (const c of savedConfig) await setConfig(prisma, c.key, c.value as never);
    }
    await moduleRef?.close();
  });

  async function seedCustomerWithWallet(points: number, walletVnd: number) {
    const u = await createUser(prisma, { phone: phone(), pointsBalance: points });
    userIds.push(u.id);
    if (points > 0) {
      await prisma.pointsTransaction.create({
        data: { userId: u.id, delta: points, lot: 'STANDARD', reason: 'IT_SEED', refType: 'SEED', refId: `seed-${u.id}` },
      });
    }
    if (walletVnd > 0) {
      await prisma.$transaction((tx) =>
        applyWalletDelta(tx, {
          userId: u.id,
          delta: walletVnd,
          type: 'CASHBACK',
          refType: 'SEED',
          refId: `seed-${u.id}`,
          reason: 'Seed ví test',
        }),
      );
    }
    const addr = await prisma.address.create({
      data: {
        userId: u.id,
        recipient: 'Lan IT',
        phone: u.phone!,
        province: 'Thành phố Hồ Chí Minh',
        district: '',
        ward: 'Phường Bến Nghé',
        street: '1 Lê Lợi',
        provinceCode: '79',
        districtCode: '',
        wardCode: '26734',
      },
    });
    return { user: u, addressId: addr.id };
  }

  async function assertWalletLedgerMatchesBalance(userId: string) {
    const [u, agg] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { walletBalance: true, pointsBalance: true } }),
      prisma.walletTransaction.aggregate({ where: { userId }, _sum: { delta: true } }),
    ]);
    expect(u.walletBalance).toBe(agg._sum.delta ?? 0);
    expect(u.walletBalance).toBeGreaterThanOrEqual(0);
    expect(u.pointsBalance).toBeGreaterThanOrEqual(0);
    return u;
  }

  it('(a) cancel × webhook 2 × expiry cron on a WALLET-paid request refunds cash & points exactly once', async () => {
    for (let round = 0; round < 5; round++) {
      const { user, addressId } = await seedCustomerWithWallet(8_000, 40_000);
      const reqId = await customerSvc.create(user.id, `idem-close-${round}-${randCode(6)}`, {
        method: 'HOME_PICKUP',
        lines: [{ itemId, declaredQty: 5 }],
        consent: true,
        pickupAddressId: addressId,
        declaredWeightGrams: 2_000,
        usePointsForShipFee: true,
        shipFeePayment: 'WALLET',
        expectedCashVnd: 17_000,
      });

      // Chuyển phiếu về trạng thái đã tạo vận đơn và quá hạn giữ chỗ để cả 3 luồng đóng đều hợp lệ.
      const past = new Date(Date.now() - 60_000);
      const updated = await prisma.wasteRequest.update({
        where: { id: reqId },
        data: {
          gomdonOrderId: `GD-${round}`,
          gomdonPartnerCode: `BE-${round}`,
          gomdonStatus: '1',
          gomdonStatusAt: past,
          expiresAt: past,
        },
      });
      expect(updated.shipFeeCashVnd).toBe(17_000);
      expect(updated.shipFeeCodVnd).toBe(0);

      const closeByCron = () =>
        (expiryCron as unknown as { closeRow(r: unknown, now: Date): Promise<unknown> }).closeRow(
          {
            id: updated.id,
            code: updated.code,
            userId: user.id,
            pointId: updated.pointId,
            method: 'HOME_PICKUP',
            status: 'OPEN',
            orderId: null,
            shipFeePointsUsed: updated.shipFeePointsUsed,
            shipFeeCashVnd: updated.shipFeeCashVnd,
            shipFeeCashPaidAt: updated.shipFeeCashPaidAt,
            gomdonOrderId: updated.gomdonOrderId,
          },
          new Date(),
        );

      await Promise.allSettled([
        customerSvc.cancel(user.id, reqId),
        lifecycle.applyWebhook(updated as never, {
          status: 2,
          eventTime: new Date(),
          gomdonOrderId: updated.gomdonOrderId!,
          partnerCode: updated.gomdonPartnerCode!,
        }),
        closeByCron(),
      ]);

      const after = await assertWalletLedgerMatchesBalance(user.id);
      expect(after.walletBalance).toBe(40_000);
      expect(after.pointsBalance).toBe(8_000);

      const refunds = await prisma.walletTransaction.findMany({ where: { userId: user.id, type: 'WASTE_FEE_REFUND' } });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.delta).toBe(17_000);

      const freshReq = await prisma.wasteRequest.findUniqueOrThrow({ where: { id: reqId } });
      expect(['CANCELLED', 'EXPIRED']).toContain(freshReq.status);
      expect(freshReq.shipFeeCashRefundedVnd).toBe(17_000);
      expect(freshReq.shipFeePointsRefunded).toBe(8_000);
    }
  });

  it('(d) concurrent HOME_PICKUP WALLET create × ORDER_PAY wallet spend when wallet fits only one: exactly one wins, loser rolls back points', async () => {
    const winners = new Set<string>();
    for (let round = 0; round < 8; round++) {
      // Phí ship 25.000đ - 8.000 điểm = 17.000đ Ví; đơn hàng cần 15.000đ Ví; số dư Ví = 20.000đ -> chỉ đủ cho MỘT bên!
      const { user, addressId } = await seedCustomerWithWallet(8_000, 20_000);

      const createWaste = async () => {
        await customerSvc.create(user.id, `idem-race-${round}-${randCode(6)}`, {
          method: 'HOME_PICKUP',
          lines: [{ itemId, declaredQty: 5 }],
          consent: true,
          pickupAddressId: addressId,
          declaredWeightGrams: 2_000,
          usePointsForShipFee: true,
          shipFeePayment: 'WALLET',
          expectedCashVnd: 17_000,
        });
        return 'waste';
      };

      const spendOrder = async () => {
        await prisma.$transaction((tx) =>
          applyWalletDelta(tx, {
            userId: user.id,
            delta: -15_000,
            type: 'ORDER_PAY',
            refType: 'ORDER',
            refId: `it-order-${round}-${randCode(6)}`,
            reason: 'Thanh toán đơn test đua Ví',
          }),
        );
        return 'order';
      };

      const [w, o] = await Promise.allSettled(round % 2 === 0 ? [createWaste(), spendOrder()] : [spendOrder(), createWaste()]);
      const fulfilled = [w, o].filter((s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      winners.add(fulfilled[0]!.value);

      const after = await assertWalletLedgerMatchesBalance(user.id);
      const reqCount = await prisma.wasteRequest.count({ where: { userId: user.id } });
      if (fulfilled[0]!.value === 'waste') {
        expect(after.walletBalance).toBe(3_000);
        expect(after.pointsBalance).toBe(0);
        expect(reqCount).toBe(1);
      } else {
        // Phiếu lấy rác thua phải lùi toàn bộ 8.000 Điểm Xanh đã tính trong transaction!
        expect(after.walletBalance).toBe(5_000);
        expect(after.pointsBalance).toBe(8_000);
        expect(reqCount).toBe(0);
      }
    }
    expect(winners.size).toBeGreaterThanOrEqual(1);
  });
});
