import type { HttpException } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import type { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { LoyaltyExpiryService } from '../../src/modules/loyalty/loyalty-expiry.service';
import { findPointsLotDrift } from '../../src/modules/loyalty/points-reconcile';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { applyStatusToClaim } from '../../src/modules/external-points/external-claim-status';
import { releaseClaim, releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { createUser, deleteItData, pinConfig, randCode, summarize, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Điểm đơn mua ngoài app (B6, extclaim) trên Postgres THẬT: gửi mã song song, trần ngày/tháng, cron cộng chạy chồng, đảo điểm khi đơn
 * hoàn, sổ lô hết hạn so với thu hồi, và đơn sàn không làm đổi hạng.
 */
describe('Điểm đơn ngoài app: claim, cộng, đảo (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const notify = jest.fn(async () => undefined);
  const lookup = { lookupAndIngest: jest.fn(async () => false) };

  const freshConfig = () => new SystemConfigService(prisma);
  const freshService = () => new ExternalClaimService(prisma, freshConfig(), lookup as never, { notify } as never);
  const admin = (svc = freshService()) => new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, svc);

  async function pin(key: string, value: string | number | boolean) {
    restore.push(await pinConfig(prisma, key, value));
  }
  async function unpinAll() {
    for (const r of restore.splice(0).reverse()) await r();
  }

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });

  beforeEach(async () => {
    notify.mockClear();
    await pin('loyalty.marketplace_claim_enabled', true);
    await pin('loyalty.point_expire_months', 12);
  });

  afterEach(async () => {
    await unpinAll();
  });

  afterAll(async () => {
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalClaimAttempt.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser() {
    const u = await createUser(prisma, { phone: phone(), zaloId: `zalo_${randCode(10)}` });
    userIds.push(u.id);
    return u;
  }
  async function mkOrder(over: Record<string, unknown> = {}) {
    const code = `IT${randCode(10)}`;
    const now = new Date();
    const o = await prisma.externalOrder.create({
      data: {
        pancakeOrderId: `EXTCL${randCode(10)}`,
        source: 'MARKETPLACE',
        channel: 'shopee',
        sourceKey: '-3|it|-3',
        trackingCode: code,
        trackingCodes: [code],
        goodsValue: 200_000,
        pancakeStatus: 2,
        status: 'OPEN',
        pancakeInsertedAt: new Date(now.getTime() - DAY),
        pancakeUpdatedAt: now,
        lastPayload: {},
        ...over,
      },
    });
    orderIds.push(o.id);
    return { ...o, code };
  }
  const codeOf = (e: unknown) => ((e as HttpException).getResponse() as { code: string }).code;
  const rejectionCodes = (results: PromiseSettledResult<unknown>[]) => summarize(results).rejected.length === 0 ? [] : results.filter((r) => r.status === 'rejected').map((r) => codeOf((r as PromiseRejectedResult).reason));

  /** Claim PENDING sẵn cho user trên đơn đã giao `deliveredDaysAgo` ngày. */
  async function pendingClaim(userId: string, over: { points?: number; deliveredDaysAgo?: number; goodsValue?: number } = {}) {
    const order = await mkOrder({ status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date(Date.now() - (over.deliveredDaysAgo ?? 20) * DAY), goodsValue: over.goodsValue ?? 200_000 });
    const claim = await prisma.externalPointsClaim.create({
      data: {
        externalOrderId: order.id,
        userId,
        kind: 'SCAN',
        state: 'PENDING',
        ratePct: 1,
        multiplier: 1,
        points: over.points ?? 2_000,
        claimedCode: order.code,
        dayKey: new Date().toISOString().slice(0, 10),
      },
    });
    return { order, claim };
  }
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).pointsBalance;
  const ledger = (userId: string, prefix: string) => prisma.pointsTransaction.findMany({ where: { userId, reason: { startsWith: prefix } } });
  async function noDrift() {
    expect(await findPointsLotDrift(prisma, userIds)).toEqual([]);
  }

  it('(a) 6 khách gửi CÙNG một mã song song: đúng một claim, 5 người còn lại ALREADY_CLAIMED', async () => {
    const order = await mkOrder();
    const users = await Promise.all(Array.from({ length: 6 }, mkUser));
    const results = await Promise.allSettled(users.map((u) => freshService().submit(u.id, order.code)));
    const s = summarize(results);
    console.log('[a] fulfilled=%d rejected=%d', s.fulfilled.length, s.rejected.length);
    expect(s.fulfilled).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(Array(5).fill('ALREADY_CLAIMED'));
    expect(await prisma.externalPointsClaim.count({ where: { externalOrderId: order.id } })).toBe(1);
  });

  it('(b1) một khách gửi 8 mã khác nhau song song: trần ngày 3 claim luôn đúng', async () => {
    const user = await mkUser();
    const orders = await Promise.all(Array.from({ length: 8 }, () => mkOrder()));
    const results = await Promise.allSettled(orders.map((o) => freshService().submit(user.id, o.code)));
    const s = summarize(results);
    console.log('[b1] fulfilled=%d rejected=%d codes=%j', s.fulfilled.length, s.rejected.length, rejectionCodes(results));
    expect(s.fulfilled).toHaveLength(3);
    expect(new Set(rejectionCodes(results))).toEqual(new Set(['DAILY_MAX']));
    expect(await prisma.externalPointsClaim.count({ where: { userId: user.id } })).toBe(3);
  });

  it('(b2) trần điểm tháng: 6 mã song song, mỗi mã 2.000 điểm, trần 5.000, đúng 2 claim', async () => {
    await pin('loyalty.marketplace_claim_daily_max', 50);
    await pin('loyalty.marketplace_claim_monthly_points_cap', 5_000);
    const user = await mkUser();
    const orders = await Promise.all(Array.from({ length: 6 }, () => mkOrder()));
    const results = await Promise.allSettled(orders.map((o) => freshService().submit(user.id, o.code)));
    const s = summarize(results);
    expect(s.fulfilled).toHaveLength(2);
    expect(new Set(rejectionCodes(results))).toEqual(new Set(['MONTHLY_CAP']));
    const sum = await prisma.externalPointsClaim.aggregate({ where: { userId: user.id }, _sum: { points: true } });
    expect(sum._sum.points).toBe(4_000);
  });

  it('(c) 5 lần không tìm thấy: lần thứ 6 bị khoá 24h (LOCKED), attempt không ghi thêm khi đang khoá', async () => {
    await pin('loyalty.marketplace_claim_daily_attempts', 50);
    const user = await mkUser();
    const svc = freshService();
    for (let i = 0; i < 5; i++) expect((await svc.submit(user.id, `ZZ${randCode(10)}`)).status).toBe('SEARCHING');
    await expect(svc.submit(user.id, `ZZ${randCode(10)}`)).rejects.toMatchObject({ response: { code: 'LOCKED' } });
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id } })).toBe(5);
  });

  it('(d) cron cộng chạy hai lần song song và 6 lượt releaseClaim: đúng MỘT dòng sổ điểm, số dư khớp sổ', async () => {
    const user = await mkUser();
    const { claim } = await pendingClaim(user.id);
    const config = freshConfig();
    const runs = await Promise.allSettled([
      releaseDueClaims(prisma, config, { notify }),
      releaseDueClaims(prisma, freshConfig(), { notify }),
      ...Array.from({ length: 6 }, () => releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 })),
    ]);
    expect(summarize(runs).rejected).toHaveLength(0);
    const rows = await ledger(user.id, 'MARKETPLACE_ORDER:');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 2_000, refType: 'EXTERNAL_ORDER', refId: claim.id, lot: 'STANDARD' });
    expect(rows[0]!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
    expect(await balanceOf(user.id)).toBe(2_000);
    const after = await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(after).toMatchObject({ state: 'CREDITED', pointsTxId: rows[0]!.id });
    const credited = await prisma.analyticsEvent.findMany({ where: { eventName: 'ext_claim_credited', userId: user.id } });
    expect(credited).toHaveLength(1);
    expect(credited[0]!.props).toMatchObject({ points: 2_000 });
    await noDrift();
  });

  it('(d2) chưa đủ 14 ngày kể từ lúc giao thì chưa cộng; đơn không còn DELIVERED thì không cộng', async () => {
    const user = await mkUser();
    const young = await pendingClaim(user.id, { deliveredDaysAgo: 13 });
    const returning = await pendingClaim(user.id);
    await prisma.externalOrder.update({ where: { id: returning.order.id }, data: { status: 'RETURNING', pancakeStatus: 4 } });
    await releaseDueClaims(prisma, freshConfig(), { notify });
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: young.claim.id } })).toMatchObject({ state: 'PENDING' });
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: returning.claim.id } })).toMatchObject({ state: 'PENDING' });
    expect(await ledger(user.id, 'MARKETPLACE_ORDER')).toHaveLength(0);
  });

  it('(d3) điểm chốt theo tiền hàng mới nhất lúc cộng; tiền hàng mất (null) thì chuyển REVIEW, không cộng', async () => {
    const user = await mkUser();
    const a = await pendingClaim(user.id, { points: 2_000 });
    await prisma.externalOrder.update({ where: { id: a.order.id }, data: { goodsValue: 150_000 } });
    const b = await pendingClaim(user.id);
    await prisma.externalOrder.update({ where: { id: b.order.id }, data: { goodsValue: null } });
    await releaseDueClaims(prisma, freshConfig(), { notify });
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: a.claim.id } })).toMatchObject({ state: 'CREDITED', points: 1_500 });
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: b.claim.id } })).toMatchObject({ state: 'REVIEW' });
    expect(await balanceOf(user.id)).toBe(1_500);
  });

  describe('đảo điểm khi đơn hoàn: min(điểm, phần lô còn, số dư)', () => {
    async function credited(points = 2_000) {
      const user = await mkUser();
      const { order, claim } = await pendingClaim(user.id, { points });
      await releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 });
      expect(await balanceOf(user.id)).toBe(points);
      return { user, order, claim };
    }
    const markReturned = (orderId: string, status: 'RETURNED' | 'CANCELLED' = 'RETURNED') =>
      prisma.externalOrder.update({ where: { id: orderId }, data: { status, pancakeStatus: status === 'RETURNED' ? 5 : 6, closedAt: new Date() } });
    const apply = (pid: string) => applyStatusToClaim(prisma, { notify }, freshConfig(), pid);

    it('đủ số dư: thu hồi đủ, claim REVERSED, năm lần áp song song chỉ ghi MỘT dòng đảo', async () => {
      const { user, order, claim } = await credited();
      await markReturned(order.id);
      const results = await Promise.all(Array.from({ length: 5 }, () => apply(order.pancakeOrderId)));
      expect(results.filter((r) => r === 'REVERSE').length).toBeGreaterThanOrEqual(1);
      const rows = await ledger(user.id, 'MARKETPLACE_ORDER_REVERSED:');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ delta: -2_000, refType: 'EXTERNAL_ORDER', refId: claim.id });
      expect(await balanceOf(user.id)).toBe(0);
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'REVERSED' });
      await noDrift();
    });

    it('khách đã tiêu 1.500: chỉ thu hồi phần số dư còn (500), không âm', async () => {
      const { user, order } = await credited();
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: user.id, delta: -1_500, lot: 'STANDARD', reason: 'IT_SPEND', refType: 'IT' } }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { decrement: 1_500 } } }),
      ]);
      await markReturned(order.id, 'CANCELLED');
      await apply(order.pancakeOrderId);
      const rows = await ledger(user.id, 'MARKETPLACE_ORDER_REVERSED:');
      expect(rows.map((r) => r.delta)).toEqual([-500]);
      expect(await balanceOf(user.id)).toBe(0);
      await noDrift();
    });

    it('lô đã hết hạn và cron đã trừ: đảo không trừ lần hai (không dòng đảo, số dư không âm)', async () => {
      const { user, order, claim } = await credited();
      await prisma.$executeRaw`
        UPDATE "points_transactions" SET "createdAt" = "createdAt" - interval '13 months', "expiresAt" = "expiresAt" - interval '13 months' WHERE "userId" = ${user.id}`;
      const expiry = new LoyaltyExpiryService(prisma, freshConfig(), { notify } as never);
      await expiry.expirePoints();
      expect(await balanceOf(user.id)).toBe(0);
      await markReturned(order.id);
      await apply(order.pancakeOrderId);
      expect(await ledger(user.id, 'MARKETPLACE_ORDER_REVERSED:')).toHaveLength(0);
      expect(await balanceOf(user.id)).toBe(0);
      expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'REVERSED' });
      await noDrift();
    });

    it('đảo trước rồi tới hạn hết hạn: cron không trừ lô đã thu hồi, điểm khác của khách nguyên vẹn', async () => {
      const { user, order } = await credited();
      await prisma.$transaction([
        prisma.pointsTransaction.create({ data: { userId: user.id, delta: 1_000, lot: 'STANDARD', reason: 'IT_OLD_LOT', refType: 'GAME', expiresAt: null } }),
        prisma.user.update({ where: { id: user.id }, data: { pointsBalance: { increment: 1_000 } } }),
      ]);
      await markReturned(order.id);
      await apply(order.pancakeOrderId);
      expect(await balanceOf(user.id)).toBe(1_000);
      await prisma.$executeRaw`
        UPDATE "points_transactions" SET "createdAt" = "createdAt" - interval '13 months', "expiresAt" = "expiresAt" - interval '13 months' WHERE "userId" = ${user.id}`;
      const expiry = new LoyaltyExpiryService(prisma, freshConfig(), { notify } as never);
      await expiry.expirePoints();
      expect(await ledger(user.id, 'POINTS_EXPIRED')).toHaveLength(0);
      expect(await balanceOf(user.id)).toBe(1_000);
      await noDrift();
    });
  });

  it('(e) đơn sàn không tính xét hạng: tierPoints vẫn 0 sau khi cộng điểm đơn sàn, recalcTier không ném', async () => {
    const user = await mkUser();
    const { claim } = await pendingClaim(user.id, { points: 50_000, goodsValue: 5_000_000 });
    await releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 });
    expect(await balanceOf(user.id)).toBe(50_000);
    const loyalty = new LoyaltyService(prisma, freshConfig());
    const since = new Date(Date.now() - 365 * DAY);
    const tierPoints = await (loyalty as unknown as { tierPoints: (u: string, s: Date) => Promise<number> }).tierPoints(user.id, since);
    expect(tierPoints).toBe(0);
    // Bảng hạng là dữ liệu chung của cả bộ race (suite khác để lại hạng minPoints 0), nên so với
    // một khách không có điểm nào thay vì so với tierId ban đầu.
    const control = await mkUser();
    await loyalty.recalcTier(control.id);
    await loyalty.recalcTier(user.id);
    const tierOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).tierId;
    expect(await tierOf(user.id)).toBe(await tierOf(control.id));
  });

  it('(f) applyStatusToClaim: huỷ chưa cộng thành VOIDED một lần; giao sau khi huỷ tự động thì REVIEW', async () => {
    const user = await mkUser();
    const order = await mkOrder({ status: 'OPEN' });
    const claim = await prisma.externalPointsClaim.create({
      data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: order.code, dayKey: '2026-10-20' },
    });
    await prisma.externalOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED', pancakeStatus: 6 } });
    const config = freshConfig();
    await Promise.all(Array.from({ length: 4 }, () => applyStatusToClaim(prisma, { notify }, config, order.pancakeOrderId)));
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'VOIDED', decidedById: null });
    expect(notify.mock.calls.filter((c) => (c as unknown[])[1] === 'EXTERNAL_POINTS_VOIDED')).toHaveLength(1);
    await prisma.externalOrder.update({ where: { id: order.id }, data: { status: 'DELIVERED', pancakeStatus: 3, deliveredAt: new Date() } });
    await applyStatusToClaim(prisma, { notify }, config, order.pancakeOrderId);
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'REVIEW' });
  });

  it('(g) mã chưa thấy đơn: attempt UNMATCHED; khi đơn về, cron ghép lại tạo claim và báo khách', async () => {
    const user = await mkUser();
    const svc = freshService();
    const code = `LATE${randCode(8)}`;
    expect((await svc.submit(user.id, code)).status).toBe('SEARCHING');
    expect((await svc.submit(user.id, code)).status).toBe('SEARCHING');
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id, result: 'UNMATCHED' } })).toBe(1);
    await mkOrder({ trackingCode: code, trackingCodes: [code] });
    const r = await svc.rematchUnmatched();
    expect(r.matched).toBeGreaterThanOrEqual(1);
    expect(await prisma.externalPointsClaim.count({ where: { userId: user.id, claimedCode: code, state: 'PENDING' } })).toBe(1);
    expect(await prisma.externalClaimAttempt.count({ where: { userId: user.id, result: 'MATCHED', resolvedAt: { not: null } } })).toBe(1);
    expect(notify.mock.calls.some((c) => (c as unknown[])[1] === 'EXTERNAL_POINTS_PENDING')).toBe(true);
  });

  it('(h) admin: huỷ thường chặn mã; "Huỷ và mở lại mã" cho khách khác tích lại; chỉ claim chưa cộng mới huỷ được', async () => {
    const a = await mkUser();
    const b = await mkUser();
    const c = await mkUser();
    const o1 = await mkOrder();
    const o2 = await mkOrder();
    const svc = freshService();
    const adm = admin(svc);
    const first = await svc.submit(a.id, o1.code);
    await adm.voidClaim(first.claimId!, 'staff1', 'khách nhập nhầm', false);
    await expect(svc.submit(b.id, o1.code)).rejects.toMatchObject({ response: { code: 'ALREADY_CLAIMED' } });
    const second = await svc.submit(a.id, o2.code);
    await adm.voidClaim(second.claimId!, 'staff1', 'nghi gian lận', true);
    const again = await svc.submit(c.id, o2.code);
    // Mã đã được nhân viên mở lại: người nhận lại luôn vào REVIEW, và người mở lại không duyệt được.
    expect(again.status).toBe('REVIEW');
    expect(again.claimId).toBe(second.claimId);
    await expect(adm.approve(second.claimId!, 'staff1')).rejects.toMatchObject({ response: { code: 'SAME_INTRODUCER' } });
    await adm.approve(second.claimId!, 'staff2');
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: second.claimId! } })).toMatchObject({ userId: c.id, state: 'PENDING', voidReason: null });
    await releaseDueClaims(prisma, freshConfig(), { notify });
    const { claim } = await pendingClaim(a.id);
    await releaseClaim(prisma, claim.id, { pendingDays: 14, expiryMonths: 12 });
    await expect(adm.voidClaim(claim.id, 'staff1', 'x', false)).rejects.toMatchObject({ status: 409 });
    const rev = await adm.reverse(claim.id, 'admin1', 'đơn gian lận');
    expect(rev).toEqual({ claimId: claim.id, reversedPoints: 2_000 });
    await expect(adm.reverse(claim.id, 'admin1', 'lần hai')).rejects.toMatchObject({ status: 409 });
    await noDrift();
  });

  it('(i) admin gắn lần gửi mã vào đơn: claim PENDING cho đúng khách; gắn hai lần chỉ một lần thắng', async () => {
    const user = await mkUser();
    const svc = freshService();
    const adm = admin(svc);
    const code = `MANUAL${randCode(8)}`;
    await svc.submit(user.id, code);
    const attempt = await prisma.externalClaimAttempt.findFirstOrThrow({ where: { userId: user.id, code } });
    const order = await mkOrder();
    const results = await Promise.allSettled([adm.attach(attempt.id, order.pancakeOrderId, { id: 'staff1', role: 'ADMIN' }, 'đối chiếu ảnh'), adm.attach(attempt.id, order.pancakeOrderId, { id: 'staff2', role: 'ADMIN' }, 'đối chiếu ảnh')]);
    expect(summarize(results).fulfilled).toHaveLength(1);
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { externalOrderId: order.id } })).toMatchObject({ userId: user.id, state: 'PENDING', claimedCode: code });
    expect(await prisma.externalClaimAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ result: 'MATCHED', externalOrderId: order.id });
  });

  it('(j) webhook Pancake đổi trạng thái: processor nối vào claim (giao thì đồng bộ mốc cộng, huỷ thì VOIDED)', async () => {
    const processor = new PancakeProcessor(prisma, { notify } as never, { setStatus: jest.fn() } as unknown as OrderStatusService, undefined, freshConfig());
    const user = await mkUser();
    const pid = `EXTCL${randCode(10)}`;
    const code = `IT${randCode(10)}`;
    const body = (status: number, updatedAt: string, extra: Record<string, unknown> = {}) => ({
      id: pid,
      status,
      marketplace_id: -3,
      is_from_ecommerce: true,
      order_sources: -3,
      account: 'shopee_it',
      items: [{ quantity: 1, discount_each_product: 0, variation_info: { retail_price: 200_000 } }],
      total_price: 200_000,
      total_discount: 0,
      partner: { extend_code: code },
      updated_at: updatedAt,
      ...extra,
    });
    const send = async (payload: Record<string, unknown>) => {
      const event = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'orders', dedupeKey: `orders|${randCode(16)}`, rawPayload: payload as object, status: 'RECEIVED' } });
      await processor.process({ data: { eventId: event.id } } as Job<{ eventId: string }>);
    };
    await send(body(2, '2026-10-10T09:00:00'));
    const order = await prisma.externalOrder.findUniqueOrThrow({ where: { pancakeOrderId: pid } });
    orderIds.push(order.id);
    const claim = await prisma.externalPointsClaim.create({
      data: { externalOrderId: order.id, userId: user.id, kind: 'SCAN', state: 'PENDING', ratePct: 1, multiplier: 1, points: 2_000, claimedCode: code, dayKey: '2026-10-10' },
    });
    await send(body(3, '2026-10-11T09:00:00', { status_history: [{ status: 3, updated_at: '2026-10-11T09:00:00' }] }));
    expect((await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).releaseAt?.toISOString()).toBe('2026-10-25T02:00:00.000Z');
    await send(body(6, '2026-10-12T09:00:00'));
    expect(await prisma.externalPointsClaim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({ state: 'VOIDED' });
    await prisma.pancakeWebhookEvent.deleteMany({ where: { rawPayload: { path: ['id'], equals: pid } } });
  });
});
