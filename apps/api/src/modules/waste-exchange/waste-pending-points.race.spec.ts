import { Logger } from '@nestjs/common';
import { tick } from '../../../test/fakes/race-db.fake';
import { cartonLine, createWasteRaceDb, request, user, warehouse } from '../../../test/fakes/waste-race.harness';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { RewardPointsService } from '../wallet/reward-points.service';
import { WasteAccessService } from './core/waste-access.service';
import { WasteHoldService } from './core/waste-hold.service';
import { WasteRequestsService } from './customer/waste-requests.service';
import { WasteHomePickupService } from './home-pickup/waste-home-pickup.service';
import { WasteConfirmService, type WasteStaffCall } from './receiving/waste-confirm.service';
import { WasteReceiveService } from './receiving/waste-receive.service';
import { WasteReverseService } from './receiving/waste-reverse.service';

jest.mock('../core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ dropoff: true, mailin: true, pickup: true }) }), { virtual: true });
jest.mock('./core/waste-public-config', () => ({ computeWastePublicFlags: jest.fn().mockResolvedValue({ dropoff: true, mailin: true, pickup: true }) }));

/**
 * W179-A (P3 & P4) — Bất biến Điểm tạm tính & Thu hồi điểm trên RaceDb:
 * - P3: Tạo phiếu -> webhook bưu tá lấy rác (3/4/7) -> kho nhận hàng (receive) -> huỷ (cancel) KHÔNG bao giờ làm tăng pointsBalance.
 *       Chỉ `WasteConfirmService.confirm` mới cộng điểm, và dưới `confirm × confirm` đồng thời điểm chỉ tăng ĐÚNG MỘT lần (`<= estimatedPoints`).
 * - P4: `reverse × redeemReward` đồng thời: cả hai khoá `users FOR UPDATE` (reverse khoá phiếu trước nên không tạo vòng),
 *       số dư Điểm Xanh không bao giờ âm và khớp sổ điểm.
 */
const delay = async (n: number) => {
  for (let i = 0; i < n; i++) await tick();
};

const CFG = {
  enabled: true,
  laneDropoff: true,
  laneMailin: true,
  lanePickup: true,
  mailinMinPoints: 3_000,
  pickupMinPoints: 3_000,
  customerMonthlyCapPoints: 60_000,
  maxOpenRequests: 2,
  requestHoldDays: 7,
  staffDailyCapPoints: 1_000_000,
  shortfallLockPct: 50,
  shortfallLockStreak: 3,
  rulesVersion: '2026-10-17.1',
};

function setup(initialPoints = 0) {
  const { db, prisma } = createWasteRaceDb();
  // Thêm bảng coupon cho LoyaltyService.redeemReward loại VOUCHER / SEED_PACK
  (prisma as Record<string, unknown>).order = { findMany: jest.fn().mockResolvedValue([]) };
  db.seed('user', [
    user('u1', '0901234567', { pointsBalance: initialPoints, zaloId: 'z-u1', phoneVerifiedAt: new Date('2026-10-01T00:00:00Z') }),
    user('s1', '0900000002', { role: 'STAFF' }),
    user('s2', '0900000003', { role: 'STAFF' }),
    user('a1', '0900000004', { role: 'ADMIN' }),
  ]);
  db.seed('wastePoint', [warehouse]);
  db.seed('wasteItem', [
    {
      id: 'wi-carton',
      code: 'CARTON',
      name: 'Thùng carton cũ',
      unitLabel: 'thùng',
      unitsPerPoint: 1,
      pointsPerGroup: 1000,
      dropsPerUnit: 0,
      dailyCapQty: 50,
      monthlyCapQty: 200,
      status: 'ACTIVE',
      gramsPerUnit: 300,
      hazardous: false,
      warehouseOnly: false,
    },
  ]);

  const sysConfig = { get: jest.fn(async (_k: string, fallback: unknown) => fallback) };
  const wasteCfg = {
    snapshot: jest.fn().mockResolvedValue(CFG),
    pointExpiresAt: jest.fn().mockResolvedValue(new Date('2027-11-16T00:00:00Z')),
  };
  const notifier = {
    pointsCredited: jest.fn().mockResolvedValue(undefined),
    requestRejected: jest.fn().mockResolvedValue(undefined),
    requestExpired: jest.fn().mockResolvedValue(undefined),
    pointsReversed: jest.fn().mockResolvedValue(undefined),
    parcelReceived: jest.fn().mockResolvedValue(undefined),
    homePickupClosed: jest.fn().mockResolvedValue(undefined),
  };
  const shipLock = { evaluateAndLock: jest.fn().mockResolvedValue({ locked: false, shipLockedAt: null, cancelledRequestIds: [] }) };
  const access = new WasteAccessService(prisma);
  jest.spyOn(access, 'availablePointIds').mockResolvedValue(new Set([warehouse.id]));
  const hold = new WasteHoldService(access);
  jest.spyOn(hold, 'capUsage').mockResolvedValue({
    itemDay: new Map(),
    itemMonth: new Map(),
    pointsMonth: 0,
    openCount: 0,
    pickupPendingCode: null,
    pickupPendingId: null,
  });
  const rewards = new RewardPointsService(prisma, sysConfig as never);
  const homeLifecycle = new WasteHomePickupService(prisma, wasteCfg as never, notifier as never, shipLock as never);
  const requestsSvc = new WasteRequestsService(prisma, access, hold, wasteCfg as never, sysConfig as never, undefined);
  jest.spyOn(requestsSvc, 'loadDetail').mockImplementation(async (_p, _u, id) => db.row('wasteRequest', id) as never);
  const receiveSvc = new WasteReceiveService(prisma, access, notifier as never);
  const confirmSvc = new WasteConfirmService(
    prisma,
    wasteCfg as never,
    access,
    rewards,
    sysConfig as never,
    notifier as never,
    shipLock as never,
    { recordBestEffort: async () => undefined } as never,
  );
  const reverseSvc = new WasteReverseService(prisma, wasteCfg as never, notifier as never, shipLock as never);
  const loyaltySvc = new LoyaltyService(prisma, sysConfig as never, {} as never, {} as never);
  jest.spyOn(loyaltySvc, 'lockedOrderPoints').mockResolvedValue({ locked: 0, lockedReturn: 0, lockedUntil: null } as never);

  return { db, prisma, requestsSvc, homeLifecycle, receiveSvc, confirmSvc, reverseSvc, loyaltySvc };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('W179-A (P3 & P4) — Điểm tạm tính không bao giờ cộng sớm, confirm cộng đúng 1 lần, reverse × redeemReward an toàn', () => {
  it('P3a: tạo phiếu -> webhook bưu tá lấy rác 3 / 4 / 7 -> kho nhận (RECEIVED) KHÔNG làm tăng pointsBalance; huỷ phiếu giữ nguyên 0', async () => {
    const h = setup(0);

    // 1. Tạo phiếu MAIL_IN rồi khách huỷ -> pointsBalance = 0
    const created = (await h.requestsSvc.create('u1', 'idem-m1', {
      method: 'MAIL_IN',
      lines: [{ itemId: 'wi-carton', declaredQty: 5 }],
      consent: true,
      packagingConsent: true,
      postagePaidConsent: true,
    })) as unknown as { id: string };
    expect(h.db.row('user', 'u1')!.pointsBalance).toBe(0);
    await h.requestsSvc.cancel('u1', created.id);
    expect(h.db.row('user', 'u1')!.pointsBalance).toBe(0);

    // 2. Phiếu HOME_PICKUP đi qua webhook 3 (bưu tá đã lấy) -> 4 -> 7 (giao tới kho) -> kho nhận (receive) -> pointsBalance VẪN = 0
    h.db.seed('wasteRequest', [
      request({
        id: 'hp1',
        code: 'TR-HP179',
        userId: 'u1',
        method: 'HOME_PICKUP',
        status: 'OPEN',
        estimatedPoints: 10_000,
        gomdonOrderId: '777',
        gomdonPartnerCode: 'BE777',
        gomdonStatus: '1',
        gomdonStatusAt: new Date('2026-11-16T01:00:00Z'),
        trackingCode: 'BE777',
        trackingNorm: 'BE777',
        carrier: 'BestExpress',
        shipFeeVnd: 0,
        shipFeePointsUsed: 0,
        shipFeeCodVnd: 0,
      }),
    ]);
    h.db.seed('wasteRequestLine', [cartonLine('hp1')]);

    for (const [idx, st] of [3, 4, 7].entries()) {
      const cur = h.db.row('wasteRequest', 'hp1')!;
      await h.homeLifecycle.applyWebhook(cur as never, {
        status: st,
        eventTime: new Date(Date.UTC(2026, 10, 16, 2 + idx)),
        gomdonOrderId: '777',
        partnerCode: 'BE777',
      });
      expect(h.db.row('user', 'u1')!.pointsBalance).toBe(0);
    }
    expect(h.db.row('wasteRequest', 'hp1')!.status).toBe('IN_TRANSIT');

    const rec = await h.receiveSvc.receive('s1', 'hp1', { match: { parcelCode: 'TR-HP179' } });
    expect(rec.outcome).toBe('RECEIVED');
    expect(h.db.row('wasteRequest', 'hp1')!.status).toBe('RECEIVED');
    expect(h.db.row('user', 'u1')!.pointsBalance).toBe(0);
    expect(h.db.rows('pointsTransaction')).toHaveLength(0);
  });

  it('P3b: chỉ confirm mới đúc điểm RECYCLE, và confirm × confirm đồng thời cộng đúng MỘT lần (<= estimatedPoints)', async () => {
    for (const skew of [-15, -5, 0, 5, 15]) {
      const h = setup(0);
      h.db.seed('wasteRequest', [request({ id: 'r1', code: 'TR-CF179', status: 'RECEIVED', method: 'MAIL_IN', estimatedPoints: 10_000 })]);
      h.db.seed('wasteRequestLine', [cartonLine('r1', { declaredQty: 10 })]);

      const call = (staff: string): WasteStaffCall => ({ callerUserId: staff, requestId: 'r1', route: 'DESK', device: { ip: null, userAgent: null } });
      const body = { lines: [{ itemId: 'wi-carton', declaredQty: 10, receivedQty: 10 }] };
      const a = async () => (await delay(Math.max(skew, 0)), h.confirmSvc.confirm(call('s1'), body));
      const b = async () => (await delay(Math.max(-skew, 0)), h.confirmSvc.confirm(call('s2'), body));

      const settled = await Promise.allSettled([a(), b()]);
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(h.db.row('user', 'u1')!.pointsBalance).toBe(10_000);
      expect(h.db.rows('pointsTransaction').filter((t) => t.refType === 'RECYCLE')).toHaveLength(1);
    }
  });

  it('P4: reverse × redeemReward đồng thời (cùng khoá users FOR UPDATE): không khoá chết, số dư không bao giờ âm, phần thiếu ghi vào reversalShortfallPoints', async () => {
    for (const skew of [-15, -5, 0, 5, 15]) {
      const h = setup(10_000);
      h.db.seed('wasteRequest', [
        request({ id: 'r1', code: 'TR-RV179', status: 'COMPLETED', method: 'MAIL_IN', estimatedPoints: 10_000, pointsAwarded: 10_000 }),
      ]);
      h.db.seed('wasteRequestLine', [cartonLine('r1', { declaredQty: 10, receivedQty: 10 })]);
      h.db.seed('pointsTransaction', [
        {
          id: 'pt-recycle-1',
          userId: 'u1',
          delta: 10_000,
          lot: 'STANDARD',
          reason: 'RECYCLE:TR-RV179',
          refType: 'RECYCLE',
          refId: 'r1',
          expiresAt: new Date('2027-11-16T00:00:00Z'),
        },
      ]);
      h.db.seed('wasteGift', [
        { id: 'g1', kind: 'GIFT', name: 'Túi vải Tubu', pointsCost: 8_000, status: 'ACTIVE', stock: 5, voucher: null },
      ]);

      const rev = async () => (await delay(Math.max(skew, 0)), h.reverseSvc.reverse('a1', 'r1', { reason: 'Gian lận khối lượng' }));
      const red = async () => (await delay(Math.max(-skew, 0)), h.loyaltySvc.redeemReward('u1', 'g1', `idem-red-${skew}`));

      const [rRev, rRed] = await Promise.allSettled([rev(), red()]);
      expect(rRev.status).toBe('fulfilled');

      const finalBalance = h.db.row('user', 'u1')!.pointsBalance as number;
      expect(finalBalance).toBeGreaterThanOrEqual(0);

      const reqRow = h.db.row('wasteRequest', 'r1')!;
      expect(reqRow.status).toBe('REVERSED');
      if (rRed.status === 'fulfilled') {
        // Đổi quà chạy trước (trừ 8.000 -> còn 2.000) rồi thu hồi lấy hết 2.000, ghi thiếu 8.000 -> số dư 0
        expect(finalBalance).toBe(0);
        expect(reqRow.reversalShortfallPoints).toBe(8_000);
      } else {
        // Thu hồi chạy trước (trừ hết 10.000 -> còn 0) nên đổi quà 8.000 bị từ chối -> số dư 0, thiếu 0
        expect(finalBalance).toBe(0);
        expect(reqRow.reversalShortfallPoints).toBe(0);
      }
    }
  });
});
