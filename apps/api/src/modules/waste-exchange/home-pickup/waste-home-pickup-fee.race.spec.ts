import { HttpException, Logger } from '@nestjs/common';
import { tick } from '../../../../test/fakes/race-db.fake';
import { cartonLine, createWasteRaceDb, request, user, warehouse } from '../../../../test/fakes/waste-race.harness';
import { applyWalletDelta } from '../../wallet/wallet-ledger.service';
import { WasteAccessService } from '../core/waste-access.service';
import { WasteExpiryCron } from '../pickup/waste-expiry.cron';
import { WasteHomePickupCustomerService } from './waste-home-pickup-customer.service';
import { WasteHomePickupService } from './waste-home-pickup.service';

jest.mock('../core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ pickup: true }) }));

/**
 * Đua tiền & điểm của W178 (§2.5):
 * (a) khách huỷ × webhook mã 2 × cron hết hạn cùng lúc: Ví và Điểm Xanh được hoàn đúng MỘT lần;
 * (b) tạo × tạo cùng khoá idempotency: đúng một dòng WASTE_FEE_PAY;
 * (c) tạo × tạo khác khoá khi Ví chỉ đủ cho một phiếu: đúng một phiếu thành công, phiếu thua KHÔNG làm hao điểm;
 * (d) tạo trả Ví × đặt đơn mua hàng trả Ví khi Ví chỉ đủ cho một: đúng một giao dịch thành công, số dư Ví khớp tổng sổ.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};
const SWEEP = Array.from({ length: 41 }, (_, i) => i - 20);
const HCM = 'Thành phố Hồ Chí Minh';
const EXPIRES = new Date('2027-11-15T00:00:00Z');

function setup(opts: { pointsBalance?: number; walletBalance?: number; seedPaidRequest?: boolean } = {}) {
  const { db, prisma } = createWasteRaceDb();
  db.seed('user', [
    user('u1', '0901234567', {
      pointsBalance: opts.pointsBalance ?? 8_000,
      pointsConvertedBalance: 0,
      walletBalance: opts.walletBalance ?? 20_000,
    }),
  ]);
  db.seed('wastePoint', [warehouse]);
  db.seed('address', [
    {
      id: 'a1',
      userId: 'u1',
      recipient: 'Lan',
      phone: '0901234567',
      province: HCM,
      ward: 'Phường Bến Nghé',
      street: '1 Lê Lợi',
      provinceCode: '79',
      wardCode: '26734',
    },
  ]);

  if (opts.seedPaidRequest) {
    db.seed('wasteRequest', [
      request({
        id: 'r1',
        code: 'TR-A2C4E',
        userId: 'u1',
        method: 'HOME_PICKUP',
        status: 'OPEN',
        gomdonOrderId: '555',
        gomdonPartnerCode: 'BE123',
        gomdonStatus: '1',
        gomdonStatusAt: new Date('2026-11-08T00:00:00Z'),
        expiresAt: new Date('2026-11-09T00:00:00Z'),
        shipFeeVnd: 25_000,
        shipFeePointsUsed: 8_000,
        shipFeeCashVnd: 17_000,
        shipFeeCashMethod: 'WALLET',
        shipFeeCashPaidAt: new Date('2026-11-08T00:00:00Z'),
        shipFeeCashRefundedVnd: null,
        shipFeeCodVnd: 0,
        shipFeePointsRefunded: null,
      }),
    ]);
    db.seed('wasteRequestLine', [cartonLine('r1')]);
    db.seed('pointsTransaction', [
      {
        id: 'pt-seed',
        userId: 'u1',
        delta: -8_000,
        lot: 'STANDARD',
        reason: 'WASTE_PICKUP_FEE:TR-A2C4E',
        refType: 'WASTE_REQUEST',
        refId: 'r1',
      },
    ]);
    db.seed('walletTransaction', [
      {
        id: 'wt-seed',
        userId: 'u1',
        delta: -17_000,
        balanceAfter: opts.walletBalance ?? 20_000,
        type: 'WASTE_FEE_PAY',
        refType: 'WASTE_REQUEST',
        refId: 'r1',
        reason: 'Phí lấy rác tận nhà · TR-A2C4E',
      },
    ]);
  }

  const config = {
    pointExpiresAt: jest.fn().mockResolvedValue(EXPIRES),
    snapshot: jest.fn().mockResolvedValue({
      enabled: true,
      laneDropoff: true,
      laneMailin: true,
      lanePickup: true,
      mailinMinPoints: 3_000,
      pickupMinPoints: 3_000,
      customerMonthlyCapPoints: 60_000,
      maxOpenRequests: 5,
      requestHoldDays: 7,
      shortfallLockPct: 50,
      shortfallLockStreak: 3,
      rulesVersion: 'v1',
      homePickupBankTransferEnabled: false,
      feePaymentTtlHours: 24,
    }),
  };
  const notifier = {
    homePickupClosed: jest.fn().mockResolvedValue(undefined),
    requestExpired: jest.fn().mockResolvedValue(undefined),
    requestExpiring: jest.fn().mockResolvedValue(undefined),
  };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) };
  const gomdon = {
    checkAddress: jest.fn().mockResolvedValue({ ok: true }),
    isConfigured: jest.fn().mockResolvedValue(true),
    quoteShopFeeDetailed: jest.fn().mockResolvedValue({ fee: 25_000, estimated: false }),
    cancelOrder: jest.fn().mockResolvedValue({ ok: true }),
  };
  const loyalty = {
    returnWindowDays: jest.fn().mockResolvedValue(7),
    lockedOrderPoints: jest.fn().mockResolvedValue({ locked: 0, lockedReturn: 0, lockedUntil: null }),
  };
  const hold = {
    validateAndHold: jest.fn().mockResolvedValue({
      pointId: 'wh',
      capDayKey: '2026-11-16',
      capMonthKey: '2026-11',
      expiresAt: new Date('2026-11-23T16:59:59Z'),
      estimatedPoints: 5_000,
      estimatedDrops: 0,
      lines: [
        {
          itemId: 'wi-carton',
          itemCode: 'CARTON',
          itemName: 'Thùng carton',
          unitLabel: 'thùng',
          unitsPerPoint: 1,
          pointsPerGroup: 1_000,
          dropsPerUnit: 0,
          gramsPerUnit: 300,
          declaredQty: 5,
          hazardous: false,
        },
      ],
    }),
  };
  const access = new WasteAccessService(prisma);
  const lifecycle = new WasteHomePickupService(prisma, config as never, notifier as never, shipLock as never);
  const customerSvc = new WasteHomePickupCustomerService(
    prisma,
    config as never,
    hold as never,
    {} as never,
    gomdon as never,
    loyalty as never,
    lifecycle,
  );
  const cron = new WasteExpiryCron(prisma, config as never, notifier as never, shipLock as never, access);

  return { db, prisma, lifecycle, customerSvc, cron };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('W178 — Đua Ví Tubu & Điểm Xanh trên HOME_PICKUP (§2.5)', () => {
  it('(a) khách huỷ × webhook mã 2 × cron hết hạn cùng lúc: Ví và Điểm Xanh được hoàn đúng MỘT lần', async () => {
    for (const skew of SWEEP) {
      const { db, customerSvc, lifecycle, cron } = setup({ pointsBalance: 0, walletBalance: 3_000, seedPaidRequest: true });
      const row = db.row('wasteRequest', 'r1')!;
      const cancel = async () => (await delay(Math.max(skew, 0)), customerSvc.cancel('u1', 'r1'));
      const webhook2 = async () =>
        (await delay(Math.max(-skew, 0)),
        lifecycle.applyWebhook(row as never, {
          status: 2,
          eventTime: new Date('2026-11-10T01:00:00Z'),
          gomdonOrderId: '555',
          partnerCode: 'BE123',
        }));
      const expire = async () =>
        (await delay(Math.abs(skew) % 3),
        (cron as unknown as { closeRow(r: unknown, now: Date): Promise<unknown> }).closeRow(
          {
            id: 'r1',
            code: 'TR-A2C4E',
            userId: 'u1',
            pointId: 'wh',
            method: 'HOME_PICKUP',
            status: 'OPEN',
            orderId: null,
            shipFeePointsUsed: 8_000,
            shipFeeCashVnd: 17_000,
            shipFeeCashPaidAt: new Date('2026-11-08T00:00:00Z'),
            gomdonOrderId: '555',
          },
          new Date('2026-11-10T03:30:00Z'),
        ));

      await Promise.allSettled([cancel(), webhook2(), expire()]);

      const u = db.row('user', 'u1')!;
      const refunds = db.rows('walletTransaction').filter((w) => w.type === 'WASTE_FEE_REFUND');
      const pointRefunds = db.rows('pointsTransaction').filter((p) => (p.delta as number) > 0);
      expect(refunds).toHaveLength(1);
      expect(refunds[0]!.delta).toBe(17_000);
      expect(u.walletBalance).toBe(20_000);
      expect(pointRefunds).toHaveLength(1);
      expect(u.pointsBalance).toBe(8_000);
      expect(db.row('wasteRequest', 'r1')!.shipFeeCashRefundedVnd).toBe(17_000);
    }
  });

  it('(b) tạo × tạo cùng khoá idempotency: đúng một phiếu, một dòng WASTE_FEE_PAY, không trừ đôi', async () => {
    for (const skew of [-5, 0, 5]) {
      const { db, customerSvc } = setup({ pointsBalance: 8_000, walletBalance: 40_000 });
      const body = {
        method: 'HOME_PICKUP' as const,
        lines: [{ itemId: 'wi-carton', declaredQty: 5 }],
        consent: true as const,
        pickupAddressId: 'a1',
        declaredWeightGrams: 2000,
        usePointsForShipFee: true,
        shipFeePayment: 'WALLET' as const,
        expectedCashVnd: 17_000,
      };
      const a = async () => (await delay(Math.max(skew, 0)), customerSvc.create('u1', 'idem-same-key', body));
      const b = async () => (await delay(Math.max(-skew, 0)), customerSvc.create('u1', 'idem-same-key', body));
      const [ra, rb] = await Promise.all([a(), b()]);
      expect(ra).toBe(rb);
      expect(db.rows('wasteRequest')).toHaveLength(1);
      expect(db.rows('walletTransaction').filter((w) => w.type === 'WASTE_FEE_PAY')).toHaveLength(1);
      expect(db.row('user', 'u1')!.walletBalance).toBe(23_000);
      expect(db.row('user', 'u1')!.pointsBalance).toBe(0);
    }
  });

  it('(c) tạo × tạo khác khoá khi Ví chỉ đủ cho MỘT phiếu: một thành công, phiếu thua rollback hoàn toàn (không trừ điểm)', async () => {
    for (const skew of [-5, 0, 5]) {
      // Phí 25.000đ. Lần thắng dùng 8.000 điểm + 17.000đ Ví -> còn 0 điểm, 3.000đ Ví. Lần thua cần 25.000đ Ví nhưng chỉ còn 3.000đ -> rollback!
      // Thử cả trường hợp điểm dồi dào (20.000 điểm mỗi lần = 10.000 + 10.000, phí 25.000đ -> mỗi phiếu cần 15.000đ Ví nhưng Ví chỉ có 20.000đ):
      // Nếu tx thua không lùi cả điểm thì khách mất oan 10.000 điểm!
      const { db, customerSvc } = setup({ pointsBalance: 16_000, walletBalance: 20_000 });
      // Phiếu 1 dùng hết 16.000 điểm + 9.000đ Ví -> còn 11.000đ Ví; phiếu 2 có 0 điểm nên cần 25.000đ Ví -> thiếu!
      // Để chứng minh rollback điểm của chính phiếu thua: cho user 0 điểm hoặc cho phiếu thua trừ điểm trước rồi mới trượt Ví:
      // Đặt pointsBalance = 8.000, fee = 25.000, walletBalance = 10.000 -> ngay phiếu đầu đã trừ 8.000 điểm rồi trượt Ví 17.000đ -> điểm phải còn nguyên 8.000!
      // Và khi 2 phiếu đua nhau với walletBalance = 20.000, pointsBalance = 8.000: tổng điểm cuối cùng = 0 (chỉ trừ cho đúng 1 phiếu thắng).
      const makeBody = () => ({
        method: 'HOME_PICKUP' as const,
        lines: [{ itemId: 'wi-carton', declaredQty: 5 }],
        consent: true as const,
        pickupAddressId: 'a1',
        declaredWeightGrams: 2000,
        usePointsForShipFee: true,
        shipFeePayment: 'WALLET' as const,
      });
      const first = async () => (await delay(Math.max(skew, 0)), customerSvc.create('u1', 'idem-k1', makeBody()));
      const second = async () => (await delay(Math.max(-skew, 0)), customerSvc.create('u1', 'idem-k2', makeBody()));
      const settled = await Promise.allSettled([first(), second()]);
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((s) => s.status === 'rejected')).toHaveLength(1);
      expect(db.rows('wasteRequest')).toHaveLength(1);
      expect(db.rows('walletTransaction')).toHaveLength(1);

      // Cũng kiểm trực tiếp ca Ví thiếu ngay từ đầu khi có điểm: điểm không bị trừ!
      const short = setup({ pointsBalance: 8_000, walletBalance: 10_000 });
      await expect(short.customerSvc.create('u1', 'idem-short', makeBody())).rejects.toBeInstanceOf(HttpException);
      expect(short.db.row('user', 'u1')!.pointsBalance).toBe(8_000);
      expect(short.db.rows('pointsTransaction')).toHaveLength(0);
      expect(short.db.rows('wasteRequest')).toHaveLength(0);
    }
  });

  it('(d) tạo HOME_PICKUP trả Ví × đặt đơn mua hàng trả Ví khi Ví chỉ đủ cho một: tuần tự trên khoá user, số dư không bao giờ âm', async () => {
    const winners = new Set<string>();
    for (const skew of SWEEP) {
      const { db, prisma, customerSvc } = setup({ pointsBalance: 8_000, walletBalance: 20_000 });
      const wasteCreate = async () => {
        await delay(Math.max(skew, 0));
        await customerSvc.create('u1', 'idem-waste', {
          method: 'HOME_PICKUP',
          lines: [{ itemId: 'wi-carton', declaredQty: 5 }],
          consent: true,
          pickupAddressId: 'a1',
          declaredWeightGrams: 2000,
          usePointsForShipFee: true,
          shipFeePayment: 'WALLET',
        });
        return 'waste';
      };
      const orderWalletSpend = async () => {
        await delay(Math.max(-skew, 0));
        await prisma.$transaction(async (tx: never) => {
          await applyWalletDelta(tx, {
            userId: 'u1',
            delta: -15_000,
            type: 'ORDER_PAY',
            refType: 'ORDER',
            refId: 'ord-1',
            reason: 'Thanh toán đơn TB-1',
          });
        });
        return 'order';
      };
      const [w, o] = await Promise.allSettled([wasteCreate(), orderWalletSpend()]);
      const fulfilled = [w, o].filter((s): s is PromiseFulfilledResult<string> => s.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      winners.add(fulfilled[0]!.value);

      const u = db.row('user', 'u1')!;
      const sumLedger = db.rows('walletTransaction').reduce((acc, r) => acc + (r.delta as number), 20_000);
      expect(u.walletBalance).toBeGreaterThanOrEqual(0);
      expect(u.walletBalance).toBe(sumLedger);
      if (fulfilled[0]!.value === 'order') {
        // Phiếu lấy rác thua phải lùi cả 8.000 Điểm Xanh!
        expect(u.pointsBalance).toBe(8_000);
        expect(db.rows('wasteRequest')).toHaveLength(0);
      } else {
        expect(u.pointsBalance).toBe(0);
        expect(db.rows('wasteRequest')).toHaveLength(1);
      }
    }
    expect(winners).toEqual(new Set(['waste', 'order']));
  });
});
