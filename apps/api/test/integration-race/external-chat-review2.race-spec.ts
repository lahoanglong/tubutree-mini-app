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
 * Sửa sau review Opus lượt 2 của chatpts, trên Postgres THẬT: SĐT xác minh đã cũ không được làm claim mất chủ (B1), trần người tạo đơn
 * không bị vượt khi tiền hàng tăng lúc cộng (B2), hai lần liên kết song song không khoá người tạo ngược chiều (N-B), liên kết gặp SKIP
 * thì REVIEW (N-C), claim mất chủ lẫn SĐT không HELD rồi LAPSED (nhỏ).
 */
describe('Điểm đơn chat sau review lượt 2 (real Postgres)', () => {
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

  describe('B1: SĐT xác minh đã cũ thì claim vẫn gắn thành viên, chờ kiểm', () => {
    it.each([
      ['quá 180 ngày', () => new Date(Date.now() - 181 * DAY)],
      ['chưa từng xác minh', () => null],
    ])('tạo claim cho thành viên có SĐT khớp mà mốc xác minh %s: gắn userId, REVIEW, không để userId null', async (_n, at) => {
      const m = await mkUser({ phoneVerifiedAt: at() });
      const p = payload({ phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20 });
      await ingest(p);
      const c = (await claimOf(String(p.id)))!;
      expect(c).toMatchObject({ userId: m.id, state: 'REVIEW' });
      expect(c.reviewReason).toContain('xác minh đã cũ');
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).not.toBe('CREDITED');
      expect(await balanceOf(m.id)).toBe(0);
    });

    it('claim chưa có chủ, thành viên (xác minh cũ) đăng nhập: liên kết vào REVIEW; cron quét cũng vậy', async () => {
      const ph1 = phone();
      const ph2 = phone();
      const p1 = payload({ phone: ph1, goods: 500_000 });
      const p2 = payload({ phone: ph2, goods: 500_000 });
      await ingest(p1);
      await ingest(p2);
      expect(await claimOf(String(p1.id))).toMatchObject({ userId: null, state: 'PENDING' });
      const m1 = await mkUser({ phone: ph1, phoneVerifiedAt: new Date(Date.now() - 200 * DAY) });
      const m2 = await mkUser({ phone: ph2, phoneVerifiedAt: null });
      expect((await linkClaimsByPhone(prisma, deps(), m1)).linked).toBe(1);
      expect(await linkWaitingClaims(prisma, deps())).toBeGreaterThanOrEqual(1);
      expect(await claimOf(String(p1.id))).toMatchObject({ userId: m1.id, state: 'REVIEW' });
      expect(await claimOf(String(p2.id))).toMatchObject({ userId: m2.id, state: 'REVIEW' });
    });
  });

  describe('B2: tiền hàng tăng giữa lúc kiểm và lúc cộng thì REVIEW, không chốt tự động', () => {
    it('trần 30.000 theo người tạo: hai đơn 500.000 (10.000 điểm) tăng lên 5.000.000 trước khi cộng: không ai được cộng 100.000', async () => {
      await pin('loyalty.chat_order_creator_monthly_points', 30_000);
      const creator = { id: `cr-${randCode(6)}`, name: 'NV Tao Don' };
      let total = 0;
      for (let i = 0; i < 2; i++) {
        const m = await mkUser();
        const id = `CHAT${randCode(10)}`;
        await ingest(payload({ id, phone: m.phone!, goods: 500_000, deliveredDaysAgo: 20, creator, updatedAt: old() }));
        const c0 = (await claimOf(id))!;
        expect(c0).toMatchObject({ state: 'PENDING', points: 10_000 });
        await ingest(payload({ id, phone: m.phone!, goods: 5_000_000, deliveredDaysAgo: 20, creator }));
        const r = await releaseClaim(prisma, c0.id, await releaseOpts());
        expect(r.outcome).toBe('TO_REVIEW');
        expect((await claimOf(id))!.reviewReason).toContain('Tiền hàng tăng');
        total += await balanceOf(m.id);
      }
      expect(total).toBe(0);
    });
  });

  describe('N-B: hai lần liên kết song song không khoá người tạo đơn ngược chiều', () => {
    it('2 SĐT, mỗi SĐT có hai đơn của hai người tạo khác nhau (A,B và B,A): 12 vòng đều liên kết đủ, không 40P01', async () => {
      for (let round = 0; round < 12; round++) {
        const A = `CA${randCode(6)}`;
        const B = `CB${randCode(6)}`;
        const X = phone();
        const Y = phone();
        const plan: [string, string][] = [[X, A], [Y, B], [X, B], [Y, A]];
        for (const [ph, cr] of plan) await ingest(payload({ phone: ph, goods: 300_000, creator: { id: cr, name: `NV ${cr}` } }));
        const mx = await mkUser({ phone: X });
        const my = await mkUser({ phone: Y });
        const [rx, ry] = await Promise.all([linkClaimsByPhone(prisma, deps(), mx), linkClaimsByPhone(prisma, deps(), my)]);
        expect([rx.linked, ry.linked]).toEqual([2, 2]);
      }
    });
  });

  describe('N-C: liên kết gặp SKIP thì REVIEW, không cộng thô', () => {
    it('đơn bị sửa mốc tạo thành quá 60 ngày tuổi trước khi liên kết: REVIEW theo lý do SKIP, không cộng', async () => {
      const ph = phone();
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: ph, goods: 500_000, deliveredDaysAgo: 20 })))!;
      await prisma.externalOrder.update({ where: { id: order.id }, data: { pancakeInsertedAt: new Date(Date.now() - 100 * DAY) } });
      const m = await mkUser({ phone: ph });
      await linkClaimsByPhone(prisma, deps(), m);
      const c = (await claimOf(id))!;
      expect(c).toMatchObject({ userId: m.id, state: 'REVIEW' });
      expect(c.reviewReason).toContain('quá');
      await releaseClaim(prisma, c.id, await releaseOpts());
      expect(await balanceOf(m.id)).toBe(0);
    });
  });

  describe('nhỏ: claim mất cả chủ lẫn SĐT', () => {
    it('chưa có chủ, orderPhone đã bị retention xoá, tới hạn cộng: REVIEW, không HELD rồi LAPSED', async () => {
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: phone(), goods: 500_000, deliveredDaysAgo: 20 })))!;
      const c = (await claimOf(id))!;
      expect(c.userId).toBeNull();
      await prisma.externalOrder.update({ where: { id: order.id }, data: { phone: null } });
      await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { orderPhone: null } });
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW', holdUntil: null });
    });

    it('duyệt từ chối claim chưa chủ mà orderPhone của claim đã mất (400, claim vẫn REVIEW, không ghi gì), kể cả khi SĐT trên đơn được ghi lại sau đó', async () => {
      const actor = await mkUser();
      const id = `CHAT${randCode(10)}`;
      const order = (await ingest(payload({ id, phone: phone(), goods: 500_000, deliveredDaysAgo: 20 })))!;
      const c = (await claimOf(id))!;
      await prisma.externalOrder.update({ where: { id: order.id }, data: { phone: null } });
      await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { orderPhone: null } });
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      const eventsBefore = (await eventsOf(c.id)).length;

      await expect(adminSvc().approve(c.id, actor.id)).rejects.toMatchObject({
        status: 400,
        message: 'Claim chưa có chủ và không còn SĐT để liên kết nên không có ai để cộng điểm. Hãy huỷ claim.',
      });
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW', decidedById: null });
      expect((await eventsOf(c.id)).length).toBe(eventsBefore);

      await prisma.externalOrder.update({ where: { id: order.id }, data: { phone: phone() } });
      await expect(adminSvc().approve(c.id, actor.id)).rejects.toMatchObject({ status: 400 });
      expect(await claimOf(id)).toMatchObject({ state: 'REVIEW', decidedById: null });
      expect((await eventsOf(c.id)).length).toBe(eventsBefore);
    });
  });

  describe('SĐT thành viên đổi sau khi tạo claim', () => {
    async function claimWithChangedMemberPhone() {
      const member = await mkUser();
      const orderPhone = member.phone!;
      const id = `CHAT${randCode(10)}`;
      await ingest(payload({ id, phone: orderPhone, goods: 500_000, deliveredDaysAgo: 20 }));
      const c = (await claimOf(id))!;
      expect(c).toMatchObject({ userId: member.id, state: 'PENDING' });
      await prisma.user.update({ where: { id: member.id }, data: { phone: phone() } });
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect((await claimOf(id))!.reviewReason).toContain('không còn khớp');
      return { member, c, id };
    }

    it('claim đã được người duyệt: lần cộng kế tiếp cộng cho thành viên, không quay lại REVIEW', async () => {
      const actor = await mkUser();
      const { member, c, id } = await claimWithChangedMemberPhone();
      await adminSvc().approve(c.id, actor.id);
      const res = await releaseClaim(prisma, c.id, await releaseOpts());
      expect(res).toMatchObject({ outcome: 'CREDITED', userId: member.id });
      expect(await claimOf(id)).toMatchObject({ state: 'CREDITED', decidedById: actor.id });
      expect(await balanceOf(member.id)).toBeGreaterThan(0);
    });

    it('claim chưa ai duyệt: SĐT thành viên lệch vẫn đưa về REVIEW, không cộng', async () => {
      const { member, c } = await claimWithChangedMemberPhone();
      await prisma.externalPointsClaim.update({ where: { id: c.id }, data: { state: 'PENDING', reviewReason: null } });
      expect((await releaseClaim(prisma, c.id, await releaseOpts())).outcome).toBe('TO_REVIEW');
      expect(await balanceOf(member.id)).toBe(0);
    });
  });
});
