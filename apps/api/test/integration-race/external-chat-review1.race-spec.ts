import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { ExternalClaimsAdminService } from '../../src/modules/external-points/external-claims-admin.service';
import { ExternalClaimService } from '../../src/modules/external-points/external-claim.service';
import { backfillChatClaims, ensureChatClaim, linkClaimsByPhone, linkWaitingClaims } from '../../src/modules/external-points/external-chat.claim';
import { loadChatConfig } from '../../src/modules/external-points/external-chat.config';
import { releaseClaim, releaseDueClaims } from '../../src/modules/external-points/external-claim-release';
import { ingestAndApply } from '../../src/modules/external-points/external-order.sync';
import { createUser, deleteItData, pinConfig, randCode, warmPool } from './helpers';

const DAY = 864e5;

/**
 * Sửa sau review Opus lượt 1 của chatpts, trên Postgres THẬT. Mỗi ca dựng lại kịch bản đã chứng minh được trên bản 1d042dc0:
 * liên kết ghi đè điểm không kiểm ngưỡng/trần (C1, C2), nhân viên sửa SĐT trên đơn để chuyển điểm (N1), status 16 bỏ qua điều kiện vận
 * đơn (N2), sửa tiền hàng sau khi cộng làm hạng nhảy (N3), số điện thoại cũ không còn xác minh (N4), người tạo đơn tự cộng (N5) và các
 * lỗi nhỏ của cron (claim thiếu SĐT, tiền tố sổ, hàng chờ bị kẹt).
 */
describe('Điểm đơn chat sau review lượt 1 (real Postgres)', () => {
  let prisma: PrismaService;
  const restore: (() => Promise<void>)[] = [];
  const userIds: string[] = [];
  const orderIds: string[] = [];
  const tierIds: string[] = [];
  const notify = jest.fn(async (..._args: unknown[]) => undefined);
  const MAP = { marketplaceIds: { '-3': 'shopee' }, chatSources: ['ITCHAT|itacc|'] };

  const freshConfig = () => new SystemConfigService(prisma);
  const deps = () => ({ config: freshConfig(), notifier: { notify } as never });
  const pin = async (key: string, value: Prisma.InputJsonValue) => restore.push(await pinConfig(prisma, key, value));

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
  });
  beforeEach(async () => {
    notify.mockClear();
    await pin('loyalty.chat_order_points_enabled', true);
    await pin('loyalty.point_expire_months', 12);
    await pin('loyalty.earn_pct', 2);
    await pin('loyalty.chat_order_earn_pct', null);
    await pin('loyalty.chat_order_monthly_points_cap', 200_000);
    await pin('loyalty.chat_order_review_above_vnd', 5_000_000);
    await pin('loyalty.chat_order_require_carrier', true);
    await pin('loyalty.chat_unclaimed_hold_days', 30);
    await pin('loyalty.external_pending_days', 14);
    await pin('loyalty.external_since', null);
  });
  afterEach(async () => {
    for (const r of restore.splice(0).reverse()) await r();
  });
  afterAll(async () => {
    const claimIds = (await prisma.externalPointsClaim.findMany({ where: { OR: [{ userId: { in: userIds } }, { externalOrderId: { in: orderIds } }] }, select: { id: true } })).map((c) => c.id);
    await prisma.externalClaimEvent.deleteMany({ where: { claimId: { in: claimIds } } });
    await prisma.externalPointsClaim.deleteMany({ where: { id: { in: claimIds } } });
    await prisma.externalOrder.deleteMany({ where: { id: { in: orderIds } } });
    await deleteItData(prisma, { userIds });
    await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    await prisma?.$disconnect();
  });

  const phone = () => `09${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  async function mkUser(over: Partial<Prisma.UserUncheckedCreateInput> = {}) {
    const u = await createUser(prisma, { phone: phone(), phoneVerifiedAt: new Date(), zaloId: `zalo_${randCode(10)}`, ...over });
    userIds.push(u.id);
    return u;
  }
  async function mkTier(multiplier: number, over: Partial<Prisma.MembershipTierUncheckedCreateInput> = {}) {
    const t = await prisma.membershipTier.create({
      data: { id: `ITR1_${randCode(8)}`, name: `x${multiplier}`, sortOrder: 60, minPoints: 2_000_000_000, minSpending: 2_000_000_000, discountPct: 0, pointMultiplier: multiplier, perks: {}, ...over },
    });
    tierIds.push(t.id);
    return t;
  }

  function payload(o: { id?: string; phone?: string; goods?: number; status?: number; deliveredDaysAgo?: number; extendCode?: string | null; updatedAt?: Date; creator?: { id: string; name: string } } = {}) {
    const goods = o.goods ?? 500_000;
    const now = new Date();
    const delivered = o.deliveredDaysAgo !== undefined ? new Date(now.getTime() - o.deliveredDaysAgo * DAY) : null;
    return {
      id: o.id ?? `CHAT${randCode(10)}`,
      status: o.status ?? (delivered ? 3 : 1),
      order_sources: 'ITCHAT',
      account: 'itacc',
      bill_phone_number: o.phone ?? phone(),
      items: [{ quantity: 1, variation_info: { retail_price: goods } }],
      total_price: goods,
      inserted_at: new Date(now.getTime() - 20 * DAY).toISOString(),
      updated_at: (o.updatedAt ?? now).toISOString(),
      ...(o.extendCode === null ? {} : { partner: { extend_code: o.extendCode ?? `GHN${randCode(9)}` } }),
      ...(delivered ? { status_history: [{ status: 3, updated_at: delivered.toISOString() }] } : {}),
      ...(o.creator ? { creator: o.creator } : {}),
    };
  }
  async function ingest(p: Record<string, unknown>, tiers?: Awaited<ReturnType<typeof prisma.membershipTier.findMany>>) {
    const l = new LoyaltyService(prisma, freshConfig());
    await ingestAndApply(prisma, { ...deps(), recalcTier: (id) => l.recalcTier(id, tiers) }, p, MAP);
    const order = await prisma.externalOrder.findUnique({ where: { pancakeOrderId: String(p['id']) } });
    if (order && !orderIds.includes(order.id)) orderIds.push(order.id);
    return order;
  }
  const old = () => new Date(Date.now() - 60_000);
  const claimOf = (id: string) => prisma.externalPointsClaim.findFirst({ where: { externalOrder: { pancakeOrderId: id } } });
  const balanceOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).pointsBalance;
  const eventsOf = (claimId: string) => prisma.externalClaimEvent.findMany({ where: { claimId }, orderBy: { createdAt: 'asc' } });
  const releaseOpts = async () => ({ pendingDays: 14, expiryMonths: 12, chat: await loadChatConfig(freshConfig()) });
  const adminSvc = () =>
    new ExternalClaimsAdminService(prisma, freshConfig(), { notify } as never, new ExternalClaimService(prisma, freshConfig(), { lookupAndIngest: async () => false } as never, { notify } as never));

  describe('C1 và C2: liên kết phải kiểm lại ngưỡng, nhân viên và trần tháng', () => {
    it('C1: tiền hàng đổi từ 1.000.000 lên 100.000.000 trước khi khách liên kết: REVIEW, không cộng thẳng', async () => {
      const ph = phone();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: ph, goods: 1_000_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c0 = (await claimOf(id))!;
      expect(c0).toMatchObject({ state: 'PENDING', userId: null, points: 20_000 });
      await ingest(payload({ id, phone: ph, goods: 100_000_000, deliveredDaysAgo: 20 }));
      const user = await mkUser({ phone: ph });
      await linkClaimsByPhone(prisma, deps(), user);
      const res = await releaseClaim(prisma, c0.id, await releaseOpts());
      expect(res.outcome).not.toBe('CREDITED');
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW', userId: user.id });
      expect(await balanceOf(user.id)).toBe(0);
    });

    it('C2: hai claim 100.000 đúng trần 200.000, thành viên hạng x2 liên kết: tổng điểm không vượt trần', async () => {
      const ph = phone();
      const tier = await mkTier(2);
      const ids = [`CHAT${randCode(10)}`, `CHAT${randCode(10)}`];
      for (const id of ids) await ingest(payload({ id, phone: ph, goods: 5_000_000, deliveredDaysAgo: 20 }));
      const user = await mkUser({ phone: ph, tierId: tier.id });
      await linkClaimsByPhone(prisma, deps(), user);
      const opts = await releaseOpts();
      for (const id of ids) await releaseClaim(prisma, (await claimOf(id))!.id, opts);
      const claims = await Promise.all(ids.map((id) => claimOf(id)));
      expect(claims.reduce((s, c) => s + (c!.state === 'CREDITED' ? c!.points : 0), 0)).toBeLessThanOrEqual(200_000);
      expect(await balanceOf(user.id)).toBeLessThanOrEqual(200_000);
    });

    it('thành viên đã có sẵn, tiền hàng tăng vượt ngưỡng sau khi tạo claim: REVIEW lúc cộng (đối chứng)', async () => {
      const user = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: user.phone!, goods: 1_000_000, deliveredDaysAgo: 20, updatedAt: old() }));
      await ingest(payload({ id, phone: user.phone!, goods: 100_000_000, deliveredDaysAgo: 20 }));
      const res = await releaseClaim(prisma, (await claimOf(id))!.id, await releaseOpts());
      expect(res.outcome).toBe('TO_REVIEW');
      expect(await balanceOf(user.id)).toBe(0);
    });
  });

  describe('N1: SĐT trên đơn đổi sau khi có claim', () => {
    it('claim chưa liên kết của X, webhook đổi sang Y, Y rồi X đăng nhập: REVIEW + PHONE_CHANGED, không ai nhận điểm', async () => {
      const px = phone();
      const py = phone();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: px, goods: 1_000_000, deliveredDaysAgo: 20, updatedAt: old() }));
      const c0 = (await claimOf(id))!;
      await ingest(payload({ id, phone: py, goods: 1_000_000, deliveredDaysAgo: 20 }));
      const y = await mkUser({ phone: py });
      const x = await mkUser({ phone: px });
      await linkClaimsByPhone(prisma, deps(), y);
      await linkClaimsByPhone(prisma, deps(), x);
      await releaseClaim(prisma, c0.id, await releaseOpts());
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW', userId: null });
      expect((await eventsOf(c0.id)).map((e) => e.action)).toContain('PHONE_CHANGED');
      expect(await balanceOf(y.id)).toBe(0);
      expect(await balanceOf(x.id)).toBe(0);
    });

    it('claim đã gắn thành viên X, webhook đổi SĐT sang số khác: chuyển REVIEW, không cộng', async () => {
      const x = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: x.phone!, goods: 1_000_000, deliveredDaysAgo: 20, updatedAt: old() }));
      expect(await claimOf(id)).toMatchObject({ state: 'PENDING', userId: x.id });
      await ingest(payload({ id, phone: phone(), goods: 1_000_000, deliveredDaysAgo: 20 }));
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW' });
      expect(await balanceOf(x.id)).toBe(0);
    });

    it('SĐT đơn bị đổi thẳng trong DB (không qua webhook): releaseClaim chuyển REVIEW + PHONE_CHANGED thay vì bỏ qua mãi', async () => {
      const x = await mkUser();
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: x.phone!, goods: 1_000_000, deliveredDaysAgo: 20 })))!;
      await prisma.externalOrder.update({ where: { id: order.id }, data: { phone: phone() } });
      const c = (await claimOf(id))!;
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect((await eventsOf(c.id)).map((e) => e.action)).toContain('PHONE_CHANGED');
    });
  });

  describe('N2: status 16 không có vận đơn', () => {
    it('đơn 3.000.000 status 16, không extend_code: REVIEW; có extend_code thì PENDING', async () => {
      const user = await mkUser();
      const bad = payload({ phone: user.phone!, goods: 3_000_000, status: 16, extendCode: null });
      await ingest(bad);
      expect(await claimOf(String(bad.id))).toMatchObject({ state: 'REVIEW' });
      const ok = payload({ phone: user.phone!, goods: 3_000_000, status: 16 });
      await ingest(ok);
      expect(await claimOf(String(ok.id))).toMatchObject({ state: 'PENDING' });
    });
  });

  describe('N3: tiền hàng chốt lúc cộng', () => {
    it('sửa tiền hàng 500.000 thành 25.000.000 sau khi cộng: hạng không nhảy, creditedGoodsValue giữ 500.000', async () => {
      const base = await mkTier(1, { sortOrder: 1, minPoints: 0, minSpending: 0 });
      const top = await mkTier(2, { sortOrder: 99, minPoints: 1_000_000_000, minSpending: 20_000_000 });
      const tiers = [base, top];
      const user = await mkUser();
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20, updatedAt: old() }), tiers);
      const l = new LoyaltyService(prisma, freshConfig());
      expect((await releaseClaim(prisma, (await claimOf(id))!.id, await releaseOpts())).outcome).toBe('CREDITED');
      await l.recalcTier(user.id, tiers);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(base.id);
      await ingest(payload({ id, phone: user.phone!, goods: 25_000_000, deliveredDaysAgo: 20 }), tiers);
      await l.recalcTier(user.id, tiers);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tierId).toBe(base.id);
      expect((await claimOf(id))!.creditedGoodsValue).toBe(500_000);
    });
  });

  describe('N4: SĐT thành viên phải còn xác minh gần đây', () => {
    it('phoneVerifiedAt quá 180 ngày hoặc chưa có: claim vẫn gắn thành viên nhưng chờ kiểm (không tự cộng); còn mới thì PENDING', async () => {
      const stale = await mkUser({ phoneVerifiedAt: new Date(Date.now() - 200 * DAY) });
      const never = await mkUser({ phoneVerifiedAt: null });
      const fresh = await mkUser({ phoneVerifiedAt: new Date(Date.now() - 10 * DAY) });
      const ids: Record<string, string> = {};
      for (const u of [stale, never, fresh]) {
        ids[u.id] = `CHAT${randCode(10)}`;
        await ingest(payload({ id: ids[u.id], phone: u.phone!, goods: 500_000 }));
      }
      expect(await claimOf(ids[stale.id]!)).toMatchObject({ userId: stale.id, state: 'REVIEW' });
      expect(await claimOf(ids[never.id]!)).toMatchObject({ userId: never.id, state: 'REVIEW' });
      expect(await claimOf(ids[fresh.id]!)).toMatchObject({ userId: fresh.id, state: 'PENDING' });
    });
  });

  describe('N5: người tạo đơn', () => {
    it('tổng điểm tự cộng của một creator.id trong tháng vượt loyalty.chat_order_creator_monthly_points: đơn kế tiếp REVIEW', async () => {
      await pin('loyalty.chat_order_creator_monthly_points', 25_000);
      const creator = { id: `pc-${randCode(6)}`, name: 'Nhan Vien A' };
      const states: string[] = [];
      for (let i = 0; i < 3; i++) {
        const p = payload({ goods: 500_000, creator });
        await ingest(p);
        states.push((await claimOf(String(p.id)))!.state);
      }
      expect(states).toEqual(['PENDING', 'PENDING', 'REVIEW']);
      const other = payload({ goods: 500_000, creator: { id: `pc-${randCode(6)}`, name: 'Nhan Vien B' } });
      await ingest(other);
      expect((await claimOf(String(other.id)))!.state).toBe('PENDING');
    });

    it('pancake.staff_map: thành viên nhận điểm chính là nhân viên tạo đơn: REVIEW; người duyệt trùng nhân viên map cũng bị chặn', async () => {
      const creatorId = `pc-${randCode(6)}`;
      const staffUser = await mkUser({ role: 'CUSTOMER', fullName: 'Le Van Staff' });
      const approver = await mkUser({ role: 'STAFF', fullName: 'Pham Thi Khac' });
      await pin('pancake.staff_map', { [creatorId]: staffUser.id, [`pc-${randCode(5)}`]: approver.id });
      const p = payload({ phone: staffUser.phone!, goods: 500_000, creator: { id: creatorId, name: 'Ten Khac Hoan Toan' } });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c.state).toBe('REVIEW');
      expect(c.creatorRef).toBe(creatorId);

      const creatorId2 = `pc-${randCode(6)}`;
      await pin('pancake.staff_map', { [creatorId2]: approver.id });
      const p2 = payload({ goods: 5_500_000, creator: { id: creatorId2, name: 'Ten Khac Hoan Toan' } });
      await ingest(p2);
      const c2 = (await claimOf(String(p2.id)))!;
      expect(c2.state).toBe('REVIEW');
      await expect(adminSvc().approve(c2.id, approver.id)).rejects.toMatchObject({ response: { code: 'PANCAKE_CREATOR_SELF' } });
    });
  });

  describe('lỗi nhỏ của cron', () => {
    it('claim đã gắn thành viên mà đơn mất SĐT (retention): vẫn cộng được, không bị bỏ qua mãi', async () => {
      const user = await mkUser();
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 })))!;
      await prisma.externalOrder.update({ where: { id: order.id }, data: { phone: null } });
      await prisma.externalPointsClaim.updateMany({ where: { externalOrderId: order.id }, data: { orderPhone: null } });
      const res = await releaseClaim(prisma, (await claimOf(id))!.id, await releaseOpts());
      expect(res.outcome).toBe('CREDITED');
      expect(await balanceOf(user.id)).toBe(10_000);
    });

    it('tiền tố sổ theo claim.kind, không theo order.source', async () => {
      const user = await mkUser();
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 })))!;
      const c = (await claimOf(id))!;
      await prisma.externalOrder.update({ where: { id: order.id }, data: { source: 'MARKETPLACE' as never } });
      await releaseClaim(prisma, c.id, await releaseOpts());
      const rows = await prisma.pointsTransaction.findMany({ where: { userId: user.id } });
      expect(rows.map((r) => r.reason)).toEqual([`PANCAKE_CHAT_ORDER:${id}`]);
    });

    it('linkWaitingClaims: tài khoản không đủ điều kiện (bị khoá) không chiếm chỗ của người đủ điều kiện', async () => {
      const goodPhone = phone();
      await ingest(payload({ phone: goodPhone, goods: 500_000 }));
      const blocked: string[] = [];
      for (let i = 0; i < 5; i++) {
        const ph = phone();
        await ingest(payload({ phone: ph, goods: 500_000 }));
        blocked.push(ph);
      }
      for (const ph of blocked) await mkUser({ phone: ph, isBlocked: true });
      const good = await mkUser({ phone: goodPhone });
      for (let i = 0; i < 2; i++) await linkWaitingClaims(prisma, deps(), new Date(), 1);
      const claim = await prisma.externalPointsClaim.findFirst({ where: { orderPhone: goodPhone } });
      expect(claim?.userId).toBe(good.id);
    });

    it('backfill: đơn đã xét và bị bỏ qua không chiếm đầu lô mãi, đơn đủ điều kiện ở sau vẫn được tạo bù', async () => {
      await pin('loyalty.chat_order_points_enabled', false);
      const goodPhone = phone();
      const good = payload({ phone: goodPhone, goods: 500_000 });
      await ingest(good);
      await pin('loyalty.chat_order_points_enabled', true);
      for (let i = 0; i < 3; i++) await ingest(payload({ phone: phone(), goods: 10 }));
      for (let i = 0; i < 4; i++) await backfillChatClaims(prisma, deps(), new Date(), 2);
      expect(await claimOf(String(good.id))).toMatchObject({ kind: 'PHONE' });
    });

    it('releaseDueClaims cộng được claim thiếu SĐT cùng lô với claim thường', async () => {
      const user = await mkUser();
      const a = `CHAT${randCode(10)}`;
      const b = `CHAT${randCode(10)}`;
      const oa = (await ingest(payload({ id: a, phone: user.phone!, goods: 500_000, deliveredDaysAgo: 20 })))!;
      await ingest(payload({ id: b, phone: user.phone!, goods: 300_000, deliveredDaysAgo: 20 }));
      await prisma.externalOrder.update({ where: { id: oa.id }, data: { phone: null } });
      await prisma.externalPointsClaim.updateMany({ where: { externalOrderId: oa.id }, data: { orderPhone: null } });
      const r = await releaseDueClaims(prisma, freshConfig(), { notify } as never);
      expect(r.credited).toBeGreaterThanOrEqual(2);
      expect(await balanceOf(user.id)).toBe(16_000);
    });

    it('ensureChatClaim vẫn idempotent sau khi thêm cột', async () => {
      const p = payload();
      await ingest(p);
      expect(await ensureChatClaim(prisma, deps(), String(p.id))).toBe('EXISTS');
    });
  });
});
